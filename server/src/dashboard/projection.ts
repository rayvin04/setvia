import {
  DashboardRoomSchema,
  type DashboardRoom,
} from "../../../shared/dashboard.js";
import type { RoomService } from "../agents/rooms.js";

type AuthorizedView = Awaited<ReturnType<RoomService["view"]>>;

export function projectDashboardRoom(view: AuthorizedView): DashboardRoom {
  const available = view.analysisCurrent && view.finalEvaluationAvailable;
  return DashboardRoomSchema.parse({
    roomId: view.roomId,
    viewerId: view.viewerId,
    eventType: view.eventType,
    revision: view.revision,
    proposalVersion: view.proposalVersion,
    participants: view.participants.map((person) => ({
      id: person.id,
      name: person.name,
      approved: view.participantApprovals.includes(person.id),
    })),
    proposal: view.proposal,
    readiness: view.readiness,
    analysisCurrent: view.analysisCurrent,
    analysisIncomplete: view.analysisIncomplete,
    finalEvaluationAvailable: view.finalEvaluationAvailable,
    loopState: view.loopState,
    mascot: view.mascot,
    findings: available ? view.findings : [],
    questions: available ? view.questions : [],
    options: available ? view.options : [],
    messages: available ? view.messages : [],
    approved: view.approved,
    approvalCount: view.approvalCount,
  });
}
