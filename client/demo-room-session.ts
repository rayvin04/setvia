import type { RoomTabSession } from "./demo-studio-api";

const sessionKey = (roomId: string) => `setvia.room.session.v1:${roomId}`;
const invitationKey = (roomId: string) => `setvia.room.invitation.v1:${roomId}`;

/** Keep the creator session in this tab's normal dashboard storage; never put it in a URL. */
export function storeDemoDashboardSession(session: RoomTabSession, invitation: string) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(session.roomId) ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(session.participantId) ||
      !/^[a-f0-9]{64}$/.test(session.token) ||
      !/^[a-f0-9]{64}$/.test(invitation))
    throw new Error("Setvia returned an invalid local dashboard session.");
  try {
    window.sessionStorage.setItem(sessionKey(session.roomId), JSON.stringify(session));
    window.sessionStorage.setItem(invitationKey(session.roomId), invitation);
  } catch {
    throw new Error("This tab cannot store the room session. Enable session storage before opening the live dashboard.");
  }
}

export function readDemoDashboardSession(roomId: string) {
  try {
    const raw = window.sessionStorage.getItem(sessionKey(roomId));
    const invitation = window.sessionStorage.getItem(invitationKey(roomId));
    if (!raw || !invitation) return null;
    const session: unknown = JSON.parse(raw);
    if (!session || typeof session !== "object" ||
        !("roomId" in session) || session.roomId !== roomId ||
        !("participantId" in session) || typeof session.participantId !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(session.participantId) ||
        !("token" in session) || typeof session.token !== "string" || !/^[a-f0-9]{64}$/.test(session.token) ||
        !/^[a-f0-9]{64}$/.test(invitation)) return null;
    return { session: session as RoomTabSession, invitation };
  } catch { return null; }
}
