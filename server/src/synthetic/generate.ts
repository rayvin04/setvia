import { z } from "zod";
import { createHash } from "node:crypto";
import { createMetaClient, type MetaApiClient, type MetaClientOptions, type MetaHttpAttemptEvent, type MetaResponsesRequest, type SafeUsageMetadata } from "../ai/meta-client.js";
import {
  ScenarioDraftSchema,
  scenarioJsonSchema,
  type ScenarioDraft,
} from "./scenario-schema.js";
import { MAX_ROOM_PARTICIPANTS } from "../agents/contracts.js";

export const SCENARIO_GENERATOR_PROMPT_VERSION = "scenario-generator-v1" as const;
export const SCENARIO_GENERATOR_MAX_OUTPUT_TOKENS = 8_000;
export const SCENARIO_GENERATOR_MAX_INPUT_CHARACTERS = 16_000;
export const SCENARIO_GENERATOR_INPUT_TOKEN_ALLOWANCE = 24_000;
export const SCENARIO_GENERATOR_MAX_ATTEMPTS_PER_REQUEST = 1;
export const SCENARIO_GENERATOR_RESERVED_COST_MICROS = 64_000;
export const SCENARIO_GENERATOR_INPUT_PRICE_MICROS_PER_MILLION = 1_250_000;
export const SCENARIO_GENERATOR_OUTPUT_PRICE_MICROS_PER_MILLION = 4_250_000;
export const SCENARIO_PRICE_SNAPSHOT_DATE = "2026-11-03";

export const GenerateScenarioRequestSchema = z.object({
  category: z.enum([
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
  ]),
  difficulty: z.enum(["easy", "medium", "hard", "adversarial"]),
  expectedAttendeeCount: z.number().int().min(1).max(100_000),
  activePlannerCount: z.number().int().min(1).max(MAX_ROOM_PARTICIPANTS),
  messageCount: z.number().int().min(1).max(100),
  timeZone: z.string().trim().min(1).max(80),
  dateLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
}).strict();

export type GenerateScenarioRequest = z.infer<typeof GenerateScenarioRequestSchema>;

export interface ScenarioGenerationResult {
  scenario: ScenarioDraft;
  model: "muse-spark-1.3";
  promptVersion: typeof SCENARIO_GENERATOR_PROMPT_VERSION;
  responseId: string | null;
  attempts: number;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostMicros: number | null;
  durationMs: number;
}

export class ScenarioGenerationError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
    readonly usage: { inputTokens: number | null; outputTokens: number | null; estimatedCostMicros: number | null } | null = null,
    readonly accountingFailed = false,
  ) {
    super(message);
    this.name = "ScenarioGenerationError";
  }
}

function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function estimateCostMicros(inputTokens: number | null, outputTokens: number | null) {
  if (inputTokens === null || outputTokens === null) return null;
  return Math.ceil(
    (inputTokens * SCENARIO_GENERATOR_INPUT_PRICE_MICROS_PER_MILLION +
      outputTokens * SCENARIO_GENERATOR_OUTPUT_PRICE_MICROS_PER_MILLION) /
      1_000_000,
  );
}

function createPrompt(input: GenerateScenarioRequest) {
  return [
    "Create one realistic but entirely fictional Setvia group-planning test scenario.",
    "Return only the JSON object required by the supplied schema.",
    "Do not include ground-truth notes in participant messages. Ground truth is a separate evaluation annotation and will never be sent to the planning agents.",
    "Use the requested event attendee count and active Setvia planning-room member count as different quantities. Only `participants` are room members. Event attendees are not automatically room members and must not be treated as approvers.",
    "Give each planner a distinct, natural voice. Mix concise replies, longer context, uncertainty, disagreement, changing preferences, and silent or delayed planners. Do not make every person speak in the same style.",
    "Make hard and soft constraints explicit in the participant message text that supports them. Ground truth must point to those source message IDs and must identify whether each constraint is hard or soft and group-visible or private.",
    "Private messages must be marked private. Do not copy their contents into group-visible messages, event details, the initial plan, or group evaluation notes.",
    "Use the requested reference timezone for the event. Message timing uses relative seconds; do not invent model completion times.",
    "Everything is a test input. Do not assert real venue availability, current prices, weather, permits, medical advice, or verified safety. If such details appear, label them as fictional/unverified assumptions.",
    "Create the requested number of room members and messages. Include a join event for every room member, including silent planners. Every message must have one valid room owner and appear once in the ordered timeline.",
    "Question response intents are optional. They must refer to a declared anticipated question and are submitted only if the live room later asks a matching question; never send them in advance.",
    "For each planner's budget, use an ISO 4217 currency code with a numeric amount, or set both amount and currency to null.",
    `Requested settings: ${JSON.stringify(input)}.`,
  ].join("\n");
}

export async function generateScenario(
  input: GenerateScenarioRequest,
  client: MetaApiClient,
): Promise<ScenarioGenerationResult> {
  const request = GenerateScenarioRequestSchema.parse(input);
  if (!isValidTimeZone(request.timeZone)) throw new ScenarioGenerationError("Choose a valid IANA timezone.", 0);
  const apiRequest = createScenarioMetaRequest(request);
  if (JSON.stringify(apiRequest).length > SCENARIO_GENERATOR_MAX_INPUT_CHARACTERS + 96_000)
    throw new ScenarioGenerationError("Scenario generation schema exceeds the configured request limit.", 0);
  const startingAttempts = client.getRequestCount();
  try {
    const response = await client.createResponse(apiRequest);
    const attempts = client.getRequestCount() - startingAttempts;
    if (attempts < 1 || attempts > SCENARIO_GENERATOR_MAX_ATTEMPTS_PER_REQUEST)
      throw new ScenarioGenerationError("Generator request exceeded its one-attempt limit.", attempts);
    let decoded: unknown;
    try {
      decoded = JSON.parse(response.outputText);
    } catch {
      throw new ScenarioGenerationError("Muse Spark returned malformed structured scenario data; nothing was saved.", attempts);
    }
    const parsed = ScenarioDraftSchema.safeParse(decoded);
    const usage = response.usage;
    const safeUsage = {
      inputTokens: usage?.input_tokens ?? null,
      outputTokens: usage?.output_tokens ?? null,
      estimatedCostMicros: estimateCostMicros(usage?.input_tokens ?? null, usage?.output_tokens ?? null),
    };
    if (!parsed.success)
      throw new ScenarioGenerationError("Muse Spark output failed Setvia scenario validation; nothing was saved.", attempts, safeUsage);
    if (parsed.data.category !== request.category || parsed.data.difficulty !== request.difficulty ||
        parsed.data.event.expectedAttendeeCount !== request.expectedAttendeeCount ||
        parsed.data.activePlannerCount !== request.activePlannerCount ||
        parsed.data.messages.length !== request.messageCount ||
        parsed.data.event.timeZone !== request.timeZone || parsed.data.event.dateLocal !== request.dateLocal)
      throw new ScenarioGenerationError("Muse Spark output did not preserve the requested scenario settings; nothing was saved.", attempts, safeUsage);

    return {
      scenario: parsed.data,
      model: "muse-spark-1.3",
      promptVersion: SCENARIO_GENERATOR_PROMPT_VERSION,
      responseId: response.id,
      attempts,
      ...safeUsage,
      durationMs: response.durationMs,
    };
  } catch (error) {
    if (error instanceof ScenarioGenerationError) throw error;
    const attempts = client.getRequestCount() - startingAttempts;
    throw new ScenarioGenerationError(
      attempts > 0 ? "Muse Spark scenario generation failed after the recorded HTTP attempt." : "Muse Spark scenario generation could not be started.",
      attempts,
    );
  }
}

export function createScenarioMetaRequest(input: GenerateScenarioRequest): MetaResponsesRequest {
  const request = GenerateScenarioRequestSchema.parse(input);
  const prompt = createPrompt(request);
  if (prompt.length > SCENARIO_GENERATOR_MAX_INPUT_CHARACTERS)
    throw new ScenarioGenerationError("Scenario generation input exceeds the configured context limit.", 0);
  return {
    instructions: "You create synthetic evaluation inputs for Setvia. All participants and event details are fictional. Follow the JSON Schema exactly; use no tools and do not invent external verification.",
    input: prompt,
    reasoning: { effort: "low" },
    max_output_tokens: SCENARIO_GENERATOR_MAX_OUTPUT_TOKENS,
    text: {
      format: {
        type: "json_schema",
        name: "setvia_synthetic_scenario_v1",
        schema: scenarioJsonSchema(),
        strict: true,
      },
    },
  };
}

export function scenarioRequestHash(input: GenerateScenarioRequest) {
  const body = { ...createScenarioMetaRequest(input), model: "muse-spark-1.3" };
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

export interface ScenarioGeneratorHttpEvent extends MetaHttpAttemptEvent {
  requestHash: string;
  role: "Scenario Generator";
  promptVersion: typeof SCENARIO_GENERATOR_PROMPT_VERSION;
}

export interface ScenarioGenerationHooks {
  reserveAttempt(allowance: { tokens: number; costMicros: number }): void | Promise<void>;
  recordHttpEvent(event: ScenarioGeneratorHttpEvent): void | Promise<void>;
  acquireAttempt?(): Promise<() => void>;
  beforeAttempt?(): void | Promise<void>;
}

export function createScenarioGenerationClient(options: {
  env?: Record<string, string | undefined>;
  client?: Pick<MetaClientOptions, "config" | "fetchImpl" | "timeoutMs">;
  input: GenerateScenarioRequest;
  hooks: ScenarioGenerationHooks;
}) {
  const requestHash = scenarioRequestHash(options.input);
  return createMetaClient({
    env: options.env,
    ...options.client,
    timeoutMs: options.client?.timeoutMs ?? 45_000,
    maxRetries: 0,
    maxTotalRequests: SCENARIO_GENERATOR_MAX_ATTEMPTS_PER_REQUEST,
    acquireAttempt: options.hooks.acquireAttempt,
    beforeAttempt: async () => {
      await options.hooks.beforeAttempt?.();
      try {
        await options.hooks.reserveAttempt({
          tokens: SCENARIO_GENERATOR_INPUT_TOKEN_ALLOWANCE + SCENARIO_GENERATOR_MAX_OUTPUT_TOKENS,
          costMicros: SCENARIO_GENERATOR_RESERVED_COST_MICROS,
        });
      } catch {
        throw new ScenarioGenerationError("Request accounting failed before Meta inference.", 0, null, true);
      }
    },
    onHttpEvent: (event) => options.hooks.recordHttpEvent({
      ...event,
      requestHash,
      role: "Scenario Generator",
      promptVersion: SCENARIO_GENERATOR_PROMPT_VERSION,
    }),
    onUsage: (usage, requestNumber) => options.hooks.recordHttpEvent({
      phase: "usage",
      requestNumber,
      requestHash,
      role: "Scenario Generator",
      promptVersion: SCENARIO_GENERATOR_PROMPT_VERSION,
      usage,
      durationMs: usage.durationMs,
    }),
  });
}
