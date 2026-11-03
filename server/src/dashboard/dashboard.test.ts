import test from "node:test";
import assert from "node:assert/strict";
import { createPreviewFixture, PreviewScenarios } from "./fixtures.js";
import { DashboardSnapshotSchema } from "../../../shared/dashboard.js";
import { projectDashboardRoom } from "./projection.js";
import { fixture, judge } from "../agents/fixtures.js";
import { buildLabRecords, labSemanticsMatch } from "../agents/lab-scenarios.js";
import { renderLab } from "../agents/lab.js";

globalThis.fetch = async () => {
  throw new Error("No live requests are allowed in dashboard tests.");
};
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
  assert.equal(initial.room.approvalCount, 2);
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
  const alex = frames.initial.alex!;
  const sam = frames.initial.sam!;
  assert.equal(alex.room.questions.length, 1);
  assert.equal(alex.room.questions[0].targetId, alex.room.viewerId);
  assert.equal(sam.room.questions.length, 0);
  assert.equal(
    sam.activity.some((e) => /Alex, what access/i.test(e.summary)),
    false,
  );
  assert.equal(
    JSON.stringify(sam).includes("what access requirements would you"),
    false,
  );
  for (const snapshot of [alex, sam])
    assert.doesNotMatch(
      JSON.stringify(snapshot),
      /PRIVATE_CANARY|privateFacts|candidates|tokenHash|invitationHash|pendingInputs|traces|promptHash/,
    );
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
    /PRIVATE_CANARY|privateFacts|candidates|tokenHash|traces/,
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
test("unevaluated room has no percentage and a completed kickoff is not unanimous approval", async () => {
  const empty = (await createPreviewFixture("empty")).initial.alex!;
  const kickoff = (await createPreviewFixture("kickoff")).initial.alex!;
  assert.equal(empty.room.readiness, null);
  assert.equal(empty.history.length, 0);
  assert.equal(kickoff.room.readiness?.percentage, 100);
  assert.equal(kickoff.room.readiness?.status, "ready_for_human_review");
  assert.equal(kickoff.room.approved, false);
  assert.equal(kickoff.room.approvalCount, 2);
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
