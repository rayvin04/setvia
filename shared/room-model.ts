import { z } from "zod";

export const Categories = [
  "Schedule Check",
  "Budget Check",
  "People Check",
  "Logistics Check",
  "Preparation Check",
  "Safety Check",
] as const;
export const CategorySchema = z.enum(Categories);
export type Category = z.infer<typeof CategorySchema>;
export const MAX_ROOM_PARTICIPANTS = 100;

export const OutcomeSchema = z.enum([
  "CONTINUE",
  "WAIT_FOR_PARTICIPANT",
  "COMPLETED",
  "BLOCKED",
]);
export type Outcome = z.infer<typeof OutcomeSchema>;
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const value = z.union([
  z.string().max(500),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const FindingSchema = z
  .object({
    id,
    category: CategorySchema,
    severity: z.enum(["info", "warning", "critical"]),
    status: z.enum(["open", "resolved", "unverified"]),
    evidenceIds: z.array(id).max(20),
    uncertainty: z.enum(["none", "missing", "estimated", "conflicting"]),
    message: z.string().min(1).max(500),
    recommendedAction: z.string().min(1).max(500),
  })
  .strict();
export type Finding = z.infer<typeof FindingSchema>;

export const OptionSchema = z
  .object({
    id,
    label: z.string().min(1).max(120),
    values: z.record(id, value),
  })
  .strict();
export type PlanOption = z.infer<typeof OptionSchema>;

export const QuestionSchema = z
  .object({
    id,
    findingId: id,
    targetId: id.nullable(),
    visibility: z.enum(["group", "private"]),
    kind: z.enum(["clarification", "choice", "decision", "approval"]),
    text: z.string().min(1).max(500),
    options: z.array(z.string().min(1).max(160)).max(8),
  })
  .strict();
export type Question = z.infer<typeof QuestionSchema>;

export const ReadinessSchema = z
  .object({
    percentage: z.number().int().min(0).max(100),
    status: z.enum(["needs_input", "blocked", "ready_for_human_review"]),
    categories: z
      .array(
        z
          .object({
            category: CategorySchema,
            percentage: z.number().int().min(0).max(100),
            status: z.enum([
              "unknown",
              "incomplete",
              "checked",
              "blocked",
              "not_applicable",
            ]),
          })
          .strict(),
      )
      .length(6),
    delta: z.number().int().nullable(),
    newIssueIds: z.array(id),
    resolvedIssueIds: z.array(id),
    policyVersion: z.literal("readiness-v1"),
  })
  .strict();
export type Readiness = z.infer<typeof ReadinessSchema>;
