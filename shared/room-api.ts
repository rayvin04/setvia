import { z } from "zod";
import { OptionSchema } from "../server/src/agents/contracts.js";
import { DashboardSnapshotSchema } from "./dashboard.js";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
// Only fields explicitly reviewed in intake can seed confirmed shared facts.
export const ReviewedDraftKeySchema = z.enum([
  "date", "time", "duration", "location", "budgetAmount", "budgetScope",
  "budgetCurrency", "objective",
]);

export const CreateRoomRequestSchema = z
  .object({
    creatorName: z.string().trim().min(1).max(40),
    eventType: z.string().trim().min(1).max(80),
    proposal: OptionSchema,
    reviewedKeys: z.array(ReviewedDraftKeySchema).max(8).optional(),
    estimatedAttendeeCount: z.number().int().min(1).max(100_000).nullable().default(null),
    confirmedAttendeeCount: z.number().int().min(0).max(100_000).nullable().default(null),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.estimatedAttendeeCount !== null &&
      value.confirmedAttendeeCount !== null &&
      value.confirmedAttendeeCount > value.estimatedAttendeeCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["confirmedAttendeeCount"],
        message: "Confirmed attendance cannot exceed the event estimate.",
      });
    }
  });
export type CreateRoomRequest = z.infer<typeof CreateRoomRequestSchema>;

export const JoinRoomRequestSchema = z
  .object({
    invitation: z.string().regex(/^[a-f0-9]{64}$/),
    name: z.string().trim().min(1).max(40),
  })
  .strict();

export const ParticipantSessionSchema = z
  .object({
    roomId: id,
    participantId: id,
    token: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const SubmitRoomMessageSchema = z
  .object({
    messageId: id,
    expectedRevision: z.number().int().nonnegative(),
    proposalVersion: z.number().int().positive(),
    text: z.string().trim().min(1).max(1_000),
    visibility: z.enum(["group", "private"]),
    questionId: id.nullable(),
    replyOption: z.string().min(1).max(160).nullable(),
  })
  .strict();

// Shared by the browser decoder and HTTP runtime so a recorded submission
// cannot be reported as a failure because response fields drift apart.
export const SubmitRoomMessageResultSchema = z.object({
  receipt: z.object({
    id,
    ownerId: id,
    visibility: z.enum(["private", "group"]),
    questionId: id.nullable(),
    proposalVersion: z.number().int().positive(),
    occurredAt: z.iso.datetime(),
  }),
  duplicate: z.boolean(),
  snapshot: DashboardSnapshotSchema,
}).strict();

export const ShareCandidateRequestSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    candidateId: id,
  })
  .strict();

export const ReviseProposalRequestSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    proposal: OptionSchema,
  })
  .strict();

export const ApproveProposalRequestSchema = z
  .object({ version: z.number().int().positive() })
  .strict();

export const RetryAnalysisRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
}).strict();

export const LeaveRoomRequestSchema = z
  .object({ expectedRevision: z.number().int().nonnegative() })
  .strict();

export type ParticipantSession = z.infer<typeof ParticipantSessionSchema>;
