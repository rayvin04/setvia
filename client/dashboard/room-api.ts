import { z } from "zod";
import {
  DashboardSnapshotSchema,
  type DashboardSnapshot,
} from "../../shared/dashboard";
import {
  CreateRoomRequestSchema,
  ParticipantSessionSchema,
  SubmitRoomMessageResultSchema,
  type CreateRoomRequest,
  type ParticipantSession,
} from "../../shared/room-api";
import type { PlanningMessage, MessageReceipt } from "../../shared/planning-message";
import type { PlanOption } from "../../server/src/agents/contracts";
import { apiEndpoint } from "../api-url";

const HealthSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(["synthetic-live-demo", "local-live", "offline-mock", "unavailable"]),
  budget: z.object({
    attempts: z.number().int().nonnegative(),
    remainingAttempts: z.number().int().nonnegative(),
    reservedTokens: z.number().int().nonnegative(),
    remainingTokens: z.number().int().nonnegative(),
    reservedCostMicros: z.number().int().nonnegative(),
    remainingCostMicros: z.number().int().nonnegative(),
  }).optional(),
});
export type RoomHealth = z.infer<typeof HealthSchema>;

const CreatedSchema = z.object({
  roomId: z.string(),
  invitation: z.string().regex(/^[a-f0-9]{64}$/),
  session: ParticipantSessionSchema,
  snapshot: DashboardSnapshotSchema,
});
const JoinedSchema = z.object({
  session: ParticipantSessionSchema,
  snapshot: DashboardSnapshotSchema,
});

export class RoomApiError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message);
    this.name = "RoomApiError";
  }
}

const sessionKey = (roomId: string) => `setvia.room.session.v1:${roomId}`;
const invitationKey = (roomId: string) => `setvia.room.invitation.v1:${roomId}`;

async function readResponse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  let value: unknown;
  try { value = await response.json(); } catch { value = null; }
  if (!response.ok) {
    const message = value && typeof value === "object" && "error" in value && typeof value.error === "string"
      ? value.error
      : "Setvia could not complete that room action. Check your connection and try again.";
    throw new RoomApiError(message, response.status);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new RoomApiError("The planning service returned an invalid room update.", 502);
  return parsed.data;
}

function authHeaders(session: ParticipantSession, lastSequence?: number) {
  return {
    Authorization: `Bearer ${session.token}`,
    "X-Setvia-Participant": session.participantId,
    ...(lastSequence !== undefined ? { "Last-Event-ID": String(lastSequence) } : {}),
  };
}

function storeSession(session: ParticipantSession) {
  try { window.sessionStorage.setItem(sessionKey(session.roomId), JSON.stringify(session)); }
  catch { throw new RoomApiError("This browser tab cannot store a room session. Enable session storage and try again."); }
}

export function getRoomSession(roomId: string): ParticipantSession | null {
  try {
    const raw = window.sessionStorage.getItem(sessionKey(roomId));
    if (!raw) return null;
    const parsed = ParticipantSessionSchema.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.roomId === roomId ? parsed.data : null;
  } catch { return null; }
}

export function getInvitationLink(roomId: string): string | null {
  try {
    const invitation = getRoomInvitation(roomId);
    if (!invitation || !/^[a-f0-9]{64}$/.test(invitation)) return null;
    return `${window.location.origin}/join?room=${encodeURIComponent(roomId)}#invite=${invitation}`;
  } catch { return null; }
}

export function getRoomInvitation(roomId: string): string | null {
  try {
    const invitation = window.sessionStorage.getItem(invitationKey(roomId));
    return invitation && /^[a-f0-9]{64}$/.test(invitation) ? invitation : null;
  } catch { return null; }
}

export async function getRoomHealth(signal?: AbortSignal): Promise<RoomHealth> {
  const response = await fetch(apiEndpoint("/rooms/health"), {
    cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal,
  });
  return readResponse(response, HealthSchema);
}

export async function createRoom(input: CreateRoomRequest, signal?: AbortSignal) {
  const parsed = CreateRoomRequestSchema.parse(input);
  const response = await fetch(apiEndpoint("/rooms"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(parsed),
    cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal,
  });
  const created = await readResponse(response, CreatedSchema);
  storeSession(created.session);
  try { window.sessionStorage.setItem(invitationKey(created.roomId), created.invitation); }
  catch { /* The participant session remains usable; the host can still copy a returned link. */ }
  return { ...created, invitationLink: `${window.location.origin}/join?room=${encodeURIComponent(created.roomId)}#invite=${created.invitation}` };
}

export async function joinRoom(
  roomId: string,
  invitation: string,
  name: string,
  signal?: AbortSignal,
  options: { persistSession?: boolean } = {},
) {
  const response = await fetch(apiEndpoint(`/rooms/${encodeURIComponent(roomId)}/join`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invitation, name }),
    cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal,
  });
  const joined = await readResponse(response, JoinedSchema);
  if (options.persistSession !== false) storeSession(joined.session);
  return joined;
}

export async function getRoomSnapshot(session: ParticipantSession, signal?: AbortSignal) {
  const response = await fetch(apiEndpoint(`/rooms/${encodeURIComponent(session.roomId)}`), {
    headers: authHeaders(session), cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal,
  });
  return readResponse(response, DashboardSnapshotSchema);
}

export async function submitRoomMessage(
  session: ParticipantSession,
  input: PlanningMessage,
  signal: AbortSignal,
): Promise<{ receipt: MessageReceipt; snapshot: DashboardSnapshot }> {
  const response = await fetch(apiEndpoint(`/rooms/${encodeURIComponent(session.roomId)}/messages`), {
    method: "POST",
    headers: { ...authHeaders(session), "Content-Type": "application/json" },
    body: JSON.stringify({
      messageId: input.messageId ?? crypto.randomUUID(),
      expectedRevision: input.expectedRevision,
      proposalVersion: input.proposalVersion,
      text: input.text,
      visibility: input.visibility,
      questionId: input.questionId,
      replyOption: input.replyOption,
    }),
    cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal,
  });
  const result = await readResponse(response, SubmitRoomMessageResultSchema);
  if (result.snapshot.room.viewerId !== session.participantId || result.snapshot.room.roomId !== session.roomId)
    throw new RoomApiError("The planning service returned a room update for a different session.", 502);
  return {
    receipt: {
      id: result.receipt.id,
      roomId: session.roomId,
      participantId: result.receipt.ownerId,
      proposalVersion: result.receipt.proposalVersion,
      visibility: result.receipt.visibility,
      questionId: result.receipt.questionId,
      recordedAt: result.receipt.occurredAt,
      mode: "room",
    },
    snapshot: result.snapshot,
  };
}

export async function sharePrivateCandidate(
  session: ParticipantSession,
  candidateId: string,
  expectedRevision: number,
) {
  const response = await fetch(apiEndpoint(`/rooms/${encodeURIComponent(session.roomId)}/candidates/${encodeURIComponent(candidateId)}/share`), {
    method: "POST",
    headers: { ...authHeaders(session), "Content-Type": "application/json" },
    body: JSON.stringify({ candidateId, expectedRevision }),
    cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer",
  });
  return readResponse(response, DashboardSnapshotSchema);
}

export async function reviseRoomProposal(session: ParticipantSession, expectedRevision: number, proposal: PlanOption) {
  const response = await fetch(apiEndpoint(`/rooms/${encodeURIComponent(session.roomId)}/proposal`), {
    method: "POST",
    headers: { ...authHeaders(session), "Content-Type": "application/json" },
    body: JSON.stringify({ expectedRevision, proposal }),
    cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer",
  });
  return readResponse(response, DashboardSnapshotSchema);
}

export async function approveRoomProposal(session: ParticipantSession, version: number) {
  const response = await fetch(apiEndpoint(`/rooms/${encodeURIComponent(session.roomId)}/approve`), {
    method: "POST",
    headers: { ...authHeaders(session), "Content-Type": "application/json" },
    body: JSON.stringify({ version }),
    cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer",
  });
  return readResponse(response, DashboardSnapshotSchema);
}

export async function leaveRoom(session: ParticipantSession, expectedRevision: number) {
  const response = await fetch(apiEndpoint(`/rooms/${encodeURIComponent(session.roomId)}/leave`), {
    method: "POST",
    headers: { ...authHeaders(session), "Content-Type": "application/json" },
    body: JSON.stringify({ expectedRevision }),
    cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer",
  });
  const result = await readResponse(response, z.object({ left: z.literal(true) }));
  try {
    window.sessionStorage.removeItem(sessionKey(session.roomId));
    window.sessionStorage.removeItem(invitationKey(session.roomId));
  } catch { /* Revocation is enforced server-side regardless of browser storage. */ }
  return result;
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolveDelay, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const cleanup = () => signal.removeEventListener("abort", abort);
    const timer = window.setTimeout(() => {
      cleanup();
      resolveDelay();
    }, ms);
    const abort = () => {
      window.clearTimeout(timer);
      cleanup();
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

export type StreamStatus = "connected" | "reconnecting" | "unauthorized";
export async function streamRoom(
  session: ParticipantSession,
  onSnapshot: (snapshot: DashboardSnapshot) => void,
  onStatus: (status: StreamStatus) => void,
  signal: AbortSignal,
) {
  let lastSequence = -1;
  let retryMs = 500;
  while (!signal.aborted) {
    try {
      const response = await fetch(apiEndpoint(`/rooms/${encodeURIComponent(session.roomId)}/events`), {
        headers: authHeaders(session, lastSequence >= 0 ? lastSequence : undefined),
        cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal,
      });
      if (response.status === 401 || response.status === 403) {
        onStatus("unauthorized");
        return;
      }
      if (!response.ok || !response.body) throw new RoomApiError("The live room stream is unavailable.", response.status);
      onStatus("connected");
      retryMs = 500;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          let eventId: number | null = null;
          let data = "";
          for (const line of block.split("\n")) {
            if (line.startsWith("id:")) eventId = Number(line.slice(3).trim());
            else if (line.startsWith("data:")) data += line.slice(5).trim();
          }
          if (data) {
            const parsed = DashboardSnapshotSchema.safeParse(JSON.parse(data));
            if (parsed.success && parsed.data.room.roomId === session.roomId && parsed.data.room.viewerId === session.participantId) {
              const sequence = eventId ?? parsed.data.sequence;
              if (Number.isSafeInteger(sequence) && sequence > lastSequence) {
                lastSequence = sequence;
                onSnapshot(parsed.data);
              }
            }
          }
          boundary = buffer.indexOf("\n\n");
        }
      }
      if (signal.aborted) return;
      onStatus("reconnecting");
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof RoomApiError && (error.status === 401 || error.status === 403)) {
        onStatus("unauthorized");
        return;
      }
      onStatus("reconnecting");
    }
    try { await delay(retryMs, signal); } catch { return; }
    retryMs = Math.min(retryMs * 2, 8_000);
  }
}
