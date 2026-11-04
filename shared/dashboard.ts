import { z } from "zod";
import {
  CategorySchema,
  FactSchema,
  FindingSchema,
  OptionSchema,
  OutcomeSchema,
  QuestionSchema,
  ReadinessSchema,
  MAX_ROOM_PARTICIPANTS,
} from "../server/src/agents/contracts.js";

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
    eventAttendance: z
      .object({
        estimatedAttendeeCount: z.number().int().nonnegative().nullable(),
        confirmedAttendeeCount: z.number().int().nonnegative().nullable(),
      })
      .strict()
      .default({ estimatedAttendeeCount: null, confirmedAttendeeCount: null }),
    revision: z.number().int().nonnegative(),
    analysisStatus: z.enum(["idle", "queued", "running", "blocked", "complete"]).default("idle"),
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
    candidates: z.array(FactSchema).max(200).default([]),
    privateAnalysisStatus: z.enum(["idle", "queued", "running", "blocked", "complete"]).default("idle"),
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
  "analysis_started",
  "analysis_completed",
  "analysis_blocked",
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
    responseTracking: z.enum(["synthetic", "room", "unavailable"]),
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
    contributions: z
      .array(
        z
          .object({
            id: identifier,
            participantId: identifier,
            participantName: z.string().min(1).max(40),
            visibility: z.enum(["group", "private"]),
            targetId: identifier.nullable(),
            text: z.string().min(1).max(1_000),
            questionId: identifier.nullable(),
            recordedAt: z.iso.datetime(),
            proposalVersion: z.number().int().positive(),
          })
          .strict(),
      )
      .max(500)
      .default([]),
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
      snapshot.responseTracking === "unavailable" &&
      snapshot.responses.length
    )
      context.addIssue({
        code: "custom",
        message: "Unavailable responses must stay unknown.",
      });
    if (
      (snapshot.source === "synthetic" && snapshot.responseTracking !== "synthetic") ||
      (snapshot.source === "room" && snapshot.responseTracking === "synthetic")
    )
      context.addIssue({
        code: "custom",
        message: "Room and synthetic response states cannot be mixed.",
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
      room.candidates.some(
        (candidate) =>
          (candidate.visibility === "private" && candidate.ownerId !== room.viewerId) ||
          (candidate.visibility === "group" && !people.has(candidate.ownerId)),
      )
    )
      context.addIssue({
        code: "custom",
        message: "Private suggestions must stay owner-only and shared details must belong to room members.",
      });
    if (
      snapshot.contributions.some(
        (entry) =>
          (entry.visibility === "private" && entry.targetId !== room.viewerId) ||
          entry.proposalVersion !== room.proposalVersion,
      )
    )
      context.addIssue({
        code: "custom",
        message: "Contributions must be authorized for this viewer and proposal version.",
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
