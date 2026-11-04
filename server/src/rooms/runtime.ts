import { createHash, randomUUID } from "node:crypto";
import type { Response } from "express";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { LiveBudgetJournal, LIVE_ATTEMPT_RESERVATION_MICROS, LIVE_ATTEMPT_RESERVATION_TOKENS } from "../../../scripts/live-budget-journal.js";
import { readMetaConfig } from "../ai/meta-client.js";
import { assertPlanningScope } from "../ai/planning-scope.js";
import { createMetaGateway } from "../agents/meta-gateway.js";
import type { MetaHttpEvent } from "../agents/meta-gateway.js";
import { AgentEngine, type Limits } from "../agents/engine.js";
import { Roles, type AgentGateway, type Auth, type Cycle, type Role } from "../agents/contracts.js";
import { policyForEvent } from "../agents/default-policy.js";
import { JsonPersistence, RoomStore, StateError } from "../agents/store.js";
import { digest } from "../agents/rooms.js";
import { saveLab, type LabRecord } from "../agents/lab.js";
import { DashboardSnapshotSchema } from "../../../shared/dashboard.js";
import { SubmitRoomMessageSchema, SubmitRoomMessageResultSchema } from "../../../shared/room-api.js";
import { projectDashboardSnapshot } from "../dashboard/projection.js";
import type { CreateRoomRequest } from "../../../shared/room-api.js";

export const DEFAULT_ROOM_PROMPT_VERSION = "agents-v8";

const INPUT_PRICE_MICROS_PER_MILLION = 1_250_000;
const OUTPUT_PRICE_MICROS_PER_MILLION = 4_250_000;
const MAX_OUTPUT_TOKENS: Record<Role, number> = {
  Listener: 2_048,
  Judge: 8_192,
  Negotiator: 4_096,
  "Question Strategist": 4_096,
  Speaker: 2_048,
};
const INPUT_TOKEN_ALLOWANCE = 55_000;
const CALL_TOKEN_ALLOWANCE = LIVE_ATTEMPT_RESERVATION_TOKENS;
const CALL_COST_MICROS = LIVE_ATTEMPT_RESERVATION_MICROS;
const MAX_REQUEST_BYTES = 50_000;
function redactListenerTraces(cycle: Cycle, context: "group-response" | "owner-private") {
  for (const trace of cycle.traces) {
    if (trace.role === "Listener") {
      trace.input = { redacted: true, context };
      trace.output = { redacted: true, validated: true };
    }
  }
  return cycle;
}

interface StreamClient {
  auth: Auth;
  response: Response;
  lastSequence: number;
  heartbeat: ReturnType<typeof setInterval>;
}

export class RoomEventHub {
  private static readonly MAX_STREAMS_PER_ROOM = 32;
  private static readonly MAX_STREAMS_PER_PARTICIPANT = 4;
  private readonly streams = new Map<string, Set<StreamClient>>();
  constructor(private readonly rooms: AgentEngine["rooms"]) {}

  async subscribe(roomId: string, auth: Auth, response: Response) {
    const initial = await this.snapshot(roomId, auth);
    const existing = this.streams.get(roomId);
    if (
      (existing?.size ?? 0) >= RoomEventHub.MAX_STREAMS_PER_ROOM ||
      [...(existing ?? [])].filter((client) => client.auth.participantId === auth.participantId).length >= RoomEventHub.MAX_STREAMS_PER_PARTICIPANT
    ) throw new StateError("ROOM_STREAM_LIMIT");
    response.status(200);
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-store, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders();
    const client: StreamClient = {
      auth,
      response,
      lastSequence: -1,
      heartbeat: setInterval(() => {
        if (!response.writableEnded && !response.write(": keep-alive\n\n")) response.end();
      }, 25_000),
    };
    const clients = this.streams.get(roomId) ?? new Set<StreamClient>();
    clients.add(client);
    this.streams.set(roomId, clients);
    const cleanup = () => {
      clearInterval(client.heartbeat);
      clients.delete(client);
      if (!clients.size) this.streams.delete(roomId);
    };
    response.once("close", cleanup);
    this.send(client, initial);
    return cleanup;
  }

  async publishGroup(roomId: string) {
    await this.publish(roomId);
  }

  async publishPrivate(roomId: string, ownerId: string) {
    await this.publish(roomId, ownerId);
  }

  private async publish(roomId: string, ownerId?: string) {
    const clients = this.streams.get(roomId);
    if (!clients) return;
    for (const client of [...clients]) {
      if (ownerId && client.auth.participantId !== ownerId) continue;
      try {
        this.send(client, await this.snapshot(roomId, client.auth));
      } catch {
        client.response.end();
      }
    }
  }

  private async snapshot(roomId: string, auth: Auth) {
    const view = await this.rooms.view(roomId, auth);
    return DashboardSnapshotSchema.parse(projectDashboardSnapshot(view));
  }

  private send(client: StreamClient, snapshot: ReturnType<typeof DashboardSnapshotSchema.parse>) {
    if (client.response.writableEnded || snapshot.sequence <= client.lastSequence) return;
    client.lastSequence = snapshot.sequence;
    const accepted = client.response.write(
      `id: ${snapshot.sequence}\nevent: room.snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`,
    );
    if (!accepted) client.response.end();
  }

  close() {
    for (const clients of this.streams.values()) {
      for (const client of clients) {
        clearInterval(client.heartbeat);
        client.response.end();
      }
    }
    this.streams.clear();
  }
}

interface RoomRuntimeOptions {
  engine: AgentEngine;
  journal: LiveBudgetJournal;
  persistenceLock: () => Promise<void>;
  privateRoot: string;
  publicRoot: string;
  syntheticDemo: boolean;
  events?: RoomEventHub;
  acquireAttempt?(): Promise<() => void>;
  beforeAttempt?(): void | Promise<void>;
  participantCooldownMs?: number;
}

export interface AuxiliaryInferenceHooks {
  reserveAttempt(allowance: { tokens: number; costMicros: number }): Promise<void>;
  recordHttpEvent(event: MetaHttpEvent): Promise<void>;
  acquireAttempt(): Promise<() => void>;
  beforeAttempt(): void | Promise<void>;
}

export class RoomRuntime {
  readonly rooms: AgentEngine["rooms"];
  readonly events: RoomEventHub;
  private readonly groupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly groupActors = new Map<string, Auth | null>();
  private readonly privateTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly privateRuns = new Map<string, Promise<void>>();
  private readonly activeTasks = new Set<Promise<void>>();
  private readonly participantSubmissions = new Map<string, { at: number; messageId: string }>();
  private closed = false;

  constructor(private readonly options: RoomRuntimeOptions) {
    this.rooms = options.engine.rooms;
    this.events = options.events ?? new RoomEventHub(this.rooms);
  }

  get budget() {
    return this.options.journal.snapshot().then((snapshot) => ({
      attempts: snapshot.attempts,
      remainingAttempts: null,
      reservedTokens: snapshot.tokensAtRisk,
      remainingTokens: null,
      reservedCostMicros: snapshot.estimatedCostMicros,
      remainingCostMicros: null,
    }));
  }
  get demoMode() { return this.options.syntheticDemo; }
  get inferenceMode() { return this.options.engine.gateway.mode; }

  getAuxiliaryInferenceHooks(): AuxiliaryInferenceHooks {
    if (this.closed) throw new StateError("RUNTIME_CLOSED");
    return {
      // Actual attempts and usage are recorded by the private request journal.
      reserveAttempt: async () => {},
      recordHttpEvent: (event) => this.options.journal.handle(event, "F"),
      acquireAttempt: () => this.options.acquireAttempt?.() ?? Promise.resolve(() => {}),
      beforeAttempt: () => this.options.beforeAttempt?.(),
    };
  }

  async create(input: CreateRoomRequest, creatorName: string) {
    const created = await this.rooms.create(
      input.eventType,
      policyForEvent(input.eventType),
      input.proposal,
      {
        estimatedAttendeeCount: input.estimatedAttendeeCount,
        confirmedAttendeeCount: input.confirmedAttendeeCount,
      },
      { syntheticDemo: this.options.syntheticDemo },
    );
    const joined = await this.rooms.join(created.roomId, created.invitation, creatorName);
    const auth = { participantId: joined.participantId, token: joined.token };
    await this.rooms.acceptReviewedDraft(created.roomId, auth, input.reviewedKeys ?? []);
    const state = await this.options.engine.store.read(created.roomId);
    const details = Object.entries(input.proposal.values)
      .filter(([, value]) => value !== null && value !== "")
      .map(([key, value]) => `${key}: ${value}`).join("\n");
    // The submitted draft is group-visible. Use the same authorized domain
    // submission path as subsequent answers, with a durable pending input.
    if (input.reviewedKeys !== undefined) await this.rooms.submit(created.roomId, auth, {
      messageId: randomUUID(), expectedRevision: state.revision,
      proposalVersion: state.proposalVersion, visibility: "group",
      questionId: null, replyOption: null,
      text: `Organizer submitted the draft: ${input.proposal.label}\n${details}`.slice(0, 1000),
    });
    else await this.rooms.queueAnalysis(created.roomId, auth);
    this.scheduleGroup(created.roomId, auth);
    return {
      roomId: created.roomId,
      invitation: created.invitation,
      session: { roomId: created.roomId, ...auth },
      snapshot: await this.snapshot(created.roomId, auth),
    };
  }

  async join(roomId: string, invitation: string, name: string) {
    const prior = await this.options.engine.store.read(roomId);
    const joined = await this.rooms.join(roomId, invitation, name);
    const auth = { participantId: joined.participantId, token: joined.token };
    if (
      prior.activeCycleId !== null ||
      prior.analysisStatus === "running" ||
      (prior.lastCycle?.baseRevision === prior.revision && prior.lastCycle.finalEvaluation !== null) ||
      (prior.analysisStatus === "queued" && prior.pendingInputs.length > 0)
    ) this.scheduleGroup(roomId, auth);
    return {
      session: { roomId, ...auth },
      snapshot: await this.snapshot(roomId, auth),
    };
  }

  async snapshot(roomId: string, auth: Auth) {
    const view = await this.rooms.view(roomId, auth);
    const result = DashboardSnapshotSchema.parse(projectDashboardSnapshot(view));
    this.resumePending(roomId, auth);
    return result;
  }

  async submit(roomId: string, auth: Auth, input: ReturnType<typeof SubmitRoomMessageSchema.parse>) {
    // The HTTP contract is always the idempotent object form.
    // Authorize before exposing request-accounting state. Duplicate receipts need no run.
    await this.rooms.view(roomId, auth);
    assertPlanningScope(input.text);
    const state = await this.options.engine.store.read(roomId);
    const existing = state.responses.some((response) => response.id === input.messageId);
    const prior = this.participantSubmissions.get(auth.participantId);
    const now = Date.now();
    const cooldown = this.options.participantCooldownMs ?? 0;
    if (!existing && prior && prior.messageId !== input.messageId && now - prior.at < cooldown)
      throw new StateError("PARTICIPANT_COOLDOWN");
    const reservation = existing ? null : { at: now, messageId: input.messageId };
    if (reservation) this.participantSubmissions.set(auth.participantId, reservation);
    try {
      if (!existing) await this.options.beforeAttempt?.();
      const result = await this.rooms.submit(roomId, auth, input);
      if (!result.duplicate) {
        if (input.visibility === "group") this.scheduleGroup(roomId, auth);
        else this.schedulePrivate(roomId, auth.participantId);
      }
      return SubmitRoomMessageResultSchema.parse({
        receipt: result.receipt,
        duplicate: result.duplicate,
        snapshot: await this.snapshot(roomId, auth),
      });
    } catch (error) {
      if (reservation && this.participantSubmissions.get(auth.participantId) === reservation)
        this.participantSubmissions.delete(auth.participantId);
      throw error;
    }
  }

  async shareCandidate(roomId: string, auth: Auth, expectedRevision: number, candidateId: string) {
    await this.rooms.shareCandidate(roomId, auth, expectedRevision, candidateId);
    this.scheduleGroup(roomId, auth);
    return this.snapshot(roomId, auth);
  }

  async revise(roomId: string, auth: Auth, expectedRevision: number, proposal: CreateRoomRequest["proposal"]) {
    await this.rooms.view(roomId, auth);
    await this.rooms.revise(roomId, auth, expectedRevision, proposal);
    this.scheduleGroup(roomId, auth);
    return this.snapshot(roomId, auth);
  }

  async approve(roomId: string, auth: Auth, version: number) {
    await this.rooms.approve(roomId, auth, version);
    return this.snapshot(roomId, auth);
  }

  async retryAnalysis(roomId: string, auth: Auth, expectedRevision: number) {
    // Authenticate before consulting the inference guard so room membership
    // cannot be used to distinguish budget or kill-switch state.
    await this.rooms.view(roomId, auth);
    await this.options.beforeAttempt?.();
    if (await this.rooms.queueAnalysis(roomId, auth, expectedRevision)) this.scheduleGroup(roomId, auth);
    return this.snapshot(roomId, auth);
  }

  async leave(roomId: string, auth: Auth, expectedRevision: number) {
    const prior = await this.options.engine.store.read(roomId);
    const privateTimerKey = roomId + ":" + auth.participantId;
    const privateTimer = this.privateTimers.get(privateTimerKey);
    if (privateTimer) clearTimeout(privateTimer);
    this.privateTimers.delete(privateTimerKey);
    this.participantSubmissions.delete(auth.participantId);
    this.options.engine.cancelPrivate(roomId, auth.participantId);
    await this.rooms.leave(roomId, auth, expectedRevision);
    const next = await this.options.engine.store.read(roomId);
    const shouldReevaluate = prior.analysisStatus === "running" || prior.pendingInputs.length > 0 ||
      (prior.lastCycle?.baseRevision === prior.revision && prior.lastCycle.finalEvaluation !== null);
    if (next.participants.length > 0 && shouldReevaluate) this.scheduleSystemGroup(roomId);
    return { left: true as const };
  }

  private resumePending(roomId: string, auth: Auth) {
    void this.options.engine.store.read(roomId).then((room) => {
      if (room.analysisStatus === "idle" && !room.lastCycle) {
        void this.rooms.queueAnalysis(roomId, auth).then((queued) => {
          if (queued) this.scheduleGroup(roomId, auth);
        }).catch(() => {});
      }
      if (room.analysisStatus === "queued" && room.pendingInputs.length && !this.groupTimers.has(roomId))
        this.scheduleGroup(roomId, auth);
      if (room.privatePendingInputs.some((input) => input.actorId === auth.participantId) &&
        !this.privateTimers.has(roomId + ":" + auth.participantId) &&
        !this.privateRuns.has(roomId + ":" + auth.participantId))
        this.schedulePrivate(roomId, auth.participantId);
    }).catch(() => {});
  }

  private scheduleGroup(roomId: string, auth: Auth) {
    this.queueGroup(roomId, auth);
  }

  private scheduleSystemGroup(roomId: string) {
    this.queueGroup(roomId, null);
  }

  private queueGroup(roomId: string, auth: Auth | null) {
    this.groupActors.set(roomId, auth);
    const prior = this.groupTimers.get(roomId);
    if (prior) clearTimeout(prior);
    const timer = setTimeout(() => {
      this.groupTimers.delete(roomId);
      const actor = this.groupActors.get(roomId);
      const wasQueued = this.groupActors.has(roomId);
      this.groupActors.delete(roomId);
      if (wasQueued) this.trackTask(this.runGroup(roomId, actor ?? undefined));
    }, 250);
    this.groupTimers.set(roomId, timer);
  }

  private async runGroup(roomId: string, auth?: Auth) {
    const result = await (auth
      ? this.options.engine.run(roomId, auth)
      : this.options.engine.runAfterMembershipChange(roomId)).catch(() => null);
    if (!result) return;
    // Keep Listener messages and extractions out of saved Lab transcripts.
    // The room may contain both group-visible and owner-private response paths.
    const cycle = redactListenerTraces(structuredClone(result), "group-response");
    const room = await this.options.engine.store.read(roomId).catch(() => null);
    if (!room?.syntheticDemo) return;
    const journal = await this.options.journal.attemptsFor("F");
    const record: LabRecord = {
      scenario: `F — Live room ${digest(roomId).slice(0, 10)}`,
      scenarioId: "F",
      mode: this.options.engine.gateway.mode === "META" ? "LIVE" : "MOCK",
      simulation: true,
      model: "muse-spark-1.3",
      promptVersion: this.options.engine.gateway.promptVersion ?? "agents-v1",
      liveRunId: this.options.journal.runId,
      liveHttpAttempts: journal,
      liveBudgetSnapshot: await this.options.journal.snapshot(),
      roomIntegration: {
        sourceRoomHash: digest(roomId),
        eventType: room.eventType,
        publicRevision: room.revision,
        proposalVersion: room.proposalVersion,
      },
      cycle,
    };
    await this.savePrivateLab(record);
  }

  private schedulePrivate(roomId: string, ownerId: string) {
    const key = roomId + ":" + ownerId;
    const prior = this.privateTimers.get(key);
    if (prior) clearTimeout(prior);
    const timer = setTimeout(() => {
      this.privateTimers.delete(key);
      const previous = this.privateRuns.get(key) ?? Promise.resolve();
      const task = previous.catch(() => {}).then(() => this.processPrivate(roomId, ownerId));
      this.privateRuns.set(key, task);
      this.trackTask(task);
      void task.finally(() => {
        if (this.privateRuns.get(key) === task) this.privateRuns.delete(key);
      }).catch(() => {});
    }, 150);
    this.privateTimers.set(key, timer);
  }

  private trackTask(task: Promise<void>) {
    this.activeTasks.add(task);
    void task.then(
      () => this.activeTasks.delete(task),
      () => this.activeTasks.delete(task),
    );
  }

  private async processPrivate(roomId: string, ownerId: string) {
    const analyses = await this.options.engine.processPrivate(roomId, ownerId).catch(() => []);
    const room = await this.options.engine.store.read(roomId).catch(() => null);
    if (!room?.syntheticDemo) return;
    const ownerIndex = room.participants.findIndex((participant) => participant.id === ownerId);
    for (const analysis of analyses) {
      const cycle = structuredClone(analysis.cycle);
      // Listener input and output stay redacted in generic trace records. The
      // validated extraction is stored separately in the private Lab report.
      redactListenerTraces(cycle, "owner-private");
      const record: LabRecord = {
        scenario: `F — Private Listener ${digest(roomId).slice(0, 10)}`,
        scenarioId: "F",
        mode: this.options.engine.gateway.mode === "META" ? "LIVE" : "MOCK",
        simulation: true,
        model: "muse-spark-1.3",
        promptVersion: this.options.engine.gateway.promptVersion ?? "agents-v1",
        liveRunId: this.options.journal.runId,
        liveHttpAttempts: await this.options.journal.attemptsFor("F"),
        liveBudgetSnapshot: await this.options.journal.snapshot(),
        roomIntegration: {
          sourceRoomHash: digest(roomId),
          eventType: room.eventType,
          publicRevision: room.revision,
          proposalVersion: analysis.proposalVersion,
          privateOwnerLabel: `Participant ${ownerIndex + 1}`,
        },
        cycle,
      };
      await this.savePrivateLab(record);
    }
  }

  private async savePrivateLab(record: LabRecord) {
    await saveLab([record], resolve(this.options.privateRoot, "lab", "live"), this.options.publicRoot);
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const timer of this.groupTimers.values()) clearTimeout(timer);
    for (const timer of this.privateTimers.values()) clearTimeout(timer);
    this.groupTimers.clear();
    this.privateTimers.clear();
    this.options.engine.cancelAll();
    this.events.close();
    await Promise.allSettled([...this.activeTasks]);
    this.privateRuns.clear();
    try {
      await this.options.journal.release();
    } finally {
      await this.options.persistenceLock();
    }
  }
}

export async function createRoomMetaGateway(
  privateRoot: string,
  promptVersion: string,
  onHttpEvent: (event: MetaHttpEvent) => Promise<void>,
  promptRoot?: string,
  attemptControls?: {
    acquireAttempt?: () => Promise<() => void>;
    beforeAttempt?: () => void | Promise<void>;
  },
) {
  if (!/^agents-v[0-9]+$/.test(promptVersion)) throw new StateError("INVALID_PROMPT_VERSION");
  const prompts = {} as Record<Role, string>;
  for (const role of Roles) {
    const file = role === "Question Strategist" ? "question-strategist.txt" : role.toLowerCase() + ".txt";
    prompts[role] = await readFile(
      promptRoot
        ? resolve(promptRoot, `${promptVersion}-${file}`)
        : resolve(privateRoot, "prompts", promptVersion, file),
      "utf8",
    );
  }
  return createMetaGateway({
    client: {
      config: readMetaConfig(), timeoutMs: 30_000, maxRetries: 0, maxTotalRequests: 1,
      ...attemptControls,
    },
    prompts, promptVersion, maxRequestBytes: MAX_REQUEST_BYTES, maxOutputTokens: MAX_OUTPUT_TOKENS,
    inputTokenAllowance: INPUT_TOKEN_ALLOWANCE, callTokenAllowance: CALL_TOKEN_ALLOWANCE,
    callCostMicros: CALL_COST_MICROS, inputPriceMicrosPerMillion: INPUT_PRICE_MICROS_PER_MILLION,
    outputPriceMicrosPerMillion: OUTPUT_PRICE_MICROS_PER_MILLION, onHttpEvent,
  });
}

export async function createLocalRoomRuntime(options: {
  privateRoot: string;
  publicRoot: string;
  promptRoot?: string;
  promptVersion?: string;
  syntheticDemo?: boolean;
  acquireAttempt?: () => Promise<() => void>;
  beforeAttempt?: () => void | Promise<void>;
  participantCooldownMs?: number;
}): Promise<RoomRuntime> {
  const privateRoot = resolve(options.privateRoot);
  const persistence = new JsonPersistence(resolve(privateRoot, "room-state"), options.publicRoot);
  const persistenceLock = await persistence.acquireRuntimeLock();
  let journal: LiveBudgetJournal | undefined;
  try {
    journal = await LiveBudgetJournal.open(privateRoot, options.publicRoot, ["F"]);
    const promptVersion = options.promptVersion ?? DEFAULT_ROOM_PROMPT_VERSION;
    const base = await createRoomMetaGateway(
      privateRoot,
      promptVersion,
      (event) => journal!.handle(event, "F"),
      options.promptRoot,
      { acquireAttempt: options.acquireAttempt, beforeAttempt: options.beforeAttempt },
    );
    const gateway: AgentGateway = base;
    const limits: Limits = {
      maxRevisions: 2,
      questionBelowReadiness: 70,
      timeoutMs: 120_000,
      callTokens: CALL_TOKEN_ALLOWANCE,
      callCostMicros: CALL_COST_MICROS,
    };
    let engine!: AgentEngine;
    let hub: RoomEventHub | undefined;
    engine = new AgentEngine(
      new RoomStore(persistence),
      gateway,
      limits,
      (roomId) => { void hub?.publishGroup(roomId); },
      (roomId, ownerId) => { void hub?.publishPrivate(roomId, ownerId); },
    );
    hub = new RoomEventHub(engine.rooms);
    const runtime = new RoomRuntime({
      engine,
      journal,
      persistenceLock,
      privateRoot,
      publicRoot: options.publicRoot,
      syntheticDemo: options.syntheticDemo ?? false,
      events: hub,
      acquireAttempt: options.acquireAttempt,
      beforeAttempt: options.beforeAttempt,
      participantCooldownMs: options.participantCooldownMs,
    });
    return runtime;
  } catch (error) {
    await journal?.release();
    await persistenceLock();
    throw error;
  }
}

export function roomAuthFromHeaders(headers: Record<string, unknown>): Auth {
  const participantId = typeof headers["x-setvia-participant"] === "string"
    ? headers["x-setvia-participant"].trim()
    : "";
  const authorization = typeof headers.authorization === "string" ? headers.authorization : "";
  const match = /^Bearer ([a-f0-9]{64})$/i.exec(authorization);
  if (!participantId || !match) throw new StateError("UNAUTHORIZED");
  return { participantId, token: match[1]! };
}

export function roomErrorStatus(code: string) {
  if (code === "ROOM_STREAM_LIMIT" || code === "PARTICIPANT_COOLDOWN") return 429;
  if (["UNAUTHORIZED", "UNAUTHORIZED_ANSWER", "PRIVATE_ANSWER_REQUIRED", "DUPLICATE_MESSAGE_ID"].includes(code)) return 403;
  if (["ROOM_NOT_FOUND", "CANDIDATE_NOT_FOUND"].includes(code)) return 404;
  if (["STALE_STATE", "STALE_PROPOSAL", "STALE_PRIVATE_ANALYSIS", "INVALID_REPLY_OPTION", "REPLY_WITHOUT_QUESTION"].includes(code)) return 409;
  if (code.includes("LIMIT") || code === "REVIEW_NOT_READY") return 409;
  return 400;
}

export const roomIdHash = (roomId: string) => createHash("sha256").update(roomId).digest("hex");
export const newMessageId = () => randomUUID();
