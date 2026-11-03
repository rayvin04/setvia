// Three targeted live contract checks; this does not publish a room cycle.
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { CycleSchema, type Cycle, type Role, type Trace, type Question } from "../server/src/agents/contracts.js";
import { validateJudge, validateSpeaker } from "../server/src/agents/engine.js";
import { JsonPersistence, StateError } from "../server/src/agents/store.js";
import { digest, sharedContext } from "../server/src/agents/rooms.js";
import { saveLab } from "../server/src/agents/lab.js";
import { createRoomMetaGateway, IntegrationRunBudget, DEFAULT_ROOM_PROMPT_VERSION } from "../server/src/rooms/runtime.js";
import { LiveBudgetJournal, LIVE_MAX_HTTP_ATTEMPTS, LIVE_ATTEMPT_RESERVATION_TOKENS, LIVE_ATTEMPT_RESERVATION_MICROS } from "./live-budget-journal.js";

if (!process.argv.includes("--execute") || process.env.SETVIA_LIVE_BILLING_CHECKED !== "1")
  throw new Error("Explicit execution and the existing manual billing check are required.");
if (!process.env.SETVIA_PRIVATE_ROOT || !/^[a-zA-Z0-9_-]{1,80}$/.test(process.env.SETVIA_VERIFY_ROOM_ID ?? ""))
  throw new Error("A private root and synthetic room ID are required.");
const privateRoot = resolve(process.env.SETVIA_PRIVATE_ROOT);
const publicRoot = resolve(process.cwd());
const persistence = new JsonPersistence(resolve(privateRoot, "room-state"), publicRoot);
const unlock = await persistence.acquireRuntimeLock();
let journal: LiveBudgetJournal | undefined;
let budget: IntegrationRunBudget | undefined;
let hold: Awaited<ReturnType<IntegrationRunBudget["holdCycle"]>> | undefined;
try {
  const room = await persistence.load(process.env.SETVIA_VERIFY_ROOM_ID!);
  if (!room?.syntheticDemo || room.participants.length !== 2) throw new Error("A synthetic two-participant room is required.");
  journal = await LiveBudgetJournal.open(privateRoot, publicRoot, ["F"]);
  budget = await IntegrationRunBudget.open(resolve(privateRoot, "room-state", "integration-budget.ndjson"));
  if ((await journal.snapshot()).attempts + 3 > LIVE_MAX_HTTP_ATTEMPTS) throw new StateError("LIVE_HTTP_ATTEMPT_LIMIT");
  hold = await budget.holdCycle(3, { tokens: LIVE_ATTEMPT_RESERVATION_TOKENS, costMicros: LIVE_ATTEMPT_RESERVATION_MICROS });
  const gateway = await createRoomMetaGateway(privateRoot, process.env.SETVIA_PROMPT_VERSION ?? DEFAULT_ROOM_PROMPT_VERSION, (event) => journal!.handle(event, "F"));
  const cycle: Cycle = { id: randomUUID(), baseRevision: room.revision, outcome: "CONTINUE", reason: "CONTRACT_CHECKS_ONLY",
    finalEvaluation: null, readiness: null, traces: [], attempts: 0, reservedTokens: 0, reservedCostMicros: 0,
    usageKnown: true, questions: [], mascot: null, messages: [] };
  const check = async <T>(role: Role, input: unknown, validate: (output: unknown) => T) => {
    const trace: Trace = { sequence: cycle.traces.length + 1, role, phase: role === "Judge" ? "review" : "draft",
      requestedBy: "orchestrator", promptVersion: gateway.promptVersion!, promptHash: gateway.promptHashes?.[role] ?? null,
      mode: "META", schemaVersion: "agents-v2", input, output: null, status: "failed", acceptedOptionIds: [], rejectedOptionIds: [],
      attempts: 0, inputTokens: null, cachedInputTokens: null, outputTokens: null, reasoningTokens: null, totalTokens: null,
      estimatedCostMicros: null, durationMs: 0 };
    cycle.traces.push(trace);
    const started = performance.now();
    try {
      const response = await gateway.call(role, input, { signal: AbortSignal.timeout(30_000), reserveAttempt: async (allowance) => {
        if (!allowance) throw new StateError("CALL_ALLOWANCE_REQUIRED");
        await hold!.reserve(allowance);
        trace.attempts++;
        cycle.attempts++;
        cycle.reservedTokens += allowance.tokens;
        cycle.reservedCostMicros += allowance.costMicros;
      } });
      // Only synthetic, group-authorized input is used here. Keep the actual
      // response in this private record even when local validation rejects it.
      trace.output = response.output;
      if (response.usage) Object.assign(trace, {
        inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens,
        totalTokens: response.usage.totalTokens ?? null, cachedInputTokens: response.usage.cachedInputTokens ?? null,
        reasoningTokens: response.usage.reasoningTokens ?? null, estimatedCostMicros: response.usage.estimatedCostMicros,
      });
      else cycle.usageKnown = false;
      const result = validate(response.output);
      trace.status = "accepted";
      return result;
    } catch (error) {
      trace.failureCode = error instanceof StateError ? error.code : "CONTRACT_CHECK_FAILED";
      trace.failureMessage = "The targeted contract check failed; no room result was published.";
      throw error;
    } finally { trace.durationMs = Math.round(performance.now() - started); }
  };
  let passed = false;
  try {
    const context = sharedContext(room);
    const evaluation = await check("Judge", { ...context, groupObservations: [], proposedOptions: [], previousFindings: [],
      draftQuestions: [], draftFindingReplies: [], draftMascot: null, task: "review" }, (raw) => validateJudge(room, raw, [], []));
    const finding = evaluation.findings.find((item) => item.status !== "resolved");
    if (!finding) throw new StateError("NO_CONTRACT_TEST_FINDING");
    // An explicit synthetic question fixture isolates Speaker from Strategist
    // quality. It is never installed in the room or represented as model work.
    const question: Question = { id: "contract_question", findingId: finding.id, targetId: null, visibility: "group", kind: "choice",
      text: "Which next step should the group discuss for this unresolved planning issue?",
      options: ["Review the current proposal", "Suggest a revision", "Provide more information"] };
    await check("Speaker", { ...context, findings: [finding], questions: [question] }, (raw) => {
      const output = validateSpeaker(raw, [question], [finding]);
      if (!output.replies.some((reply) => reply.questionId === question.id)) throw new StateError("QUESTION_REPLY_MISSING");
      return output;
    });
    await check("Speaker", { ...context, findings: [finding], questions: [] }, (raw) => {
      const output = validateSpeaker(raw, [], [finding]);
      if (!output.replies.some((reply) => reply.findingId === finding.id)) throw new StateError("FINDING_REPLY_MISSING");
      return output;
    });
    passed = true;
    cycle.outcome = "COMPLETED";
    cycle.reason = "TARGETED_CONTRACTS_VERIFIED";
  } catch (error) {
    cycle.outcome = "BLOCKED";
    cycle.reason = error instanceof StateError ? error.code : "TARGETED_CHECK_FAILED";
  }
  const report = await saveLab([{
    scenario: "F — Targeted Judge and Speaker contracts only; no room cycle or publication",
    scenarioId: "F", mode: "LIVE", simulation: true, model: "muse-spark-1.3", promptVersion: gateway.promptVersion,
    liveRunId: journal.runId, liveHttpAttempts: await journal.attemptsFor("F"), liveBudgetSnapshot: await journal.snapshot(),
    roomIntegration: { sourceRoomHash: digest(room.id), eventType: room.eventType, publicRevision: room.revision, proposalVersion: room.proposalVersion },
    cycle: CycleSchema.parse(cycle), passed,
  }], resolve(privateRoot, "lab", "live"), publicRoot);
  console.log(JSON.stringify({ targetedContractsPassed: passed, fullLiveCycle: false, reason: cycle.reason,
    attempts: cycle.attempts, tokens: cycle.traces.reduce((sum, trace) => sum + (trace.totalTokens ?? 0), 0),
    estimatedCostMicros: cycle.traces.reduce((sum, trace) => sum + (trace.estimatedCostMicros ?? 0), 0),
    budget: budget.snapshot(), globalAttempts: (await journal.snapshot()).attempts, report }, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  await hold?.release();
  await budget?.close();
  await journal?.release();
  await unlock();
}
