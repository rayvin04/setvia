import { createHash, randomUUID } from "node:crypto";
import type { Response } from "express";
import { dirname, resolve } from "node:path";
import { lstat, mkdir, open, readFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { LiveBudgetJournal, LIVE_MAX_HTTP_ATTEMPTS, LIVE_ATTEMPT_RESERVATION_MICROS, LIVE_ATTEMPT_RESERVATION_TOKENS } from "../../../scripts/live-budget-journal.js";
import { readMetaConfig } from "../ai/meta-client.js";
import { assertPlanningScope } from "../ai/planning-scope.js";
import { createMetaGateway } from "../agents/meta-gateway.js";
import type { MetaHttpEvent } from "../agents/meta-gateway.js";
import { AgentEngine, type Limits } from "../agents/engine.js";
import { Roles, type AgentGateway, type Auth, type CallContext, type Cycle, type Role } from "../agents/contracts.js";
import { policyForEvent } from "../agents/default-policy.js";
import { JsonPersistence, RoomStore, StateError } from "../agents/store.js";
import { digest } from "../agents/rooms.js";
import { saveLab, type LabRecord } from "../agents/lab.js";
import { DashboardSnapshotSchema } from "../../../shared/dashboard.js";
import { SubmitRoomMessageSchema, SubmitRoomMessageResultSchema } from "../../../shared/room-api.js";
import { projectDashboardSnapshot } from "../dashboard/projection.js";
import { ReceiptImageManager } from "./receipt-image.js";
import type { CreateRoomRequest, GenerateReceiptImageRequest } from "../../../shared/room-api.js";

export const DEFAULT_ROOM_PROMPT_VERSION = "agents-v8";

// Keep the committed Stage B integration ceiling; Studio and extraction share this ledger.
export const LIVE_CAP = {
  attempts: 31,
  costMicros: 3_224_000,
  tokens: 1_984_000,
};
export const LIVE_CYCLE_CAP = {
  attempts: 10,
  tokens: 640_000,
  costMicros: 1_040_000,
};
const LIVE_ROOM_CAP = {
  attempts: 21,
  tokens: 1_344_000,
  costMicros: 2_184_000,
};
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
type Allowance = { tokens: number; costMicros: number };
type BudgetHold = Allowance & { attempts: number; released: boolean };

function redactListenerTraces(cycle: Cycle, context: "group-response" | "owner-private") {
  for (const trace of cycle.traces) {
    if (trace.role === "Listener") {
      trace.input = { redacted: true, context };
      trace.output = { redacted: true, validated: true };
    }
  }
  return cycle;
}

export class IntegrationRunBudget {
  attempts = 0;
  tokens = 0;
  costMicros = 0;
  private tail: Promise<void> = Promise.resolve();
  private persistenceFailed = false;
  private closed = false;
  private readonly holds = new Set<BudgetHold>();

  private constructor(
    private readonly ledger: FileHandle,
    readonly cap = LIVE_CAP,
  ) {}

  static async open(path: string, cap = LIVE_CAP) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    let content = "";
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 1_048_576)
        throw new StateError("INTEGRATION_BUDGET_CORRUPT");
      content = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const ledger = await open(path, "a", 0o600);
    try {
      const openedInfo = await ledger.stat();
      const pathInfo = await lstat(path);
      if (!pathInfo.isFile() || pathInfo.isSymbolicLink() || openedInfo.dev !== pathInfo.dev || openedInfo.ino !== pathInfo.ino) {
        throw new StateError("INTEGRATION_BUDGET_CORRUPT");
      }
    } catch (error) {
      await ledger.close();
      throw error;
    }
    const budget = new IntegrationRunBudget(ledger, cap);
    if (content && !content.endsWith("\n")) {
      await budget.ledger.close();
      throw new StateError("INTEGRATION_BUDGET_CORRUPT");
    }
    try {
      for (const line of content.split("\n").filter(Boolean)) {
        const record = JSON.parse(line) as { tokens: number; costMicros: number };
        if (!Number.isSafeInteger(record.tokens) || record.tokens < 0 || !Number.isSafeInteger(record.costMicros) || record.costMicros < 0)
          throw new Error("invalid reservation");
        budget.attempts++;
        budget.tokens += record.tokens;
        budget.costMicros += record.costMicros;
      }
    } catch {
      await budget.ledger.close();
      throw new StateError("INTEGRATION_BUDGET_CORRUPT");
    }
    if (budget.attempts > cap.attempts || budget.tokens > cap.tokens || budget.costMicros > cap.costMicros) {
      await budget.ledger.close();
      throw new StateError("INTEGRATION_BUDGET_CORRUPT");
    }
    return budget;
  }

  assertCapacity(attempts: number, allowance: Allowance) {
    const held = [...this.holds].reduce((sum, hold) => ({
      attempts: sum.attempts + hold.attempts,
      tokens: sum.tokens + hold.tokens,
      costMicros: sum.costMicros + hold.costMicros,
    }), { attempts: 0, tokens: 0, costMicros: 0 });
    if (this.closed || this.persistenceFailed) throw new StateError("INTEGRATION_BUDGET_UNAVAILABLE");
    if (!Number.isSafeInteger(attempts) || attempts < 1 ||
      !Number.isSafeInteger(allowance.tokens) || allowance.tokens < 0 ||
      !Number.isSafeInteger(allowance.costMicros) || allowance.costMicros < 0 ||
      this.attempts + held.attempts + attempts > this.cap.attempts ||
      this.tokens + held.tokens + allowance.tokens * attempts > this.cap.tokens ||
      this.costMicros + held.costMicros + allowance.costMicros * attempts > this.cap.costMicros)
      throw new StateError("INTEGRATION_RUN_BUDGET_LIMIT");
  }

  async holdCycle(attempts: number, allowance: Allowance) {
    const hold: BudgetHold = { attempts, tokens: allowance.tokens * attempts,
      costMicros: allowance.costMicros * attempts, released: false };
    const operation = this.tail.then(() => {
      this.assertCapacity(attempts, allowance);
      this.holds.add(hold);
    });
    this.tail = operation.catch(() => {});
    await operation;
    return {
      reserve: (callAllowance: Allowance) => this.reserve(callAllowance, hold),
      release: () => {
        const release = this.tail.then(() => {
          hold.released = true;
          this.holds.delete(hold);
        });
        this.tail = release.catch(() => {});
        return release;
      },
    };
  }

  reserve(allowance: Allowance, hold?: BudgetHold) {
    const operation = this.tail.then(async () => {
      if (hold) {
        if (this.closed || this.persistenceFailed || hold.released || !this.holds.has(hold))
          throw new StateError("INTEGRATION_BUDGET_UNAVAILABLE");
        if (!Number.isSafeInteger(allowance.tokens) || allowance.tokens < 0 ||
          !Number.isSafeInteger(allowance.costMicros) || allowance.costMicros < 0 ||
          hold.attempts < 1 || hold.tokens < allowance.tokens || hold.costMicros < allowance.costMicros)
          throw new StateError("INTEGRATION_RUN_BUDGET_LIMIT");
      } else this.assertCapacity(1, allowance);
      const record = JSON.stringify({ tokens: allowance.tokens, costMicros: allowance.costMicros }) + "\n";
      try {
        await this.ledger.writeFile(record, { encoding: "utf8" });
        await this.ledger.sync();
      } catch (error) {
        this.persistenceFailed = true;
        throw error;
      }
      this.attempts++;
      this.tokens += allowance.tokens;
      this.costMicros += allowance.costMicros;
      if (hold) {
        hold.attempts--;
        hold.tokens -= allowance.tokens;
        hold.costMicros -= allowance.costMicros;
      }
    });
    this.tail = operation.catch(() => {});
    return operation;
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.tail;
    await this.ledger.close();
  }
  snapshot() {
    return {
      attempts: this.attempts,
      remainingAttempts: this.cap.attempts - this.attempts,
      reservedTokens: this.tokens,
      remainingTokens: this.cap.tokens - this.tokens,
      reservedCostMicros: this.costMicros,
      remainingCostMicros: this.cap.costMicros - this.costMicros,
    };
  }
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
  constructor(
    private readonly rooms: AgentEngine["rooms"],
    private readonly beforeSnapshot?: (roomId: string, auth: Auth) => Promise<void>,
  ) {}

  async subscribe(roomId: string, auth: Auth, response: Response) {
    await this.beforeSnapshot?.(roomId, auth);
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
  budget: IntegrationRunBudget;
  persistenceLock: () => Promise<void>;
  privateRoot: string;
  publicRoot: string;
  syntheticDemo: boolean;
  events?: RoomEventHub;
  beforeGroup?(): Promise<void>;
  acquireAttempt?(): Promise<() => void>;
  beforeAttempt?(): void | Promise<void>;
  participantCooldownMs?: number;
  receiptImages?: ReceiptImageManager;
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

  get budget() { return this.options.budget.snapshot(); }
  get demoMode() { return this.options.syntheticDemo; }
  get inferenceMode() { return this.options.engine.gateway.mode; }

  getAuxiliaryInferenceHooks(): AuxiliaryInferenceHooks {
    if (this.closed) throw new StateError("RUNTIME_CLOSED");
    return {
      reserveAttempt: (allowance) => this.options.budget.reserve(allowance),
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
    await this.options.receiptImages?.recover(roomId, auth);
    const view = await this.rooms.view(roomId, auth);
    const result = DashboardSnapshotSchema.parse(projectDashboardSnapshot(view));
    this.resumePending(roomId, auth);
    return result;
  }

  requestReceiptImage(roomId: string, auth: Auth, input: GenerateReceiptImageRequest) {
    if (!this.options.receiptImages) throw new StateError("RECEIPT_IMAGE_NOT_CONFIGURED");
    return this.options.receiptImages.request(roomId, auth, input);
  }

  readReceiptImage(roomId: string, auth: Auth) {
    if (!this.options.receiptImages) throw new StateError("RECEIPT_IMAGE_NOT_CONFIGURED");
    return this.options.receiptImages.read(roomId, auth);
  }

  async submit(roomId: string, auth: Auth, input: ReturnType<typeof SubmitRoomMessageSchema.parse>) {
    // The HTTP contract is always the idempotent object form.
    // Authorize before exposing budget state. Duplicate receipts need no run.
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
      if (input.visibility === "group" && !existing) await this.options.beforeGroup?.();
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
    await this.options.beforeGroup?.();
    await this.rooms.revise(roomId, auth, expectedRevision, proposal);
    this.scheduleGroup(roomId, auth);
    return this.snapshot(roomId, auth);
  }

  async approve(roomId: string, auth: Auth, version: number) {
    await this.rooms.approve(roomId, auth, version);
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
    await this.options.receiptImages?.close();
    this.events.close();
    await Promise.allSettled([...this.activeTasks]);
    this.privateRuns.clear();
    try {
      await this.options.budget.close();
    } finally {
      try {
        await this.options.journal.release();
      } finally {
        await this.options.persistenceLock();
      }
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
  let budget: IntegrationRunBudget | undefined;
  let receiptImages: ReceiptImageManager | undefined;
  try {
    journal = await LiveBudgetJournal.open(privateRoot, options.publicRoot, ["F"]);
    const runBudget = await IntegrationRunBudget.open(resolve(privateRoot, "room-state", "integration-budget.ndjson"));
    budget = runBudget;
    const promptVersion = options.promptVersion ?? DEFAULT_ROOM_PROMPT_VERSION;
    const base = await createRoomMetaGateway(
      privateRoot,
      promptVersion,
      (event) => journal!.handle(event, "F"),
      options.promptRoot,
      { acquireAttempt: options.acquireAttempt, beforeAttempt: options.beforeAttempt },
    );
    const gateway: AgentGateway = {
      mode: base.mode,
      promptVersion: base.promptVersion,
      promptHashes: base.promptHashes,
      async openCycle(maxRequests) {
        await checkGroupCapacity(maxRequests);
        const hold = await runBudget.holdCycle(maxRequests, { tokens: CALL_TOKEN_ALLOWANCE, costMicros: CALL_COST_MICROS });
        return {
          call: (role, input, context) => meteredCall(role, input, context, hold.reserve),
          release: hold.release,
        };
      },
      async call(role, input, context) {
        return meteredCall(role, input, context, (allowance) => runBudget.reserve(allowance));
      },
    };
    async function meteredCall(role: Role, input: unknown, context: CallContext, reserve: (allowance: Allowance) => Promise<void>) {
      return base.call(role, input, {
          signal: context.signal,
          reserveAttempt: async (allowance) => {
            if (!allowance) throw new StateError("CALL_ALLOWANCE_REQUIRED");
            await context.reserveAttempt(allowance);
            await reserve(allowance);
          },
        });
    }
    async function checkGroupCapacity(maxRequests: number) {
      runBudget.assertCapacity(maxRequests, { tokens: CALL_TOKEN_ALLOWANCE, costMicros: CALL_COST_MICROS });
      const global = await journal!.snapshot();
      if (global.attempts + maxRequests > LIVE_MAX_HTTP_ATTEMPTS)
        throw new StateError("LIVE_HTTP_ATTEMPT_LIMIT");
    }
    const limits: Limits = {
      maxInvocations: 16,
      maxRequests: LIVE_CYCLE_CAP.attempts,
      maxRevisions: 2,
      timeoutMs: 120_000,
      maxTokens: LIVE_CYCLE_CAP.tokens,
      maxCostMicros: LIVE_CYCLE_CAP.costMicros,
      callTokens: CALL_TOKEN_ALLOWANCE,
      callCostMicros: CALL_COST_MICROS,
      roomMaxRequests: LIVE_ROOM_CAP.attempts,
      roomMaxTokens: LIVE_ROOM_CAP.tokens,
      roomMaxCostMicros: LIVE_ROOM_CAP.costMicros,
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
    receiptImages = await ReceiptImageManager.open({
      store: engine.store,
      privateRoot,
      publicRoot: options.publicRoot,
      beforeAttempt: options.beforeAttempt,
      publishGroup: (roomId) => hub?.publishGroup(roomId),
    });
    hub = new RoomEventHub(engine.rooms, (roomId, auth) => receiptImages!.recover(roomId, auth));
    const runtime = new RoomRuntime({
      engine,
      journal,
      budget: runBudget,
      persistenceLock,
      privateRoot,
      publicRoot: options.publicRoot,
      syntheticDemo: options.syntheticDemo ?? false,
      events: hub,
      receiptImages,
      beforeGroup: () => checkGroupCapacity(limits.maxRequests),
      acquireAttempt: options.acquireAttempt,
      beforeAttempt: options.beforeAttempt,
      participantCooldownMs: options.participantCooldownMs,
    });
    return runtime;
  } catch (error) {
    await receiptImages?.close();
    await budget?.close();
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
  if (["INFERENCE_DISABLED", "RECEIPT_IMAGE_NOT_CONFIGURED", "RECEIPT_IMAGE_BUDGET_UNAVAILABLE", "RECEIPT_IMAGE_STORAGE_INVALID"].includes(code)) return 503;
  if (["UNAUTHORIZED", "UNAUTHORIZED_ANSWER", "PRIVATE_ANSWER_REQUIRED", "DUPLICATE_MESSAGE_ID"].includes(code)) return 403;
  if (["ROOM_NOT_FOUND", "CANDIDATE_NOT_FOUND"].includes(code)) return 404;
  if (["STALE_STATE", "STALE_PROPOSAL", "STALE_PRIVATE_ANALYSIS", "INVALID_REPLY_OPTION", "REPLY_WITHOUT_QUESTION", "INVALID_RECEIPT_IMAGE_RETRY", "RECEIPT_IMAGE_STATE_INVALID", "RECEIPT_IMAGE_NOT_READY"].includes(code)) return 409;
  if (code === "RECEIPT_IMAGE_BUDGET_LIMIT") return 429;
  if (code.includes("LIMIT") || code === "REVIEW_NOT_READY") return 409;
  return 400;
}

export const roomIdHash = (roomId: string) => createHash("sha256").update(roomId).digest("hex");
export const newMessageId = () => randomUUID();
