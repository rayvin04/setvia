import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { ScenarioRecord } from "./scenario-schema.js";
import { SyntheticScenarioStore } from "./store.js";
import {
  RoomApiClientError,
  RoomSnapshotSchema,
  SyntheticRoomApiClient,
  messagePayload,
  type ParticipantSession,
  type RoomSnapshot,
} from "./room-client.js";

const StatusSchema = z.enum([
  "ready",
  "playing",
  "paused",
  "waiting_for_question",
  "completed",
  "blocked",
  "reset",
  "recorded",
]);

const RecordedEventSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  scenarioEventId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).nullable(),
  phase: z.enum(["room_created", "participant_joined", "participant_message", "agent_state", "manual_intervention", "skipped"]),
  participantId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).nullable(),
  messageId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).nullable(),
  visibility: z.enum(["group", "private"]).nullable(),
  outcome: z.enum(["accepted", "waiting", "skipped", "complete", "blocked"]),
  capturedAt: z.string().datetime(),
  note: z.string().max(240),
  snapshot: RoomSnapshotSchema.nullable(),
  budget: z.object({
    attempts: z.number().int().nonnegative().nullable(),
    remainingAttempts: z.number().int().nonnegative().nullable(),
    reservedTokens: z.number().int().nonnegative().nullable(),
    reservedCostMicros: z.number().int().nonnegative().nullable(),
  }).strict(),
}).strict();

export const SimulationRunRecordSchema = z.object({
  formatVersion: z.literal("setvia-synthetic-simulation-v1"),
  runId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  datasetId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  datasetVersion: z.number().int().positive(),
  mode: z.literal("LIVE"),
  label: z.literal("Synthetic participants · Live Meta AI"),
  model: z.literal("muse-spark-1.3"),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  status: StatusSchema,
  currentIndex: z.number().int().nonnegative(),
  roomIdHash: z.string().regex(/^[a-f0-9]{64}$/),
  labJoinKey: z.string().regex(/^[a-f0-9]{64}$/),
  events: z.array(RecordedEventSchema).max(500),
  manualInterventions: z.array(z.object({
    participantId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    text: z.string().trim().min(1).max(1_000),
    visibility: z.enum(["group", "private"]),
    recordedAt: z.string().datetime(),
  }).strict()).max(100),
}).strict();

export type SimulationRunRecord = z.infer<typeof SimulationRunRecordSchema>;

const ManualInputSchema = z.object({
  participantId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  text: z.string().trim().min(1).max(1_000),
  visibility: z.enum(["group", "private"]),
}).strict();

interface LiveRunState {
  record: SimulationRunRecord;
  dataset: ScenarioRecord;
  roomInvitation: string;
  sessions: Map<string, ParticipantSession>;
  cursor: number;
  busy: boolean;
  paused: boolean;
  autoSpeed: number | null;
  playbackPromise: Promise<void> | null;
  updatedAt: string;
}

interface RecordedPlaybackState {
  id: string;
  sourceRun: SimulationRunRecord;
  cursor: number;
  status: "recorded" | "paused" | "completed";
  speed: number;
  playbackPromise: Promise<void> | null;
  updatedAt: string;
}

function loopbackDigest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function delay(milliseconds: number) {
  return new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function statusBusy(status: string) {
  return status === "queued" || status === "running";
}

export class SyntheticSimulationService {
  private readonly liveRuns = new Map<string, LiveRunState>();
  private readonly recordings = new Map<string, RecordedPlaybackState>();

  constructor(private readonly store: SyntheticScenarioStore, private readonly rooms = new SyntheticRoomApiClient()) {}

  async listRecordedRuns() {
    const values = await this.store.listRuns();
    return values.flatMap((value) => {
      const parsed = SimulationRunRecordSchema.safeParse(value);
      if (!parsed.success) return [];
      const run = parsed.data;
      return [{
        runId: run.runId,
        datasetId: run.datasetId,
        datasetVersion: run.datasetVersion,
        label: run.label,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        status: run.status,
        events: run.events.length,
        roomIdHash: run.roomIdHash,
      }];
    }).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async startLive(datasetId: string, datasetVersion?: number) {
    const dataset = await this.store.get(datasetId, datasetVersion);
    if (!dataset) throw new Error("SYNTHETIC_SCENARIO_NOT_FOUND");
    if (!dataset.review.approvedForPlayback) throw new Error("HUMAN_REVIEW_REQUIRED");
    const health = await this.rooms.health();
    if (!health.enabled || health.mode !== "synthetic-live-demo")
      throw new Error("SYNTHETIC_LIVE_ROOM_SERVER_REQUIRED");

    const runId = `sim-${randomUUID()}`;
    const roomIdSeed = `plan-${randomUUID()}`;
    const firstJoin = dataset.scenario.timeline[0]!;
    const creator = dataset.scenario.participants.find((person) => person.id === firstJoin.participantId);
    if (!creator || firstJoin.kind !== "join") throw new Error("INVALID_FIRST_ROOM_MEMBER");
    const created = await this.rooms.createRoom({
      creatorName: creator.name,
      eventType: dataset.scenario.event.type,
      initialPlan: dataset.scenario.event.initialPlan,
      attendeeCount: dataset.scenario.event.expectedAttendeeCount,
      confirmedAttendeeCount: dataset.scenario.event.confirmedAttendeeCount,
      proposalId: roomIdSeed,
    });
    const roomIdHash = loopbackDigest(created.roomId);
    const initialSnapshot = RoomSnapshotSchema.parse(created.snapshot);
    const record: SimulationRunRecord = {
      formatVersion: "setvia-synthetic-simulation-v1",
      runId,
      datasetId: dataset.datasetId,
      datasetVersion: dataset.datasetVersion,
      mode: "LIVE",
      label: "Synthetic participants · Live Meta AI",
      model: "muse-spark-1.3",
      startedAt: new Date().toISOString(),
      completedAt: null,
      status: "ready",
      currentIndex: 1,
      roomIdHash,
      labJoinKey: roomIdHash,
      events: [{
        id: `capture-${randomUUID()}`,
        scenarioEventId: firstJoin.id,
        phase: "room_created",
        participantId: creator.id,
        messageId: null,
        visibility: null,
        outcome: "accepted",
        capturedAt: new Date().toISOString(),
        note: `${creator.name} joined the synthetic planning room.`,
        snapshot: initialSnapshot,
        budget: {
          attempts: health.budget?.attempts ?? null,
          remainingAttempts: health.budget?.remainingAttempts ?? null,
          reservedTokens: health.budget?.reservedTokens ?? null,
          reservedCostMicros: health.budget?.reservedCostMicros ?? null,
        },
      }],
      manualInterventions: [],
    };
    const state: LiveRunState = {
      record,
      dataset,
      roomInvitation: created.invitation,
      sessions: new Map([[creator.id, created.session]]),
      cursor: 1,
      busy: false,
      paused: true,
      autoSpeed: null,
      playbackPromise: null,
      updatedAt: new Date().toISOString(),
    };
    this.liveRuns.set(runId, state);
    await this.persist(state);
    return {
      ...this.view(runId),
      dashboardSession: created.session,
      dashboardInvitation: created.invitation,
    };
  }

  async loadRecorded(runId: string) {
    const raw = await this.store.readRun(runId);
    const parsed = SimulationRunRecordSchema.safeParse(raw);
    if (!parsed.success || parsed.data.events.length === 0) throw new Error("RECORDING_NOT_FOUND");
    const id = `recording-${randomUUID()}`;
    const state: RecordedPlaybackState = {
      id,
      sourceRun: parsed.data,
      cursor: 0,
      status: "paused",
      speed: 1,
      playbackPromise: null,
      updatedAt: new Date().toISOString(),
    };
    this.recordings.set(id, state);
    return this.recordedView(id);
  }

  get(runId: string) {
    return this.recordings.has(runId) ? this.recordedView(runId) : this.view(runId);
  }

  async next(runId: string) {
    const recording = this.recordings.get(runId);
    if (recording) {
      if (recording.status === "recorded") throw new Error("SIMULATION_AUTOPLAY_ACTIVE");
      recording.cursor = Math.min(recording.cursor + 1, recording.sourceRun.events.length);
      if (recording.cursor >= recording.sourceRun.events.length) recording.status = "completed";
      recording.updatedAt = new Date().toISOString();
      return this.recordedView(runId);
    }
    const state = this.requireLive(runId);
    if (!state.paused) throw new Error("SIMULATION_AUTOPLAY_ACTIVE");
    await this.stepLive(state);
    return this.view(runId);
  }

  async play(runId: string, speed: number) {
    if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) throw new Error("INVALID_PLAYBACK_SPEED");
    const recording = this.recordings.get(runId);
    if (recording) {
      recording.speed = speed;
      recording.status = "recorded";
      recording.updatedAt = new Date().toISOString();
      if (!recording.playbackPromise) {
        recording.playbackPromise = (async () => {
          while (recording.cursor < recording.sourceRun.events.length) {
            await delay(Math.max(100, 800 / speed));
            if (recording.status !== "recorded") break;
            recording.cursor += 1;
            recording.updatedAt = new Date().toISOString();
          }
          if (recording.cursor >= recording.sourceRun.events.length) recording.status = "completed";
        })().finally(() => { recording.playbackPromise = null; });
      }
      return this.recordedView(runId);
    }
    const state = this.requireLive(runId);
    if (state.busy) throw new Error("SIMULATION_STEP_IN_PROGRESS");
    state.autoSpeed = speed;
    state.paused = false;
    state.record.status = "playing";
    state.updatedAt = new Date().toISOString();
    if (!state.playbackPromise) state.playbackPromise = this.autoPlay(state).finally(() => { state.playbackPromise = null; });
    await this.persist(state);
    return this.view(runId);
  }

  async pause(runId: string) {
    const recording = this.recordings.get(runId);
    if (recording) {
      recording.status = "paused";
      recording.updatedAt = new Date().toISOString();
      return this.recordedView(runId);
    }
    const state = this.requireLive(runId);
    state.paused = true;
    state.autoSpeed = null;
    if (!state.busy) state.record.status = "paused";
    state.updatedAt = new Date().toISOString();
    await this.persist(state);
    return this.view(runId);
  }

  async resume(runId: string, speed?: number) {
    if (this.recordings.has(runId)) return this.play(runId, speed ?? 1);
    const state = this.requireLive(runId);
    return this.play(runId, speed ?? state.autoSpeed ?? 1);
  }

  async skipCurrent(runId: string) {
    const state = this.requireLive(runId);
    if (state.busy) throw new Error("SIMULATION_STEP_IN_PROGRESS");
    if (!state.paused) throw new Error("SIMULATION_AUTOPLAY_ACTIVE");
    const event = state.dataset.scenario.timeline[state.cursor];
    if (!event || event.kind !== "message") throw new Error("NO_OPTIONAL_MESSAGE_TO_SKIP");
    const message = state.dataset.scenario.messages.find((item) => item.id === event.messageId);
    if (!message?.questionRefId) throw new Error("ONLY_OPTIONAL_QUESTION_RESPONSES_CAN_BE_SKIPPED");
    const participant = state.dataset.scenario.participants.find((person) => person.id === event.participantId);
    state.record.events.push({
      id: `capture-${randomUUID()}`,
      scenarioEventId: event.id,
      phase: "skipped",
      participantId: event.participantId,
      messageId: message.id,
      visibility: message.visibility,
      outcome: "skipped",
      capturedAt: new Date().toISOString(),
      note: `${participant?.name ?? "A planner"}'s optional scripted response was skipped because no matching live question was available.`,
      snapshot: null,
      budget: { attempts: null, remainingAttempts: null, reservedTokens: null, reservedCostMicros: null },
    });
    state.cursor += 1;
    state.record.currentIndex = state.cursor;
    state.record.status = state.cursor >= state.dataset.scenario.timeline.length ? "completed" : "paused";
    if (state.record.status === "completed") state.record.completedAt = new Date().toISOString();
    state.updatedAt = new Date().toISOString();
    await this.persist(state);
    return this.view(runId);
  }

  async intervene(runId: string, body: unknown) {
    const state = this.requireLive(runId);
    const parsed = ManualInputSchema.safeParse(body);
    if (!parsed.success) throw new Error("INVALID_MANUAL_INTERVENTION");
    if (state.busy) throw new Error("SIMULATION_STEP_IN_PROGRESS");
    if (!state.paused) throw new Error("SIMULATION_AUTOPLAY_ACTIVE");
    const participant = state.dataset.scenario.participants.find((person) => person.id === parsed.data.participantId);
    const session = state.sessions.get(parsed.data.participantId);
    if (!participant || !session) throw new Error("PARTICIPANT_NOT_JOINED");
    const snapshot = await this.rooms.getSnapshot(session);
    const messageId = `manual-${randomUUID()}`;
    const before = snapshot.sequence;
    const result = await this.rooms.submitMessage(session, messagePayload({
      messageId,
      expectedRevision: snapshot.room.revision,
      proposalVersion: snapshot.room.proposalVersion,
      text: parsed.data.text,
      visibility: parsed.data.visibility,
      questionId: null,
      replyOption: null,
    }));
    const capturedAt = new Date().toISOString();
    state.record.manualInterventions.push({ ...parsed.data, recordedAt: capturedAt });
    state.record.events.push({
      id: `capture-${randomUUID()}`,
      scenarioEventId: null,
      phase: "manual_intervention",
      participantId: participant.id,
      messageId,
      visibility: parsed.data.visibility,
      outcome: "accepted",
      capturedAt,
      note: `${participant.name} submitted a manual ${parsed.data.visibility} response.`,
      snapshot: result.snapshot,
      budget: { attempts: null, remainingAttempts: null, reservedTokens: null, reservedCostMicros: null },
    });
    const final = await this.waitUntilSettled(session, result.snapshot, parsed.data.visibility, before);
    this.appendAgentState(state, participant.id, messageId, parsed.data.visibility, final);
    state.record.status = "paused";
    state.updatedAt = new Date().toISOString();
    await this.persist(state);
    return this.view(runId);
  }

  async reset(runId: string) {
    const recording = this.recordings.get(runId);
    if (recording) {
      recording.cursor = 0;
      recording.status = "paused";
      recording.speed = 1;
      recording.updatedAt = new Date().toISOString();
      return this.recordedView(runId);
    }
    const state = this.requireLive(runId);
    if (state.busy) throw new Error("SIMULATION_STEP_IN_PROGRESS");
    state.paused = true;
    state.record.status = "reset";
    state.record.completedAt = new Date().toISOString();
    await this.persist(state);
    return this.startLive(state.dataset.datasetId, state.dataset.datasetVersion);
  }

  private async stepLive(state: LiveRunState) {
    if (state.busy) throw new Error("SIMULATION_STEP_IN_PROGRESS");
    if (state.cursor >= state.dataset.scenario.timeline.length) {
      state.record.status = "completed";
      state.record.completedAt = new Date().toISOString();
      await this.persist(state);
      return;
    }
    const event = state.dataset.scenario.timeline[state.cursor]!;
    state.busy = true;
    try {
      if (event.kind === "join") {
        const person = state.dataset.scenario.participants.find((entry) => entry.id === event.participantId);
        if (!person) throw new Error("UNKNOWN_SCENARIO_PARTICIPANT");
        const joined = await this.rooms.joinRoom(state.record.events[0]!.snapshot!.room.roomId, state.roomInvitation, person.name);
        state.sessions.set(person.id, joined.session);
        this.appendEvent(state, {
          scenarioEventId: event.id,
          phase: "participant_joined",
          participantId: person.id,
          messageId: null,
          visibility: null,
          outcome: "accepted",
          note: `${person.name} joined the synthetic planning room.`,
          snapshot: joined.snapshot,
        });
        state.cursor += 1;
      } else {
        const message = state.dataset.scenario.messages.find((entry) => entry.id === event.messageId);
        if (!message) throw new Error("UNKNOWN_SCENARIO_MESSAGE");
        const person = state.dataset.scenario.participants.find((entry) => entry.id === message.ownerId);
        const session = state.sessions.get(message.ownerId);
        if (!person || !session) throw new Error("PARTICIPANT_NOT_JOINED");
        let snapshot = await this.rooms.getSnapshot(session);
        let questionId: string | null = null;
        if (message.questionRefId) {
          const question = this.findMatchingQuestion(state, message, snapshot);
          if (!question) {
            state.record.status = "waiting_for_question";
            state.record.events.push({
              id: `capture-${randomUUID()}`,
              scenarioEventId: event.id,
              phase: "participant_message",
              participantId: person.id,
              messageId: message.id,
              visibility: message.visibility,
              outcome: "waiting",
              capturedAt: new Date().toISOString(),
              note: "Waiting for a matching validated room question; the response was not submitted.",
              snapshot,
              budget: { attempts: null, remainingAttempts: null, reservedTokens: null, reservedCostMicros: null },
            });
            await this.persist(state);
            return;
          }
          if (question.visibility === "private" && (question.targetId !== session.participantId || message.visibility !== "private")) {
            state.record.status = "waiting_for_question";
            await this.persist(state);
            return;
          }
          if ((question.options.length > 0 && (!message.replyOption || !question.options.includes(message.replyOption))) ||
              (message.replyOption !== null && !question.options.includes(message.replyOption))) {
            state.record.status = "waiting_for_question";
            await this.persist(state);
            return;
          }
          questionId = question.id;
        }
        const beforeSequence = snapshot.sequence;
        const submitted = await this.rooms.submitMessage(session, messagePayload({
          messageId: message.id,
          expectedRevision: snapshot.room.revision,
          proposalVersion: snapshot.room.proposalVersion,
          text: message.text,
          visibility: message.visibility,
          questionId,
          replyOption: message.replyOption,
        }));
        this.appendEvent(state, {
          scenarioEventId: event.id,
          phase: "participant_message",
          participantId: person.id,
          messageId: message.id,
          visibility: message.visibility,
          outcome: "accepted",
          note: `${person.name} submitted a ${message.visibility} synthetic message.`,
          snapshot: submitted.snapshot,
        });
        const final = await this.waitUntilSettled(session, submitted.snapshot, message.visibility, beforeSequence);
        this.appendAgentState(state, person.id, message.id, message.visibility, final);
        state.cursor += 1;
      }
      state.record.currentIndex = state.cursor;
      state.record.status = state.cursor >= state.dataset.scenario.timeline.length ? "completed" : "paused";
      if (state.record.status === "completed") state.record.completedAt = new Date().toISOString();
      state.updatedAt = new Date().toISOString();
      await this.persist(state);
    } catch (error) {
      state.record.status = "blocked";
      state.record.events.push({
        id: `capture-${randomUUID()}`,
        scenarioEventId: event.id,
        phase: "agent_state",
        participantId: event.participantId,
        messageId: event.messageId,
        visibility: null,
        outcome: "blocked",
        capturedAt: new Date().toISOString(),
        note: error instanceof RoomApiClientError ? error.message.slice(0, 240) : "A validated room action could not be completed.",
        snapshot: null,
        budget: { attempts: null, remainingAttempts: null, reservedTokens: null, reservedCostMicros: null },
      });
      state.updatedAt = new Date().toISOString();
      await this.persist(state);
      throw error;
    } finally {
      state.busy = false;
    }
  }

  private findMatchingQuestion(state: LiveRunState, message: ScenarioRecord["scenario"]["messages"][number], snapshot: RoomSnapshot) {
    const intent = state.dataset.scenario.anticipatedQuestions.find((question) => question.id === message.questionRefId);
    if (!intent) return null;
    const tags = intent.topicTags.map((tag) => tag.replaceAll("_", " ").toLocaleLowerCase());
    return snapshot.room.questions.find((question) => {
      if (question.targetId && question.targetId !== snapshot.room.viewerId) return false;
      const text = question.text.toLocaleLowerCase();
      return tags.some((tag) => tag.split(/\s+/).filter(Boolean).every((word) => text.includes(word)));
    }) ?? null;
  }

  private async waitUntilSettled(session: ParticipantSession, submitted: RoomSnapshot, visibility: "group" | "private", initialSequence: number) {
    const started = Date.now();
    let latest = submitted;
    while (Date.now() - started < 180_000) {
      const status = visibility === "private" ? latest.room.privateAnalysisStatus : latest.room.analysisStatus;
      if (latest.sequence > initialSequence && !statusBusy(status)) return latest;
      await delay(400);
      latest = await this.rooms.getSnapshot(session);
    }
    throw new Error("ROOM_ANALYSIS_STATE_TIMEOUT");
  }

  private appendAgentState(state: LiveRunState, participantId: string, messageId: string, visibility: "group" | "private", snapshot: RoomSnapshot) {
    const status = visibility === "private" ? snapshot.room.privateAnalysisStatus : snapshot.room.analysisStatus;
    this.appendEvent(state, {
      scenarioEventId: null,
      phase: "agent_state",
      participantId,
      messageId,
      visibility,
      outcome: status === "blocked" ? "blocked" : "complete",
      note: status === "blocked" ? "The room analysis reached its validated blocked state." : "The room agents reached a settled state.",
      snapshot,
    });
  }

  private appendEvent(state: LiveRunState, input: Omit<z.input<typeof RecordedEventSchema>, "id" | "capturedAt" | "budget">) {
    state.record.events.push({
      id: `capture-${randomUUID()}`,
      capturedAt: new Date().toISOString(),
      budget: { attempts: null, remainingAttempts: null, reservedTokens: null, reservedCostMicros: null },
      ...input,
    });
  }

  private async autoPlay(state: LiveRunState) {
    while (!state.paused && state.cursor < state.dataset.scenario.timeline.length && state.record.status !== "blocked") {
      const event = state.dataset.scenario.timeline[state.cursor];
      const speed = state.autoSpeed ?? 1;
      if (event?.delaySeconds) await delay(Math.max(0, Math.round(event.delaySeconds * 1_000 / speed)));
      if (state.paused) break;
      try { await this.stepLive(state); }
      catch { break; }
      if (state.record.status === "waiting_for_question") break;
      if (state.cursor < state.dataset.scenario.timeline.length) await delay(Math.max(100, 500 / speed));
      state.record.status = "playing";
      await this.persist(state);
    }
    if (state.paused && state.record.status === "playing") state.record.status = "paused";
    state.updatedAt = new Date().toISOString();
    await this.persist(state);
  }

  private async persist(state: LiveRunState) {
    state.record.currentIndex = state.cursor;
    state.record = SimulationRunRecordSchema.parse(state.record);
    await this.store.saveRun(state.record.runId, state.record);
  }

  private requireLive(runId: string) {
    const state = this.liveRuns.get(runId);
    if (!state) throw new Error("SIMULATION_NOT_FOUND");
    return state;
  }

  private view(runId: string) {
    const state = this.requireLive(runId);
    const lastEvent = state.record.events.at(-1);
    return {
      run: state.record,
      cursor: state.cursor,
      total: state.dataset.scenario.timeline.length,
      participantNames: state.dataset.scenario.participants.map(({ id, name, role }) => ({ id, name, role, joined: state.sessions.has(id) })),
      nextEvent: state.dataset.scenario.timeline[state.cursor] ?? null,
      busy: state.busy,
      paused: state.paused,
      updatedAt: state.updatedAt,
      currentSnapshot: lastEvent?.snapshot ?? null,
      dataset: {
        id: state.dataset.datasetId,
        version: state.dataset.datasetVersion,
        name: state.dataset.scenario.event.name,
        eventType: state.dataset.scenario.event.type,
        expectedAttendees: state.dataset.scenario.event.expectedAttendeeCount,
        activePlanners: state.dataset.scenario.activePlannerCount,
      },
      labJoinKey: state.record.labJoinKey,
    };
  }

  private recordedView(id: string) {
    const state = this.recordings.get(id);
    if (!state) throw new Error("RECORDING_NOT_FOUND");
    const cursor = Math.min(state.cursor, state.sourceRun.events.length);
    const events = state.sourceRun.events.slice(0, cursor);
    const last = events.at(-1) ?? null;
    return {
      run: state.sourceRun,
      playbackId: state.id,
      mode: "RECORDED" as const,
      label: "Recorded synthetic demo · saved outputs · no new Meta requests",
      cursor,
      total: state.sourceRun.events.length,
      busy: false,
      paused: state.status === "paused" || state.status === "completed",
      updatedAt: state.updatedAt,
      currentSnapshot: last?.snapshot ?? null,
    };
  }
}
