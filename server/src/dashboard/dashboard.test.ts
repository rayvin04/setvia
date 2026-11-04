import test from "node:test";
import assert from "node:assert/strict";
import { createPreviewFixture, PreviewScenarios } from "./fixtures.js";
import { DashboardSnapshotSchema } from "../../../shared/dashboard.js";
import { projectDashboardRoom, projectDashboardSnapshot } from "./projection.js";
import { fixture, judge } from "../agents/fixtures.js";
import { buildLabRecords, labSemanticsMatch } from "../agents/lab-scenarios.js";
import { renderLab } from "../agents/lab.js";

globalThis.fetch = async () => {
  throw new Error("No live requests are allowed in dashboard tests.");
};
test("departed participants' shared contributions remain renderable in an authorized snapshot", async () => {
  const f = await fixture([]);
  let room = await f.store.read(f.roomId);
  await f.engine.rooms.submit(f.roomId, f.other, {
    messageId: "departing_shared_message", text: "My shared planning detail", visibility: "group",
    expectedRevision: room.revision, proposalVersion: room.proposalVersion, questionId: null, replyOption: null,
  });
  room = await f.store.read(f.roomId);
  await f.engine.rooms.leave(f.roomId, f.other, room.revision);
  const snapshot = DashboardSnapshotSchema.parse(projectDashboardSnapshot(await f.engine.rooms.view(f.roomId, f.auth)));
  assert.equal(snapshot.contributions[0]?.participantName, "Former participant");
  assert.equal(snapshot.contributions[0]?.text, "My shared planning detail");
});
const beach = createPreviewFixture("beach");
const family = createPreviewFixture("family");

test("dashboard frames use actual deterministic readiness and proposal revisions", async () => {
  const frames = await beach;
  const initial = frames.initial.alex!;
  const updated = frames.updated.alex!;
  const revised = frames.revised.alex!;
  assert.equal(initial.room.readiness?.percentage, 72);
  assert.equal(updated.room.readiness?.percentage, 92);
  assert.equal(updated.room.readiness?.delta, 20);
  assert.equal(revised.room.proposal.values.time, "6:30 AM – 6:00 PM");
  assert.ok(revised.room.proposalVersion > initial.room.proposalVersion);
  assert.equal(initial.room.approvalCount, 0);
  assert.equal(revised.room.approvalCount, 0);
  assert.equal(
    revised.responses.some((r) => r.responded),
    false,
  );
  assert.equal(
    frames.carpool.alex!.room.findings.some(
      (f) => f.id === "carpool_drivers" && f.status === "open",
    ),
    true,
  );
});
test("critical safety overrides an 83 percent result while the analysis cycle can complete", async () => {
  const snapshot = (await createPreviewFixture("safety")).initial.alex!;
  assert.equal(snapshot.room.readiness?.percentage, 83);
  assert.equal(snapshot.room.readiness?.status, "blocked");
  assert.equal(snapshot.room.loopState, "WAIT_FOR_PARTICIPANT");
  assert.equal(snapshot.room.findings[0].category, "Safety Check");
  assert.equal(snapshot.room.findings[0].severity, "critical");
});
test("personal questions and question activity are projected server-side for their recipient", async () => {
  const frames = await family;
  const pat = frames.initial.mika!;
  const alex = frames.initial.alex!;
  const sam = frames.initial.sam!;
  const jo = frames.initial.jo!;
  assert.equal(pat.room.questions.length, 1);
  assert.equal(pat.room.questions[0].targetId, pat.room.viewerId);
  assert.equal(pat.room.questions[0].visibility, "private");
  assert.equal(alex.room.questions.length, 0);
  assert.equal(sam.room.questions.length, 0);
  assert.equal(
    sam.activity.some((e) => /private planning question/i.test(e.summary)),
    false,
  );
  assert.equal(
    JSON.stringify(alex).includes("step-free entrance"),
    false,
  );
  assert.match(JSON.stringify(pat), /step-free entrance/);
  for (const snapshot of [alex, sam, jo])
    assert.doesNotMatch(
      JSON.stringify(snapshot),
      /step-free entrance|accessible restroom|privateFacts|tokenHash|invitationHash|pendingInputs|traces|promptHash/,
    );
  assert.equal(pat.contributions.filter((entry) => entry.visibility === "private").length, 1);
  for (const snapshot of [alex, sam, jo])
    assert.equal(snapshot.contributions.some((entry) => entry.visibility === "private"), false);
});
test("group questions are visible to each authorized synthetic viewer", async () => {
  const frames = await beach;
  assert.equal(
    frames.initial.alex!.room.questions[0].text,
    frames.initial.sam!.room.questions[0].text,
  );
  assert.equal(frames.initial.sam!.room.questions[0].visibility, "group");
});
test("projection requires RoomService authorization and omits own raw private facts", async () => {
  const f = await fixture([{ role: "Judge", output: judge() }]);
  await f.engine.rooms.confirmFact(
    f.roomId,
    f.auth,
    (await f.store.read(f.roomId)).revision,
    {
      id: "private",
      key: "private",
      value: "PRIVATE_CANARY",
      ownerId: f.auth.participantId,
      confirmed: true,
      visibility: "private",
      scope: "participant",
    },
  );
  await f.engine.run(f.roomId, f.auth);
  await assert.rejects(
    f.engine.rooms.view(f.roomId, { ...f.auth, token: "forged" }),
    /UNAUTHORIZED/,
  );
  const projection = projectDashboardRoom(
    await f.engine.rooms.view(f.roomId, f.auth),
  );
  assert.doesNotMatch(
    JSON.stringify(projection),
    /PRIVATE_CANARY|privateFacts|tokenHash|traces/,
  );
});
test("blocked analysis retains the last score and publishes no fabricated findings or decisions", async () => {
  const snapshot = (await createPreviewFixture("blocked")).initial.alex!;
  assert.equal(snapshot.room.loopState, "BLOCKED");
  assert.equal(snapshot.room.readiness?.percentage, 72);
  assert.equal(snapshot.room.finalEvaluationAvailable, false);
  assert.deepEqual(snapshot.room.questions, []);
  assert.deepEqual(snapshot.room.options, []);
  assert.deepEqual(snapshot.room.findings, []);
});
test("unevaluated room has no percentage and completed kickoff remains separate from approval", async () => {
  const empty = (await createPreviewFixture("empty")).initial.alex!;
  const kickoff = (await createPreviewFixture("kickoff")).review.alex!;
  assert.equal(empty.room.readiness, null);
  assert.equal(empty.history.length, 0);
  assert.equal(kickoff.room.readiness?.percentage, 100);
  assert.equal(kickoff.room.readiness?.status, "ready_for_human_review");
  assert.equal(kickoff.room.loopState, "COMPLETED");
  assert.equal(kickoff.room.approved, false);
  assert.equal(kickoff.room.approvalCount, 0);
});
test("all preview scenarios preserve six categories and publish schema-checked envelopes", async () => {
  for (const scenario of PreviewScenarios) {
    const frames =
      scenario === "beach"
        ? await beach
        : scenario === "family"
          ? await family
          : await createPreviewFixture(scenario);
    for (const frame of Object.values(frames))
      for (const snapshot of Object.values(frame)) {
        assert.equal(DashboardSnapshotSchema.safeParse(snapshot).success, true);
        if (snapshot.room.readiness)
          assert.equal(
            new Set(snapshot.room.readiness.categories.map((c) => c.category))
              .size,
            6,
          );
      }
  }
});
test("the five judge demos provide a complete fictional journey without prefilled approvals", async () => {
  const expectedEventTypes = {
    beach: "Beach trip",
    family: "Family reunion",
    kickoff: "Project kickoff",
    study: "Group project",
    wedding: "Wedding planning",
  } as const;
  for (const [scenario, eventType] of Object.entries(expectedEventTypes)) {
    const frames = await createPreviewFixture(scenario as keyof typeof expectedEventTypes);
    const initial = frames.initial.alex!;
    const updated = frames.updated.alex!;
    const review = frames.review.alex!;
    assert.equal(initial.room.eventType, eventType);
    assert.equal(initial.room.participants.length, 4);
    assert.equal(initial.contributions.filter((entry) => entry.visibility === "group").length, 4);
    assert.ok(initial.room.questions.length > 0 ||
      Object.values(frames.initial).some((snapshot) => snapshot?.room.questions.length));
    assert.equal(initial.room.loopState, "WAIT_FOR_PARTICIPANT");
    assert.ok((updated.room.readiness?.percentage ?? 0) > (initial.room.readiness?.percentage ?? 0));
    assert.equal(review.room.loopState, "COMPLETED");
    assert.equal(review.room.readiness?.status, "ready_for_human_review");
    assert.equal(review.room.approvalCount, 0);
    assert.equal(review.room.approved, false);
    assert.equal(review.room.participants.some((person) => person.approved), false);
    for (const frame of Object.values(frames))
      for (const snapshot of Object.values(frame)) {
        assert.ok(snapshot);
        assert.equal(snapshot.room.approvalCount, 0);
        assert.equal(snapshot.room.participants.some((person) => person.approved), false);
      }
  }
});
test("kickoff and group project mark irrelevant checks as not applicable", async () => {
  const kickoff = (await createPreviewFixture("kickoff")).initial.alex!.room;
  const study = (await createPreviewFixture("study")).initial.alex!.room;
  const kickoffStatuses = new Map(
    kickoff.readiness!.categories.map((category) => [category.category, category.status]),
  );
  const studyStatuses = new Map(
    study.readiness!.categories.map((category) => [category.category, category.status]),
  );
  for (const category of ["Budget Check", "Logistics Check", "Safety Check"])
    assert.equal(kickoffStatuses.get(category as never), "not_applicable");
  for (const category of ["Logistics Check", "Safety Check"])
    assert.equal(studyStatuses.get(category as never), "not_applicable");
});
test("Lab semantics reject the previous People Check and budget explanation mismatch", async () => {
  const records = await buildLabRecords();
  assert.equal(records.filter((r) => r.passed).length, 5);
  for (const record of records) assert.equal(labSemanticsMatch(record), true);
  const reunion = structuredClone(records[2]);
  reunion.cycle.finalEvaluation!.findings[0].message =
    "Confirm the shared budget.";
  reunion.cycle.finalEvaluation!.findings[0].recommendedAction =
    "Ask for a spending limit.";
  assert.equal(labSemanticsMatch(reunion), false);
  const html = renderLab(records);
  assert.match(html, /class=readiness-blocked>BLOCKED<\/strong> 83%/);
  assert.match(html, /Participant approval: not simulated/);
});
