import { MetaApiError, MetaConfigurationError } from "./errors.js";

export const META_API_BASE_URL = "https://api.meta.ai/v1" as const;
export const META_SPARK_MODEL = "muse-spark-1.3" as const;

export interface MetaConfig {
  apiKey: string;
  baseUrl: typeof META_API_BASE_URL;
  model: typeof META_SPARK_MODEL;
}

export type MetaInputContent =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string };

export interface MetaResponsesRequest {
  input:
    | string
    | Array<{
        type: "message";
        role: "user";
        content: MetaInputContent[];
      }>;
  instructions?: string;
  max_output_tokens?: number;
  text?: {
    format: {
      type: "json_schema";
      name: string;
      schema: Record<string, unknown>;
      strict?: boolean;
    };
  };
}

export interface MetaUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
}

export interface SafeUsageMetadata {
  model: string;
  responseId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens: number | null;
  durationMs: number;
}

export interface MetaResponseResult {
  id: string | null;
  model: string;
  outputText: string;
  usage: MetaUsage | null;
  durationMs: number;
}

export interface MetaApiClient {
  readonly baseUrl: typeof META_API_BASE_URL;
  readonly model: typeof META_SPARK_MODEL;
  createResponse(
    request: MetaResponsesRequest,
    options?: { signal?: AbortSignal },
  ): Promise<MetaResponseResult>;
  getRequestCount(): number;
}

export interface MetaClientOptions {
  env?: Record<string, string | undefined>;
  config?: MetaConfig;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  maxTotalRequests?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  onUsage?: (metadata: SafeUsageMetadata) => void;
}

const MAX_RETRIES = 2;
const MAX_RETRY_AFTER_MS = 1_500;

function validateMetaConfig(config: MetaConfig): MetaConfig {
  if (typeof config.apiKey !== "string" || config.apiKey.trim().length === 0) {
    throw new MetaConfigurationError(
      "MODEL_API_KEY is missing. Set it in the server environment or local .env file.",
    );
  }
  if (config.baseUrl !== META_API_BASE_URL) {
    throw new MetaConfigurationError(
      "MODEL_API_BASE_URL must be the official Meta endpoint https://api.meta.ai/v1.",
    );
  }
  if (config.model !== META_SPARK_MODEL) {
    throw new MetaConfigurationError(
      "MODEL_SPARK must be muse-spark-1.3 Standard mode.",
    );
  }
  return {
    apiKey: config.apiKey.trim(),
    baseUrl: META_API_BASE_URL,
    model: META_SPARK_MODEL,
  };
}

export function readMetaConfig(
  env: Record<string, string | undefined> = process.env,
): MetaConfig {
  const apiKey = env.MODEL_API_KEY?.trim();
  if (!apiKey) {
    throw new MetaConfigurationError(
      "MODEL_API_KEY is missing. Set it in the server environment or local .env file.",
    );
  }

  const baseUrl = (env.MODEL_API_BASE_URL ?? META_API_BASE_URL).trim();
  if (baseUrl !== META_API_BASE_URL) {
    throw new MetaConfigurationError(
      "MODEL_API_BASE_URL must be the official Meta endpoint https://api.meta.ai/v1.",
    );
  }

  const model = (env.MODEL_SPARK ?? META_SPARK_MODEL).trim();
  if (model !== META_SPARK_MODEL) {
    throw new MetaConfigurationError(
      "MODEL_SPARK must be muse-spark-1.3 Standard mode.",
    );
  }

  return { apiKey, baseUrl: META_API_BASE_URL, model: META_SPARK_MODEL };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function textFromResponse(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (typeof value.output_text === "string") return value.output_text;
  if (!Array.isArray(value.output)) return null;

  const textParts: string[] = [];
  for (const item of value.output) {
    if (
      !isRecord(item) ||
      item.type !== "message" ||
      !Array.isArray(item.content)
    ) {
      continue;
    }
    for (const part of item.content) {
      if (
        isRecord(part) &&
        part.type === "output_text" &&
        typeof part.text === "string"
      ) {
        textParts.push(part.text);
      }
    }
  }
  return textParts.length > 0 ? textParts.join("") : null;
}

function usageFromResponse(value: unknown): MetaUsage | null {
  if (!isRecord(value) || !isRecord(value.usage)) return null;
  const usage = value.usage;
  const details = isRecord(usage.input_tokens_details)
    ? usage.input_tokens_details
    : undefined;

  return {
    input_tokens: numberOrNull(usage.input_tokens) ?? undefined,
    output_tokens: numberOrNull(usage.output_tokens) ?? undefined,
    total_tokens: numberOrNull(usage.total_tokens) ?? undefined,
    input_tokens_details: details
      ? { cached_tokens: numberOrNull(details.cached_tokens) ?? undefined }
      : undefined,
  };
}

function safeApiError(status: number): MetaApiError {
  if (status === 401) {
    return new MetaApiError(
      "authentication",
      "Meta API authentication failed (HTTP 401). Verify MODEL_API_KEY.",
      { status },
    );
  }
  if (status === 403) {
    return new MetaApiError(
      "forbidden",
      "Meta denied access (HTTP 403). Check team and model permissions.",
      { status },
    );
  }
  if (status === 404) {
    return new MetaApiError(
      "not_found",
      "Meta endpoint or model was not found (HTTP 404).",
      { status },
    );
  }
  if (status === 429) {
    return new MetaApiError(
      "rate_limit",
      "Meta rate limit reached (HTTP 429).",
      {
        status,
        retryable: true,
      },
    );
  }
  if (status === 408) {
    return new MetaApiError("timeout", "Meta request timed out (HTTP 408).", {
      status,
      retryable: true,
    });
  }
  if (status >= 500) {
    return new MetaApiError(
      "server",
      "Meta service failed (HTTP " + status + ").",
      { status, retryable: true },
    );
  }
  return new MetaApiError(
    "request",
    "Meta rejected the request (HTTP " +
      status +
      "). Check the request schema.",
    { status },
  );
}

function retryAfterMilliseconds(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, MAX_RETRY_AFTER_MS);
  }
  const dateMs = Date.parse(header);
  if (Number.isNaN(dateMs)) return null;
  return Math.min(Math.max(0, dateMs - Date.now()), MAX_RETRY_AFTER_MS);
}

function asSafeUsage(result: MetaResponseResult): SafeUsageMetadata {
  return {
    model: result.model,
    responseId: result.id,
    inputTokens: result.usage?.input_tokens ?? null,
    outputTokens: result.usage?.output_tokens ?? null,
    totalTokens: result.usage?.total_tokens ?? null,
    cachedInputTokens:
      result.usage?.input_tokens_details?.cached_tokens ?? null,
    durationMs: result.durationMs,
  };
}

export function createMetaClient(
  options: MetaClientOptions = {},
): MetaApiClient {
  const config = validateMetaConfig(
    options.config ?? readMetaConfig(options.env),
  );
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxRetries = Math.min(
    MAX_RETRIES,
    Math.max(0, Math.floor(options.maxRetries ?? MAX_RETRIES)),
  );
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const random = options.random ?? Math.random;
  let requestCount = 0;

  return {
    baseUrl: config.baseUrl,
    model: config.model,
    getRequestCount: () => requestCount,
    async createResponse(request, requestOptions = {}) {
      const startedAt = performance.now();
      let attempt = 0;

      for (;;) {
        if (
          options.maxTotalRequests !== undefined &&
          requestCount >= options.maxTotalRequests
        ) {
          throw new MetaApiError(
            "request_budget_exhausted",
            "The configured Meta test request limit has been reached.",
          );
        }
        requestCount += 1;

        let response: Response;
        let attemptSignal: AbortSignal | undefined;
        try {
          const timeoutSignal = AbortSignal.timeout(timeoutMs);
          const signal = requestOptions.signal
            ? AbortSignal.any([requestOptions.signal, timeoutSignal])
            : timeoutSignal;
          attemptSignal = signal;
          response = await fetchImpl(config.baseUrl + "/responses", {
            method: "POST",
            headers: {
              Authorization: "Bearer " + config.apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ ...request, model: config.model }),
            signal,
          });
        } catch {
          if (requestOptions.signal?.aborted) {
            throw new MetaApiError(
              "timeout",
              "Meta request was cancelled before completion.",
            );
          }
          const timedOut = attemptSignal?.aborted === true;
          if (attempt < maxRetries) {
            const delay = 200 * 2 ** attempt + Math.floor(random() * 100);
            attempt += 1;
            await sleep(delay);
            continue;
          }
          if (timedOut) {
            throw new MetaApiError("timeout", "Meta request timed out.", {
              retryable: true,
            });
          }
          throw new MetaApiError(
            "connection",
            "Could not connect to the Meta Model API.",
            { retryable: true },
          );
        }

        if (!response.ok) {
          const apiError = safeApiError(response.status);
          if (apiError.retryable && attempt < maxRetries) {
            const serverDelay = retryAfterMilliseconds(response);
            const delay =
              serverDelay ?? 200 * 2 ** attempt + Math.floor(random() * 100);
            attempt += 1;
            await sleep(delay);
            continue;
          }
          throw apiError;
        }

        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw new MetaApiError(
            "invalid_response",
            "Meta returned a response that was not valid JSON.",
            { status: response.status },
          );
        }

        const outputText = textFromResponse(payload);
        if (outputText === null) {
          throw new MetaApiError(
            "invalid_response",
            "Meta returned a response without readable output text.",
            { status: response.status },
          );
        }

        const responseRecord = isRecord(payload) ? payload : {};
        if (
          typeof responseRecord.model === "string" &&
          responseRecord.model !== config.model
        ) {
          throw new MetaApiError(
            "unexpected_model",
            "Meta returned an unexpected model ID; the result was rejected.",
          );
        }
        const usage = usageFromResponse(payload);
        const result: MetaResponseResult = {
          id: typeof responseRecord.id === "string" ? responseRecord.id : null,
          model:
            typeof responseRecord.model === "string"
              ? responseRecord.model
              : config.model,
          outputText,
          usage,
          durationMs: Math.round(performance.now() - startedAt),
        };

        try {
          options.onUsage?.(asSafeUsage(result));
        } catch {
          // Observability callbacks must not turn a successful model response into failure.
        }
        return result;
      }
    },
  };
}
