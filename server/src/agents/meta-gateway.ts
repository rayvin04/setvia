import { createHash } from "node:crypto";
import { z } from "zod";
import { createMetaClient, type MetaClientOptions } from "../ai/meta-client.js";
import {
  RoleSchemas,
  Roles,
  type AgentGateway,
  type Role,
} from "./contracts.js";
import { StateError } from "./store.js";

export interface MetaGatewayOptions {
  client: MetaClientOptions;
  prompts: Record<Role, string>; // Loaded by the server from its private sibling workspace.
  maxRequestBytes: number;
  maxOutputTokens: number;
  // Caller supplies a conservative per-attempt allowance, including framing and schema.
  inputTokenAllowance: number;
  callTokenAllowance: number;
  callCostMicros: number;
  inputPriceMicrosPerMillion: number;
  outputPriceMicrosPerMillion: number;
}
export function createMetaGateway(options: MetaGatewayOptions): AgentGateway {
  for (const role of Roles)
    if (!options.prompts[role]?.trim())
      throw new StateError("MISSING_PRIVATE_PROMPT");
  const numbers = [
    options.maxRequestBytes,
    options.maxOutputTokens,
    options.inputTokenAllowance,
    options.callTokenAllowance,
    options.callCostMicros,
    options.inputPriceMicrosPerMillion,
    options.outputPriceMicrosPerMillion,
  ];
  if (
    numbers.some((n) => !Number.isSafeInteger(n) || n <= 0) ||
    options.inputTokenAllowance + options.maxOutputTokens >
      options.callTokenAllowance ||
    Math.ceil(
      (options.inputTokenAllowance * options.inputPriceMicrosPerMillion +
        options.maxOutputTokens * options.outputPriceMicrosPerMillion) /
        1_000_000,
    ) > options.callCostMicros
  )
    throw new StateError("INVALID_ALLOWANCE");
  return {
    mode: "META",
    promptHashes: Object.fromEntries(
      Roles.map((role) => [
        role,
        createHash("sha256").update(options.prompts[role]).digest("hex"),
      ]),
    ),
    async call(role, input, context) {
      const request = {
        instructions: options.prompts[role],
        input: JSON.stringify(input),
        reasoning: { effort: "minimal" as const },
        max_output_tokens: options.maxOutputTokens,
        text: {
          format: {
            type: "json_schema" as const,
            name: "setvia_" + role.toLowerCase().replaceAll(" ", "_"),
            strict: true,
            schema: z.toJSONSchema(RoleSchemas[role]),
          },
        },
      };
      // A byte-bound estimate deliberately over-reserves; it is not an invoice.
      const bytes = Buffer.byteLength(JSON.stringify(request));
      if (
        bytes > options.maxRequestBytes ||
        bytes + 2048 > options.inputTokenAllowance
      )
        throw new StateError("INPUT_LIMIT");
      const client = createMetaClient({
        ...options.client,
        maxRetries: 0,
        maxTotalRequests: 1,
        beforeAttempt: () =>
          context.reserveAttempt({
            tokens: options.callTokenAllowance,
            costMicros: options.callCostMicros,
          }),
      });
      const response = await client.createResponse(request, {
        signal: context.signal,
      });
      const inputTokens = response.usage?.input_tokens;
      const outputTokens = response.usage?.output_tokens;
      return {
        output: JSON.parse(response.outputText),
        usage:
          inputTokens === undefined || outputTokens === undefined
            ? null
            : {
                inputTokens,
                outputTokens,
                estimatedCostMicros: Math.ceil(
                  (inputTokens * options.inputPriceMicrosPerMillion +
                    outputTokens * options.outputPriceMicrosPerMillion) /
                    1_000_000,
                ),
              },
      };
    },
  };
}
