import { z } from "zod";
import { OptionSchema } from "../agents/contracts.js";

const SessionSchema = z.object({
  roomId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  participantId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  token: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

const QuestionSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  text: z.string().max(500),
  options: z.array(z.string().max(160)).max(8),
  visibility: z.enum(["group", "private"]),
  targetId: z.string().nullable(),
}).passthrough();

export const RoomSnapshotSchema = z.object({
  schemaVersion: z.literal("dashboard-v1"),
  source: z.literal("room"),
  sequence: z.number().int().nonnegative(),
  room: z.object({
    roomId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    viewerId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    revision: z.number().int().nonnegative(),
    proposalVersion: z.number().int().positive(),
    analysisStatus: z.enum(["idle", "queued", "running", "blocked", "complete"]),
    privateAnalysisStatus: z.enum(["idle", "queued", "running", "blocked", "complete"]),
    participants: z.array(z.object({ id: z.string(), name: z.string() }).passthrough()).max(100),
    questions: z.array(QuestionSchema).max(8),
    readiness: z.object({ percentage: z.number().int().min(0).max(100), status: z.string() }).passthrough().nullable(),
  }).passthrough(),
}).passthrough();

export type RoomSnapshot = z.infer<typeof RoomSnapshotSchema>;
export type ParticipantSession = z.infer<typeof SessionSchema>;

const CreatedRoomSchema = z.object({
  roomId: z.string(),
  invitation: z.string().regex(/^[a-f0-9]{64}$/),
  session: SessionSchema,
  snapshot: RoomSnapshotSchema,
}).strict();

const JoinedRoomSchema = z.object({
  session: SessionSchema,
  snapshot: RoomSnapshotSchema,
}).strict();

const HealthSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(["synthetic-live-demo", "local-live", "unavailable"]),
  budget: z.object({
    attempts: z.number().int().nonnegative(),
    remainingAttempts: z.number().int().nonnegative(),
    reservedTokens: z.number().int().nonnegative(),
    remainingTokens: z.number().int().nonnegative(),
    reservedCostMicros: z.number().int().nonnegative(),
    remainingCostMicros: z.number().int().nonnegative(),
  }).optional(),
}).passthrough();

const SubmitMessageSchema = z.object({
  messageId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  expectedRevision: z.number().int().nonnegative(),
  proposalVersion: z.number().int().positive(),
  text: z.string().trim().min(1).max(1_000),
  visibility: z.enum(["group", "private"]),
  questionId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).nullable(),
  replyOption: z.string().trim().min(1).max(160).nullable(),
}).strict();

export class RoomApiClientError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message);
    this.name = "RoomApiClientError";
  }
}

export class SyntheticRoomApiClient {
  readonly baseUrl: string;

  constructor(baseUrl = process.env.SETVIA_ROOM_API_ORIGIN ?? "http://127.0.0.1:3001", private readonly fetcher: typeof fetch = fetch) {
    let parsed: URL;
    try { parsed = new URL(baseUrl); }
    catch { throw new Error("SETVIA_ROOM_API_ORIGIN must be an HTTPS origin or loopback HTTP origin."); }
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
    const allowedTransport = parsed.protocol === "https:" || (parsed.protocol === "http:" && loopback);
    if (!allowedTransport || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash)
      throw new Error("SETVIA_ROOM_API_ORIGIN must be an HTTPS origin or loopback HTTP origin.");
    this.baseUrl = parsed.origin;
  }

  private async request<T>(path: string, schema: z.ZodType<T>, input?: { method?: string; body?: unknown; session?: ParticipantSession }) {
    const session = input?.session;
    const response = await this.fetcher(`${this.baseUrl}/api${path}`, {
      method: input?.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(input?.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(session ? {
          Authorization: `Bearer ${session.token}`,
          "X-Setvia-Participant": session.participantId,
        } : {}),
      },
      cache: "no-store",
      redirect: "error",
      ...(input?.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    });
    let value: unknown;
    try { value = await response.json(); } catch { value = null; }
    if (!response.ok) {
      const message = value && typeof value === "object" && "error" in value && typeof value.error === "string"
        ? value.error
        : "The local Setvia room service rejected the action.";
      throw new RoomApiClientError(message, response.status);
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new RoomApiClientError("Setvia returned an invalid room response.", 502);
    return parsed.data;
  }

  health() {
    return this.request("/rooms/health", HealthSchema);
  }

  async createRoom(input: {
    creatorName: string;
    eventType: string;
    initialPlan: string;
    attendeeCount: number;
    confirmedAttendeeCount: number | null;
    proposalId: string;
  }) {
    const proposal = OptionSchema.parse({ id: input.proposalId, label: input.initialPlan, values: {} });
    const payload = {
      creatorName: input.creatorName,
      eventType: input.eventType,
      proposal,
      estimatedAttendeeCount: input.attendeeCount,
      confirmedAttendeeCount: input.confirmedAttendeeCount,
    };
    const result = await this.request("/rooms", CreatedRoomSchema, { method: "POST", body: payload });
    if (result.session.roomId !== result.roomId || result.snapshot.room.roomId !== result.roomId || result.snapshot.room.viewerId !== result.session.participantId)
      throw new RoomApiClientError("Setvia returned a room for a different synthetic session.", 502);
    return result;
  }

  async joinRoom(roomId: string, invitation: string, name: string) {
    const result = await this.request(`/rooms/${encodeURIComponent(roomId)}/join`, JoinedRoomSchema, {
      method: "POST",
      body: { invitation, name },
    });
    if (result.session.roomId !== roomId || result.snapshot.room.roomId !== roomId || result.snapshot.room.viewerId !== result.session.participantId)
      throw new RoomApiClientError("Setvia returned a room for a different synthetic session.", 502);
    return result;
  }

  async getSnapshot(session: ParticipantSession) {
    const snapshot = await this.request(`/rooms/${encodeURIComponent(session.roomId)}`, RoomSnapshotSchema, { session });
    if (snapshot.room.roomId !== session.roomId || snapshot.room.viewerId !== session.participantId)
      throw new RoomApiClientError("Setvia returned a snapshot for a different participant.", 502);
    return snapshot;
  }

  async submitMessage(session: ParticipantSession, body: z.input<typeof SubmitMessageSchema>) {
    const payload = SubmitMessageSchema.parse(body);
    const result = await this.request(`/rooms/${encodeURIComponent(session.roomId)}/messages`, z.object({
      receipt: z.object({ id: z.string(), ownerId: z.string(), proposalVersion: z.number().int(), occurredAt: z.string() }).passthrough(),
      duplicate: z.boolean(),
      snapshot: RoomSnapshotSchema,
    }).strict(), { method: "POST", session, body: payload });
    if (result.receipt.ownerId !== session.participantId || result.snapshot.room.viewerId !== session.participantId)
      throw new RoomApiClientError("Setvia returned a receipt for a different participant.", 502);
    return result;
  }
}

export function messagePayload(input: {
  messageId: string;
  expectedRevision: number;
  proposalVersion: number;
  text: string;
  visibility: "group" | "private";
  questionId: string | null;
  replyOption: string | null;
}) {
  return SubmitMessageSchema.parse(input);
}
