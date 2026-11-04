import type { DashboardSnapshot } from "../../shared/dashboard";
import {
  PlanningMessageError,
  validatePlanningMessage,
  type MessageReceipt,
  type PlanningMessage,
} from "../../shared/planning-message";

export interface ContributionView {
  id: string;
  participantId: string;
  participantName: string;
  proposalVersion: number;
  visibility: "private" | "group";
  questionId: string | null;
  recordedAt: string;
  text: string;
}
export interface PreviewContribution extends MessageReceipt, ContributionView {
  mode: "preview";
}
interface PreviewInteractionOptions {
  now?: () => string;
  createId?: () => string;
  beforeRecord?: (signal: AbortSignal) => Promise<void>;
  limit?: number;
}

export function createPreviewInteractions(
  options: PreviewInteractionOptions = {},
) {
  const records = new Map<string, PreviewContribution[]>();
  const approvals = new Map<string, Set<string>>();
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? (() => crypto.randomUUID());
  const proposalKey = (snapshot: DashboardSnapshot) =>
    snapshot.room.roomId + ":" + snapshot.room.proposalVersion;
  return {
    async submit(
      input: PlanningMessage,
      getSnapshot: () => DashboardSnapshot | null,
      signal: AbortSignal,
    ): Promise<MessageReceipt> {
      const initial = getSnapshot();
      if (!initial || initial.source !== "synthetic")
        throw new PlanningMessageError(
          "Room messaging is not connected in this view.",
        );
      validatePlanningMessage(initial.room, input);
      signal.throwIfAborted();
      if (options.beforeRecord) await options.beforeRecord(signal);
      else await new Promise<void>((resolve) => queueMicrotask(resolve));
      signal.throwIfAborted();
      const current = getSnapshot();
      if (!current || current.source !== "synthetic")
        throw new PlanningMessageError(
          "The preview changed. Your message was not sent.",
        );
      const message = validatePlanningMessage(current.room, input);
      const existing = records.get(message.roomId) ?? [];
      if (existing.length >= (options.limit ?? 100))
        throw new PlanningMessageError(
          "This preview has reached its response limit. Reset the preview to continue.",
        );
      const contribution: PreviewContribution = {
        id: createId(),
        roomId: message.roomId,
        participantId: message.viewerId,
        participantName: current.room.participants.find(
          (person) => person.id === message.viewerId,
        )!.name,
        proposalVersion: message.proposalVersion,
        visibility: message.visibility,
        questionId: message.questionId,
        recordedAt: now(),
        mode: "preview",
        text: message.text,
      };
      records.set(message.roomId, [...existing, contribution]);
      const { text: _text, participantName: _name, ...receipt } = contribution;
      return receipt;
    },
    approve(snapshot: DashboardSnapshot): void {
      if (snapshot.source !== "synthetic")
        throw new PlanningMessageError(
          "Approvals are not available in this preview view.",
        );
      if (
        !snapshot.room.analysisCurrent ||
        !snapshot.room.finalEvaluationAvailable ||
        snapshot.room.loopState !== "COMPLETED" ||
        snapshot.room.readiness?.status !== "ready_for_human_review"
      )
        throw new PlanningMessageError(
          "This proposal is not ready for participant review yet.",
        );
      const member = snapshot.room.participants.find(
        (person) => person.id === snapshot.room.viewerId,
      );
      if (!member)
        throw new PlanningMessageError(
          "The preview participant could not be verified.",
        );
      const key = proposalKey(snapshot);
      const current = approvals.get(key) ?? new Set<string>();
      if (member.approved || current.has(member.id))
        throw new PlanningMessageError(
          "This participant already approved the current proposal.",
        );
      current.add(member.id);
      approvals.set(key, current);
    },
    project(snapshot: DashboardSnapshot): {
      snapshot: DashboardSnapshot;
      contributions: ContributionView[];
    } {
      if (snapshot.source !== "synthetic")
        return { snapshot, contributions: [] };
      const members = new Set(snapshot.room.participants.map((p) => p.id));
      const all = (records.get(snapshot.room.roomId) ?? []).filter((entry) =>
        members.has(entry.participantId),
      );
      const localVisible = all.filter(
        (entry) =>
          entry.visibility === "group" ||
          entry.participantId === snapshot.room.viewerId,
      );
      const fixtureVisible = snapshot.contributions.filter(
        (entry) =>
          entry.visibility === "group" ||
          entry.participantId === snapshot.room.viewerId,
      );
      const answered = new Set(
        all
          .filter(
            (entry) =>
              entry.participantId === snapshot.room.viewerId &&
              entry.proposalVersion === snapshot.room.proposalVersion &&
              entry.questionId !== null,
          )
          .map((entry) => entry.questionId),
      );
      const currentApprovals = approvals.get(proposalKey(snapshot)) ?? new Set();
      const participants = snapshot.room.participants.map((person) => ({
        ...person,
        approved: person.approved || currentApprovals.has(person.id),
      }));
      const approvalCount = participants.filter((person) => person.approved).length;
      return {
        // Put a participant's latest local action first so it is immediately
        // visible in the preview transcript before the seeded room history.
        contributions: [...localVisible, ...fixtureVisible],
        snapshot: {
          ...snapshot,
          room: {
            ...snapshot.room,
            participants,
            approvalCount,
            approved: participants.length > 0 && approvalCount === participants.length,
            questions: snapshot.room.questions.filter(
              (question) => !answered.has(question.id),
            ),
            messages: snapshot.room.messages.filter(
              (message) =>
                message.questionId === null ||
                !answered.has(message.questionId),
            ),
          },
          responses:
            snapshot.responseTracking === "synthetic"
              ? snapshot.responses.map((response) => ({
                  ...response,
                  responded:
                    response.responded ||
                    all.some(
                      (entry) =>
                        entry.participantId === response.participantId &&
                        entry.proposalVersion === snapshot.room.proposalVersion &&
                        (entry.visibility === "group" ||
                          entry.participantId === snapshot.room.viewerId),
                    ),
                }))
              : snapshot.responses,
        },
      };
    },
    reset(roomId: string) {
      records.delete(roomId);
      for (const key of approvals.keys())
        if (key.startsWith(roomId + ":")) approvals.delete(key);
    },
  };
}
