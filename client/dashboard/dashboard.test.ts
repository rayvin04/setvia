import test from "node:test";
import assert from "node:assert/strict";
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
