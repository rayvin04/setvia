import { z } from "zod";
import {
  CategorySchema,
  FindingSchema,
  OptionSchema,
  OutcomeSchema,
  QuestionSchema,
  ReadinessSchema,
  MAX_ROOM_PARTICIPANTS,
} from "./room-model.js";
export type { Category, Readiness } from "./room-model.js";

const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const SpeakerMessageSchema = z
  .object({
    text: z.string().max(500),
    visibility: z.enum(["group", "private"]),
    targetId: identifier.nullable(),
    questionId: identifier.nullable(),
    proposalVersion: z.number().int().positive(),
  })
  .strict();

export const DashboardRoomSchema = z
  .object({
    roomId: identifier,
    viewerId: identifier,
    eventType: z.string().min(1).max(80),
    revision: z.number().int().nonnegative(),
    proposalVersion: z.number().int().positive(),
    participants: z
      .array(
        z
          .object({
            id: identifier,
            name: z.string().min(1).max(40),
            approved: z.boolean(),
          })
          .strict(),
      )
      .max(MAX_ROOM_PARTICIPANTS),
    proposal: OptionSchema,
    readiness: ReadinessSchema.nullable(),
    analysisCurrent: z.boolean(),
    analysisIncomplete: z.boolean(),
    analysisError: z
      .object({
        code: z.string().regex(/^[A-Z0-9_]{1,64}$/),
        role: z
          .enum(["Listener", "Judge", "Negotiator", "Question Strategist", "Speaker"])
          .nullable(),
      })
      .strict()
      .nullable()
      .optional(),
    finalEvaluationAvailable: z.boolean(),
    loopState: OutcomeSchema.nullable(),
    mascot: z.enum(["thinking", "curious", "concerned", "content"]).nullable(),
    findings: z.array(FindingSchema).max(40),
    questions: z.array(QuestionSchema).max(8),
    options: z.array(OptionSchema).max(8),
    messages: z.array(SpeakerMessageSchema).max(28),
    approved: z.boolean(),
    approvalCount: z.number().int().nonnegative(),
  })
  .strict();
export type DashboardRoom = z.infer<typeof DashboardRoomSchema>;

export const ActivityKinds = [
  "participant_joined",
  "participant_responded",
  "finding_detected",
  "constraint_confirmed",
  "proposal_revised",
  "question_asked",
  "issue_resolved",
  "readiness_changed",
  "participant_approved",
] as const;
export const DashboardActivitySchema = z
  .object({
    id: identifier,
    kind: z.enum(ActivityKinds),
    revision: z.number().int().nonnegative(),
    proposalVersion: z.number().int().positive(),
    occurredAt: z.iso.datetime(),
    actorId: identifier.nullable(),
    summary: z.string().min(1).max(300),
    category: CategorySchema.nullable(),
  })
  .strict();
export type DashboardActivity = z.infer<typeof DashboardActivitySchema>;

export const DashboardSnapshotSchema = z
  .object({
    schemaVersion: z.literal("dashboard-v1"),
    source: z.enum(["synthetic", "room"]),
    sequence: z.number().int().nonnegative(),
    room: DashboardRoomSchema,
    responseTracking: z.enum(["synthetic", "unavailable"]),
    responses: z
      .array(
        z
          .object({
            participantId: identifier,
            proposalVersion: z.number().int().positive(),
            responded: z.boolean(),
          })
          .strict(),
      )
      .max(MAX_ROOM_PARTICIPANTS),
    activity: z.array(DashboardActivitySchema).max(100),
    history: z
      .array(
        z
          .object({
            id: identifier,
            revision: z.number().int().nonnegative(),
            proposalVersion: z.number().int().positive(),
            occurredAt: z.iso.datetime(),
            readiness: ReadinessSchema,
            explanation: z.string().min(1).max(500),
          })
          .strict(),
      )
      .max(30),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const { room } = snapshot;
    const people = new Set(room.participants.map((person) => person.id));
    if (!people.has(room.viewerId) || people.size !== room.participants.length)
      context.addIssue({
        code: "custom",
        message: "Invalid viewer or membership.",
      });
    if (
      room.approvalCount !==
        room.participants.filter((p) => p.approved).length ||
      room.approved !== (people.size > 0 && room.approvalCount === people.size)
    )
      context.addIssue({
        code: "custom",
        message: "Approval counts must match this version.",
      });
    if (
      snapshot.source === "room" &&
      snapshot.responseTracking !== "unavailable"
    )
      context.addIssue({
        code: "custom",
        message: "Real response tracking is not implemented.",
      });
    if (
      snapshot.responseTracking === "unavailable" &&
      snapshot.responses.length
    )
      context.addIssue({
        code: "custom",
        message: "Unavailable responses must stay unknown.",
      });
    if (
      new Set(snapshot.responses.map((r) => r.participantId)).size !==
        snapshot.responses.length ||
      snapshot.responses.some(
        (r) =>
          !people.has(r.participantId) ||
          r.proposalVersion !== room.proposalVersion,
      )
    )
      context.addIssue({
        code: "custom",
        message: "Responses must belong to the current proposal.",
      });
    if (
      room.questions.some(
        (q) => q.visibility === "private" && q.targetId !== room.viewerId,
      ) ||
      room.messages.some(
        (m) =>
          (m.visibility === "private" && m.targetId !== room.viewerId) ||
          m.proposalVersion !== room.proposalVersion,
      )
    )
      context.addIssue({
        code: "custom",
        message: "Projection contains a foreign or outdated message.",
      });
    if (
      (!room.analysisCurrent || !room.finalEvaluationAvailable) &&
      (room.findings.length ||
        room.questions.length ||
        room.options.length ||
        room.messages.length)
    )
      context.addIssue({
        code: "custom",
        message: "Unevaluated or stale analysis cannot publish decisions.",
      });
    if (
      snapshot.activity.some(
        (e) =>
          e.revision > room.revision ||
          e.proposalVersion > room.proposalVersion,
      ) ||
      snapshot.history.some(
        (h) =>
          h.revision > room.revision ||
          h.proposalVersion > room.proposalVersion,
      )
    )
      context.addIssue({
        code: "custom",
        message: "Snapshot contains future events.",
      });
  });
export type DashboardSnapshot = z.infer<typeof DashboardSnapshotSchema>;

export const DashboardActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("answer"),
      questionId: identifier,
      option: z.string().min(1).max(160),
      expectedRevision: z.number().int().nonnegative(),
      proposalVersion: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("information"),
      questionId: identifier,
      text: z.string().trim().min(1).max(1000),
      expectedRevision: z.number().int().nonnegative(),
      proposalVersion: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("proposal"),
      optionId: identifier,
      expectedRevision: z.number().int().nonnegative(),
      proposalVersion: z.number().int().positive(),
    })
    .strict(),
]);
export type DashboardAction = z.infer<typeof DashboardActionSchema>;

export function validateDashboardAction(
  room: DashboardRoom,
  input: unknown,
): DashboardAction {
  const action = DashboardActionSchema.parse(input);
  if (
    !room.analysisCurrent ||
    room.analysisIncomplete ||
    action.expectedRevision !== room.revision ||
    action.proposalVersion !== room.proposalVersion
  )
    throw new Error("This proposal changed. Refresh before responding.");
  if (action.kind === "proposal") {
    if (!room.options.some((option) => option.id === action.optionId))
      throw new Error("This proposal option is unavailable.");
  } else {
    const question = room.questions.find((q) => q.id === action.questionId);
    if (
      !question ||
      (question.targetId !== null && question.targetId !== room.viewerId)
    )
      throw new Error("This question is unavailable for you.");
    if (action.kind === "answer" && !question.options.includes(action.option))
      throw new Error("Choose one of the validated options.");
  }
  return action;
}
