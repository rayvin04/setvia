import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  validatePlanningMessage,
  PlanningMessageError,
  planningMessageErrorText,
  MAX_PLANNING_MESSAGE_LENGTH,
  type PlanningMessage,
} from "../../shared/planning-message.js";
import type { Question } from "../../server/src/agents/contracts.js";
import { createPreviewInteractions } from "./preview-interactions.js";
import {
  currentQuestion,
  questionQuickReplies,
  virtualKeyboardInset,
} from "./composer-model.js";
import {
  MessageComposer,
  type MessageComposerProps,
} from "./MessageComposer.js";
import { PlanPanel } from "./PlanningPanels.js";
import { createPreviewFixture } from "../../server/src/dashboard/fixtures.js";
import {
  DashboardSnapshotSchema,
  validateDashboardAction,
} from "../../shared/dashboard.js";
import {
  acceptDashboardUpdate,
  categoryPresentation,
  readinessPresentation,
  responseCount,
  speakerPresentation,
} from "./model.js";

const beach = createPreviewFixture("beach");
function messageFor(
  snapshot: Awaited<typeof beach>["initial"]["alex"],
  overrides: Partial<PlanningMessage> = {},
): PlanningMessage {
  const room = snapshot!.room;
  return {
    roomId: room.roomId,
    viewerId: room.viewerId,
    expectedRevision: room.revision,
    proposalVersion: room.proposalVersion,
    questionId: null,
    replyOption: null,
    visibility: "private",
    text: "I can bring the first-aid kit.",
    ...overrides,
  };
}

test("composer validates trimmed nonempty messages, lengths and current viewer/version leases", async () => {
  const snapshot = (await beach).initial.alex!;
  assert.equal(
    validatePlanningMessage(
      snapshot.room,
      messageFor(snapshot, { text: "  My budget is ₱500.  " }),
    ).text,
    "My budget is ₱500.",
  );
  for (const extra of [
    { text: " \n " },
    { text: "x".repeat(MAX_PLANNING_MESSAGE_LENGTH + 1) },
    { viewerId: "another_person" },
    { roomId: "another_room" },
    { proposalVersion: snapshot.room.proposalVersion - 1 },
    { expectedRevision: snapshot.room.revision - 1 },
  ])
    assert.throws(
      () => validatePlanningMessage(snapshot.room, messageFor(snapshot, extra)),
      PlanningMessageError,
    );
});
test("group preview contributions are projected to room members without inventing approval or readiness", async () => {
  const frames = await beach;
  const mika = frames.initial.mika!;
  const original = structuredClone(mika);
  const adapter = createPreviewInteractions({
    createId: () => "contribution_1",
  });
  const receipt = await adapter.submit(
    messageFor(mika, {
      visibility: "group",
      text: "We forgot transportation.",
    }),
    () => mika,
    new AbortController().signal,
  );
  assert.equal(receipt.mode, "preview");
  const alex = adapter.project(frames.initial.alex!);
  assert.equal(alex.contributions[0].text, "We forgot transportation.");
  assert.equal(responseCount(alex.snapshot), 4);
  assert.deepEqual(alex.snapshot.room.readiness, mika.room.readiness);
  assert.equal(alex.snapshot.room.approvalCount, 0);
  assert.deepEqual(mika, original);
});
test("private preview responses never enter another viewer's contribution or activity projection", async () => {
  const frames = await beach;
  const mika = frames.initial.mika!;
  const adapter = createPreviewInteractions();
  await adapter.submit(
    messageFor(mika, { text: "PRIVATE_COMPOSER_CANARY" }),
    () => mika,
    new AbortController().signal,
  );
  assert.equal(
    adapter.project(mika).contributions[0].text,
    "PRIVATE_COMPOSER_CANARY",
  );
  assert.doesNotMatch(
    JSON.stringify(adapter.project(frames.initial.alex!)),
    /PRIVATE_COMPOSER_CANARY/,
  );
  assert.equal(
    adapter.project({
      ...frames.initial.alex!,
      source: "room",
      responseTracking: "unavailable",
      responses: [],
    }).contributions.length,
    0,
  );
});
test("answering a group question acknowledges only this member and does not approve the proposal", async () => {
  const frames = await beach;
  const alex = frames.initial.alex!;
  const q = currentQuestion(alex.room)!;
  const adapter = createPreviewInteractions();
  await adapter.submit(
    messageFor(alex, {
      questionId: q.id,
      replyOption: q.options[0],
      text: q.options[0],
    }),
    () => alex,
    new AbortController().signal,
  );
  assert.equal(currentQuestion(adapter.project(alex).snapshot.room), undefined);
  assert.equal(
    currentQuestion(adapter.project(frames.initial.sam!).snapshot.room)?.id,
    q.id,
  );
  assert.equal(adapter.project(alex).snapshot.room.approvalCount, 0);
  assert.equal(adapter.project(alex).snapshot.room.readiness?.percentage, 72);
});
test("private targeted questions require the recipient and private audience", async () => {
  const frames = await createPreviewFixture("family");
  const alex = frames.initial.alex!;
  const q = currentQuestion(alex.room)!;
  const input = messageFor(alex, {
    questionId: q.id,
    text: "I need a step-free entrance.",
  });
  assert.equal(validatePlanningMessage(alex.room, input).visibility, "private");
  assert.throws(
    () => validatePlanningMessage(alex.room, { ...input, visibility: "group" }),
    /private answer/,
  );
  assert.throws(
    () =>
      validatePlanningMessage(frames.initial.sam!.room, {
        ...input,
        viewerId: frames.initial.sam!.room.viewerId,
      }),
    /no longer available/,
  );
  assert.throws(
    () =>
      validatePlanningMessage(
        alex.room,
        { ...input, visibility: "group", questionId: null },
        ["private"],
      ),
    /visibility is unavailable/,
  );
});
test("preview submission preserves multiline text and reset removes temporary contributions", async () => {
  const snapshot = (await beach).initial.alex!;
  const adapter = createPreviewInteractions();
  const text =
    "Saturday does not work.\nMy budget is ₱500.\nI can help with food.";
  await adapter.submit(
    messageFor(snapshot, { text }),
    () => snapshot,
    new AbortController().signal,
  );
  assert.equal(adapter.project(snapshot).contributions[0].text, text);
  adapter.reset(snapshot.room.roomId);
  assert.deepEqual(adapter.project(snapshot).contributions, []);
});
test("pending preview messages revalidate revision and participant before recording", async () => {
  const frames = await beach;
  let current = frames.initial.alex!;
  let release!: () => void;
  const adapter = createPreviewInteractions({
    beforeRecord: () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  });
  const promise = adapter.submit(
    messageFor(current),
    () => current,
    new AbortController().signal,
  );
  assert.equal(adapter.project(current).contributions.length, 0);
  current = frames.updated.alex!;
  release();
  await assert.rejects(promise, /proposal changed/);
  assert.equal(adapter.project(current).contributions.length, 0);
});
test("switching viewers or aborting a pending response cannot record under a foreign identity", async () => {
  const frames = await beach;
  let current = frames.initial.alex!;
  let release!: () => void;
  const adapter = createPreviewInteractions({
    beforeRecord: () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  });
  const signal = new AbortController();
  const promise = adapter.submit(
    messageFor(current),
    () => current,
    signal.signal,
  );
  current = frames.initial.sam!;
  release();
  await assert.rejects(promise, /participant changed/);
  const aborted = new AbortController();
  const cancelled = adapter.submit(
    messageFor(current),
    () => current,
    aborted.signal,
  );
  aborted.abort();
  release();
  await assert.rejects(cancelled);
  assert.equal(adapter.project(current).contributions.length, 0);
});
test("preview failures are recoverable and unknown errors never expose their payload", async () => {
  const snapshot = (await beach).initial.alex!;
  const adapter = createPreviewInteractions({ limit: 1 });
  await adapter.submit(
    messageFor(snapshot),
    () => snapshot,
    new AbortController().signal,
  );
  await assert.rejects(
    adapter.submit(
      messageFor(snapshot),
      () => snapshot,
      new AbortController().signal,
    ),
    /Reset the preview/,
  );
  assert.doesNotMatch(
    planningMessageErrorText(new Error("PRIVATE_ERROR_PAYLOAD")),
    /PRIVATE_ERROR_PAYLOAD/,
  );
  assert.equal(
    planningMessageErrorText(Object.assign(
      new Error("This room has reached its approved live-analysis limit."),
      { name: "RoomApiError" },
    )),
    "This room has reached its approved live-analysis limit.",
  );
  adapter.reset(snapshot.room.roomId);
  await adapter.submit(
    messageFor(snapshot),
    () => snapshot,
    new AbortController().signal,
  );
  assert.equal(adapter.project(snapshot).contributions.length, 1);
});
test("quick replies retain validated arbitrary choices and make alternative input or detail review explicit", async () => {
  const snapshot = (await beach).initial.alex!;
  const room = snapshot.room;
  const q = {
    ...currentQuestion(room)!,
    options: [
      "₱500",
      "Monday",
      "Reject",
      "Suggest another time",
      "Review details",
    ],
  };
  const replies = questionQuickReplies(q);
  assert.deepEqual(
    replies.map((reply) => reply.label),
    q.options,
  );
  assert.deepEqual(
    replies.map((reply) => reply.intent),
    ["submit", "submit", "submit", "compose", "review"],
  );
  assert.throws(
    () =>
      validatePlanningMessage(
        { ...room, questions: [q] },
        messageFor(snapshot, {
          questionId: q.id,
          replyOption: "Unvalidated answer",
        }),
      ),
    /reply option changed/,
  );
});

test("a choice that conflicts with a confirmed requirement cannot be sent as an ordinary quick reply", () => {
  const question: Question = {
    id: "departure_choice",
    findingId: "schedule_gap",
    targetId: null,
    visibility: "group",
    kind: "choice",
    text: "When should the group leave?",
    options: ["Leave at 9 AM [conflicts with a confirmed requirement]"],
  };
  assert.equal(questionQuickReplies(question)[0]?.intent, "compose");
});
test("composer renders labeled pending, disabled and safe error states", async () => {
  const room = (await beach).initial.alex!.room;
  const props: MessageComposerProps = {
    roomId: room.roomId,
    viewer: room.participants[0],
    revision: room.revision,
    proposalVersion: room.proposalVersion,
    question: currentQuestion(room),
    replies: questionQuickReplies(currentQuestion(room)),
    allowedVisibilities: ["private", "group"],
    onSubmit: async () => {
      throw new Error("not called during render");
    },
    mode: "preview",
  };
  const pending = renderToStaticMarkup(
    createElement(MessageComposer, { ...props, pending: true }),
  );
  assert.match(pending, /aria-busy="true"/);
  assert.match(pending, /Recording preview response/);
  assert.match(pending, /disabled=""/);
  assert.match(pending, /maxLength="1000"/i);
  const error = renderToStaticMarkup(
    createElement(MessageComposer, {
      ...props,
      disabled: true,
      disabledReason: "Wait for this update.",
      error: "Your response wasn’t recorded. Please try again.",
    }),
  );
  assert.match(error, /role="alert"/);
  assert.match(error, /aria-describedby=/);
  assert.match(error, /Wait for this update/);
  assert.match(error, /Message visibility/);
});
test("event attendees remain separate from response and approval denominators", async () => {
  const snapshot = structuredClone((await beach).initial.alex!);
  snapshot.room.proposal.values.expectedAttendees = 150;
  const html = renderToStaticMarkup(createElement(PlanPanel, { snapshot }));
  assert.match(html, /150 expected/);
  assert.match(html, /separate from room members/);
  assert.equal(snapshot.room.participants.length, 4);
  assert.equal(responseCount(snapshot), 3);
  assert.equal(snapshot.room.approvalCount, 0);
});
test("visual viewport offsets keep a mobile composer above an overlay keyboard", () => {
  assert.equal(virtualKeyboardInset(780, 400, 0), 380);
  assert.equal(virtualKeyboardInset(780, 400, 50), 330);
  assert.equal(virtualKeyboardInset(400, 400, 0), 0);
  assert.equal(virtualKeyboardInset(780, 900, 0), 0);
});
test("dashboard contracts support the foundation's 58-person scenario", async () => {
  const snapshot = structuredClone((await beach).initial.alex!);
  const original = snapshot.room.participants[0];
  snapshot.room.participants = Array.from({ length: 58 }, (_, index) => ({
    id: index === 0 ? original.id : `person_${index}`,
    name: `Person ${index + 1}`,
    approved: false,
  }));
  snapshot.room.approvalCount = 0;
  snapshot.room.approved = false;
  snapshot.responses = snapshot.room.participants.map((person) => ({
    participantId: person.id,
    proposalVersion: snapshot.room.proposalVersion,
    responded: false,
  }));
  assert.equal(DashboardSnapshotSchema.safeParse(snapshot).success, true);
});
test("readiness color honors critical gates over ordinary numeric thresholds", async () => {
  const safety = (await createPreviewFixture("safety")).initial.alex!;
  assert.equal(readinessPresentation(safety.room).tone, "red");
  assert.equal(readinessPresentation(safety.room).label, "Blocked");
  assert.equal(
    categoryPresentation(safety.room, "Safety Check").severity,
    "Critical",
  );
  assert.equal(
    categoryPresentation(safety.room, "Safety Check").unresolved.length,
    1,
  );
});
test("readiness distinguishes unknown, stale, blocked analysis and human review", async () => {
  const room = (await beach).initial.alex!.room;
  assert.equal(
    readinessPresentation({ ...room, readiness: null }).label,
    "Not evaluated",
  );
  assert.equal(
    readinessPresentation({ ...room, analysisCurrent: false }).historical,
    true,
  );
  assert.equal(
    readinessPresentation({ ...room, loopState: "BLOCKED" }).label,
    "Analysis blocked",
  );
  assert.equal(
    readinessPresentation({ ...room, loopState: "BLOCKED" }).historical,
    true,
  );
  const kickoff = (await createPreviewFixture("kickoff")).initial.alex!.room;
  assert.equal(readinessPresentation(kickoff).label, "Ready for review");
  assert.equal(kickoff.approved, false);
});
test("stale, duplicate, foreign and malformed event snapshots cannot replace a current view", async () => {
  const { initial, updated } = await beach;
  const current = updated.alex!;
  assert.equal(acceptDashboardUpdate(current, initial.alex), current);
  assert.equal(acceptDashboardUpdate(current, current), current);
  assert.equal(
    acceptDashboardUpdate(current, {
      ...current,
      sequence: 999,
      room: { ...current.room, revision: current.room.revision - 1 },
    }),
    current,
  );
  assert.equal(
    acceptDashboardUpdate(current, {
      ...current,
      sequence: 999,
      room: {
        ...current.room,
        proposalVersion: current.room.proposalVersion - 1,
      },
    }),
    current,
  );
  assert.equal(
    acceptDashboardUpdate(initial.alex!, { ...updated.sam!, sequence: 999 }),
    initial.alex,
  );
  assert.equal(
    acceptDashboardUpdate(initial.alex!, {
      ...updated.alex!,
      room: { ...updated.alex!.room, roomId: "another_room" },
    }),
    initial.alex,
  );
  assert.equal(
    acceptDashboardUpdate(current, { rawPrivateResponse: "PRIVATE_CANARY" }),
    current,
  );
  assert.equal(acceptDashboardUpdate(initial.alex!, current).sequence, 2);
});
test("validated choices accept only current structured options for this participant", async () => {
  const { room } = (await beach).initial.alex!;
  const action = {
    kind: "answer",
    questionId: room.questions[0].id,
    option: room.questions[0].options[0],
    expectedRevision: room.revision,
    proposalVersion: room.proposalVersion,
  };
  assert.equal(validateDashboardAction(room, action).kind, "answer");
  assert.throws(() =>
    validateDashboardAction(room, {
      ...action,
      option: "Unvalidated fake choice",
    }),
  );
  assert.throws(() =>
    validateDashboardAction(room, {
      ...action,
      expectedRevision: room.revision - 1,
    }),
  );
  assert.throws(() =>
    validateDashboardAction(room, {
      ...action,
      proposalVersion: room.proposalVersion - 1,
    }),
  );
  assert.throws(() =>
    validateDashboardAction(room, {
      kind: "proposal",
      optionId: "made_up",
      expectedRevision: room.revision,
      proposalVersion: room.proposalVersion,
    }),
  );
});
test("a private question cannot be submitted by a different participant", async () => {
  const snapshot = (await createPreviewFixture("family")).initial.alex!;
  const other = snapshot.room.participants.find(
    (p) => p.id !== snapshot.room.viewerId,
  )!;
  assert.throws(() =>
    validateDashboardAction(
      { ...snapshot.room, viewerId: other.id },
      {
        kind: "information",
        questionId: snapshot.room.questions[0].id,
        text: "Foreign answer",
        expectedRevision: snapshot.room.revision,
        proposalVersion: snapshot.room.proposalVersion,
      },
    ),
  );
  assert.equal(
    DashboardSnapshotSchema.safeParse({
      ...snapshot,
      room: { ...snapshot.room, viewerId: other.id },
    }).success,
    false,
  );
});
test("raw traces and participant data are rejected at the rendering boundary", async () => {
  const snapshot = (await beach).initial.alex!;
  for (const extra of [
    { traces: [] },
    { privateFacts: [] },
    { pendingInputs: [] },
  ])
    assert.equal(
      DashboardSnapshotSchema.safeParse({
        ...snapshot,
        room: { ...snapshot.room, ...extra },
      }).success,
      false,
    );
  assert.equal(
    DashboardSnapshotSchema.safeParse({ ...snapshot, source: "room" }).success,
    false,
  );
});
test("real response counts remain unknown until a response ledger exists", async () => {
  const snapshot = (await beach).initial.alex!;
  assert.equal(responseCount(snapshot), 3);
  assert.equal(
    responseCount({
      ...snapshot,
      source: "room",
      responseTracking: "unavailable",
      responses: [],
    }),
    null,
  );
});
test("Speaker presents approved backend question content without claiming live reasoning", async () => {
  const snapshot = (await beach).initial.alex!;
  assert.equal(
    speakerPresentation(snapshot.room).text,
    snapshot.room.messages[0].text,
  );
  const blocked = (await createPreviewFixture("blocked")).initial.alex!;
  assert.equal(speakerPresentation(blocked.room).kind, "Analysis blocked");
  assert.equal(speakerPresentation(blocked.room).question, undefined);
  assert.equal(
    categoryPresentation(blocked.room, "Budget Check").label,
    "Pending",
  );
});
