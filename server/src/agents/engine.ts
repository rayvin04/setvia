import { randomUUID, createHash } from "node:crypto";
import {
  RoleSchemas,
  type AgentGateway,
  type Auth,
  type Cycle,
  type Finding,
  type JudgeEvaluation,
  type PlanOption,
  type Question,
  type Role,
  type Room,
  type Trace,
} from "./contracts.js";
import { RoomStore, StateError } from "./store.js";
import { RoomService, authorize, sharedContext } from "./rooms.js";
import { calculateReadiness, explicitViolations, violations } from "./readiness.js";
import { MetaApiError } from "../ai/errors.js";

export interface Limits {
  maxInvocations: number;
  maxRequests: number;
  maxRevisions: number;
  timeoutMs: number;
  maxTokens: number;
  maxCostMicros: number;
  // Conservative allowances for a single request, including its full prompt/schema.
  callTokens: number;
  callCostMicros: number;
  roomMaxRequests: number;
  roomMaxTokens: number;
  roomMaxCostMicros: number;
}
export const MOCK_LIMITS: Limits = {
  maxInvocations: 16,
  maxRequests: 12,
  maxRevisions: 2,
  timeoutMs: 30_000,
  maxTokens: 200_000,
  maxCostMicros: 500_000,
  callTokens: 12_000,
  callCostMicros: 30_000,
  roomMaxRequests: 100,
  roomMaxTokens: 2_000_000,
  roomMaxCostMicros: 5_000_000,
};
const fingerprint = (value: unknown) => {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, val]) => [k, canonical(val)]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
};
function unique(ids: string[]) {
  if (new Set(ids).size !== ids.length) throw new StateError("INVALID_HANDOFF");
}
function validateJudge(
  room: Room,
  raw: unknown,
  options: PlanOption[],
  previous: Finding[],
): JudgeEvaluation {
  const judge = RoleSchemas.Judge.parse(raw);
  const explicitSafeStop =
    judge.next === "stop" &&
    judge.canStop &&
    !judge.anotherPassUseful &&
    !judge.participantInputRequired &&
    !judge.readinessAssessment.readyForReview &&
    judge.findings.some(
      (finding) => finding.severity === "critical" && finding.status !== "resolved",
    );
  if (judge.findings.some((f) => f.id.startsWith("hard_")))
    throw new StateError("RESERVED_FINDING_ID");
  for (const old of previous)
    if (
      old.status !== "resolved" &&
      !old.id.startsWith("hard_") &&
      !judge.findings.some((f) => f.id === old.id)
    )
      judge.findings.push(structuredClone(old));
  unique(judge.findings.map((f) => f.id));
  unique(judge.verdicts.map((v) => v.optionId));
  const facts = room.facts.filter((f) => f.visibility === "group");
  const evidence = new Map<
    string,
    { confirmed: boolean; key: string; value: unknown }
  >([
    ...facts.map((f) => [f.id, f] as const),
    ...room.constraints.map(
      (c) =>
        [c.id, { confirmed: true, key: c.key, value: c.expected }] as const,
    ),
  ]);
  for (const f of judge.findings) {
    if (f.evidenceIds.some((id) => !evidence.has(id)))
      throw new StateError("UNKNOWN_EVIDENCE");
    if (
      f.status === "resolved" &&
      (!f.evidenceIds.length ||
        f.evidenceIds.some(
          (id) =>
            !evidence.get(id)?.confirmed ||
            evidence.get(id)?.value === null ||
            !room.policy
              .find((p) => p.category === f.category)
              ?.requiredKeys.includes(evidence.get(id)!.key),
        ))
    ) {
      f.status = "unverified";
      f.uncertainty = "missing";
    }
  }
  for (const verdict of judge.verdicts) {
    const option = options.find((o) => o.id === verdict.optionId);
    if (!option) throw new StateError("UNKNOWN_OPTION");
    const conflicts = violations(room, option);
    if (verdict.accepted && conflicts.length) {
      verdict.accepted = false;
      for (const c of conflicts) {
        const issueId = "hard_" + fingerprint([c.id, option.id]).slice(0, 20);
        judge.findings.push({
          id: issueId,
          category: c.category,
          severity: "critical",
          status: "open",
          evidenceIds: [],
          uncertainty: "none",
          message: "A proposed option violates a confirmed shared requirement.",
          recommendedAction:
            "Revise the option to satisfy the confirmed requirement.",
        });
        judge.taskFindingIds.push(issueId);
      }
      // An invalid option is never accepted. Preserve a deliberate Judge stop
      // so an infeasible problem can be handed back to people instead of
      // forcing the Negotiator to invent another candidate until the cap.
      if (!explicitSafeStop) {
        judge.next = "negotiate";
        judge.anotherPassUseful = true;
        judge.canStop = false;
      }
    }
  }
  for (const c of explicitViolations(room, room.proposal))
    judge.findings.push({
      id: "hard_plan_" + fingerprint(c.id).slice(0, 20),
      category: c.category,
      severity: "critical",
      status: "open",
      evidenceIds: [c.id],
      uncertainty: "none",
      message:
        "The current proposal does not satisfy a confirmed shared requirement.",
      recommendedAction:
        "Revise the proposal or obtain explicit confirmation of a changed requirement.",
    });
  if (
    judge.taskFindingIds.some(
      (id) =>
        !judge.findings.some((f) => f.id === id && f.status !== "resolved"),
    )
  )
    throw new StateError("INVALID_TASK");
  if (
    judge.next === "negotiate" &&
    (!judge.anotherPassUseful || !judge.taskFindingIds.length)
  )
    throw new StateError("NO_ACTIONABLE_TASK");
  if (judge.next === "question" && !judge.participantInputRequired)
    throw new StateError("INVALID_TASK");
  return judge;
}
function validateQuestions(
  room: Room,
  questions: Question[],
  findings: Finding[],
) {
  unique(questions.map((q) => q.id));
  for (const q of questions) {
    const target = room.participants.find((p) => p.id === q.targetId);
    if (!findings.some((f) => f.id === q.findingId && f.status !== "resolved"))
      throw new StateError("INVALID_QUESTION");
    if (q.targetId !== null && !target)
      throw new StateError("UNAUTHORIZED_TARGET");
    if (q.visibility === "private" && !target)
      throw new StateError("UNAUTHORIZED_TARGET");
    if (
      room.questions.some(
        (old) =>
          old.id !== q.id &&
          old.findingId === q.findingId &&
          old.targetId === q.targetId &&
          old.kind === q.kind,
      )
    )
      throw new StateError("REPEATED_QUESTION");
    if (q.visibility === "group" && target && !target.publicTargetingConsent)
      throw new StateError("DISCLOSURE_DENIED");
  }
}

function traceFailure(error: unknown): { code: string; message: string } {
  if (error instanceof StateError && /^[A-Z0-9_]{1,64}$/.test(error.code))
    return {
      code: error.code,
      message: `Application validation stopped this handoff (${error.code}).`,
    };
  if (error instanceof MetaApiError) {
    const truncated =
      error.code === "invalid_response" &&
      /output-token limit/i.test(error.message);
    const messages: Record<MetaApiError["code"], string> = {
      authentication: "Meta authentication failed.",
      forbidden: "Meta denied access to the requested model.",
      not_found: "The Meta endpoint or model was not found.",
      rate_limit: "Meta rate limit was reached.",
      timeout: "The Meta request timed out.",
      server: "Meta returned a server error.",
      request: "Meta rejected the request.",
      connection: "Could not connect to Meta.",
      invalid_response: "Meta returned an incomplete or invalid response.",
      unexpected_model: "Meta returned an unexpected model.",
      request_budget_exhausted: "The configured Meta request budget was exhausted.",
    };
    return {
      code: truncated ? "META_OUTPUT_TRUNCATED" : `META_${error.code.toUpperCase()}`,
      message: truncated
        ? "Meta reached the configured output-token limit before completing the response."
        : messages[error.code],
    };
  }
  if (error instanceof Error && error.name === "ZodError")
    return {
      code: "INVALID_HANDOFF",
      message: "Structured output did not match the role schema.",
    };
  if (error instanceof SyntaxError)
    return {
      code: "INVALID_MODEL_JSON",
      message: "Response text could not be parsed as the required JSON handoff.",
    };
  return {
    code: "AGENT_FAILURE",
    message: "Agent invocation failed; detailed payload omitted.",
  };
}

async function withAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  let listener: () => void = () => {};
  const cancellation = new Promise<never>((_, reject) => {
    listener = () => reject(new StateError("CANCELLED"));
    signal.addEventListener("abort", listener, { once: true });
  });
  try {
    return await Promise.race([promise, cancellation]);
  } finally {
    signal.removeEventListener("abort", listener);
  }
}
export class AgentEngine {
  readonly rooms: RoomService;
  private active = new Map<string, AbortController>();
  readonly limits: Limits;
  constructor(
    readonly store: RoomStore,
    readonly gateway: AgentGateway,
    limits?: Limits,
  ) {
    if (gateway.mode === "META" && !limits)
      throw new StateError("LIVE_LIMITS_REQUIRED");
    this.limits = limits ?? MOCK_LIMITS;
    limits = this.limits;
    if (limits.maxInvocations > 30) throw new StateError("INVALID_LIMITS");
    for (const value of Object.values(limits))
      if (!Number.isSafeInteger(value) || value < 1)
        throw new StateError("INVALID_LIMITS");
    this.rooms = new RoomService(store, (id) => this.cancel(id));
  }
  cancel(id: string) {
    this.active.get(id)?.abort();
  }

  async run(
    roomId: string,
    auth: Auth,
    options: { signal?: AbortSignal; retryBlocked?: boolean } = {},
  ): Promise<Cycle> {
    const controller = new AbortController();
    let room!: Room;
    let existing: Cycle | null = null;
    const cycleId = randomUUID();
    await this.store.transaction(roomId, (state) => {
      if (!state) throw new StateError("ROOM_NOT_FOUND");
      authorize(state, auth);
      if (
        state.lastCycle?.baseRevision === state.revision &&
        state.activeCycleId === null &&
        (state.lastCycle.outcome !== "BLOCKED" || !options.retryBlocked)
      ) {
        existing = structuredClone(state.lastCycle);
        return;
      }
      this.cancel(roomId);
      state.activeCycleId = cycleId;
      room = structuredClone(state);
    });
    if (existing) return existing;
    this.active.set(roomId, controller);
    const deadline = setTimeout(
      () => controller.abort("TIMEOUT"),
      this.limits.timeoutMs,
    );
    const signal = options.signal
      ? AbortSignal.any([controller.signal, options.signal])
      : controller.signal;
    const cycle: Cycle = {
      id: cycleId,
      baseRevision: room.revision,
      outcome: "CONTINUE",
      reason: "RUNNING",
      finalEvaluation: null,
      readiness: room.readiness,
      traces: [],
      attempts: 0,
      reservedTokens: 0,
      reservedCostMicros: 0,
      usageKnown: true,
      questions: [],
      mascot: null,
      messages: [],
    };
    // Persist an incomplete marker and reservations before any external side effect.
    try {
      await this.store.transaction(roomId, (state) => {
        if (
          !state ||
          state.revision !== room.revision ||
          state.activeCycleId !== cycleId
        )
          throw new StateError("STALE_STATE");
        state.lastCycle = structuredClone(cycle);
      });
    } catch {
      clearTimeout(deadline);
      if (this.active.get(roomId) === controller) this.active.delete(roomId);
      cycle.outcome = "BLOCKED";
      cycle.reason = "PERSISTENCE_FAILURE";
      cycle.usageKnown = false;
      return cycle;
    }
    let candidates = room.candidates;
    const handledInputIds = new Set<string>();
    let planned: PlanOption[] = [];
    let draftQuestions: Question[] = [];
    let draftMascot: Cycle["mascot"] = null;
    let draftFindingIds: string[] = [];
    let previousFindings = room.lastCycle?.finalEvaluation?.findings ?? [];

    const assertCurrent = async () => {
      signal.throwIfAborted();
      const state = await this.store.read(roomId);
      if (state.revision !== room.revision || state.activeCycleId !== cycleId)
        throw new StateError("STALE_STATE");
    };
    const invoke = async (
      role: Role,
      phase: Trace["phase"],
      payload: unknown,
      requestedBy: Trace["requestedBy"],
      privateContext = false,
    ) => {
      await assertCurrent();
      const optional = role !== "Judge";
      if (
        cycle.traces.length + 1 + (optional ? 1 : 0) >
        this.limits.maxInvocations
      )
        throw new StateError("INVOCATION_LIMIT");
      const trace: Trace = {
        sequence: cycle.traces.length + 1,
        role,
        phase,
        requestedBy,
        promptVersion: this.gateway.promptVersion ?? "agents-v1",
        promptHash: this.gateway.promptHashes?.[role] ?? null,
        mode: this.gateway.mode,
        schemaVersion: "agents-v1",
        input: privateContext
          ? { redacted: true, context: "private" }
          : structuredClone(payload),
        output: null,
        status: "failed",
        acceptedOptionIds: [],
        rejectedOptionIds: [],
        attempts: 0,
        inputTokens: null,
        cachedInputTokens: null,
        outputTokens: null,
        reasoningTokens: null,
        totalTokens: null,
        estimatedCostMicros: null,
        durationMs: 0,
      };
      cycle.traces.push(trace);
      const callStartedAt = performance.now();
      try {
        const result = await withAbort(
          this.gateway.call(role, payload, {
            signal,
            reserveAttempt: async (allowance) => {
              await assertCurrent();
              if (
                allowance &&
                (allowance.tokens > this.limits.callTokens ||
                  allowance.costMicros > this.limits.callCostMicros ||
                  allowance.tokens <= 0 ||
                  allowance.costMicros <= 0)
              )
                throw new StateError("INVALID_ALLOWANCE");
              // All optional work preserves one full final-Judge allowance.
              const reserve = optional ? 1 : 0;
              if (cycle.attempts + 1 + reserve > this.limits.maxRequests)
                throw new StateError("REQUEST_LIMIT");
              if (
                cycle.reservedTokens + this.limits.callTokens * (1 + reserve) >
                this.limits.maxTokens
              )
                throw new StateError("TOKEN_LIMIT");
              if (
                cycle.reservedCostMicros +
                  this.limits.callCostMicros * (1 + reserve) >
                this.limits.maxCostMicros
              )
                throw new StateError("COST_LIMIT");
              await this.store.transaction(roomId, (state) => {
                if (
                  !state ||
                  state.revision !== room.revision ||
                  state.activeCycleId !== cycleId
                )
                  throw new StateError("STALE_STATE");
                if (
                  state.lifetimeAttempts + 1 > this.limits.roomMaxRequests ||
                  state.lifetimeReservedTokens + this.limits.callTokens >
                    this.limits.roomMaxTokens ||
                  state.lifetimeReservedCostMicros +
                    this.limits.callCostMicros >
                    this.limits.roomMaxCostMicros
                )
                  throw new StateError("ROOM_BUDGET_LIMIT");
                state.lifetimeAttempts++;
                state.lifetimeReservedTokens += this.limits.callTokens;
                state.lifetimeReservedCostMicros += this.limits.callCostMicros;
                cycle.attempts++;
                trace.attempts++;
                cycle.reservedTokens += this.limits.callTokens;
                cycle.reservedCostMicros += this.limits.callCostMicros;
                state.lastCycle = structuredClone(cycle);
              });
            },
          }),
          signal,
        );
        trace.durationMs = Math.round(performance.now() - callStartedAt);
        await assertCurrent();
        if (!trace.attempts) throw new StateError("UNMETERED_CALL");
        const output = RoleSchemas[role].parse(result.output);
        if (result.usage) {
          const reportedNumbers = Object.values(result.usage).filter(
            (value): value is number => typeof value === "number",
          );
          for (const n of reportedNumbers)
            if (!Number.isSafeInteger(n) || n < 0)
              throw new StateError("INVALID_USAGE");
          trace.inputTokens = result.usage.inputTokens;
          trace.cachedInputTokens = result.usage.cachedInputTokens ?? null;
          trace.outputTokens = result.usage.outputTokens;
          trace.reasoningTokens = result.usage.reasoningTokens ?? null;
          trace.totalTokens = result.usage.totalTokens ?? result.usage.inputTokens + result.usage.outputTokens;
          if (
            (trace.cachedInputTokens !== null && trace.cachedInputTokens > trace.inputTokens) ||
            (trace.reasoningTokens !== null && trace.reasoningTokens > trace.outputTokens)
          )
            throw new StateError("INVALID_USAGE");
          trace.estimatedCostMicros = result.usage.estimatedCostMicros;
          if (
            result.usage.inputTokens + result.usage.outputTokens >
              this.limits.callTokens * trace.attempts ||
            result.usage.estimatedCostMicros >
              this.limits.callCostMicros * trace.attempts
          )
            throw new StateError("USAGE_BOUND_EXCEEDED");
        } else cycle.usageKnown = false;
        trace.output = privateContext
          ? { redacted: true, validated: true }
          : structuredClone(output);
        trace.status = "accepted";
        return output;
      } catch (error) {
        trace.durationMs = Math.round(performance.now() - callStartedAt);
        const failure = traceFailure(error);
        trace.failureCode = failure.code;
        trace.failureMessage = failure.message;
        cycle.usageKnown = false;
        throw error;
      }
    };
    const judgePass = async (
      phase: "review" | "final",
      requestedBy: Trace["requestedBy"],
    ) => {
      const input = {
        ...sharedContext(room),
        proposedOptions: planned,
        previousFindings: previousFindings.filter(
          (f) => !f.id.startsWith("hard_"),
        ),
        draftQuestions,
        draftMascot,
        task: phase,
      };
      const judge = validateJudge(
        room,
        await invoke("Judge", phase, input, requestedBy),
        planned,
        previousFindings,
      );
      previousFindings = judge.findings;
      const trace = cycle.traces.at(-1)!;
      trace.acceptedOptionIds = judge.verdicts
        .filter((v) => v.accepted)
        .map((v) => v.optionId);
      trace.rejectedOptionIds = judge.verdicts
        .filter((v) => !v.accepted)
        .map((v) => v.optionId);
      trace.status = trace.rejectedOptionIds.length ? "rejected" : "accepted";
      trace.output = structuredClone(judge);
      return judge;
    };
    try {
      for (const pendingInput of room.pendingInputs) {
        const parsed = RoleSchemas.Listener.parse(
          await invoke(
            "Listener",
            "interpret",
            {
              // The Listener needs only this participant's text and private
              // facts. Sending the group roster, proposal, and shared facts
              // here would widen disclosure without helping extraction.
              privateInput: { text: pendingInput.text },
              privateFacts: room.facts.filter(
                (f) =>
                  f.visibility === "private" &&
                  f.ownerId === pendingInput.actorId,
              ),
            },
            "orchestrator",
            true,
          ),
        );
        candidates = [
          ...candidates,
          ...parsed.candidates.map((c) => ({
            ...c,
            id: randomUUID(),
            ownerId: pendingInput.actorId,
            confirmed: false,
            visibility: "private" as const,
            scope: "participant" as const,
          })),
        ].slice(-200);
        handledInputIds.add(pendingInput.id);
      }
      let judge = await judgePass("review", "orchestrator");
      let revisions = 0;
      const seen = new Set<string>();
      for (;;) {
        await assertCurrent();
        if (judge.next === "negotiate") {
          if (revisions > this.limits.maxRevisions)
            throw new StateError("REVISION_LIMIT");
          // Compare meaningful content, excluding wording and arbitrary issue/option IDs.
          const signature = fingerprint({
            findings: judge.findings
              .map((f) => [
                f.category,
                f.severity,
                f.status,
                [...f.evidenceIds].sort(),
              ])
              .sort(),
            options: planned
              .map((o) => o.values)
              .sort((a, b) => fingerprint(a).localeCompare(fingerprint(b))),
            verdicts: judge.verdicts.map((v) => [
              planned.find((o) => o.id === v.optionId)?.values,
              v.accepted,
            ]),
          });
          if (seen.has(signature)) throw new StateError("NO_PROGRESS");
          seen.add(signature);
          draftQuestions = [];
          draftMascot = null;
          draftFindingIds = [];
          const proposal = RoleSchemas.Negotiator.parse(
            await invoke(
              "Negotiator",
              "revise",
              {
                ...sharedContext(room),
                findings: judge.findings,
                previousOptions: planned,
                previousVerdicts: judge.verdicts,
                taskFindingIds: judge.taskFindingIds,
              },
              "Judge",
            ),
          );
          unique(proposal.options.map((o) => o.id));
          planned = proposal.options;
          revisions++;
          judge = await judgePass("review", "Negotiator");
          continue;
        }
        if (judge.next === "question") {
          const strategy = RoleSchemas["Question Strategist"].parse(
            await invoke(
              "Question Strategist",
              "questions",
              {
                ...sharedContext(room),
                findings: judge.findings,
                existingQuestions: room.questions,
                feasibleOptions: planned.filter((o) =>
                  judge.verdicts.some((v) => v.optionId === o.id && v.accepted),
                ),
              },
              "Judge",
            ),
          );
          validateQuestions(room, strategy.questions, judge.findings);
          draftQuestions = strategy.questions;
        }
        if (draftQuestions.length || judge.next === "speak") {
          const speaker = RoleSchemas.Speaker.parse(
            await invoke(
              "Speaker",
              "draft",
              {
                ...sharedContext(room),
                findings: judge.findings,
                questions: draftQuestions,
              },
              draftQuestions.length ? "Question Strategist" : "Judge",
            ),
          );
          unique(speaker.questionIds);
          unique(speaker.findingIds);
          if (
            speaker.questionIds.some(
              (id) => !draftQuestions.some((q) => q.id === id),
            ) ||
            speaker.findingIds.some(
              (id) => !judge.findings.some((f) => f.id === id),
            )
          )
            throw new StateError("INVALID_DRAFT");
          draftQuestions = draftQuestions.filter((q) =>
            speaker.questionIds.includes(q.id),
          );
          draftMascot = speaker.mascot;
          draftFindingIds = speaker.findingIds;
          judge = await judgePass("final", "Speaker");
          if (judge.next === "negotiate") {
            draftQuestions = [];
            continue;
          }
          if (judge.next === "speak") throw new StateError("NO_PROGRESS");
          if (
            judge.acceptedQuestionIds.some(
              (id) => !draftQuestions.some((q) => q.id === id),
            )
          )
            throw new StateError("INVALID_DRAFT");
          draftQuestions = draftQuestions.filter((q) =>
            judge.acceptedQuestionIds.includes(q.id),
          );
        }
        if (
          !judge.canStop ||
          (judge.anotherPassUseful && !judge.participantInputRequired)
        )
          throw new StateError("NO_USEFUL_STOP");
        if (judge.participantInputRequired && !draftQuestions.length)
          throw new StateError("QUESTION_REQUIRED");
        validateQuestions(room, draftQuestions, judge.findings);
        cycle.outcome = draftQuestions.length
          ? "WAIT_FOR_PARTICIPANT"
          : "COMPLETED";
        cycle.reason = draftQuestions.length
          ? "PARTICIPANT_INPUT_REQUIRED"
          : "ANALYSIS_COMPLETE";
        cycle.finalEvaluation = judge;
        cycle.readiness = calculateReadiness(room, judge.findings);
        cycle.questions = draftQuestions;
        cycle.mascot = draftMascot;
        cycle.messages = [
          ...draftQuestions.map((q) => ({
            text: q.text,
            visibility: q.visibility,
            targetId: q.targetId,
            questionId: q.id,
            proposalVersion: room.proposalVersion,
          })),
          ...judge.findings
            .filter((f) => draftFindingIds.includes(f.id))
            .map((f) => ({
              text: f.message,
              visibility: "group" as const,
              targetId: null,
              questionId: null,
              proposalVersion: room.proposalVersion,
            })),
        ];
        break;
      }
    } catch (error) {
      cycle.outcome = "BLOCKED";
      cycle.reason =
        controller.signal.reason === "TIMEOUT"
          ? "TIMEOUT"
          : signal.aborted
            ? "CANCELLED"
            : error instanceof StateError
              ? error.code
              : error instanceof Error && error.name === "ZodError"
                ? "INVALID_HANDOFF"
                : "AGENT_FAILURE";
      cycle.finalEvaluation = null;
      cycle.questions = [];
      cycle.mascot = null;
      cycle.readiness = room.readiness;
    } finally {
      clearTimeout(deadline);
      if (this.active.get(roomId) === controller) this.active.delete(roomId);
    }
    try {
      await this.store.transaction(roomId, (state) => {
        // A stale or cancelled old cycle cannot change newer state, including its loop status.
        if (
          !state ||
          state.revision !== room.revision ||
          state.activeCycleId !== cycleId
        )
          return;
        state.activeCycleId = null;
        state.lastCycle = structuredClone(cycle);
        state.candidates = candidates;
        state.pendingInputs = state.pendingInputs.filter(
          (input) => !handledInputIds.has(input.id),
        );
        if (cycle.finalEvaluation) {
          state.readiness = cycle.readiness;
          state.questions = cycle.questions;
          state.options = planned;
        }
      });
    } catch {
      cycle.outcome = "BLOCKED";
      cycle.reason = "PERSISTENCE_FAILURE";
      cycle.finalEvaluation = null;
      cycle.readiness = room.readiness;
      cycle.messages = [];
      cycle.questions = [];
    }
    return cycle;
  }
}
