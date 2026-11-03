import { z } from "zod";

export const CATEGORY_DEFINITIONS = {
  "Schedule Check":
    "Conflicting availability, impossible timing, overlaps, unrealistic durations, and missing deadlines.",
  "Budget Check":
    "Per-person limits, total estimates, conflicting or unclear expenses, and confirmed financial constraints.",
  "People Check":
    "Missing responses or confirmations, accessibility, attendance conflicts, unassigned responsibilities, and unclear roles.",
  "Logistics Check":
    "Transportation, locations, routes, travel arrangements, venue details, and practical coordination.",
  "Preparation Check":
    "Event-specific equipment, materials, supplies, things to bring, and preparation responsibilities.",
  "Safety Check":
    "Hazards, precautions, emergency preparation, communications, weather and route risks, and relevant local guidance. AI evaluation never establishes safety.",
} as const;
export const Categories = Object.keys(CATEGORY_DEFINITIONS) as [
  keyof typeof CATEGORY_DEFINITIONS,
  ...(keyof typeof CATEGORY_DEFINITIONS)[],
];
export const CategorySchema = z.enum(Categories);
export type Category = z.infer<typeof CategorySchema>;
export const Roles = [
  "Listener",
  "Judge",
  "Negotiator",
  "Question Strategist",
  "Speaker",
] as const;
export type Role = (typeof Roles)[number];
// The current application contract supports large groups without making a
// model call for each participant. Keep this explicit and bounded.
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
export const FactSchema = z
  .object({
    id,
    key: id,
    value,
    ownerId: id,
    visibility: z.enum(["group", "private"]),
    // Participant values are compared only with other values from that owner.
    // Shared facts represent one room-wide claim and may conflict across owners.
    scope: z.enum(["participant", "shared"]).default("participant"),
    confirmed: z.boolean(),
  })
  .strict();
export type Fact = z.infer<typeof FactSchema>;
export type FactInput = z.input<typeof FactSchema>;
export const ConstraintSchema = z
  .object({
    id,
    ownerId: id,
    // Personal constraints remain outside shared model context unless their
    // owner explicitly chooses group visibility.
    visibility: z.enum(["group", "private"]).default("group"),
    category: CategorySchema,
    key: id,
    operator: z.enum(["required", "eq", "neq", "lte", "gte"]),
    expected: value,
    hard: z.boolean(),
  })
  .strict();
export type Constraint = z.infer<typeof ConstraintSchema>;
export type ConstraintInput = z.input<typeof ConstraintSchema>;
export const PolicySchema = z
  .array(
    z
      .object({
        category: CategorySchema,
        enabled: z.boolean(),
        weight: z.number().positive().max(100),
        requiredKeys: z.array(id).max(30),
        requiredPerParticipantKeys: z.array(id).max(10).default([]),
      })
      .strict(),
  )
  .length(6)
  .refine(
    (p) => new Set(p.map((c) => c.category)).size === 6,
    "All six categories must appear exactly once.",
  );
export type Policy = z.infer<typeof PolicySchema>;
export type PolicyInput = z.input<typeof PolicySchema>;
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
export const JudgeSchema = z
  .object({
    findings: z.array(FindingSchema).max(40),
    verdicts: z
      .array(z.object({ optionId: id, accepted: z.boolean() }).strict())
      .max(8),
    next: z.enum(["negotiate", "question", "speak", "stop"]),
    taskFindingIds: z.array(id).max(40),
    acceptedQuestionIds: z.array(id).max(8),
    anotherPassUseful: z.boolean(),
    participantInputRequired: z.boolean(),
    canStop: z.boolean(),
    readinessAssessment: z
      .object({
        readyForReview: z.boolean(),
        explanation: z.string().max(500),
      })
      .strict(),
  })
  .strict();
export type JudgeEvaluation = z.infer<typeof JudgeSchema>;
// Encode the single authorized target directly in JSON Schema. A Zod
// refinement is enforced locally but is not representable in the provider's
// strict structured-output schema, which previously let ambiguous targets
// reach the local validator and block an otherwise valid cycle.
const SpeakerReplySchema = z.union([
  z.object({
    questionId: id,
    findingId: z.null(),
    text: z.string().trim().min(1).max(500),
  }).strict(),
  z.object({
    questionId: z.null(),
    findingId: id,
    text: z.string().trim().min(1).max(500),
  }).strict(),
]);

export const RoleSchemas = {
  Listener: z
    .object({
      candidates: z.array(z.object({ key: id, value }).strict()).max(20),
    })
    .strict(),
  Judge: JudgeSchema,
  Negotiator: z
    .object({ options: z.array(OptionSchema).min(1).max(8) })
    .strict(),
  "Question Strategist": z
    .object({ questions: z.array(QuestionSchema).min(1).max(8) })
    .strict(),
  Speaker: z
    .object({
      replies: z.array(SpeakerReplySchema).max(28),
      mascot: z.enum(["thinking", "curious", "concerned", "content"]),
    })
    .strict(),
} as const;

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
export const TraceSchema = z
  .object({
    sequence: z.number().int(),
    role: z.enum(Roles),
    phase: z.enum([
      "interpret",
      "review",
      "revise",
      "questions",
      "draft",
      "final",
    ]),
    requestedBy: z.enum(["orchestrator", ...Roles]),
    promptVersion: z.string().regex(/^agents-v[0-9]+$/),
    promptHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    mode: z.enum(["MOCK", "META"]),
    // v1 Lab history remains readable after the Speaker handoff adds authored
    // reply text in v2.
    schemaVersion: z.enum(["agents-v1", "agents-v2"]),
    input: z.unknown(),
    output: z.unknown(),
    status: z.enum(["accepted", "rejected", "failed"]),
    failureCode: z.string().regex(/^[A-Z0-9_]+$/).max(64).optional(),
    failureMessage: z.string().max(180).optional(),
    acceptedOptionIds: z.array(id),
    rejectedOptionIds: z.array(id),
    attempts: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative().nullable(),
    cachedInputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    reasoningTokens: z.number().int().nonnegative().nullable(),
    totalTokens: z.number().int().nonnegative().nullable(),
    estimatedCostMicros: z.number().int().nonnegative().nullable(),
    durationMs: z.number().int().nonnegative(),
  })
  .strict();
export type Trace = z.infer<typeof TraceSchema>;
export const CycleSchema = z
  .object({
    id,
    baseRevision: z.number().int(),
    outcome: OutcomeSchema,
    reason: z.string().regex(/^[A-Z_]+$/),
    finalEvaluation: JudgeSchema.nullable(),
    readiness: ReadinessSchema.nullable(),
    traces: z.array(TraceSchema).max(30),
    attempts: z.number().int().nonnegative(),
    reservedTokens: z.number().int().nonnegative(),
    reservedCostMicros: z.number().int().nonnegative(),
    usageKnown: z.boolean(),
    questions: z.array(QuestionSchema).max(8),
    mascot: z.enum(["thinking", "curious", "concerned", "content"]).nullable(),
    messages: z
      .array(
        z
          .object({
            text: z.string().max(500),
            visibility: z.enum(["group", "private"]),
            targetId: id.nullable(),
            questionId: id.nullable(),
            proposalVersion: z.number().int().positive(),
          })
          .strict(),
      )
      .max(28),
  })
  .strict();
export type Cycle = z.infer<typeof CycleSchema>;
export const RoomResponseSchema = z
  .object({
    id,
    ownerId: id,
    visibility: z.enum(["group", "private"]),
    text: z.string().trim().min(1).max(1_000),
    questionId: id.nullable(),
    replyOption: z.string().min(1).max(160).nullable(),
    proposalVersion: z.number().int().positive(),
    occurredAt: z.iso.datetime(),
  })
  .strict();
export type RoomResponse = z.infer<typeof RoomResponseSchema>;
const PendingRoomInputSchema = z
  .object({
    id,
    actorId: id,
    messageId: id.nullable().default(null),
    text: z.string().trim().min(1).max(4_000),
    visibility: z.enum(["group", "private"]).default("private"),
    questionId: id.nullable().default(null),
    replyOption: z.string().min(1).max(160).nullable().default(null),
  })
  .strict();
export type PendingRoomInput = z.infer<typeof PendingRoomInputSchema>;
export const PrivateAnalysisSchema = z
  .object({
    ownerId: id,
    sourceMessageId: id,
    proposalVersion: z.number().int().positive(),
    updatedAt: z.iso.datetime(),
    cycle: CycleSchema,
    candidates: z.array(FactSchema).max(20),
  })
  .strict();
export type PrivateAnalysis = z.infer<typeof PrivateAnalysisSchema>;
export const RoomActivitySchema = z
  .object({
    id,
    kind: z.enum([
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
    ]),
    revision: z.number().int().nonnegative(),
    proposalVersion: z.number().int().positive(),
    occurredAt: z.iso.datetime(),
    actorId: id.nullable(),
    summary: z.string().trim().min(1).max(300),
    category: CategorySchema.nullable(),
    visibility: z.enum(["group", "private"]).default("group"),
    targetId: id.nullable().default(null),
  })
  .strict();
export type RoomActivity = z.infer<typeof RoomActivitySchema>;
export const ReadinessHistorySchema = z
  .object({
    id,
    revision: z.number().int().nonnegative(),
    proposalVersion: z.number().int().positive(),
    occurredAt: z.iso.datetime(),
    readiness: ReadinessSchema,
    explanation: z.string().trim().min(1).max(500),
  })
  .strict();
export const RoomSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    eventSequence: z.number().int().nonnegative().default(0),
    publicSequence: z.number().int().nonnegative().default(0),
    privateSequences: z.record(id, z.number().int().nonnegative()).default({}),
    privateRevisions: z.record(id, z.number().int().nonnegative()).default({}),
    revision: z.number().int().nonnegative(),
    analysisStatus: z.enum(["idle", "queued", "running", "blocked", "complete"]).default("idle"),
    eventType: z.string().min(1).max(80),
    syntheticDemo: z.boolean().default(false),
    // Event attendance counts are separate from active room membership. They
    // are optional so existing schemaVersion 1 snapshots remain compatible.
    estimatedAttendeeCount: z.number().int().nonnegative().nullable().optional(),
    confirmedAttendeeCount: z.number().int().nonnegative().nullable().optional(),
    invitationHash: z.string().regex(/^[a-f0-9]{64}$/),
    participants: z
      .array(
        z
          .object({
            id,
            name: z.string().min(1).max(40),
            tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
            publicTargetingConsent: z.boolean(),
          })
          .strict(),
      )
      .max(MAX_ROOM_PARTICIPANTS),
    policy: PolicySchema,
    constraints: z.array(ConstraintSchema).max(100),
    facts: z.array(FactSchema).max(200),
    candidates: z.array(FactSchema).max(200),
    proposal: OptionSchema,
    proposalVersion: z.number().int().positive(),
    approvals: z.record(id, z.number().int().positive()),
    pendingInputs: z.array(PendingRoomInputSchema).max(50),
    privatePendingInputs: z.array(PendingRoomInputSchema).max(100).default([]),
    responses: z.array(RoomResponseSchema).max(500).default([]),
    activity: z.array(RoomActivitySchema).max(100).default([]),
    privateAnalysisStatus: z.record(id, z.enum(["queued", "running", "blocked", "complete"])).default({}),
    privateAnalyses: z.array(PrivateAnalysisSchema).max(100).default([]),
    readinessHistory: z.array(ReadinessHistorySchema).max(30).default([]),
    questions: z.array(QuestionSchema).max(8),
    options: z.array(OptionSchema).max(8),
    readiness: ReadinessSchema.nullable(),
    lastCycle: CycleSchema.nullable(),
    activeCycleId: id.nullable(),
    lifetimeAttempts: z.number().int().nonnegative(),
    lifetimeReservedTokens: z.number().int().nonnegative(),
    lifetimeReservedCostMicros: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((room, context) => {
    if (
      room.estimatedAttendeeCount != null &&
      room.confirmedAttendeeCount != null &&
      room.confirmedAttendeeCount > room.estimatedAttendeeCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["confirmedAttendeeCount"],
        message: "Confirmed attendees cannot exceed the event estimate.",
      });
    }
  });
export type Room = z.infer<typeof RoomSchema>;
export interface Auth {
  participantId: string;
  token: string;
}
export interface CallContext {
  signal: AbortSignal;
  // Trusted adapters MUST call this immediately before EACH HTTP attempt.
  reserveAttempt(allowance?: {
    tokens: number;
    costMicros: number;
  }): Promise<void>;
}
export interface AgentResult {
  output: unknown;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens?: number | null;
    cachedInputTokens?: number | null;
    reasoningTokens?: number | null;
    estimatedCostMicros: number;
  } | null;
}
export interface AgentGateway {
  mode: "MOCK" | "META";
  promptVersion?: string;
  promptHashes?: Partial<Record<Role, string>>;
  // Live adapters hold the complete bounded cycle allowance before its first
  // request. Unused capacity is released when the cycle settles.
  openCycle?(maxRequests: number): Promise<{
    call: AgentGateway["call"];
    release(): Promise<void>;
  }>;
  call(role: Role, input: unknown, context: CallContext): Promise<AgentResult>;
}
// Extension boundary only. No image generation or model request is made here.
export interface VisualPlanner {
  propose(
    input: { proposalVersion: number; authorizedFacts: Fact[] },
    signal: AbortSignal,
  ): Promise<{ assetRequests: string[] }>;
}
