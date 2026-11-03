import { z } from "zod";
import { validateDashboardAction, type DashboardRoom } from "./dashboard.js";

export const MAX_PLANNING_MESSAGE_LENGTH = 1000;
export const MessageVisibilitySchema = z.enum(["private", "group"]);
export type MessageVisibility = z.infer<typeof MessageVisibilitySchema>;
const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const PlanningMessageSchema = z
  .object({
    roomId: identifier,
    viewerId: identifier,
    expectedRevision: z.number().int().nonnegative(),
    proposalVersion: z.number().int().positive(),
    questionId: identifier.nullable(),
    replyOption: z.string().min(1).max(160).nullable(),
    visibility: MessageVisibilitySchema,
    text: z.string().trim().min(1).max(MAX_PLANNING_MESSAGE_LENGTH),
  })
  .strict();
export type PlanningMessage = z.infer<typeof PlanningMessageSchema>;
export interface MessageReceipt {
  id: string;
  roomId: string;
  participantId: string;
  proposalVersion: number;
  visibility: MessageVisibility;
  questionId: string | null;
  recordedAt: string;
  mode: "preview" | "room";
}
export type SubmitPlanningMessage = (
  input: PlanningMessage,
  signal: AbortSignal,
) => Promise<MessageReceipt>;
export class PlanningMessageError extends Error {}

export function validatePlanningMessage(
  room: DashboardRoom,
  input: unknown,
  allowed: readonly MessageVisibility[] = ["private", "group"],
): PlanningMessage {
  const parsed = PlanningMessageSchema.safeParse(input);
  if (!parsed.success)
    throw new PlanningMessageError(
      `Write a message between 1 and ${MAX_PLANNING_MESSAGE_LENGTH.toLocaleString("en")} characters.`,
    );
  const message = parsed.data;
  if (
    message.roomId !== room.roomId ||
    message.viewerId !== room.viewerId ||
    !room.participants.some((person) => person.id === message.viewerId)
  )
    throw new PlanningMessageError(
      "The room or preview participant changed. Your message was not sent.",
    );
  if (
    message.expectedRevision !== room.revision ||
    message.proposalVersion !== room.proposalVersion
  )
    throw new PlanningMessageError(
      "The proposal changed. Check the current question and send again.",
    );
  if (!allowed.includes(message.visibility))
    throw new PlanningMessageError(
      "That visibility is unavailable in this room.",
    );
  if (message.questionId !== null) {
    const question = room.questions.find((q) => q.id === message.questionId);
    if (
      !question ||
      (question.targetId !== null && question.targetId !== room.viewerId)
    )
      throw new PlanningMessageError(
        "This question is no longer available for you.",
      );
    if (question.visibility === "private" && message.visibility !== "private")
      throw new PlanningMessageError("This question needs a private answer.");
    try {
      validateDashboardAction(
        room,
        message.replyOption === null
          ? {
              kind: "information",
              questionId: question.id,
              text: message.text,
              expectedRevision: room.revision,
              proposalVersion: room.proposalVersion,
            }
          : {
              kind: "answer",
              questionId: question.id,
              option: message.replyOption,
              expectedRevision: room.revision,
              proposalVersion: room.proposalVersion,
            },
      );
    } catch {
      throw new PlanningMessageError(
        "This question or reply option changed. Review it before sending.",
      );
    }
  } else if (message.replyOption !== null)
    throw new PlanningMessageError(
      "Choose a current question before using a quick reply.",
    );
  return message;
}

export function planningMessageErrorText(error: unknown): string {
  return error instanceof PlanningMessageError
    ? error.message
    : "Your response wasn’t recorded. Please try again.";
}
