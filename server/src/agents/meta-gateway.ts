import { createHash } from "node:crypto";
import { z } from "zod";
import { createMetaClient, type MetaClientOptions, type SafeUsageMetadata } from "../ai/meta-client.js";
import {
  RoleSchemas,
  Roles,
  type AgentGateway,
  type CallContext,
  type Role,
} from "./contracts.js";
import { StateError } from "./store.js";

export interface MetaHttpEvent {
  phase: "started" | "response" | "transport_error" | "usage";
  requestNumber: number;
  requestHash: string;
  role: Role | "Scenario Generator";
  promptVersion: string;
  status?: number;
  durationMs?: number;
  usage?: SafeUsageMetadata;
}

export interface MetaGatewayOptions {
  client: MetaClientOptions;
  prompts: Record<Role, string>; // Loaded by the server from its private sibling workspace.
  promptVersion?: string;
  maxRequestBytes: number;
  maxOutputTokens: number | Partial<Record<Role, number>>;
  // Caller supplies a conservative per-attempt allowance, including framing and schema.
  inputTokenAllowance: number;
  callTokenAllowance: number;
  callCostMicros: number;
  inputPriceMicrosPerMillion: number;
  cachedInputPriceMicrosPerMillion?: number;
  outputPriceMicrosPerMillion: number;
  onHttpEvent?: (event: MetaHttpEvent) => void | Promise<void>;
}

function outputCapsFor(options: MetaGatewayOptions): Record<Role, number> {
  const caps = {} as Record<Role, number>;
  for (const role of Roles) {
    const cap = typeof options.maxOutputTokens === "number"
      ? options.maxOutputTokens
      : options.maxOutputTokens[role];
    if (!Number.isSafeInteger(cap) || (cap ?? 0) <= 0)
      throw new StateError("INVALID_OUTPUT_TOKEN_CAP");
    caps[role] = cap!;
  }
  return caps;
}

function estimateMaxCostMicros(
  inputTokens: number,
  outputTokens: number,
  inputPrice: number,
  outputPrice: number,
) {
  // Reservation deliberately assumes no cached input discount.
  return Math.ceil(
    (inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000,
  );
}

export function createMetaGateway(options: MetaGatewayOptions): AgentGateway {
  const promptVersion = options.promptVersion ?? "agents-v1";
  if (!/^agents-v[0-9]+$/.test(promptVersion))
    throw new StateError("INVALID_PROMPT_VERSION");
  for (const role of Roles)
    if (!options.prompts[role]?.trim())
      throw new StateError("MISSING_PRIVATE_PROMPT");
  const outputCaps = outputCapsFor(options);
  const maxOutputTokens = Math.max(...Object.values(outputCaps));
  const numbers = [
    options.maxRequestBytes,
    options.inputTokenAllowance,
    options.callTokenAllowance,
    options.callCostMicros,
    options.inputPriceMicrosPerMillion,
    options.cachedInputPriceMicrosPerMillion ?? 150_000,
    options.outputPriceMicrosPerMillion,
  ];
  if (
    numbers.some((n) => !Number.isSafeInteger(n) || n <= 0) ||
    options.inputTokenAllowance + maxOutputTokens > options.callTokenAllowance ||
    estimateMaxCostMicros(
      options.inputTokenAllowance,
      maxOutputTokens,
      options.inputPriceMicrosPerMillion,
      options.outputPriceMicrosPerMillion,
    ) > options.callCostMicros
  )
    throw new StateError("INVALID_ALLOWANCE");

  return {
    mode: "META",
    promptVersion,
    promptHashes: Object.fromEntries(
      Roles.map((role) => [
        role,
        createHash("sha256").update(options.prompts[role]).digest("hex"),
      ]),
    ),
    async call(role, input, context: CallContext) {
      const request = {
        instructions: options.prompts[role],
        input: JSON.stringify(input),
        reasoning: { effort: "minimal" as const },
        max_output_tokens: outputCaps[role],
        text: {
          format: {
            type: "json_schema" as const,
            name: "setvia_" + role.toLowerCase().replaceAll(" ", "_"),
            strict: true,
            schema: z.toJSONSchema(RoleSchemas[role]),
          },
        },
      };
      const serialized = JSON.stringify(request);
      const bytes = Buffer.byteLength(serialized);
      if (
        bytes > options.maxRequestBytes ||
        bytes + 2048 > options.inputTokenAllowance
      )
        throw new StateError("INPUT_LIMIT");
      const requestHash = createHash("sha256").update(serialized).digest("hex");
      const client = createMetaClient({
        ...options.client,
        maxRetries: 0,
        maxTotalRequests: 1,
        beforeAttempt: () =>
          context.reserveAttempt({
            tokens: options.callTokenAllowance,
            costMicros: options.callCostMicros,
          }),
        onHttpEvent: options.onHttpEvent
          ? (event) => options.onHttpEvent!({
              ...event,
              role,
              promptVersion,
              requestHash,
            })
          : undefined,
        onUsage: options.onHttpEvent
          ? (usage, requestNumber) => options.onHttpEvent!({
              phase: "usage",
              requestNumber,
              role,
              promptVersion,
              requestHash,
              usage,
              durationMs: usage.durationMs,
            })
          : undefined,
      });
      const response = await client.createResponse(request, {
        signal: context.signal,
      });
      const inputTokens = response.usage?.input_tokens;
      const outputTokens = response.usage?.output_tokens;
      const reportedCachedTokens = response.usage?.input_tokens_details?.cached_tokens;
      if (
        (inputTokens !== undefined && reportedCachedTokens !== undefined && reportedCachedTokens > inputTokens) ||
        (response.usage?.output_tokens_details?.reasoning_tokens !== undefined &&
          response.usage.output_tokens_details.reasoning_tokens > (outputTokens ?? 0))
      )
        throw new StateError("INVALID_USAGE");
      return {
        output: JSON.parse(response.outputText),
        usage:
          inputTokens === undefined || outputTokens === undefined
            ? null
            : {
                inputTokens,
                outputTokens,
                totalTokens: response.usage?.total_tokens ?? inputTokens + outputTokens,
                cachedInputTokens: reportedCachedTokens ?? null,
                reasoningTokens: response.usage?.output_tokens_details?.reasoning_tokens ?? null,
                estimatedCostMicros: Math.ceil(
                  ((inputTokens - (reportedCachedTokens ?? 0)) * options.inputPriceMicrosPerMillion +
                    (reportedCachedTokens ?? 0) * (options.cachedInputPriceMicrosPerMillion ?? 150_000) +
                    outputTokens * options.outputPriceMicrosPerMillion) /
                    1_000_000,
                ),
              },
      };
    },
  };
}
