import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { Categories, RoleSchemas, RoomSchema, type Question } from "./contracts.js";
import { AgentEngine, MOCK_LIMITS, annotateInfeasibleQuestionOptions, requirePlanningFollowUp, validateJudge } from "./engine.js";
import {
  fixture,
  judge,
  finding,
  negotiationSteps,
  addBudget,
  scriptedGateway,
} from "./fixtures.js";
import { JsonPersistence, RoomStore } from "./store.js";
import { RoomService, groupResponseEvidenceId, sharedContext } from "./rooms.js";
import { renderLab, saveLab } from "./lab.js";
import { getScenario, SCENARIO_IDS } from "./scenarios.js";
import { runAllScenarioMocks, runScenarioMock, runScenarioWithGateway } from "./scenario-runner.js";
import { calculateReadiness, violations } from "./readiness.js";
import { createMetaGateway, type MetaHttpEvent } from "./meta-gateway.js";
import { MetaApiError } from "../ai/errors.js";
import {
  META_API_BASE_URL,
  META_SPARK_MODEL,
  createMetaClient,
} from "../ai/meta-client.js";

test("Judge and Negotiator revise more than once and deterministically reject an invalid compromise", async () => {
  const f = await fixture(negotiationSteps());
  await addBudget(f);
  const result = await f.engine.run(f.roomId, f.auth);
  assert.equal(result.outcome, "COMPLETED");
  assert.deepEqual(
    result.traces.map((t) => t.role),
    ["Judge", "Negotiator", "Judge", "Negotiator", "Judge"],
  );
  assert.deepEqual(result.traces[2].rejectedOptionIds, ["expensive"]);
  assert.equal(result.finalEvaluation?.verdicts[0].accepted, true);
  assert.equal(result.attempts, 5);
});
test("unnecessary agents are skipped and completed analysis stops without another call", async () => {
  const f = await fixture([{ role: "Judge", output: judge() }]);
  const first = await f.engine.run(f.roomId, f.auth);
  const second = await f.engine.run(f.roomId, f.auth);
  assert.equal(first.outcome, "COMPLETED");
  assert.equal(second.id, first.id);
  assert.deepEqual(
    f.calls.map((c) => c.role),
    ["Judge"],
  );
});

test("below 70 percent reviews every missing planning area then asks a validated participant question", async () => {
  const f = await fixture([]);
  await f.store.transaction(f.roomId, (room) => { if (room) room.facts = []; });
  const initial = requirePlanningFollowUp(await f.store.read(f.roomId), judge(), 70, false);
  assert.equal(initial.next, "negotiate");
  assert.equal(initial.taskFindingIds.length, 6);
  const policyFindingId = "policy_missing_budget_check";
  const question: Question = { id: "budget_question", findingId: policyFindingId, targetId: null,
    visibility: "group", kind: "choice", text: "What per-person budget works?", options: ["₱1,000", "₱1,500"] };
  const scripted = scriptedGateway([
    { role: "Judge", output: judge() },
    { role: "Negotiator", output: { options: [{ id: "lower_cost", label: "Lower cost", values: { cost: 100 } }] } },
    { role: "Judge", output: judge({ verdicts: [{ optionId: "lower_cost", accepted: true }] }) },
    { role: "Question Strategist", output: { questions: [question] } },
    { role: "Speaker", output: { mascot: "curious", replies: [{ questionId: question.id, findingId: null, text: question.text }] } },
    { role: "Judge", output: judge({ next: "question", participantInputRequired: true, acceptedQuestionIds: [question.id] }) },
  ]);
  const engine = new AgentEngine(f.store, scripted.gateway, { ...MOCK_LIMITS, questionBelowReadiness: 70 });
  const result = await engine.run(f.roomId, f.auth);
  assert.deepEqual(scripted.calls.map((call) => call.role),
    ["Judge", "Negotiator", "Judge", "Question Strategist", "Speaker", "Judge"]);
  assert.equal(result.outcome, "WAIT_FOR_PARTICIPANT");
  assert.ok((result.readiness?.percentage ?? 100) < 70);
  assert.equal((await engine.rooms.view(f.roomId, f.auth)).questions[0]?.text, question.text);
});

test("answers restart all needed roles above 70 percent until the plan is validated", async () => {
  const f = await fixture([]);
  await f.store.transaction(f.roomId, (room) => { if (room) room.facts = room.facts.filter((fact) => fact.key !== "check_1"); });
  const first: Question = { id: "budget_first", findingId: "policy_missing_budget_check", targetId: null,
    visibility: "group", kind: "choice", text: "Which per-person budget works?", options: ["₱1,000", "₱1,500"] };
  const second: Question = { ...first, id: "budget_scope", text: "Does ₱1,000 include food and transport?", options: ["Both included", "Transport only"] };
  const rounds = (question: Question) => [
    { role: "Judge" as const, output: judge() },
    { role: "Negotiator" as const, output: { options: [{ id: "affordable", label: "Shared budget", values: { cost: 100 } }] } },
    { role: "Judge" as const, output: judge({ verdicts: [{ optionId: "affordable", accepted: true }] }) },
    { role: "Question Strategist" as const, output: { questions: [question] } },
    { role: "Speaker" as const, output: { mascot: "curious", replies: [{ questionId: question.id, findingId: null, text: question.text }] } },
    { role: "Judge" as const, output: judge({ next: "question", participantInputRequired: true, acceptedQuestionIds: [question.id] }) },
  ];
  const scripted = scriptedGateway([...rounds(first),
    { role: "Listener", output: { candidates: [{ key: "budgetAmount", value: 1000 }] } },
    ...rounds(second),
    { role: "Judge", output: judge({ findings: [finding({ id: first.findingId, status: "resolved", uncertainty: "none", evidenceIds: ["restored_check"] })] }) },
  ]);
  const engine = new AgentEngine(f.store, scripted.gateway, { ...MOCK_LIMITS, questionBelowReadiness: 70 });
  const initial = await engine.run(f.roomId, f.auth);
  assert.equal(initial.outcome, "WAIT_FOR_PARTICIPANT");
  assert.ok(initial.readiness!.percentage >= 70);
  const before = await engine.rooms.view(f.roomId, f.auth);
  await engine.rooms.submit(f.roomId, f.auth, { messageId: "answer_budget", text: "₱1,000", visibility: "group",
    questionId: first.id, replyOption: "₱1,000", expectedRevision: before.revision, proposalVersion: before.proposalVersion });
  const queued = await engine.rooms.view(f.roomId, f.auth);
  assert.equal(queued.analysisStatus, "queued");
  assert.equal(queued.analysisRoles.some((role) => role.status === "complete"), false);
  const followup = await engine.run(f.roomId, f.auth);
  assert.equal(followup.outcome, "WAIT_FOR_PARTICIPANT");
  assert.equal(followup.questions[0]?.text, second.text);
  assert.deepEqual(scripted.calls.slice(6, 13).map((call) => call.role),
    ["Listener", "Judge", "Negotiator", "Judge", "Question Strategist", "Speaker", "Judge"]);
  const strategy = scripted.calls[10]!.input as { recentlyAnsweredQuestions: Array<{ answer: string }> };
  assert.equal(strategy.recentlyAnsweredQuestions[0]?.answer, "₱1,000");
  const current = await engine.rooms.view(f.roomId, f.auth);
  await engine.rooms.confirmFact(f.roomId, f.auth, current.revision, { id: "restored_check", key: "check_1", value: true,
    ownerId: f.auth.participantId, visibility: "group", confirmed: true });
  const final = await engine.run(f.roomId, f.auth);
  assert.equal(final.outcome, "COMPLETED");
  assert.equal(final.readiness?.status, "ready_for_human_review");
  assert.deepEqual(final.questions, []);
  assert.equal((await engine.rooms.view(f.roomId, f.auth)).approved, false, "completion still requires human approval");
});

test("choice options that conflict with confirmed shared hard constraints require explicit reconsideration", async () => {
  const f = await fixture([]);
  const room = await f.store.read(f.roomId);
  room.constraints = [{
    id: "confirmed_departure_time",
    ownerId: f.auth.participantId,
    visibility: "group",
    category: "Schedule Check",
    key: "departureTime",
    operator: "gte",
    expected: "10:00 AM",
    hard: true,
  }];
  const questions: Question[] = [{
    id: "departure_choice",
    findingId: "schedule_gap",
    targetId: null,
    visibility: "group",
    kind: "choice",
    text: "When should the group leave?",
    options: ["Leave at 9 AM", "Leave at 10:30 AM"],
  }];
  annotateInfeasibleQuestionOptions(room, questions);
  assert.match(questions[0]!.options[0]!, /conflicts with a confirmed requirement/);
  assert.equal(questions[0]!.options[1], "Leave at 10:30 AM");

  const privateConstraintRoom = {
    ...room,
    constraints: room.constraints.map((constraint) => ({ ...constraint, visibility: "private" as const })),
  };
  const privateQuestions = structuredClone(questions).map((question) => ({
    ...question,
    options: ["Leave at 9 AM", "Leave at 10:30 AM"],
  }));
  annotateInfeasibleQuestionOptions(privateConstraintRoom, privateQuestions);
  assert.deepEqual(privateQuestions[0]!.options, ["Leave at 9 AM", "Leave at 10:30 AM"]);
});
async function questionFixture() {
  const f = await fixture([]);
  const question: Question = {
    id: "budget_question",
    findingId: "budget_gap",
    targetId: f.auth.participantId,
    visibility: "private",
    kind: "clarification",
    text: "What budget can you authorize sharing?",
    options: [],
  };
  const initial = judge({
    findings: [finding()],
    next: "question",
    participantInputRequired: true,
  });
  const scripted = scriptedGateway([
    { role: "Judge", output: initial },
    { role: "Question Strategist", output: { questions: [question] } },
    {
      role: "Speaker",
      output: { replies: [{ questionId: question.id, findingId: null, text: "What private budget range can we plan around?" }], mascot: "curious" },
    },
    {
      role: "Judge",
      output: { ...initial, acceptedQuestionIds: [question.id] },
    },
    {
      role: "Listener",
      output: { candidates: [{ key: "private_budget", value: 200 }] },
    },
  ]);
  const engine = new AgentEngine(f.store, scripted.gateway);
  return { ...f, ...scripted, engine, question };
}
test("targeted questions wait without polling and are hidden from other participants", async () => {
  const f = await questionFixture();
  const result = await f.engine.run(f.roomId, f.auth);
  assert.equal(result.outcome, "WAIT_FOR_PARTICIPANT");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal((await f.engine.run(f.roomId, f.other)).id, result.id);
  assert.equal(f.calls.length, 4);
  assert.equal(
    (await f.engine.rooms.view(f.roomId, f.other)).questions.length,
    0,
  );
  assert.equal(
    (await f.engine.rooms.view(f.roomId, f.auth)).messages[0].questionId,
    f.question.id,
  );
  await assert.rejects(
    f.engine.rooms.submit(
      f.roomId,
      f.other,
      result.baseRevision,
      "x",
      f.question.id,
    ),
    /UNAUTHORIZED_ANSWER/,
  );
});
test("a private reply to a group question keeps it open for other planners", async () => {
  const f = await questionFixture();
  const cycle = await f.engine.run(f.roomId, f.auth);
  await f.store.transaction(f.roomId, (room) => {
    if (room) room.questions = room.questions.map((question) => ({ ...question, visibility: "group", targetId: null }));
  });
  const room = await f.store.read(f.roomId);
  await f.engine.rooms.submit(f.roomId, f.auth, {
    messageId: "private_group_question_answer",
    expectedRevision: room.revision + (room.privateRevisions[f.auth.participantId] ?? 0),
    proposalVersion: room.proposalVersion,
    text: "I want to discuss this privately first.",
    visibility: "private",
    questionId: f.question.id,
    replyOption: null,
  });
  const ownerView = await f.engine.rooms.view(f.roomId, f.auth);
  const otherView = await f.engine.rooms.view(f.roomId, f.other);
  assert.equal((await f.store.read(f.roomId)).privatePendingInputs.length, 1);
  assert.deepEqual(ownerView.questions.map((question) => question.id), [f.question.id]);
  assert.deepEqual(otherView.questions.map((question) => question.id), [f.question.id]);
  assert.equal(JSON.stringify(otherView.responses).includes("discuss this privately"), false);
  assert.equal((await f.store.read(f.roomId)).lastCycle?.id, cycle.id);
});
test("private extraction stays owner-only until explicit sharing", async () => {
  const f = await questionFixture();
  const first = await f.engine.run(f.roomId, f.auth);
  await f.engine.rooms.submit(
    f.roomId,
    f.auth,
    first.baseRevision,
    "SYNTHETIC_PRIVATE_BUDGET",
    f.question.id,
  );
  const beforePublish = await f.store.read(f.roomId);
  const [privateResult] = await f.engine.processPrivate(f.roomId, f.auth.participantId);
  assert.equal(privateResult?.cycle.outcome, "COMPLETED");
  const afterPublish = await f.store.read(f.roomId);
  assert.equal(afterPublish.revision, beforePublish.revision);
  assert.equal(afterPublish.proposalVersion, beforePublish.proposalVersion);
  assert.deepEqual(afterPublish.approvals, {});
  assert.equal(f.calls.length, 5);
  assert.equal((await f.engine.rooms.view(f.roomId, f.auth)).approvalCount, 0);
  const roomView = await f.engine.rooms.view(f.roomId, f.other);
  assert.equal(roomView.candidates.length, 0);
  const ownerView = await f.engine.rooms.view(f.roomId, f.auth);
  assert.equal(ownerView.candidates[0]?.value, 200);
  await f.engine.rooms.shareCandidate(f.roomId, f.auth, ownerView.revision, ownerView.candidates[0]!.id);
  assert.equal((await f.engine.rooms.view(f.roomId, f.other)).facts.some((fact) => fact.value === 200 && fact.confirmed), true);
  assert.equal(
    JSON.stringify(f.calls.filter((c) => c.role !== "Listener")).includes(
      "SYNTHETIC_PRIVATE_BUDGET",
    ),
    false,
  );
});
test("AI completion and 100 percent readiness cannot bypass human approval; revisions invalidate votes", async () => {
  const f = await fixture([{ role: "Judge", output: judge() }]);
  const result = await f.engine.run(f.roomId, f.auth);
  assert.equal(result.readiness?.percentage, 100);
  assert.equal((await f.engine.rooms.view(f.roomId, f.auth)).approved, false);
  const room = await f.store.read(f.roomId);
  await f.engine.rooms.approve(f.roomId, f.auth, room.proposalVersion);
  await f.engine.rooms.approve(f.roomId, f.other, room.proposalVersion);
  assert.equal((await f.engine.rooms.view(f.roomId, f.auth)).approved, true);
  await f.engine.rooms.revise(f.roomId, f.auth, room.revision, {
    id: "new",
    label: "Changed",
    values: { cost: 160 },
  });
  const revised = await f.store.read(f.roomId);
  assert.equal(revised.proposalVersion, room.proposalVersion + 1);
  assert.deepEqual(revised.approvals, {});
  assert.equal((await f.engine.rooms.view(f.roomId, f.auth)).approved, false);
  await assert.rejects(
    f.engine.rooms.approve(f.roomId, f.auth, room.proposalVersion),
    /STALE_PROPOSAL/,
  );
  await assert.rejects(
    f.engine.rooms.approve(
      f.roomId,
      { ...f.auth, token: "forged" },
      room.proposalVersion + 1,
    ),
    /UNAUTHORIZED/,
  );
});
test("joining preserves same-version approvals and responses while requiring the new planner", async () => {
  const f = await fixture([
    { role: "Listener", output: { candidates: [] } },
    { role: "Judge", output: judge() },
    { role: "Judge", output: judge() },
  ]);
  let room = await f.store.read(f.roomId);
  await f.engine.rooms.submit(f.roomId, f.auth, {
    messageId: "response_before_join",
    expectedRevision: room.revision,
    proposalVersion: room.proposalVersion,
    text: "This group response remains valid for the unchanged proposal.",
    visibility: "group",
    questionId: null,
    replyOption: null,
  });
  const first = await f.engine.run(f.roomId, f.auth);
  assert.equal(first.outcome, "COMPLETED");
  room = await f.store.read(f.roomId);
  const proposalVersion = room.proposalVersion;
  const priorRevision = room.revision;
  await f.engine.rooms.approve(f.roomId, f.auth, proposalVersion);
  await f.engine.rooms.approve(f.roomId, f.other, proposalVersion);
  room = await f.store.read(f.roomId);
  const revisionBeforeJoin = room.revision;

  const joined = await f.engine.rooms.join(f.roomId, f.invitation, "Jordan");
  const newAuth = { participantId: joined.participantId, token: joined.token };
  room = await f.store.read(f.roomId);
  assert.equal(room.proposalVersion, proposalVersion);
  assert.equal(room.revision, revisionBeforeJoin + 1);
  assert.equal(room.activeCycleId, null);
  assert.equal(room.approvals[f.auth.participantId], proposalVersion);
  assert.equal(room.approvals[f.other.participantId], proposalVersion);
  assert.equal(room.approvals[joined.participantId], undefined);
  assert.equal(room.responses.find((response) => response.id === "response_before_join")?.proposalVersion, proposalVersion);
  assert.equal(room.responses.some((response) => response.id === "response_before_join"), true);
  await assert.rejects(
    f.engine.rooms.revise(f.roomId, f.auth, priorRevision, room.proposal),
    /STALE_STATE/,
  );

  const newPlannerBeforeReview = await f.engine.rooms.view(f.roomId, newAuth);
  assert.equal(newPlannerBeforeReview.participants.length, 3);
  assert.equal(newPlannerBeforeReview.attendance.requiredApproverIds.length, 3);
  assert.equal(newPlannerBeforeReview.approvalCount, 2);
  assert.equal(newPlannerBeforeReview.approved, false);
  assert.equal(newPlannerBeforeReview.responses.some((response) => response.id === "response_before_join"), true);

  const second = await f.engine.run(f.roomId, f.auth);
  assert.equal(second.outcome, "COMPLETED");
  await f.engine.rooms.approve(f.roomId, newAuth, proposalVersion);
  const afterNewApproval = await f.engine.rooms.view(f.roomId, newAuth);
  assert.equal(afterNewApproval.approvalCount, 3);
  assert.equal(afterNewApproval.approved, true);
  assert.equal((await f.store.read(f.roomId)).proposalVersion, proposalVersion);
});
test("leaving removes only the departing vote and private data while preserving shared responses", async () => {
  const f = await fixture([
    { role: "Listener", output: { candidates: [] } },
    { role: "Judge", output: judge() },
    { role: "Judge", output: judge() },
  ]);
  let room = await f.store.read(f.roomId);
  await f.engine.rooms.submit(f.roomId, f.other, {
    messageId: "departing_group_response",
    expectedRevision: room.revision,
    proposalVersion: room.proposalVersion,
    text: "This group response remains available after its author leaves.",
    visibility: "group",
    questionId: null,
    replyOption: null,
  });
  const first = await f.engine.run(f.roomId, f.auth);
  assert.equal(first.outcome, "COMPLETED");
  room = await f.store.read(f.roomId);
  const proposalVersion = room.proposalVersion;
  await f.engine.rooms.approve(f.roomId, f.auth, proposalVersion);
  await f.engine.rooms.approve(f.roomId, f.other, proposalVersion);

  room = await f.store.read(f.roomId);
  await f.engine.rooms.submit(f.roomId, f.other, {
    messageId: "departing_private_response",
    expectedRevision: room.revision + (room.privateRevisions[f.other.participantId] ?? 0),
    proposalVersion,
    text: "PRIVATE_DEPARTING_RESPONSE",
    visibility: "private",
    questionId: null,
    replyOption: null,
  });
  room = await f.store.read(f.roomId);
  const revisionBeforeLeave = room.revision;
  await f.engine.rooms.leave(
    f.roomId,
    f.other,
    room.revision + (room.privateRevisions[f.other.participantId] ?? 0),
  );

  room = await f.store.read(f.roomId);
  assert.equal(room.proposalVersion, proposalVersion);
  assert.equal(room.revision, revisionBeforeLeave + 1);
  assert.deepEqual(room.participants.map((participant) => participant.id), [f.auth.participantId]);
  assert.equal(room.approvals[f.auth.participantId], proposalVersion);
  assert.equal(room.approvals[f.other.participantId], undefined);
  assert.equal(room.responses.some((response) => response.id === "departing_group_response"), true);
  assert.equal(room.responses.some((response) => response.id === "departing_private_response"), false);
  await assert.rejects(f.engine.rooms.view(f.roomId, f.other), /UNAUTHORIZED/);

  const second = await f.engine.run(f.roomId, f.auth);
  assert.equal(second.outcome, "COMPLETED");
  const remainingView = await f.engine.rooms.view(f.roomId, f.auth);
  assert.equal(remainingView.responses.some((response) => response.id === "departing_group_response"), true);
  assert.equal(JSON.stringify(remainingView).includes("PRIVATE_DEPARTING_RESPONSE"), false);
  assert.equal(remainingView.approvalCount, 1);
  assert.equal(remainingView.approved, true);
  assert.equal((await f.store.read(f.roomId)).proposalVersion, proposalVersion);
});
test("readiness increases and decreases; hard constraints block a green status even if Judge says ready", async () => {
  const f = await fixture(
    Array.from({ length: 3 }, () => ({
      role: "Judge" as const,
      output: judge(),
    })),
  );
  await addBudget(f);
  const first = await f.engine.run(f.roomId, f.auth);
  await f.engine.rooms.revise(f.roomId, f.auth, first.baseRevision, {
    id: "bad",
    label: "Too costly",
    values: { cost: 500 },
  });
  const second = await f.engine.run(f.roomId, f.auth);
  assert.equal(second.readiness?.status, "blocked");
  assert.ok(second.readiness!.delta! < 0);
  await f.engine.rooms.revise(f.roomId, f.auth, second.baseRevision, {
    id: "good",
    label: "Affordable",
    values: { cost: 150 },
  });
  const third = await f.engine.run(f.roomId, f.auth);
  assert.ok(third.readiness!.delta! > 0);
});
test("missing information is not confirmed and critical unresolved safety concerns prevent readiness", async () => {
  const f = await fixture([
    {
      role: "Judge",
      output: judge({
        findings: [finding({ category: "Safety Check", severity: "critical" })],
      }),
    },
  ]);
  const result = await f.engine.run(f.roomId, f.auth);
  assert.equal(result.readiness?.status, "blocked");
  assert.equal(
    result.readiness?.categories.find((c) => c.category === "Safety Check")
      ?.percentage,
    0,
  );
});
test("resolved findings without confirmed evidence are downgraded", async () => {
  const f = await fixture([
    {
      role: "Judge",
      output: judge({ findings: [finding({ status: "resolved" })] }),
    },
  ]);
  const result = await f.engine.run(f.roomId, f.auth);
  assert.equal(result.finalEvaluation?.findings[0].status, "unverified");
  assert.notEqual(result.readiness?.percentage, 100);
});
test("unknown evidence and malformed structured handoffs fail closed", async () => {
  for (const output of [
    judge({ findings: [finding({ evidenceIds: ["invented"] })] }),
    { score: 100 },
  ]) {
    const f = await fixture([{ role: "Judge", output }]);
    const result = await f.engine.run(f.roomId, f.auth);
    assert.equal(result.outcome, "BLOCKED");
    assert.equal(result.finalEvaluation, null);
  }
});
test("the orchestrator completes multi-role cycles without a per-cycle request quota", async () => {
  const f = await questionFixture();
  const engine = new AgentEngine(f.store, f.gateway, {
    ...MOCK_LIMITS,
  });
  const result = await engine.run(f.roomId, f.auth);
  assert.ok(result.attempts > 2);
});
test("a final Judge can reject a Speaker draft before publication", async () => {
  const f = await questionFixture();
  const base = f.gateway.call.bind(f.gateway);
  const engine = new AgentEngine(f.store, {
    mode: "MOCK",
    async call(role, input, context) {
      const result = await base(role, input, context);
      if (role === "Judge" && (input as { task?: string }).task === "final")
        result.output = judge({
          participantInputRequired: true,
          next: "question",
          findings: [finding()],
        });
      return result;
    },
  });
  const result = await engine.run(f.roomId, f.auth);
  assert.equal(result.outcome, "BLOCKED");
  assert.equal(result.reason, "QUESTION_REQUIRED");
  assert.equal((await engine.rooms.view(f.roomId, f.auth)).questions.length, 0);
});
test("each actual adapter attempt is counted, including failed retry attempts", async () => {
  const f = await fixture([{ role: "Judge", output: judge(), attempts: 3 }]);
  const engine = new AgentEngine(f.store, f.gateway, {
    ...MOCK_LIMITS,
  });
  const result = await engine.run(f.roomId, f.auth);
  assert.equal(result.attempts, 3);
  assert.equal((await f.store.read(f.roomId)).lifetimeAttempts, 3);
});
test("paraphrased repetition terminates with no progress rather than an infinite loop", async () => {
  const steps = negotiationSteps();
  const repeat = judge({
    findings: [finding({ message: "Different wording" })],
    next: "negotiate",
    taskFindingIds: ["budget_gap"],
    anotherPassUseful: true,
    canStop: false,
  });
  const f = await fixture([
    { role: "Judge", output: repeat },
    {
      role: "Negotiator",
      output: { options: [{ id: "one", label: "A", values: { cost: 150 } }] },
    },
    { role: "Judge", output: repeat },
    {
      role: "Negotiator",
      output: { options: [{ id: "two", label: "B", values: { cost: 150 } }] },
    },
    { role: "Judge", output: repeat },
    ...steps,
  ]);
  const result = await f.engine.run(f.roomId, f.auth);
  assert.equal(result.reason, "NO_PROGRESS");
  assert.equal(f.calls.length, 5);
});
test("revision limit stops still-changing but unproductive proposals", async () => {
  const more = judge({
    findings: [finding()],
    next: "negotiate",
    taskFindingIds: ["budget_gap"],
    anotherPassUseful: true,
    canStop: false,
  });
  const f = await fixture([
    { role: "Judge", output: more },
    {
      role: "Negotiator",
      output: {
        options: [{ id: "one", label: "First", values: { cost: 500 } }],
      },
    },
    { role: "Judge", output: more },
    {
      role: "Negotiator",
      output: {
        options: [{ id: "two", label: "Second", values: { cost: 400 } }],
      },
    },
    { role: "Judge", output: more },
  ]);
  const engine = new AgentEngine(f.store, f.gateway, {
    ...MOCK_LIMITS,
    maxRevisions: 1,
  });
  const result = await engine.run(f.roomId, f.auth);
  assert.equal(result.outcome, "BLOCKED");
  assert.equal(result.reason, "REVISION_LIMIT");
  assert.equal(f.calls.filter((c) => c.role === "Negotiator").length, 2);
});
test("deadline and explicit cancellation stop even an adapter that ignores its signal", async () => {
  for (const explicit of [false, true]) {
    const f = await fixture([
      { role: "Judge", wait: () => new Promise(() => {}), output: judge() },
    ]);
    const engine = new AgentEngine(f.store, f.gateway, {
      ...MOCK_LIMITS,
      timeoutMs: explicit ? 1000 : 10,
    });
    const controller = new AbortController();
    const promise = engine.run(f.roomId, f.auth, { signal: controller.signal });
    if (explicit) setTimeout(() => controller.abort(), 10);
    const result = await promise;
    assert.equal(result.outcome, "BLOCKED");
    assert.equal(result.reason, explicit ? "CANCELLED" : "TIMEOUT");
  }
});
test("outdated results cannot overwrite newer room state", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const f = await fixture([
    { role: "Judge", output: judge(), wait: () => gate },
  ]);
  const pending = f.engine.run(f.roomId, f.auth);
  while (f.calls.length === 0)
    await new Promise((resolve) => setTimeout(resolve, 1));
  const before = await f.store.read(f.roomId);
  await f.engine.rooms.revise(f.roomId, f.auth, before.revision, {
    id: "newer",
    label: "New input",
    values: { cost: 170 },
  });
  release();
  const result = await pending;
  assert.equal(result.outcome, "BLOCKED");
  const current = await f.store.read(f.roomId);
  assert.equal(current.proposal.id, "newer");
  assert.equal(current.readiness, null);
  assert.equal(
    (await f.engine.rooms.view(f.roomId, f.auth)).analysisCurrent,
    false,
  );
});
test("joining during analysis cancels stale output and keeps the proposal version", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture([
    { role: "Judge", output: judge(), wait: () => gate },
  ]);
  const before = await f.store.read(f.roomId);
  const pending = f.engine.run(f.roomId, f.auth);
  while (f.calls.length === 0)
    await new Promise((resolve) => setTimeout(resolve, 1));

  const joined = await f.engine.rooms.join(f.roomId, f.invitation, "Jordan");
  release();
  const result = await pending;
  const current = await f.store.read(f.roomId);
  assert.equal(result.outcome, "BLOCKED");
  assert.equal(current.proposalVersion, before.proposalVersion);
  assert.equal(current.revision, before.revision + 1);
  assert.equal(current.activeCycleId, null);
  assert.equal(current.analysisStatus, "idle");
  assert.equal(current.participants.some((participant) => participant.id === joined.participantId), true);
  assert.equal(current.readiness, before.readiness);
});
test("private raw answers and facts stay private while extracted planning details are shared", async () => {
  const f = await fixture([
    {
      role: "Listener",
      output: { candidates: [{ key: "meetingLocation", value: "Northside Park" }] },
    },
    { role: "Judge", output: judge() },
  ]);
  let room = await f.store.read(f.roomId);
  await f.engine.rooms.confirmFact(f.roomId, f.auth, room.revision, {
    id: "secret",
    key: "medical",
    value: "PRIVATE_FACT_CANARY",
    visibility: "private",
    confirmed: true,
    ownerId: f.auth.participantId,
  });
  room = await f.store.read(f.roomId);
  await f.engine.rooms.submit(
    f.roomId,
    f.auth,
    room.revision,
    "PRIVATE_RESPONSE_CANARY",
  );
  await f.engine.processPrivate(f.roomId, f.auth.participantId);
  room = await f.store.read(f.roomId);
  const ownerView = await f.engine.rooms.view(f.roomId, f.auth);
  const privateSuggestion = ownerView.candidates.find((candidate) => candidate.value === "Northside Park")!;
  await f.engine.rooms.shareCandidate(f.roomId, f.auth, ownerView.revision, privateSuggestion.id);
  const afterShare = await f.engine.rooms.view(f.roomId, f.auth);
  await f.engine.rooms.confirmFact(f.roomId, f.auth, afterShare.revision, {
    id: "shared_canary",
    key: "meetingLocation",
    value: "GROUP_CONTEXT_CANARY",
    visibility: "group",
    scope: "shared",
    confirmed: true,
    ownerId: f.auth.participantId,
  });
  const result = await f.engine.run(f.roomId, f.auth);
  const listenerInput = f.calls.find((call) => call.role === "Listener")?.input as
    | { privateInput?: { text?: string }; privateFacts?: unknown[]; facts?: unknown[]; participants?: unknown[] }
    | undefined;
  assert.deepEqual(listenerInput?.privateInput, { text: "PRIVATE_RESPONSE_CANARY" });
  assert.equal(listenerInput?.privateFacts?.length, 1);
  assert.equal("facts" in (listenerInput ?? {}), false);
  assert.equal("participants" in (listenerInput ?? {}), false);
  assert.equal(JSON.stringify(listenerInput).includes("GROUP_CONTEXT_CANARY"), false);
  const sharedCalls = JSON.stringify(f.calls.filter((c) => c.role !== "Listener"));
  const ownerViewJson = JSON.stringify(await f.engine.rooms.view(f.roomId, f.auth));
  const otherView = JSON.stringify(await f.engine.rooms.view(f.roomId, f.other));
  assert.equal(sharedCalls.includes("PRIVATE_RESPONSE_CANARY"), false);
  assert.equal(sharedCalls.includes("PRIVATE_FACT_CANARY"), false);
  assert.equal(sharedCalls.includes("Northside Park"), true);
  assert.equal(JSON.stringify(result).includes("PRIVATE_RESPONSE_CANARY"), false);
  assert.equal(ownerViewJson.includes("PRIVATE_RESPONSE_CANARY"), true);
  assert.equal(ownerViewJson.includes("PRIVATE_FACT_CANARY"), true);
  assert.equal(otherView.includes("PRIVATE_RESPONSE_CANARY"), false);
  assert.equal(otherView.includes("PRIVATE_FACT_CANARY"), false);
  assert.equal(otherView.includes("Northside Park"), true);
  assert.equal(
    renderLab([{ mode: "MOCK", scenario: "privacy", cycle: result }]).includes(
      "PRIVATE_RESPONSE_CANARY",
    ),
    false,
  );
});
test("group responses reach shared reasoning without attaching the owner's private facts", async () => {
  const f = await fixture([
    {
      role: "Listener",
      output: { candidates: [{ key: "departure_window", value: "after 8 AM" }] },
    },
    {
      role: "Judge",
      output: judge({
        findings: [finding({
          id: "schedule_response_conflict",
          category: "Schedule Check",
          severity: "critical",
          evidenceIds: [groupResponseEvidenceId("shared_schedule_message")],
          uncertainty: "conflicting",
        })],
        readinessAssessment: {
          readyForReview: false,
          explanation: "A group schedule conflict remains unresolved.",
        },
      }),
    },
  ]);
  let room = await f.store.read(f.roomId);
  await f.engine.rooms.confirmFact(f.roomId, f.auth, room.revision, {
    id: "private_budget_fact",
    key: "private_budget",
    value: "PRIVATE_FACT_MUST_NOT_REACH_GROUP_LISTENER_OR_JUDGE",
    visibility: "private",
    confirmed: true,
    ownerId: f.auth.participantId,
  });
  room = await f.store.read(f.roomId);
  await f.engine.rooms.submit(f.roomId, f.auth, {
    messageId: "shared_schedule_message",
    expectedRevision: room.revision + (room.privateRevisions[f.auth.participantId] ?? 0),
    proposalVersion: room.proposalVersion,
    text: "SYNTH_GROUP_SCHEDULE: I can leave only after 8 AM.",
    visibility: "group",
    questionId: null,
    replyOption: null,
  });

  const result = await f.engine.run(f.roomId, f.auth);
  const listenerInput = f.calls.find((call) => call.role === "Listener")?.input;
  const judgeInput = f.calls.find((call) => call.role === "Judge")?.input as {
    groupResponses?: Array<{ text: string; ownerId: string; evidenceId: string }>;
    groupObservations?: Array<{
      ownerId: string;
      confirmed: boolean;
      candidates: Array<{ key: string; value: unknown }>;
    }>;
  } | undefined;
  const listenerJson = JSON.stringify(listenerInput);
  const judgeJson = JSON.stringify(judgeInput);
  assert.match(listenerJson, /groupInput/);
  assert.equal(listenerJson.includes("privateFacts"), false);
  assert.equal(listenerJson.includes("PRIVATE_FACT_MUST_NOT_REACH"), false);
  assert.equal(judgeJson.includes("PRIVATE_FACT_MUST_NOT_REACH"), false);
  assert.equal(judgeInput?.groupResponses?.some((item) => item.text.includes("SYNTH_GROUP_SCHEDULE")), true);
  assert.equal(judgeInput?.groupResponses?.some((item) =>
    item.evidenceId === groupResponseEvidenceId("shared_schedule_message"),
  ), true);
  assert.equal(judgeInput?.groupObservations?.some((item) =>
    item.ownerId === f.auth.participantId && item.confirmed === false &&
    item.candidates.some((candidate) => candidate.key === "departure_window" && candidate.value === "after 8 AM"),
  ), true);
  assert.equal(result.outcome, "COMPLETED");
  assert.equal(JSON.stringify(result.traces.find((trace) => trace.role === "Listener")?.input).includes("SYNTH_GROUP_SCHEDULE"), true);
});
test("Judge evidence accepts Listener observations beyond the raw response context window", async () => {
  const messageIds = Array.from({ length: 7 }, (_, index) => `shared_response_${index}`);
  const f = await fixture([
    ...messageIds.map((_, index) => ({
      role: "Listener" as const,
      output: { candidates: [{ key: `availability_${index}`, value: `window_${index}` }] },
    })),
    {
      role: "Judge",
      output: judge({
        findings: [finding({
          id: "older_group_observation",
          category: "Schedule Check",
          evidenceIds: [groupResponseEvidenceId(messageIds[0]!)],
        })],
        readinessAssessment: {
          readyForReview: false,
          explanation: "An older participant schedule observation remains unverified.",
        },
      }),
    },
  ]);

  for (const [index, messageId] of messageIds.entries()) {
    const room = await f.store.read(f.roomId);
    await f.engine.rooms.submit(f.roomId, f.auth, {
      messageId,
      expectedRevision: room.revision,
      proposalVersion: room.proposalVersion,
      text: `SYNTH_GROUP_AVAILABILITY_${index}`,
      visibility: "group",
      questionId: null,
      replyOption: null,
    });
  }

  const result = await f.engine.run(f.roomId, f.auth);
  const judgeInput = f.calls.find((call) => call.role === "Judge")?.input as {
    groupResponses?: Array<{ evidenceId: string }>;
    groupObservations?: Array<{ sourceEvidenceId: string }>;
  } | undefined;
  assert.equal(result.outcome, "COMPLETED");
  assert.equal(judgeInput?.groupResponses?.some((item) =>
    item.evidenceId === groupResponseEvidenceId(messageIds[0]!),
  ), false);
  assert.equal(judgeInput?.groupObservations?.some((item) =>
    item.sourceEvidenceId === groupResponseEvidenceId(messageIds[0]!),
  ), true);
  assert.equal(
    result.finalEvaluation?.findings.some((item) => item.id === "older_group_observation"),
    true,
  );
});
test("public targeted questions require explicit participant consent", async () => {
  const f = await questionFixture();
  const call = f.gateway.call.bind(f.gateway);
  const engine = new AgentEngine(f.store, {
    mode: "MOCK",
    async call(role, input, context) {
      const result = await call(role, input, context);
      if (role === "Question Strategist")
        result.output = { questions: [{ ...f.question, visibility: "group" }] };
      return result;
    },
  });
  const result = await engine.run(f.roomId, f.auth);
  assert.equal(result.reason, "DISCLOSURE_DENIED");
  assert.equal(result.questions.length, 0);
});
test("failure preserves the last independently validated readiness and requires controlled retry", async () => {
  const f = await fixture([
    { role: "Judge", output: judge() },
    { role: "Judge", error: new Error("SECRET UPSTREAM BODY") },
    { role: "Judge", output: judge() },
  ]);
  const first = await f.engine.run(f.roomId, f.auth);
  await f.engine.rooms.revise(f.roomId, f.auth, first.baseRevision, {
    id: "r2",
    label: "Revision",
    values: { cost: 120 },
  });
  const failed = await f.engine.run(f.roomId, f.auth);
  assert.equal(failed.outcome, "BLOCKED");
  assert.deepEqual(failed.readiness, first.readiness);
  assert.equal(failed.traces.at(-1)?.failureCode, "AGENT_FAILURE");
  assert.equal(failed.traces.at(-1)?.failureMessage, "Agent invocation failed; detailed payload omitted.");
  assert.equal(JSON.stringify(failed).includes("SECRET UPSTREAM BODY"), false);
  await f.engine.run(f.roomId, f.auth);
  assert.equal(f.calls.length, 2);
  const retried = await f.engine.run(f.roomId, f.auth, { retryBlocked: true });
  assert.equal(retried.outcome, "COMPLETED");
  assert.equal((await f.store.read(f.roomId)).lifetimeAttempts, 3);
});
test("Meta output-token truncation is recorded with a safe, inspectable trace failure", async () => {
  const f = await fixture([{
    role: "Judge",
    error: new MetaApiError(
      "invalid_response",
      "Meta response hit its output-token limit before finishing the result. SECRET RESPONSE TEXT",
    ),
  }]);
  const result = await f.engine.run(f.roomId, f.auth);
  assert.equal(result.outcome, "BLOCKED");
  assert.equal(result.traces[0]?.failureCode, "META_OUTPUT_TRUNCATED");
  assert.equal(
    result.traces[0]?.failureMessage,
    "Meta reached the configured output-token limit before completing the response.",
  );
  assert.equal(JSON.stringify(result).includes("SECRET RESPONSE TEXT"), false);
});
test("structured handoff failures expose only a safe schema path", async () => {
  const question: Question = {
    id: "schedule_question",
    findingId: "budget_gap",
    targetId: null,
    visibility: "group",
    kind: "clarification",
    text: "Which departure time works?",
    options: [],
  };
  const f = await fixture([
    {
      role: "Judge",
      output: judge({
        findings: [finding()],
        next: "question",
        participantInputRequired: true,
        canStop: false,
      }),
    },
    { role: "Question Strategist", output: { questions: [question] } },
    {
      role: "Speaker",
      output: {
        replies: [{
          questionId: null,
          findingId: null,
          text: "SENSITIVE_INVALID_SPEAKER_VALUE",
        }],
        mascot: "curious",
      },
    },
  ]);
  const result = await f.engine.run(f.roomId, f.auth);
  const failure = result.traces.at(-1)!;
  assert.equal(result.outcome, "BLOCKED");
  assert.equal(failure.failureCode, "INVALID_HANDOFF");
  assert.match(failure.failureMessage ?? "", /replies\[0\]/);
  assert.equal(JSON.stringify(result).includes("SENSITIVE_INVALID_SPEAKER_VALUE"), false);
});
test("Speaker target exclusivity is encoded in provider JSON Schema", () => {
  const schema = z.toJSONSchema(RoleSchemas.Speaker) as unknown as {
    properties: { replies: { items: { anyOf?: unknown[] } } };
  };
  assert.equal(schema.properties.replies.items.anyOf?.length, 2);
  assert.equal(
    RoleSchemas.Speaker.safeParse({
      replies: [{ questionId: null, findingId: null, text: "Invalid target" }],
      mascot: "curious",
    }).success,
    false,
  );
  assert.equal(
    RoleSchemas.Speaker.safeParse({
      replies: [{ questionId: "schedule_question", findingId: null, text: "Which time works?" }],
      mascot: "curious",
    }).success,
    true,
  );
  assert.equal(RoleSchemas.Speaker.safeParse({
    replies: [{ questionId: null, findingId: "schedule_gap", text: "Please confirm the time." }],
    mascot: "concerned",
  }).success, true);
  assert.equal(RoleSchemas.Speaker.safeParse({
    replies: [{ questionId: "schedule_question", findingId: "schedule_gap", text: "Ambiguous target" }],
    mascot: "curious",
  }).success, false);
});
test("the final Judge reviews authored finding replies and can prevent their publication", async () => {
  const f = await fixture([
    { role: "Judge", output: judge({ findings: [finding()], next: "speak" }) },
    { role: "Speaker", output: { replies: [
      { findingId: "budget_gap", questionId: null, text: "Unsupported authored claim" },
    ], mascot: "content" } },
    { role: "Judge", output: judge({ findings: [finding()], canStop: false }) },
  ]);
  const result = await f.engine.run(f.roomId, f.auth);
  const finalInput = f.calls[2]!.input as { draftFindingReplies: unknown[] };
  assert.deepEqual(finalInput.draftFindingReplies, [{ findingId: "budget_gap", text: "Unsupported authored claim" }]);
  assert.equal(result.outcome, "BLOCKED");
  assert.equal(result.reason, "NO_USEFUL_STOP");
  assert.equal(result.messages.length, 0);
});

test("Judge rejects fabricated, expired, foreign-room and owner-private evidence", async (t) => {
  for (const kind of ["fabricated", "expired", "foreign_room", "other_private", "own_private"] as const) {
    await t.test(kind, async () => {
      const messageId = "expired_group_evidence";
      const evidenceId = kind === "expired" ? groupResponseEvidenceId(messageId) : `${kind}_evidence`;
      const f = await fixture([{ role: "Judge", output: judge({
        findings: [finding({ evidenceIds: [evidenceId] })],
      }) }]);
      let room = await f.store.read(f.roomId);
      if (kind === "own_private" || kind === "other_private") {
        const owner = kind === "own_private" ? f.auth : f.other;
        await f.engine.rooms.confirmFact(f.roomId, owner, room.revision, {
          id: evidenceId, key: "budget", value: "PRIVATE_EVIDENCE_CANARY",
          ownerId: owner.participantId, visibility: "private", confirmed: true,
        });
      } else if (kind === "expired") {
        await f.engine.rooms.submit(f.roomId, f.auth, {
          messageId, expectedRevision: room.revision, proposalVersion: room.proposalVersion,
          text: "Only this old proposal has my agreement.", visibility: "group", questionId: null, replyOption: null,
        });
        room = await f.store.read(f.roomId);
        await f.engine.rooms.revise(f.roomId, f.auth, room.revision, {
          ...room.proposal, label: "Materially changed plan", values: { cost: 999 },
        });
      } else if (kind === "foreign_room") {
        const foreign = await fixture([]);
        const foreignRoom = await foreign.store.read(foreign.roomId);
        await foreign.engine.rooms.confirmFact(foreign.roomId, foreign.auth, foreignRoom.revision, {
          id: evidenceId, key: "budget", value: 200, ownerId: foreign.auth.participantId,
          visibility: "group", confirmed: true,
        });
      }
      const result = await f.engine.run(f.roomId, f.auth);
      assert.equal(result.outcome, "BLOCKED");
      assert.equal(result.reason, "UNKNOWN_EVIDENCE");
      assert.equal(result.finalEvaluation, null);
      assert.equal(result.messages.length, 0);
      const inputs = JSON.stringify(f.calls);
      assert.equal(inputs.includes("PRIVATE_EVIDENCE_CANARY"), false);
      assert.equal(inputs.includes("Only this old proposal"), false);
    });
  }
});

test("Judge may cite another participant's current shared response, which remains unconfirmed", async () => {
  const messageId = "other_group_response";
  const f = await fixture([
    { role: "Listener", output: { candidates: [{ key: "check_1", value: true }] } },
    { role: "Judge", output: judge({ findings: [finding({
      status: "resolved", uncertainty: "none", evidenceIds: [groupResponseEvidenceId(messageId)],
    })] }) },
  ]);
  const room = await f.store.read(f.roomId);
  await f.engine.rooms.submit(f.roomId, f.other, {
    messageId, expectedRevision: room.revision, proposalVersion: room.proposalVersion,
    text: "A shared budget suggestion, awaiting confirmation.", visibility: "group", questionId: null, replyOption: null,
  });
  const result = await f.engine.run(f.roomId, f.auth);
  assert.equal(result.outcome, "COMPLETED");
  assert.equal(result.finalEvaluation?.findings[0]?.status, "unverified");
});

test("the Judge must cite a current response's opaque evidence ID rather than its raw message UUID", async () => {
  const f = await fixture([]);
  const messageId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  let room = await f.store.read(f.roomId);
  await f.engine.rooms.submit(f.roomId, f.auth, {
    messageId, expectedRevision: room.revision, proposalVersion: room.proposalVersion,
    text: "A synthetic group statement", visibility: "group", questionId: null, replyOption: null,
  });
  room = await f.store.read(f.roomId);
  assert.throws(() => validateJudge(room, judge({ findings: [finding({ evidenceIds: [messageId] })] }), [], []), /UNKNOWN_EVIDENCE/);
  assert.doesNotThrow(() => validateJudge(room, judge({ findings: [finding({ evidenceIds: [groupResponseEvidenceId(messageId)] })] }), [], []));
  assert.equal(JSON.stringify(sharedContext(room)).includes(messageId), false);
});

test("Listener cannot use a queue item as evidence for another participant's response", async () => {
  const f = await fixture([]);
  const room = await f.store.read(f.roomId);
  await f.engine.rooms.submit(f.roomId, f.auth, {
    messageId: "owner_bound_source", expectedRevision: room.revision, proposalVersion: room.proposalVersion,
    text: "My group contribution", visibility: "group", questionId: null, replyOption: null,
  });
  await f.store.transaction(f.roomId, (state) => { state!.pendingInputs[0]!.actorId = f.other.participantId; });
  const result = await f.engine.run(f.roomId, f.auth);
  assert.equal(result.reason, "INVALID_EVIDENCE_SOURCE");
  assert.equal(f.calls.length, 0);
});
test("all six exact category names are preserved and applicability is policy-driven", async () => {
  assert.deepEqual(Categories, [
    "Schedule Check",
    "Budget Check",
    "People Check",
    "Logistics Check",
    "Preparation Check",
    "Safety Check",
  ]);
  const f = await fixture([{ role: "Judge", output: judge() }], "meeting");
  await f.store.transaction(f.roomId, (room) => {
    room!.policy.find((c) => c.category === "Logistics Check")!.enabled = false;
  });
  const result = await f.engine.run(f.roomId, f.auth);
  assert.equal(
    result.readiness?.categories.find((c) => c.category === "Logistics Check")
      ?.status,
    "not_applicable",
  );
});
test("serialized JSON snapshots recover state, reject corruption/traversal, and forbid public storage", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "setvia-agent-test-"));
  t.after(async () => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    assert.ok(basename(root).startsWith("setvia-agent-test-"));
    await rm(root, { recursive: true, force: true });
  });
  const f = await fixture([{ role: "Judge", output: judge() }]);
  const initial = await f.store.read(f.roomId);
  const persistence = new JsonPersistence(root, join(root, "public-repo"));
  const firstStore = new RoomStore(persistence);
  await firstStore.create(initial);
  await Promise.all(
    Array.from({ length: 12 }, () =>
      firstStore.transaction(f.roomId, (room) => {
        room!.revision++;
      }),
    ),
  );
  const restored = await new RoomStore(persistence).read(f.roomId);
  assert.equal(restored.revision, initial.revision + 12);
  await assert.rejects(persistence.load("../escape"), /INVALID_ID/);
  assert.throws(
    () =>
      new JsonPersistence(
        join(root, "public-repo", "data"),
        join(root, "public-repo"),
      ),
    /PRIVATE_STORAGE_REQUIRED/,
  );
  await writeFile(join(root, f.roomId + ".json"), "{broken");
  await assert.rejects(
    new RoomStore(persistence).read(f.roomId),
    /CORRUPT_SNAPSHOT/,
  );
});
test("restart marks an in-flight cycle incomplete and retains consumed reservations", async () => {
  const f = await fixture([{ role: "Judge", output: judge() }]);
  const result = await f.engine.run(f.roomId, f.auth);
  await f.store.transaction(f.roomId, (room) => {
    room!.activeCycleId = "interrupted";
    room!.lastCycle!.outcome = "CONTINUE";
  });
  const restored = await new RoomStore(f.store.persistence).read(f.roomId);
  assert.equal(restored.lastCycle?.reason, "RESTART_INTERRUPTED");
  assert.equal(restored.lastCycle?.finalEvaluation, null);
  assert.equal(restored.lifetimeAttempts, 1);
  assert.deepEqual(restored.readiness, result.readiness);
});
test("Lab escapes model text and private history is stored only outside the public repository", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "setvia-agent-test-"));
  t.after(async () => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    await rm(root, { recursive: true, force: true });
  });
  const f = await fixture([
    {
      role: "Judge",
      output: judge({
        findings: [finding({ message: "<script>alert(1)</script>" })],
      }),
    },
  ]);
  const cycle = await f.engine.run(f.roomId, f.auth);
  const records = [{ mode: "MOCK" as const, scenario: "Test", cycle }];
  const html = renderLab(records);
  assert.equal(html.includes("<script>alert"), false);
  assert.ok(html.includes("&lt;script&gt;"));
  const saved = await saveLab(records, root, join(root, "public-repo"));
  assert.equal(
    JSON.parse(await readFile(saved.jsonPath, "utf8")).fixtureVersion,
    "lab-v2",
  );
  assert.ok(
    (await readFile(saved.htmlPath, "utf8")).includes(
      "Visible structured execution records",
    ),
  );
});
test("Meta adapter reuses the existing pinned client, disables retries, and meters HTTP before sending", async () => {
  let attempts = 0;
  let sends = 0;
  const prompts = Object.fromEntries(
    Object.keys(RoleSchemas).map((role) => [
      role,
      "Synthetic test instruction.",
    ]),
  ) as Record<keyof typeof RoleSchemas, string>;
  const gateway = createMetaGateway({
    prompts,
    maxRequestBytes: 30_000,
    maxOutputTokens: 3000,
    inputTokenAllowance: 40_000,
    callTokenAllowance: 43_000,
    callCostMicros: 100_000,
    inputPriceMicrosPerMillion: 1_250_000,
    outputPriceMicrosPerMillion: 4_250_000,
    client: {
      config: {
        apiKey: "synthetic-key",
        baseUrl: META_API_BASE_URL,
        model: META_SPARK_MODEL,
      },
      fetchImpl: async (url, init) => {
        sends++;
        assert.equal(String(url), META_API_BASE_URL + "/responses");
        assert.equal(JSON.parse(String(init?.body)).model, META_SPARK_MODEL);
        return Response.json({
          model: META_SPARK_MODEL,
          output_text: JSON.stringify(judge()),
          usage: { input_tokens: 100, output_tokens: 50 },
        });
      },
    },
  });
  const output = await gateway.call(
    "Judge",
    {},
    {
      signal: new AbortController().signal,
      reserveAttempt: async () => {
        attempts++;
      },
    },
  );
  assert.equal(sends, 1);
  assert.equal(attempts, 1);
  RoleSchemas.Judge.parse(output.output);
  const client = createMetaClient({
    config: {
      apiKey: "synthetic",
      baseUrl: META_API_BASE_URL,
      model: META_SPARK_MODEL,
    },
    maxRetries: 2,
    sleep: async () => {},
    beforeAttempt: () => {
      attempts++;
      if (attempts > 2) throw new Error("BUDGET");
    },
    fetchImpl: async () => {
      sends++;
      return new Response("", { status: 503 });
    },
  });
  await assert.rejects(client.createResponse({ input: "synthetic" }), /BUDGET/);
  assert.equal(sends, 2);
});

test("separate Meta clients emit distinct invocation identities even for identical concurrent requests", async () => {
  const events: MetaHttpEvent[] = [];
  const gateway = createMetaGateway({
    prompts: Object.fromEntries(Object.keys(RoleSchemas).map((role) => [role, "Synthetic instruction."])) as Record<keyof typeof RoleSchemas, string>,
    maxRequestBytes: 30_000, maxOutputTokens: 3_000, inputTokenAllowance: 40_000,
    callTokenAllowance: 43_000, callCostMicros: 100_000,
    inputPriceMicrosPerMillion: 1_250_000, outputPriceMicrosPerMillion: 4_250_000,
    onHttpEvent: (event) => { events.push(event); },
    client: { config: { apiKey: "synthetic-key", baseUrl: META_API_BASE_URL, model: META_SPARK_MODEL },
      fetchImpl: async () => Response.json({ model: META_SPARK_MODEL, output_text: JSON.stringify(judge()),
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }),
    },
  });
  const context = { signal: new AbortController().signal, reserveAttempt: async () => {} };
  await Promise.all([gateway.call("Judge", {}, context), gateway.call("Judge", {}, context)]);
  const started = events.filter((event) => event.phase === "started");
  assert.equal(started.length, 2);
  assert.equal(started[0]!.requestNumber, started[1]!.requestNumber);
  assert.equal(started[0]!.requestHash, started[1]!.requestHash);
  assert.equal(new Set(started.map((event) => event.invocationId)).size, 2);
  for (const start of started) {
    assert.ok(start.invocationId);
    assert.deepEqual(events.filter((event) => event.invocationId === start.invocationId).map((event) => event.phase), ["started", "response", "usage"]);
  }
});

test("simultaneous private submissions are queued without overwriting either participant", async () => {
  const f = await fixture([
    {
      role: "Listener",
      output: { candidates: [{ key: "a", value: "FIRST_PRIVATE" }] },
    },
    {
      role: "Listener",
      output: { candidates: [{ key: "b", value: "SECOND_PRIVATE" }] },
    },
    { role: "Judge", output: judge() },
  ]);
  let room = await f.store.read(f.roomId);
  await f.engine.rooms.submit(f.roomId, f.auth, room.revision, "FIRST_PRIVATE");
  room = await f.store.read(f.roomId);
  await f.engine.rooms.submit(
    f.roomId,
    f.other,
    room.revision,
    "SECOND_PRIVATE",
  );
  assert.equal((await f.store.read(f.roomId)).pendingInputs.length, 0);
  assert.equal((await f.store.read(f.roomId)).privatePendingInputs.length, 2);
  await f.engine.processPrivate(f.roomId, f.auth.participantId);
  await f.engine.processPrivate(f.roomId, f.other.participantId);
  assert.equal((await f.store.read(f.roomId)).privatePendingInputs.length, 0);
  const firstView = await f.engine.rooms.view(f.roomId, f.auth);
  const secondView = await f.engine.rooms.view(f.roomId, f.other);
  assert.deepEqual(firstView.candidates.map((candidate) => candidate.value), ["FIRST_PRIVATE"]);
  assert.deepEqual(secondView.candidates.map((candidate) => candidate.value), ["SECOND_PRIVATE"]);
  assert.equal(
    JSON.stringify(f.calls[0].input).includes("SECOND_PRIVATE"),
    false,
  );
  assert.equal(
    JSON.stringify(f.calls[1].input).includes("FIRST_PRIVATE"),
    false,
  );
});
test("unresolved findings cannot disappear from later Judge passes without evidence", async () => {
  const f = await fixture([
    {
      role: "Judge",
      output: judge({
        findings: [finding({ severity: "critical", category: "Safety Check" })],
      }),
    },
    { role: "Judge", output: judge() },
  ]);
  const first = await f.engine.run(f.roomId, f.auth);
  await f.engine.rooms.revise(f.roomId, f.auth, first.baseRevision, {
    id: "next",
    label: "Next",
    values: { cost: 150 },
  });
  const second = await f.engine.run(f.roomId, f.auth);
  assert.equal(second.finalEvaluation?.findings[0].status, "open");
  assert.equal(second.readiness?.status, "blocked");
});
test("conflicting confirmed shared facts block readiness independently of the model", async () => {
  const f = await fixture([{ role: "Judge", output: judge() }]);
  let room = await f.store.read(f.roomId);
  const original = room.facts.find((fact) => fact.id === "fact_1")!;
  await f.engine.rooms.confirmFact(f.roomId, f.auth, room.revision, {
    ...original,
    scope: "shared",
  });
  room = await f.store.read(f.roomId);
  await f.engine.rooms.confirmFact(f.roomId, f.other, room.revision, {
    id: "opposed",
    key: "check_1",
    value: false,
    ownerId: f.other.participantId,
    confirmed: true,
    visibility: "group",
    scope: "shared",
  });
  assert.equal(
    (await f.engine.run(f.roomId, f.auth)).readiness?.status,
    "blocked",
  );
});
test("participant-owned constraints cannot be removed or replaced by another participant", async () => {
  const f = await fixture([]);
  await addBudget(f);
  const room = await f.store.read(f.roomId);
  await assert.rejects(
    f.engine.rooms.setConstraints(
      f.roomId,
      f.other,
      room.revision,
      room.constraints,
    ),
    /UNAUTHORIZED/,
  );
  await f.engine.rooms.setConstraints(f.roomId, f.other, room.revision, []);
  assert.equal((await f.store.read(f.roomId)).constraints.length, 1);
});
test("withdrawal revokes access and cancels stale in-flight work", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const f = await fixture([
    { role: "Judge", output: judge(), wait: () => gate },
  ]);
  const run = f.engine.run(f.roomId, f.auth);
  while (!f.calls.length) await new Promise((r) => setTimeout(r, 1));
  await f.engine.rooms.leave(
    f.roomId,
    f.auth,
    (await f.store.read(f.roomId)).revision,
  );
  release();
  assert.equal((await run).outcome, "BLOCKED");
  await assert.rejects(f.engine.rooms.view(f.roomId, f.auth), /UNAUTHORIZED/);
  await assert.rejects(f.engine.run(f.roomId, f.auth), /UNAUTHORIZED/);
});
test("legacy room accounting at the former cumulative cap does not block later cycles", async () => {
  const f = await fixture([
    { role: "Judge", output: judge() },
    { role: "Judge", output: judge() },
  ]);
  const engine = new AgentEngine(f.store, f.gateway, {
    ...MOCK_LIMITS,
  });
  await f.store.transaction(f.roomId, (room) => {
    assert.ok(room);
    room.lifetimeAttempts = 31;
    room.lifetimeReservedTokens = 1_984_000;
    room.lifetimeReservedCostMicros = 3_224_000;
  });
  const first = await engine.run(f.roomId, f.auth);
  await engine.rooms.revise(f.roomId, f.auth, first.baseRevision, {
    id: "next",
    label: "Next",
    values: { cost: 120 },
  });
  const second = await engine.run(f.roomId, f.auth);
  assert.equal(second.outcome, "COMPLETED");
  assert.equal((await f.store.read(f.roomId)).lifetimeAttempts, 33);
});
test("adapter allowances are recorded without an orchestrator ceiling", async () => {
  const f = await fixture([]);
  const engine = new AgentEngine(f.store, {
    mode: "MOCK",
    async call(_role, _input, context) {
      await context.reserveAttempt({
        tokens: MOCK_LIMITS.callTokens + 1,
        costMicros: 1,
      });
      throw new Error("Should never be reached");
    },
  });
  const result = await engine.run(f.roomId, f.auth);
  assert.equal(result.reason, "AGENT_FAILURE");
  assert.equal(result.attempts, 1);
  assert.throws(
    () => new AgentEngine(f.store, { ...f.gateway, mode: "META" }),
    /LIVE_LIMITS_REQUIRED/,
  );
});
test("unknown usage remains explicitly unknown while conservative reservations stay consumed", async () => {
  const f = await fixture([]);
  const engine = new AgentEngine(f.store, {
    mode: "MOCK",
    async call(_role, _input, context) {
      await context.reserveAttempt();
      return { output: judge(), usage: null };
    },
  });
  const result = await engine.run(f.roomId, f.auth);
  assert.equal(result.usageKnown, false);
  assert.equal(result.traces[0].inputTokens, null);
  assert.equal(result.reservedCostMicros, MOCK_LIMITS.callCostMicros);
});

test("disabling a category cannot hide an unresolved critical issue or hard constraint", async () => {
  const f = await fixture([
    {
      role: "Judge",
      output: judge({
        findings: [finding({ category: "Safety Check", severity: "critical" })],
      }),
    },
  ]);
  const room = await f.store.read(f.roomId);
  const policy = structuredClone(room.policy);
  policy.find((c) => c.category === "Safety Check")!.enabled = false;
  await f.engine.rooms.configurePolicy(f.roomId, f.auth, room.revision, policy);
  const cycle = await f.engine.run(f.roomId, f.auth);
  assert.equal(cycle.readiness?.status, "blocked");
});
test("current hard violations remain explicit validated findings even when the model omits them", async () => {
  const f = await fixture([{ role: "Judge", output: judge() }]);
  await addBudget(f);
  const room = await f.store.read(f.roomId);
  await f.engine.rooms.revise(f.roomId, f.auth, room.revision, {
    id: "bad",
    label: "Bad budget",
    values: { cost: 900 },
  });
  const cycle = await f.engine.run(f.roomId, f.auth);
  assert.ok(
    cycle.finalEvaluation?.findings.some(
      (finding) =>
        finding.id.startsWith("hard_plan_") &&
        finding.evidenceIds.includes("max_budget"),
    ),
  );
  assert.equal(cycle.readiness?.status, "blocked");
});
test("missing proposal values block readiness without being mislabeled as explicit violations", async () => {
  const f = await fixture([{ role: "Judge", output: judge() }]);
  let room = await f.store.read(f.roomId);
  await f.engine.rooms.setConstraints(f.roomId, f.auth, room.revision, [
    {
      id: "start_after",
      ownerId: f.auth.participantId,
      category: "Schedule Check",
      key: "startHour",
      operator: "gte",
      expected: 15,
      hard: true,
    },
  ]);
  room = await f.store.read(f.roomId);
  await f.engine.rooms.setConstraints(f.roomId, f.other, room.revision, [
    {
      id: "start_before",
      ownerId: f.other.participantId,
      category: "Schedule Check",
      key: "startHour",
      operator: "lte",
      expected: 9,
      hard: true,
    },
  ]);
  room = await f.store.read(f.roomId);
  assert.equal(violations(room, room.proposal).length, 2);

  const cycle = await f.engine.run(f.roomId, f.auth);
  assert.equal(cycle.readiness?.status, "blocked");
  assert.equal(
    cycle.finalEvaluation?.findings.some((entry) =>
      entry.id.startsWith("hard_plan_"),
    ),
    false,
  );
});

test("structured handoffs include prior findings and explicit proposal critiques", async () => {
  const f = await fixture(negotiationSteps());
  await addBudget(f);
  await f.engine.run(f.roomId, f.auth);
  const reviews = f.calls.filter((c) => c.role === "Judge");
  assert.ok(
    (reviews[1].input as { previousFindings: unknown[] }).previousFindings
      .length > 0,
  );
  const revisions = f.calls.filter((c) => c.role === "Negotiator");
  assert.deepEqual(
    (revisions[1].input as { previousVerdicts: unknown }).previousVerdicts,
    [{ optionId: "expensive", accepted: false }],
  );
});
test("revoked shared information is not carried forward through historical findings", async () => {
  const f = await fixture([
    {
      role: "Judge",
      output: judge({
        findings: [
          finding({ evidenceIds: ["fact_1"], message: "SHARED_THEN_PRIVATE" }),
        ],
      }),
    },
    { role: "Judge", output: judge() },
  ]);
  let room = await f.store.read(f.roomId);
  const original = room.facts.find((fact) => fact.id === "fact_1")!;
  await f.engine.rooms.confirmFact(f.roomId, f.auth, room.revision, {
    ...original,
    value: "SHARED_THEN_PRIVATE",
  });
  await f.engine.run(f.roomId, f.auth);
  room = await f.store.read(f.roomId);
  await f.engine.rooms.confirmFact(f.roomId, f.auth, room.revision, {
    ...original,
    value: "SHARED_THEN_PRIVATE",
    visibility: "private",
  });
  const next = await f.engine.run(f.roomId, f.other);
  assert.equal(JSON.stringify(next).includes("SHARED_THEN_PRIVATE"), false);
  assert.equal(
    JSON.stringify(f.calls.at(-1)?.input).includes("SHARED_THEN_PRIVATE"),
    false,
  );
});

test("owner-aware readiness keeps personal budget values separate and ignores private values", async () => {
  const f = await fixture([{ role: "Judge", output: judge() }]);
  let room = await f.store.read(f.roomId);
  const policy = structuredClone(room.policy);
  policy.find((entry) => entry.category === "Budget Check")!.requiredKeys = [
    "personalBudget",
  ];
  await f.engine.rooms.configurePolicy(f.roomId, f.auth, room.revision, policy);
  room = await f.store.read(f.roomId);
  await f.engine.rooms.confirmFact(f.roomId, f.auth, room.revision, {
    id: "personal_budget_a",
    key: "personalBudget",
    value: 500,
    ownerId: f.auth.participantId,
    visibility: "group",
    scope: "participant",
    confirmed: true,
  });
  room = await f.store.read(f.roomId);
  await f.engine.rooms.confirmFact(f.roomId, f.other, room.revision, {
    id: "personal_budget_b",
    key: "personalBudget",
    value: 900,
    ownerId: f.other.participantId,
    visibility: "group",
    scope: "participant",
    confirmed: true,
  });
  room = await f.store.read(f.roomId);
  const beforePrivate = calculateReadiness(room, []);
  assert.equal(
    beforePrivate.categories.find((entry) => entry.category === "Budget Check")
      ?.status,
    "checked",
  );
  assert.notEqual(beforePrivate.status, "blocked");
  await f.engine.rooms.confirmFact(f.roomId, f.auth, room.revision, {
    id: "private_budget_a",
    key: "personalBudget",
    value: 9999,
    ownerId: f.auth.participantId,
    visibility: "private",
    scope: "participant",
    confirmed: true,
  });
  const afterPrivate = calculateReadiness(await f.store.read(f.roomId), []);
  assert.equal(afterPrivate.percentage, beforePrivate.percentage);
  assert.equal(
    (await f.engine.rooms.view(f.roomId, f.other)).privateFacts
      .some((fact) => fact.id === "private_budget_a"),
    false,
  );
});

test("different owner schedules are not shared contradictions, but incompatible hard constraints block a plan", async () => {
  const f = await fixture([]);
  let room = await f.store.read(f.roomId);
  const policy = structuredClone(room.policy);
  policy.find((entry) => entry.category === "Schedule Check")!.requiredKeys = [
    "availabilityWindow",
  ];
  await f.engine.rooms.configurePolicy(f.roomId, f.auth, room.revision, policy);
  room = await f.store.read(f.roomId);
  await f.engine.rooms.confirmFact(f.roomId, f.auth, room.revision, {
    id: "availability_a",
    key: "availabilityWindow",
    value: "after 15:00 local",
    ownerId: f.auth.participantId,
    visibility: "group",
    scope: "participant",
    confirmed: true,
  });
  room = await f.store.read(f.roomId);
  await f.engine.rooms.confirmFact(f.roomId, f.other, room.revision, {
    id: "availability_b",
    key: "availabilityWindow",
    value: "before 09:00 local",
    ownerId: f.other.participantId,
    visibility: "group",
    scope: "participant",
    confirmed: true,
  });
  room = await f.store.read(f.roomId);
  assert.notEqual(calculateReadiness(room, []).status, "blocked");
  await f.engine.rooms.setConstraints(f.roomId, f.auth, room.revision, [
    {
      id: "availability_after_15",
      ownerId: f.auth.participantId,
      category: "Schedule Check",
      key: "startHour",
      operator: "gte",
      expected: 15,
      hard: true,
    },
  ]);
  room = await f.store.read(f.roomId);
  await f.engine.rooms.setConstraints(f.roomId, f.other, room.revision, [
    {
      id: "availability_before_9",
      ownerId: f.other.participantId,
      category: "Schedule Check",
      key: "startHour",
      operator: "lte",
      expected: 9,
      hard: true,
    },
  ]);
  room = await f.store.read(f.roomId);
  await f.engine.rooms.revise(f.roomId, f.auth, room.revision, {
    id: "infeasible_time",
    label: "10:00",
    values: { startHour: 10, cost: 100 },
  });
  room = await f.store.read(f.roomId);
  assert.deepEqual(
    violations(room, room.proposal).map((constraint) => constraint.id).sort(),
    ["availability_after_15", "availability_before_9"],
  );
  assert.equal(calculateReadiness(room, []).status, "blocked");
});

test("different claims about one explicitly shared fact block readiness for verification", async () => {
  const f = await fixture([]);
  let room = await f.store.read(f.roomId);
  const policy = structuredClone(room.policy);
  policy.find((entry) => entry.category === "People Check")!.requiredKeys = [
    "venueAccess",
  ];
  await f.engine.rooms.configurePolicy(f.roomId, f.auth, room.revision, policy);
  room = await f.store.read(f.roomId);
  await f.engine.rooms.confirmFact(f.roomId, f.auth, room.revision, {
    id: "venue_access_a",
    key: "venueAccess",
    value: "assumed accessible",
    ownerId: f.auth.participantId,
    visibility: "group",
    scope: "shared",
    confirmed: true,
  });
  room = await f.store.read(f.roomId);
  await f.engine.rooms.confirmFact(f.roomId, f.other, room.revision, {
    id: "venue_access_b",
    key: "venueAccess",
    value: "not verified",
    ownerId: f.other.participantId,
    visibility: "group",
    scope: "shared",
    confirmed: true,
  });
  const readiness = calculateReadiness(await f.store.read(f.roomId), []);
  assert.equal(readiness.status, "blocked");
  assert.equal(
    readiness.categories.find((entry) => entry.category === "People Check")
      ?.status,
    "blocked",
  );
});

test("five core scenario mocks and the separate planner stress test pass their authored assertions", async () => {
  const largeOne = getScenario("E");
  const largeTwo = getScenario("E");
  assert.equal(largeOne.participants.length, 7);
  assert.equal(largeOne.estimatedAttendeeCount, 58);
  assert.equal(largeOne.confirmedAttendeeCount, 47);
  assert.equal(largeOne.requiredApproverIds.length, 7);
  assert.equal(largeOne.participants.filter((person) => person.roomResponseStatus === "no_response").length, 1);
  assert.equal(largeOne.seed, largeTwo.seed);
  assert.deepEqual(largeOne.participants, largeTwo.participants);
  assert.equal(getScenario("E_STRESS").participants.length, 58);
  assert.equal(SCENARIO_IDS.length, 5);
  const results = await runAllScenarioMocks();
  assert.equal(results.length, 6);
  for (const { record } of results) {
    assert.equal(record.mode, "MOCK");
    assert.equal(record.simulation, true);
    assert.equal(record.passed, true, `${record.scenario}: ${JSON.stringify(record.assertions)}`);
    assert.ok(record.assertions?.every((assertion) => assertion.passed));
  }
});

test("event attendance stays separate from active room membership and old room snapshots remain readable", async () => {
  const f = await fixture([{ role: "Judge", output: judge() }]);
  const legacy = await f.store.read(f.roomId);
  delete legacy.estimatedAttendeeCount;
  delete legacy.confirmedAttendeeCount;
  assert.doesNotThrow(() => RoomSchema.parse(legacy));

  const created = await f.engine.rooms.create(
    "volunteer event",
    legacy.policy,
    legacy.proposal,
    { estimatedAttendeeCount: 58, confirmedAttendeeCount: 47 },
  );
  const participant = await f.engine.rooms.join(created.roomId, created.invitation, "Planner");
  const room = await f.store.read(created.roomId);
  const context = sharedContext(room);
  assert.equal(context.attendance.estimatedAttendeeCount, 58);
  assert.equal(context.attendance.confirmedAttendeeCount, 47);
  assert.equal(context.attendance.roomParticipantCount, 1);
  assert.equal(context.attendance.requiredApproverIds.length, 1);
  assert.equal(context.attendance.requiredApproverIds[0], participant.participantId);

  await assert.rejects(
    f.engine.rooms.create(
      "invalid event",
      legacy.policy,
      legacy.proposal,
      { estimatedAttendeeCount: 2, confirmedAttendeeCount: 3 },
    ),
    /INVALID_ATTENDEE_COUNTS/,
  );
});

test("the live scenario path requires META mode and never auto-scores model quality", async () => {
  const mock = await runScenarioMock("B");
  const steps = mock.record.cycle.traces.map((trace) => ({
    role: trace.role,
    output: trace.output,
  }));
  const fake = scriptedGateway(steps).gateway;
  const fakeMeta = { ...fake, mode: "META" as const };
  const limits = {
    ...MOCK_LIMITS,
    callTokens: 58_000,
    callCostMicros: 82_000,
  };
  const live = await runScenarioWithGateway("B", fakeMeta, limits);
  assert.equal(live.record.mode, "LIVE");
  assert.equal(live.record.passed, undefined);
  assert.equal(live.record.cycle.outcome, "WAIT_FOR_PARTICIPANT");
  assert.ok(live.record.assertions?.every((assertion) => assertion.passed));
  await assert.rejects(
    () => runScenarioWithGateway("B", fake, limits),
    /LIVE_GATEWAY_REQUIRED/,
  );
});

test("Judge may stop after a deterministic rejection and return an infeasible plan to a human", async () => {
  const { record } = await runScenarioMock("C");
  assert.equal(record.cycle.outcome, "COMPLETED");
  assert.equal(record.cycle.finalEvaluation?.verdicts.some((verdict) => verdict.accepted), false);
  assert.equal(record.cycle.readiness?.status, "blocked");
  assert.deepEqual(
    record.cycle.traces.filter((trace) => trace.role === "Negotiator").length,
    2,
  );
});
