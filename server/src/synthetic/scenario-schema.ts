import { z } from "zod";
import { MAX_ROOM_PARTICIPANTS } from "../agents/contracts.js";

const slug = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const shortText = z.string().trim().min(1).max(240);
const supportedCurrencies = new Set(Intl.supportedValuesOf("currency"));
const currencyCode = z.string().regex(/^[A-Z]{3}$/);
const category = z.enum([
  "beach_outing",
  "mountain_hike",
  "professional_meeting",
  "family_reunion",
  "large_event",
  "wedding",
  "school_project",
  "birthday_party",
  "conference",
  "other",
]);
const difficulty = z.enum(["easy", "medium", "hard", "adversarial"]);

const participant = z.object({
  id: slug,
  name: z.string().trim().min(1).max(40),
  role: z.string().trim().min(1).max(80),
  personality: z.string().trim().min(1).max(320),
  speakingStyle: z.string().trim().min(1).max(160),
  availability: z.array(shortText).max(8),
  budget: z.object({
    amount: z.number().finite().nonnegative().max(10_000_000).nullable(),
    currency: currencyCode.nullable(),
  }).strict(),
  preferences: z.array(shortText).max(10),
  responsePattern: z.enum(["responsive", "delayed", "silent"]),
}).strict();

const message = z.object({
  id: slug,
  ownerId: slug,
  text: z.string().trim().min(1).max(1_000),
  visibility: z.enum(["group", "private"]),
  delaySeconds: z.number().int().min(0).max(900),
  questionRefId: slug.nullable(),
  replyOption: z.string().trim().min(1).max(160).nullable(),
}).strict();

const timelineEvent = z.object({
  id: slug,
  order: z.number().int().min(0).max(300),
  kind: z.enum(["join", "message"]),
  participantId: slug,
  messageId: slug.nullable(),
  delaySeconds: z.number().int().min(0).max(900),
}).strict();

const anticipatedQuestion = z.object({
  id: slug,
  topicTags: z.array(slug).min(1).max(6),
  intent: shortText,
}).strict();

const constraintAnnotation = z.object({
  id: slug,
  ownerId: slug,
  description: shortText,
  hardness: z.enum(["hard", "soft"]),
  visibility: z.enum(["group", "private"]),
  sourceMessageIds: z.array(slug).min(1).max(8),
}).strict();

const expectedProblem = z.object({
  id: slug,
  category: z.enum([
    "Schedule Check",
    "Budget Check",
    "People Check",
    "Logistics Check",
    "Preparation Check",
    "Safety Check",
  ]),
  description: shortText,
  severity: z.enum(["info", "warning", "critical"]),
  evidenceMessageIds: z.array(slug).min(1).max(12),
}).strict();

const questionResponse = z.object({
  id: slug,
  participantId: slug,
  questionRefId: slug,
  responseText: z.string().trim().min(1).max(500),
  visibility: z.enum(["group", "private"]),
  replyOption: z.string().trim().min(1).max(160).nullable(),
}).strict();

/**
 * Model output. Ground truth is deliberately a separate sibling from scenario
 * input so playback code can pass only `scenario` to Setvia's room API.
 */
export const ScenarioDraftObjectSchema = z.object({
  category,
  difficulty,
  event: z.object({
    name: z.string().trim().min(1).max(120),
    type: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(800),
    objectives: z.array(shortText).min(1).max(8),
    expectedAttendeeCount: z.number().int().min(1).max(100_000),
    confirmedAttendeeCount: z.number().int().min(0).max(100_000).nullable(),
    dateLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    timeZone: z.string().trim().min(1).max(80),
    initialPlan: z.string().trim().min(1).max(300),
    unverifiedAssumptions: z.array(shortText).max(10),
  }).strict(),
  activePlannerCount: z.number().int().min(1).max(MAX_ROOM_PARTICIPANTS),
  participants: z.array(participant).min(1).max(MAX_ROOM_PARTICIPANTS),
  messages: z.array(message).min(1).max(100),
  timeline: z.array(timelineEvent).min(2).max(200),
  anticipatedQuestions: z.array(anticipatedQuestion).max(12),
  questionResponses: z.array(questionResponse).max(24),
  groundTruth: z.object({
    constraints: z.array(constraintAnnotation).max(200),
    hiddenComplications: z.array(expectedProblem).max(40),
    expectedProblems: z.array(expectedProblem).max(40),
    evaluationNotes: z.array(shortText).max(20),
  }).strict(),
}).strict();

export const ScenarioDraftSchema = ScenarioDraftObjectSchema.superRefine((scenario, context) => {
  const participants = new Map(scenario.participants.map((person) => [person.id, person]));
  const participantIds = new Set(participants.keys());
  const messages = new Map(scenario.messages.map((item) => [item.id, item]));
  const messageIds = new Set(messages.keys());
  const questionIds = new Set(scenario.anticipatedQuestions.map((question) => question.id));

  if (participantIds.size !== scenario.participants.length)
    context.addIssue({ code: "custom", path: ["participants"], message: "Participant IDs must be unique." });
  if (scenario.activePlannerCount !== scenario.participants.length)
    context.addIssue({ code: "custom", path: ["activePlannerCount"], message: "Active planner count must equal the room member list." });
  scenario.participants.forEach((person, index) => {
    if ((person.budget.amount === null) !== (person.budget.currency === null))
      context.addIssue({ code: "custom", path: ["participants", index, "budget"], message: "A budget amount and currency must be provided together." });
    if (person.budget.currency !== null && !supportedCurrencies.has(person.budget.currency))
      context.addIssue({ code: "custom", path: ["participants", index, "budget", "currency"], message: "Use a supported ISO 4217 currency code." });
  });
  if (scenario.event.confirmedAttendeeCount !== null && scenario.event.confirmedAttendeeCount > scenario.event.expectedAttendeeCount)
    context.addIssue({ code: "custom", path: ["event", "confirmedAttendeeCount"], message: "Confirmed attendees cannot exceed expected attendees." });

  try {
    new Intl.DateTimeFormat("en", { timeZone: scenario.event.timeZone });
  } catch {
    context.addIssue({ code: "custom", path: ["event", "timeZone"], message: "Use a valid IANA reference timezone." });
  }
  if (scenario.event.dateLocal !== null) {
    const parsed = new Date(`${scenario.event.dateLocal}T12:00:00Z`);
    if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== scenario.event.dateLocal)
      context.addIssue({ code: "custom", path: ["event", "dateLocal"], message: "Use a real calendar date." });
  }

  if (messageIds.size !== scenario.messages.length)
    context.addIssue({ code: "custom", path: ["messages"], message: "Message IDs must be unique." });
  const exactText = new Set<string>();
  for (const [index, item] of scenario.messages.entries()) {
    if (!participantIds.has(item.ownerId))
      context.addIssue({ code: "custom", path: ["messages", index, "ownerId"], message: "Every message must belong to an active room planner." });
    if (exactText.has(item.text.toLocaleLowerCase()))
      context.addIssue({ code: "custom", path: ["messages", index, "text"], message: "Duplicate participant messages are not allowed." });
    exactText.add(item.text.toLocaleLowerCase());
    if (item.questionRefId !== null && !questionIds.has(item.questionRefId))
      context.addIssue({ code: "custom", path: ["messages", index, "questionRefId"], message: "Message response must refer to a declared anticipated question." });
    if (item.questionRefId === null && item.replyOption !== null)
      context.addIssue({ code: "custom", path: ["messages", index, "replyOption"], message: "A reply option requires a question reference." });
  }

  const speakerIds = new Set(scenario.participants.filter((person) => person.responsePattern !== "silent").map((person) => person.id));
  const ownersWithMessages = new Set(scenario.messages.map((item) => item.ownerId));
  for (const person of scenario.participants) {
    if (person.responsePattern === "silent" && ownersWithMessages.has(person.id))
      context.addIssue({ code: "custom", path: ["participants"], message: `${person.id} is marked silent but has messages.` });
    if (person.responsePattern !== "silent" && !ownersWithMessages.has(person.id))
      context.addIssue({ code: "custom", path: ["participants"], message: `${person.id} has no message despite a response pattern.` });
  }
  if (!speakerIds.size)
    context.addIssue({ code: "custom", path: ["participants"], message: "At least one planner must provide input." });

  const timelineIds = new Set<string>();
  const joined = new Set<string>();
  const timelineMessageIds = new Set<string>();
  let sawMessage = false;
  const ordered = [...scenario.timeline].sort((a, b) => a.order - b.order);
  ordered.forEach((event, index) => {
    if (event.order !== index)
      context.addIssue({ code: "custom", path: ["timeline", index, "order"], message: "Timeline order must be unique and contiguous from zero." });
    if (timelineIds.has(event.id))
      context.addIssue({ code: "custom", path: ["timeline", index, "id"], message: "Timeline event IDs must be unique." });
    timelineIds.add(event.id);
    if (!participantIds.has(event.participantId))
      context.addIssue({ code: "custom", path: ["timeline", index, "participantId"], message: "Timeline references an unknown room planner." });
    if (event.kind === "join") {
      if (sawMessage || joined.has(event.participantId) || event.messageId !== null)
        context.addIssue({ code: "custom", path: ["timeline", index], message: "Each planner joins once before messages begin." });
      joined.add(event.participantId);
    } else {
      sawMessage = true;
      if (!event.messageId || !messageIds.has(event.messageId))
        context.addIssue({ code: "custom", path: ["timeline", index, "messageId"], message: "Timeline message references must exist." });
      else {
        const source = messages.get(event.messageId)!;
        if (source.ownerId !== event.participantId)
          context.addIssue({ code: "custom", path: ["timeline", index, "participantId"], message: "Timeline message owner must match its room planner." });
        if (source.delaySeconds !== event.delaySeconds)
          context.addIssue({ code: "custom", path: ["timeline", index, "delaySeconds"], message: "Timeline delay must match its participant message." });
        if (timelineMessageIds.has(event.messageId))
          context.addIssue({ code: "custom", path: ["timeline", index, "messageId"], message: "Each message appears once in the timeline." });
        timelineMessageIds.add(event.messageId);
      }
      if (!joined.has(event.participantId))
        context.addIssue({ code: "custom", path: ["timeline", index], message: "A planner must join before sending a message." });
    }
  });
  if (joined.size !== participantIds.size)
    context.addIssue({ code: "custom", path: ["timeline"], message: "Every room planner needs exactly one join event." });
  if (timelineMessageIds.size !== messageIds.size)
    context.addIssue({ code: "custom", path: ["timeline"], message: "Every message must appear once in the timeline." });
  if (scenario.messages.reduce((total, item) => total + item.text.length, 0) > 18_000)
    context.addIssue({ code: "custom", path: ["messages"], message: "Generated message context exceeds the local room context limit." });

  const checkReferences = (id: string, ids: Set<string>, path: (string | number)[]) => {
    if (!ids.has(id)) context.addIssue({ code: "custom", path, message: "Reference points to a missing scenario record." });
  };
  scenario.groundTruth.constraints.forEach((constraint, index) => {
    checkReferences(constraint.ownerId, participantIds, ["groundTruth", "constraints", index, "ownerId"]);
    constraint.sourceMessageIds.forEach((messageId, messageIndex) => {
      checkReferences(messageId, messageIds, ["groundTruth", "constraints", index, "sourceMessageIds", messageIndex]);
      if (messages.get(messageId)?.ownerId !== constraint.ownerId)
        context.addIssue({ code: "custom", path: ["groundTruth", "constraints", index, "sourceMessageIds", messageIndex], message: "Constraint evidence must come from its owner." });
      if (messages.get(messageId)?.visibility !== constraint.visibility)
        context.addIssue({ code: "custom", path: ["groundTruth", "constraints", index, "sourceMessageIds", messageIndex], message: "Constraint visibility must match its source message." });
    });
  });
  for (const group of ["hiddenComplications", "expectedProblems"] as const) {
    scenario.groundTruth[group].forEach((problem, index) => {
      problem.evidenceMessageIds.forEach((messageId, messageIndex) =>
        checkReferences(messageId, messageIds, ["groundTruth", group, index, "evidenceMessageIds", messageIndex]),
      );
    });
  }
  scenario.questionResponses.forEach((response, index) => {
    checkReferences(response.participantId, participantIds, ["questionResponses", index, "participantId"]);
    checkReferences(response.questionRefId, questionIds, ["questionResponses", index, "questionRefId"]);
    const responseMessage = messages.get(response.id);
    if (!responseMessage || responseMessage.ownerId !== response.participantId ||
        responseMessage.questionRefId !== response.questionRefId ||
        responseMessage.text !== response.responseText || responseMessage.visibility !== response.visibility ||
        responseMessage.replyOption !== response.replyOption)
      context.addIssue({ code: "custom", path: ["questionResponses", index], message: "A later response must match its timeline message and valid anticipated question." });
  });
});

export type ScenarioDraft = z.infer<typeof ScenarioDraftSchema>;

export const ScenarioRecordSchema = z.object({
  formatVersion: z.literal("setvia-synthetic-scenario-v1"),
  datasetId: slug,
  datasetVersion: z.number().int().positive(),
  createdAt: z.string().datetime(),
  scenario: ScenarioDraftSchema,
  provenance: z.object({
    source: z.literal("Meta Muse Spark"),
    model: z.literal("muse-spark-1.3"),
    promptVersion: z.literal("scenario-generator-v1"),
    generationRequestId: z.string().max(200).nullable(),
    generatedAt: z.string().datetime(),
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    estimatedCostMicros: z.number().int().nonnegative().nullable(),
    humanEdits: z.array(z.object({
      editedAt: z.string().datetime(),
      editedPaths: z.array(z.string().max(120)).max(100),
    }).strict()).max(50),
    validation: z.array(z.object({
      id: slug,
      passed: z.boolean(),
      detail: z.string().max(300),
    }).strict()).max(20),
  }).strict(),
  review: z.object({
    approvedForPlayback: z.boolean(),
    approvedAt: z.string().datetime().nullable(),
  }).strict(),
}).strict();

export type ScenarioRecord = z.infer<typeof ScenarioRecordSchema>;

export function scenarioJsonSchema() {
  const schema = z.toJSONSchema(ScenarioDraftObjectSchema, { reused: "inline" }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

export function scenarioValidationSummary(scenario: ScenarioDraft) {
  const checks = [
    { id: "attendees_separate", passed: scenario.event.expectedAttendeeCount >= 1 && scenario.activePlannerCount === scenario.participants.length, detail: `${scenario.event.expectedAttendeeCount} expected event attendees; ${scenario.activePlannerCount} active room planners.` },
    { id: "room_limit", passed: scenario.participants.length <= MAX_ROOM_PARTICIPANTS, detail: `${scenario.participants.length}/${MAX_ROOM_PARTICIPANTS} active room members.` },
    { id: "participant_messages", passed: scenario.messages.every((item) => scenario.participants.some((person) => person.id === item.ownerId)), detail: "Every message belongs to a declared room planner." },
    { id: "message_visibility", passed: scenario.messages.every((item) => item.visibility === "group" || item.visibility === "private"), detail: "Every message has an explicit visibility." },
    { id: "timezone", passed: Boolean(scenario.event.timeZone), detail: `Reference timezone: ${scenario.event.timeZone}.` },
    { id: "ground_truth_refs", passed: true, detail: "All ground-truth message, owner, and question references passed Zod refinement." },
    { id: "external_facts", passed: true, detail: "External availability, prices, weather, and safety checks are not claimed as verified." },
  ];
  return checks;
}
