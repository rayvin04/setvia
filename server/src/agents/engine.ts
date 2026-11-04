import { randomUUID, createHash } from "node:crypto";
import {
  RoleSchemas,
  CycleSchema,
  type AgentGateway,
  type Auth,
  type Cycle,
  type Finding,
  type JudgeEvaluation,
  type PlanOption,
  type Question,
  type Role,
  type Room,
  type RoomActivity,
  type Trace,
} from "./contracts.js";
import { RoomStore, StateError } from "./store.js";
import {
  RoomService,
  authorize,
  currentGroupResponses,
  groupResponseEvidenceId,
  sharedContext,
} from "./rooms.js";
import { calculateReadiness, explicitViolations, violations } from "./readiness.js";
import { MetaApiError } from "../ai/errors.js";

export interface Limits {
  maxRevisions: number;
  timeoutMs: number;
  // Conservative per-attempt estimates kept for accounting only.
  callTokens: number;
  callCostMicros: number;
}
export const MOCK_LIMITS: Limits = {
  maxRevisions: 2,
  timeoutMs: 30_000,
  callTokens: 12_000,
  callCostMicros: 30_000,
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
function appendActivity(
  room: Room,
  entry: Pick<RoomActivity, "kind" | "actorId" | "summary" | "category"> &
    Partial<Pick<RoomActivity, "visibility" | "targetId">>,
) {
  room.activity = [...room.activity, {
    id: randomUUID(),
    kind: entry.kind,
    revision: room.revision,
    proposalVersion: room.proposalVersion,
    occurredAt: new Date().toISOString(),
    actorId: entry.actorId,
    summary: entry.summary,
    category: entry.category,
    visibility: entry.visibility ?? "group",
    targetId: entry.targetId ?? null,
  }].slice(-100);
}
export function validateJudge(
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
    ...room.constraints.filter((constraint) => constraint.visibility === "group").map(
      (c) =>
        [c.id, { confirmed: true, key: c.key, value: c.expected }] as const,
    ),
    ...currentGroupResponses(room)
      .map((response) => [
        groupResponseEvidenceId(response.id),
        { confirmed: false, key: "group_response", value: response.text },
      ] as const),
    // This catalogue also resolves current Listener observations and prior
    // findings outside the small raw-message tail. IDs must resolve to actual
    // group responses for this proposal; observations cannot invent sources.
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
export function validateSpeaker(raw: unknown, questions: Question[], findings: Finding[]) {
  const speaker = RoleSchemas.Speaker.parse(raw);
  unique(speaker.replies.flatMap((reply) => reply.questionId === null ? [] : [reply.questionId]));
  unique(speaker.replies.flatMap((reply) => reply.findingId === null ? [] : [reply.findingId]));
  if (speaker.replies.some((reply) => reply.questionId !== null
    ? !questions.some((question) => question.id === reply.questionId)
    : !findings.some((finding) => finding.id === reply.findingId)))
    throw new StateError("INVALID_DRAFT");
  return speaker;
}
function validateQuestions(
  room: Room,
  questions: Question[],
  findings: Finding[],
) {
  unique(questions.map((q) => q.id));
  annotateInfeasibleQuestionOptions(room, questions);
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

const CONFIRMED_CONFLICT_SUFFIX = " [conflicts with a confirmed requirement]";

function parseClockMinutes(value: string): number | undefined {
  const meridiem = value.match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (meridiem) {
    let hours = Number(meridiem[1]) % 12;
    if (meridiem[3]!.toLowerCase().startsWith("p")) hours += 12;
    return hours * 60 + Number(meridiem[2] ?? 0);
  }
  const twentyFourHour = value.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (!twentyFourHour) return undefined;
  return Number(twentyFourHour[1]) * 60 + Number(twentyFourHour[2]);
}

function parsedChoiceValue(key: string, expected: unknown, label: string) {
  if (typeof expected === "string" && /time|departure|leave|start|arrival|meet/i.test(key)) {
    const actual = parseClockMinutes(label);
    const target = parseClockMinutes(expected);
    return actual === undefined || target === undefined ? undefined : { actual, target };
  }
  if (typeof expected === "number" && /budget|cost|price|amount|spend/i.test(key)) {
    if (!/₱|php|\$|usd|dollars?/i.test(label)) return undefined;
    const amount = label.match(/(?:₱|php|\$|usd\s*)\s*([0-9][0-9,]*(?:\.\d+)?)/i);
    if (!amount) return undefined;
    return { actual: Number(amount[1]!.replaceAll(",", "")), target: expected };
  }
  return undefined;
}

/** Labels structured choices that contradict a confirmed shared hard constraint. */
export function annotateInfeasibleQuestionOptions(room: Room, questions: Question[]) {
  const hardShared = room.constraints.filter((constraint) =>
    constraint.visibility === "group" && constraint.hard,
  );
  for (const question of questions) {
    if (question.kind !== "choice") continue;
    question.options = question.options.map((label) => {
      if (label.endsWith(CONFIRMED_CONFLICT_SUFFIX)) return label;
      const conflict = hardShared.some((constraint) => {
        const parsed = parsedChoiceValue(constraint.key, constraint.expected, label);
        if (!parsed) return false;
        switch (constraint.operator) {
          case "eq": return parsed.actual !== parsed.target;
          case "neq": return parsed.actual === parsed.target;
          case "lte": return parsed.actual > parsed.target;
          case "gte": return parsed.actual < parsed.target;
          case "required": return false;
        }
      });
      return conflict
        ? `${label.slice(0, 120)}${CONFIRMED_CONFLICT_SUFFIX}`
        : label;
    });
  }
  return questions;
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
      request_limit: "This Meta client reached its single-request safeguard.",
      accounting: "Request accounting failed before inference could be completed.",
    };
    return {
      code: truncated ? "META_OUTPUT_TRUNCATED" : `META_${error.code.toUpperCase()}`,
      message: truncated
        ? "Meta reached the configured output-token limit before completing the response."
        : messages[error.code],
    };
  }
  if (error instanceof Error && error.name === "ZodError") {
    const issues = (error as Error & {
      issues?: Array<{ path?: unknown; code?: unknown }>;
    }).issues;
    const issue = issues?.[0];
    const location = Array.isArray(issue?.path)
      ? issue.path.reduce<string>((current, segment) => {
          if (typeof segment === "number" && Number.isSafeInteger(segment) && segment >= 0)
            return `${current}[${segment}]`;
          if (typeof segment === "string" && /^[A-Za-z][A-Za-z0-9_]*$/.test(segment))
            return current ? `${current}.${segment}` : segment;
          return current;
        }, "")
      : "";
    const issueCode = typeof issue?.code === "string" && /^[a-z0-9_]{1,40}$/.test(issue.code)
      ? issue.code
      : "";
    return {
      code: "INVALID_HANDOFF",
      message: location
        ? `Structured output did not match the role schema at ${location}${issueCode ? ` (${issueCode})` : ""}.`
        : "Structured output did not match the role schema.",
    };
  }
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
  private activePrivate = new Map<string, AbortController>();
  readonly limits: Limits;
  private readonly publishRoom: (roomId: string) => void;
  constructor(
    readonly store: RoomStore,
    readonly gateway: AgentGateway,
    limits?: Limits,
    publishRoom: (roomId: string) => void = () => {},
    publishPrivate: (roomId: string, ownerId: string) => void = () => {},
  ) {
    if (gateway.mode === "META" && !limits)
      throw new StateError("LIVE_LIMITS_REQUIRED");
    this.limits = limits ?? MOCK_LIMITS;
    limits = this.limits;
    for (const value of Object.values(limits))
      if (!Number.isSafeInteger(value) || value < 1)
        throw new StateError("INVALID_LIMITS");
    this.publishRoom = publishRoom;
    this.rooms = new RoomService(
      store,
      (id) => {
        this.cancel(id);
        publishRoom(id);
      },
      publishPrivate,
    );
  }
  cancel(id: string) {
    this.active.get(id)?.abort();
  }

  cancelPrivate(roomId: string, ownerId: string) {
    this.activePrivate.get(roomId + ":" + ownerId)?.abort();
  }

  cancelAll() {
    for (const controller of this.active.values()) controller.abort();
    for (const controller of this.activePrivate.values()) controller.abort();
  }

  async run(
    roomId: string,
    auth: Auth,
    options: { signal?: AbortSignal; retryBlocked?: boolean } = {},
  ): Promise<Cycle> {
    return this.runInternal(roomId, auth, options);
  }

  async runAfterMembershipChange(roomId: string): Promise<Cycle> {
    return this.runInternal(roomId, null, {});
  }

  private async runInternal(
    roomId: string,
    auth: Auth | null,
    options: { signal?: AbortSignal; retryBlocked?: boolean },
  ): Promise<Cycle> {
    const controller = new AbortController();
    let room!: Room;
    let existing: Cycle | null = null;
    const cycleId = randomUUID();
    await this.store.transaction(roomId, (state) => {
      if (!state) throw new StateError("ROOM_NOT_FOUND");
      if (auth) authorize(state, auth);
      else if (!state.participants.length) throw new StateError("ROOM_EMPTY");
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
      state.analysisStatus = "running";
      state.publicSequence++;
      state.eventSequence++;
      appendActivity(state, {
        kind: "analysis_started",
        actorId: auth?.participantId ?? null,
        summary: "Setvia is reviewing the shared plan with its agent team.",
        category: null,
      });
      room = structuredClone(state);
    });
    if (existing) return existing;
    this.publishRoom(roomId);
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
    const groupObservations: Array<{
      sourceEvidenceId: string;
      ownerId: string;
      proposalVersion: number;
      questionId: string | null;
      replyOption: string | null;
      confirmed: false;
      scope: "participant";
      candidates: Array<{ key: string; value: string | number | boolean | null }>;
    }> = [];
    const analysisContext = () => ({
      ...sharedContext(room),
      groupObservations: structuredClone(groupObservations),
    });
    let planned: PlanOption[] = [];
    let draftQuestions: Question[] = [];
    let draftMascot: Cycle["mascot"] = null;
    let draftFindingIds: string[] = [];
    let authoredFindingTexts = new Map<string, string>();
    const priorReadiness = room.readiness;
    const currentEvidenceIds = new Set([
      ...room.facts.filter((fact) => fact.visibility === "group").map((fact) => fact.id),
      ...room.constraints.filter((constraint) => constraint.visibility === "group").map((constraint) => constraint.id),
      ...currentGroupResponses(room).map((response) => groupResponseEvidenceId(response.id)),
    ]);
    const validatedFindingsBeforeCycle = (room.lastCycle?.finalEvaluation?.findings ?? []).map((finding) => {
      // A previous finding remains a concern when its evidence expires or is
      // revoked. Never send the stale reference back as current evidence.
      const evidenceIds = finding.evidenceIds.filter((id) => currentEvidenceIds.has(id));
      return evidenceIds.length === finding.evidenceIds.length ? finding : {
        ...finding, evidenceIds, status: "unverified" as const, uncertainty: "missing" as const,
      };
    });
    let previousFindings = validatedFindingsBeforeCycle;
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
              const tokens = allowance?.tokens ?? this.limits.callTokens;
              const costMicros = allowance?.costMicros ?? this.limits.callCostMicros;
              if (!Number.isSafeInteger(tokens) || tokens < 1 ||
                !Number.isSafeInteger(costMicros) || costMicros < 1)
                throw new StateError("INVALID_ALLOWANCE");
              await this.store.transaction(roomId, (state) => {
                if (
                  !state ||
                  state.revision !== room.revision ||
                  state.activeCycleId !== cycleId
                )
                  throw new StateError("STALE_STATE");
                state.lifetimeAttempts++;
                state.lifetimeReservedTokens += tokens;
                state.lifetimeReservedCostMicros += costMicros;
                cycle.attempts++;
                trace.attempts++;
                cycle.reservedTokens += tokens;
                cycle.reservedCostMicros += costMicros;
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
        ...analysisContext(),
        proposedOptions: planned,
        previousFindings: previousFindings.filter(
          (f) => !f.id.startsWith("hard_"),
        ),
        draftQuestions,
        draftFindingReplies: [...authoredFindingTexts].map(([findingId, text]) => ({ findingId, text })),
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
        if (pendingInput.visibility !== "group")
          throw new StateError("PRIVATE_INPUT_IN_GROUP_ANALYSIS");
        const source = room.responses.find((response) => response.id === pendingInput.messageId);
        if (!source || source.visibility !== "group" || source.ownerId !== pendingInput.actorId ||
          source.text !== pendingInput.text || source.questionId !== pendingInput.questionId ||
          source.replyOption !== pendingInput.replyOption)
          throw new StateError("INVALID_EVIDENCE_SOURCE");
        if (source.proposalVersion !== room.proposalVersion) {
          handledInputIds.add(pendingInput.id);
          continue;
        }
        const parsed = RoleSchemas.Listener.parse(
          await invoke(
            "Listener",
            "interpret",
            {
              // A group-visible response authorizes only that text for this
              // Listener call. Never attach the owner's private facts here.
              groupInput: {
                text: pendingInput.text,
                questionId: pendingInput.questionId,
                replyOption: pendingInput.replyOption,
              },
            },
            "orchestrator",
          ),
        );
        groupObservations.push({
          sourceEvidenceId: groupResponseEvidenceId(source.id),
          ownerId: source.ownerId,
          proposalVersion: source.proposalVersion,
          questionId: pendingInput.questionId,
          replyOption: pendingInput.replyOption,
          confirmed: false,
          scope: "participant",
          candidates: parsed.candidates.map(({ key, value }) => ({ key, value })),
        });
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
          authoredFindingTexts.clear();
          const proposal = RoleSchemas.Negotiator.parse(
            await invoke(
              "Negotiator",
              "revise",
              {
                ...analysisContext(),
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
                ...analysisContext(),
                findings: judge.findings,
                existingQuestions: room.questions.filter(
                  (question) => question.visibility === "group",
                ),
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
          const speaker = validateSpeaker(
            await invoke(
              "Speaker",
              "draft",
              {
                ...analysisContext(),
                findings: judge.findings,
                questions: draftQuestions,
              },
              draftQuestions.length ? "Question Strategist" : "Judge",
            ), draftQuestions, judge.findings,
          );
          const findingIds = speaker.replies.flatMap((reply) =>
            reply.findingId === null ? [] : [reply.findingId],
          );
          const authoredQuestions = new Map(
            speaker.replies
              .filter((reply) => reply.questionId !== null)
              .map((reply) => [reply.questionId!, reply.text]),
          );
          draftQuestions = draftQuestions
            .filter((question) => authoredQuestions.has(question.id))
            .map((question) => ({
              ...question,
              text: authoredQuestions.get(question.id)!,
            }));
          draftMascot = speaker.mascot;
          draftFindingIds = findingIds;
          authoredFindingTexts = new Map(
            speaker.replies
              .filter((reply) => reply.findingId !== null)
              .map((reply) => [reply.findingId!, reply.text]),
          );
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
              text: authoredFindingTexts.get(f.id)!,
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
        state.analysisStatus = cycle.outcome === "BLOCKED" ? "blocked" : "complete";
        state.publicSequence++;
        state.eventSequence++;
        const candidateIds = new Set(candidates.map((candidate) => candidate.id));
        const concurrentlyAddedPrivate = state.candidates.filter(
          (candidate) =>
            candidate.visibility === "private" &&
            !room.candidates.some((before) => before.id === candidate.id) &&
            !candidateIds.has(candidate.id),
        );
        state.candidates = [...candidates, ...concurrentlyAddedPrivate].slice(-200);
        state.pendingInputs = state.pendingInputs.filter(
          (input) => !handledInputIds.has(input.id),
        );
        if (cycle.finalEvaluation) {
          state.readiness = cycle.readiness;
          state.questions = cycle.questions;
          state.options = planned;
          if (cycle.readiness) {
            state.readinessHistory = [
              ...state.readinessHistory,
              {
                id: randomUUID(),
                revision: state.revision,
                proposalVersion: state.proposalVersion,
                occurredAt: new Date().toISOString(),
                readiness: structuredClone(cycle.readiness),
                explanation:
                  cycle.finalEvaluation.readinessAssessment.explanation ||
                  (priorReadiness
                    ? `Validated readiness is now ${cycle.readiness.percentage}%.`
                    : "The first validated readiness result is available."),
              },
            ].slice(-30);
          }
        }
        if (cycle.finalEvaluation) {
          const nextFindings = cycle.finalEvaluation.findings;
          const priorIds = new Set(validatedFindingsBeforeCycle.map((finding) => finding.id));
          const newCategories = new Set(nextFindings
            .filter((finding) => finding.status !== "resolved" && !priorIds.has(finding.id))
            .map((finding) => finding.category));
          for (const category of newCategories) appendActivity(state, {
            kind: "finding_detected",
            actorId: null,
            summary: `Setvia found a new item to review in ${category}.`,
            category,
          });

          const currentById = new Map(nextFindings.map((finding) => [finding.id, finding]));
          const resolvedCategories = new Set(validatedFindingsBeforeCycle
            .filter((finding) => finding.status !== "resolved" && currentById.get(finding.id)?.status === "resolved")
            .map((finding) => finding.category));
          for (const category of resolvedCategories) appendActivity(state, {
            kind: "issue_resolved",
            actorId: null,
            summary: `A previously flagged item was resolved in ${category}.`,
            category,
          });

          const groupQuestions = cycle.questions.filter((question) => question.visibility === "group");
          if (groupQuestions.length) appendActivity(state, {
            kind: "question_asked",
            actorId: null,
            summary: groupQuestions.length === 1 ? "Setvia asked the group to confirm a planning detail." : `Setvia asked the group ${groupQuestions.length} planning questions.`,
            category: null,
          });
          for (const question of cycle.questions) {
            if (question.visibility !== "private" || !question.targetId) continue;
            appendActivity(state, {
              kind: "question_asked",
              actorId: null,
              summary: "Setvia sent you a private planning question.",
              category: null,
              visibility: "private",
              targetId: question.targetId,
            });
          }

          if (priorReadiness && cycle.readiness && (
            priorReadiness.percentage !== cycle.readiness.percentage ||
            priorReadiness.status !== cycle.readiness.status
          )) appendActivity(state, {
            kind: "readiness_changed",
            actorId: null,
            summary: `Validated readiness changed from ${priorReadiness.percentage}% to ${cycle.readiness.percentage}%.`,
            category: null,
          });
        }
        appendActivity(state, {
          kind: cycle.outcome === "BLOCKED" ? "analysis_blocked" : "analysis_completed",
          actorId: null,
          summary: cycle.outcome === "BLOCKED"
            ? "Setvia could not complete this analysis. The last validated result is retained."
            : "Setvia completed a validated analysis of the shared plan.",
          category: null,
        });
      });
    } catch {
      cycle.outcome = "BLOCKED";
      cycle.reason = "PERSISTENCE_FAILURE";
      cycle.finalEvaluation = null;
      cycle.readiness = room.readiness;
      cycle.messages = [];
      cycle.questions = [];
    }
    this.publishRoom(roomId);
    return cycle;
  }

  /**
   * Process owner-only inputs with Listener in an isolated call. This method
   * never invokes Judge and never changes public readiness or shared revision.
   */
  async processPrivate(roomId: string, ownerId: string) {
    const initial = await this.store.read(roomId);
    if (!initial.participants.some((participant) => participant.id === ownerId))
      throw new StateError("UNAUTHORIZED");
    const queue = initial.privatePendingInputs.filter((input) => input.actorId === ownerId);
    if (!queue.length) return [];
    await this.rooms.markPrivateAnalysisRunning(roomId, ownerId);
    const completed: Room["privateAnalyses"] = [];
    for (const pending of queue) {
      const room = await this.store.read(roomId);
      if (!room.participants.some((participant) => participant.id === ownerId))
        break;
      const cycle: Cycle = {
        id: randomUUID(),
        baseRevision: room.revision,
        outcome: "COMPLETED",
        reason: "ANALYSIS_COMPLETE",
        finalEvaluation: null,
        readiness: null,
        traces: [],
        attempts: 0,
        reservedTokens: 0,
        reservedCostMicros: 0,
        usageKnown: true,
        questions: [],
        mascot: null,
        messages: [],
      };
      const trace: Trace = {
        sequence: 1,
        role: "Listener",
        phase: "interpret",
        requestedBy: "orchestrator",
        promptVersion: this.gateway.promptVersion ?? "agents-v1",
        promptHash: this.gateway.promptHashes?.Listener ?? null,
        mode: this.gateway.mode,
        schemaVersion: "agents-v2",
        input: { redacted: true, context: "owner-private" },
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
      const startedAt = performance.now();
      const controller = new AbortController();
      const activeKey = roomId + ":" + ownerId;
      this.activePrivate.set(activeKey, controller);
      const timeout = setTimeout(() => controller.abort("TIMEOUT"), this.limits.timeoutMs);
      let analysis: Room["privateAnalyses"][number];
      try {
        const result = await withAbort(
          this.gateway.call(
            "Listener",
            {
              privateInput: { text: pending.text },
              privateFacts: room.facts.filter(
                (fact) => fact.ownerId === ownerId && fact.visibility === "private",
              ),
            },
            {
              signal: controller.signal,
              reserveAttempt: async (allowance) => {
                const tokens = allowance?.tokens ?? this.limits.callTokens;
                const costMicros = allowance?.costMicros ?? this.limits.callCostMicros;
                if (
                  !Number.isSafeInteger(tokens) || tokens < 1 ||
                  !Number.isSafeInteger(costMicros) || costMicros < 1
                ) throw new StateError("INVALID_ALLOWANCE");
                await this.store.transaction(roomId, (state) => {
                  if (!state || !state.participants.some((participant) => participant.id === ownerId))
                    throw new StateError("UNAUTHORIZED");
                  state.lifetimeAttempts++;
                  state.lifetimeReservedTokens += tokens;
                  state.lifetimeReservedCostMicros += costMicros;
                });
                cycle.attempts++;
                trace.attempts++;
                cycle.reservedTokens += tokens;
                cycle.reservedCostMicros += costMicros;
              },
            },
          ),
          controller.signal,
        );
        trace.durationMs = Math.round(performance.now() - startedAt);
        if (trace.attempts !== 1) throw new StateError("UNMETERED_CALL");
        const parsed = RoleSchemas.Listener.parse(result.output);
        if (result.usage) {
          trace.inputTokens = result.usage.inputTokens;
          trace.cachedInputTokens = result.usage.cachedInputTokens ?? null;
          trace.outputTokens = result.usage.outputTokens;
          trace.reasoningTokens = result.usage.reasoningTokens ?? null;
          trace.totalTokens = result.usage.totalTokens ?? result.usage.inputTokens + result.usage.outputTokens;
          trace.estimatedCostMicros = result.usage.estimatedCostMicros;
        } else cycle.usageKnown = false;
        trace.output = structuredClone(parsed);
        trace.status = "accepted";
        cycle.reason = "ANALYSIS_COMPLETE";
        analysis = {
          ownerId,
          sourceMessageId: pending.messageId ?? pending.id,
          proposalVersion: room.proposalVersion,
          updatedAt: new Date().toISOString(),
          cycle: CycleSchema.parse(cycle),
          candidates: parsed.candidates.map((candidate) => ({
            ...candidate,
            id: randomUUID(),
            ownerId,
            confirmed: false,
            visibility: "private" as const,
            scope: "participant" as const,
          })),
        };
        await this.rooms.completePrivateAnalysis(roomId, ownerId, pending.id, analysis);
      } catch (error) {
        const failure = traceFailure(error);
        trace.failureCode = failure.code;
        trace.failureMessage = failure.message;
        trace.durationMs = Math.round(performance.now() - startedAt);
        trace.status = "failed";
        cycle.outcome = "BLOCKED";
        cycle.reason = controller.signal.reason === "TIMEOUT" ? "TIMEOUT" : "PRIVATE_ANALYSIS_FAILED";
        cycle.finalEvaluation = null;
        cycle.readiness = null;
        cycle.usageKnown = false;
        analysis = {
          ownerId,
          sourceMessageId: pending.messageId ?? pending.id,
          proposalVersion: room.proposalVersion,
          updatedAt: new Date().toISOString(),
          cycle: CycleSchema.parse(cycle),
          candidates: [],
        };
        await this.rooms.failPrivateAnalysis(roomId, ownerId, pending.id, analysis);
      } finally {
        clearTimeout(timeout);
        if (this.activePrivate.get(activeKey) === controller) this.activePrivate.delete(activeKey);
      }
      completed.push(analysis);
    }
    return completed;
  }
}
