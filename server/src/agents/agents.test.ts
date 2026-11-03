import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { Categories, RoleSchemas, type Question } from "./contracts.js";
import { AgentEngine, MOCK_LIMITS } from "./engine.js";
import {
  fixture,
  judge,
  finding,
  negotiationSteps,
  addBudget,
  scriptedGateway,
} from "./fixtures.js";
import { JsonPersistence, RoomStore } from "./store.js";
import { RoomService } from "./rooms.js";
import { renderLab, saveLab } from "./lab.js";
import { createMetaGateway } from "./meta-gateway.js";
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
      output: { questionIds: [question.id], findingIds: [], mascot: "curious" },
    },
    {
      role: "Judge",
      output: { ...initial, acceptedQuestionIds: [question.id] },
    },
    {
      role: "Listener",
      output: { candidates: [{ key: "private_budget", value: 200 }] },
    },
    { role: "Judge", output: judge() },
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
test("a participant answer resumes on the new revision and does not approve the plan", async () => {
  const f = await questionFixture();
  const first = await f.engine.run(f.roomId, f.auth);
  await f.engine.rooms.submit(
    f.roomId,
    f.auth,
    first.baseRevision,
    "SYNTHETIC_PRIVATE_BUDGET",
    f.question.id,
  );
  const second = await f.engine.run(f.roomId, f.auth);
  assert.equal(second.outcome, "COMPLETED");
  assert.equal(second.baseRevision, first.baseRevision + 1);
  assert.equal(f.calls.length, 6);
  assert.equal((await f.engine.rooms.view(f.roomId, f.auth)).approvalCount, 0);
  assert.equal(
    (await f.engine.rooms.view(f.roomId, f.other)).candidates.length,
    0,
  );
  assert.equal(
    JSON.stringify(second).includes("SYNTHETIC_PRIVATE_BUDGET"),
    false,
  );
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
test("request budget reserves the final Judge and never publishes an unvalidated draft", async () => {
  const f = await questionFixture();
  const engine = new AgentEngine(f.store, f.gateway, {
    ...MOCK_LIMITS,
    maxRequests: 3,
  });
  const result = await engine.run(f.roomId, f.auth);
  assert.equal(result.outcome, "BLOCKED");
  assert.equal(result.reason, "REQUEST_LIMIT");
  assert.equal(result.attempts, 2);
  assert.equal(result.questions.length, 0);
  assert.equal((await engine.rooms.view(f.roomId, f.auth)).messages.length, 0);
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
test("token, cost, invocation and cumulative room ceilings are enforced outside the model", async () => {
  for (const limits of [
    { maxTokens: 1 },
    { maxCostMicros: 1 },
    { maxInvocations: 1, maxRequests: 1 },
    { roomMaxRequests: 1 },
  ]) {
    const f = await fixture(negotiationSteps());
    await addBudget(f);
    const engine = new AgentEngine(f.store, f.gateway, {
      ...MOCK_LIMITS,
      ...limits,
    });
    const result = await engine.run(f.roomId, f.auth);
    assert.equal(result.outcome, "BLOCKED");
    assert.equal(result.finalEvaluation, null);
    assert.ok(result.attempts <= 1);
  }
});
test("each actual adapter attempt is counted, including failed retry attempts", async () => {
  const f = await fixture([{ role: "Judge", output: judge(), attempts: 3 }]);
  const engine = new AgentEngine(f.store, f.gateway, {
    ...MOCK_LIMITS,
    maxRequests: 2,
  });
  const result = await engine.run(f.roomId, f.auth);
  assert.equal(result.attempts, 2);
  assert.equal(result.reason, "REQUEST_LIMIT");
  assert.equal((await f.store.read(f.roomId)).lifetimeAttempts, 2);
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
test("private facts and Listener output never enter shared roles, traces or another participant's projection", async () => {
  const f = await fixture([
    {
      role: "Listener",
      output: { candidates: [{ key: "medical", value: "PRIVATE_CANARY" }] },
    },
    { role: "Judge", output: judge() },
  ]);
  let room = await f.store.read(f.roomId);
  await f.engine.rooms.confirmFact(f.roomId, f.auth, room.revision, {
    id: "secret",
    key: "medical",
    value: "PRIVATE_CANARY",
    visibility: "private",
    confirmed: true,
    ownerId: f.auth.participantId,
  });
  room = await f.store.read(f.roomId);
  await f.engine.rooms.submit(
    f.roomId,
    f.auth,
    room.revision,
    "PRIVATE_CANARY",
  );
  const result = await f.engine.run(f.roomId, f.auth);
  assert.equal(
    JSON.stringify(f.calls.filter((c) => c.role !== "Listener")).includes(
      "PRIVATE_CANARY",
    ),
    false,
  );
  assert.equal(JSON.stringify(result).includes("PRIVATE_CANARY"), false);
  assert.equal(
    JSON.stringify(await f.engine.rooms.view(f.roomId, f.other)).includes(
      "PRIVATE_CANARY",
    ),
    false,
  );
  assert.equal(
    renderLab([{ mode: "MOCK", scenario: "privacy", cycle: result }]).includes(
      "PRIVATE_CANARY",
    ),
    false,
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
  assert.equal(JSON.stringify(failed).includes("SECRET UPSTREAM BODY"), false);
  await f.engine.run(f.roomId, f.auth);
  assert.equal(f.calls.length, 2);
  const retried = await f.engine.run(f.roomId, f.auth, { retryBlocked: true });
  assert.equal(retried.outcome, "COMPLETED");
  assert.equal((await f.store.read(f.roomId)).lifetimeAttempts, 3);
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
    "lab-v1",
  );
  assert.ok(
    (await readFile(saved.htmlPath, "utf8")).includes(
      "Actual execution records",
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
  assert.equal((await f.store.read(f.roomId)).pendingInputs.length, 2);
  await f.engine.run(f.roomId, f.auth);
  assert.equal((await f.store.read(f.roomId)).pendingInputs.length, 0);
  assert.equal(
    (await f.engine.rooms.view(f.roomId, f.auth)).candidates[0].value,
    "FIRST_PRIVATE",
  );
  assert.equal(
    (await f.engine.rooms.view(f.roomId, f.other)).candidates[0].value,
    "SECOND_PRIVATE",
  );
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
  const room = await f.store.read(f.roomId);
  await f.engine.rooms.confirmFact(f.roomId, f.other, room.revision, {
    id: "opposed",
    key: "check_1",
    value: false,
    ownerId: f.other.participantId,
    confirmed: true,
    visibility: "group",
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
test("room-wide budgets survive new events and do not reset on a new cycle", async () => {
  const f = await fixture([
    { role: "Judge", output: judge() },
    { role: "Judge", output: judge() },
  ]);
  const engine = new AgentEngine(f.store, f.gateway, {
    ...MOCK_LIMITS,
    roomMaxRequests: 1,
  });
  const first = await engine.run(f.roomId, f.auth);
  await engine.rooms.revise(f.roomId, f.auth, first.baseRevision, {
    id: "next",
    label: "Next",
    values: { cost: 120 },
  });
  const second = await engine.run(f.roomId, f.auth);
  assert.equal(second.reason, "ROOM_BUDGET_LIMIT");
  assert.equal(second.attempts, 0);
  assert.equal((await f.store.read(f.roomId)).lifetimeAttempts, 1);
});
test("adapter allowances cannot exceed the orchestrator's reserved token or cost ceiling", async () => {
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
  assert.equal(result.reason, "INVALID_ALLOWANCE");
  assert.equal(result.attempts, 0);
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
