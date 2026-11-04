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
    eventAttendance: view.eventAttendance,
    revision: view.revision,
    analysisStatus: view.analysisStatus,
    receiptImage: view.receiptImage,
    privateAnalysisStatus: view.privateAnalysisStatus,
    proposalVersion: view.proposalVersion,
    participants: view.participants.map((person) => ({
      id: person.id,
      name: person.name,
      approved: view.participantApprovals.includes(person.id),
    })),
    candidates: view.candidates,
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

export function projectDashboardSnapshot(view: AuthorizedView) {
  const room = projectDashboardRoom(view);
  const currentResponses = view.responses.filter(
    (response) => response.proposalVersion === room.proposalVersion,
  );
  const responses = room.participants.map((person) => ({
    participantId: person.id,
    proposalVersion: room.proposalVersion,
    responded: currentResponses.some(
      (response) =>
        response.ownerId === person.id &&
        (response.visibility === "group" || person.id === room.viewerId),
    ),
  }));
  const byId = new Map(room.participants.map((person) => [person.id, person]));
  const contributions = currentResponses.map((response) => ({
    id: response.id,
    participantId: response.ownerId,
    participantName: byId.get(response.ownerId)?.name ?? "Former participant",
    visibility: response.visibility,
    targetId: response.visibility === "private" ? response.ownerId : null,
    text: response.text,
    questionId: response.questionId,
    recordedAt: response.occurredAt,
    proposalVersion: response.proposalVersion,
  }));
  return {
    schemaVersion: "dashboard-v1" as const,
    source: "room" as const,
    sequence: view.sequence,
    room,
    responseTracking: "room" as const,
    responses,
    contributions,
    activity: view.activity.map(({ visibility: _visibility, targetId: _targetId, ...entry }) => entry),
    history: view.readinessHistory,
  };
}
