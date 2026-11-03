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
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? (() => crypto.randomUUID());
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
    project(snapshot: DashboardSnapshot): {
      snapshot: DashboardSnapshot;
      contributions: PreviewContribution[];
    } {
      if (snapshot.source !== "synthetic")
        return { snapshot, contributions: [] };
      const members = new Set(snapshot.room.participants.map((p) => p.id));
      const all = (records.get(snapshot.room.roomId) ?? []).filter((entry) =>
        members.has(entry.participantId),
      );
      const visible = all.filter(
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
      const responders = new Set(
        all
          .filter(
            (entry) => entry.proposalVersion === snapshot.room.proposalVersion,
          )
          .map((entry) => entry.participantId),
      );
      return {
        contributions: visible,
        snapshot: {
          ...snapshot,
          room: {
            ...snapshot.room,
            questions: snapshot.room.questions.filter(
              (q) => !answered.has(q.id),
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
                    responders.has(response.participantId),
                }))
              : snapshot.responses,
        },
      };
    },
    reset(roomId: string) {
      records.delete(roomId);
    },
  };
}
