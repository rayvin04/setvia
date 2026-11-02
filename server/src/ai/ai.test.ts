import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  MetaApiError,
  MetaConfigurationError,
  InvalidImageError,
  InvalidModelOutputError,
} from "./errors.js";
import {
  createMetaClient,
  META_API_BASE_URL,
  META_SPARK_MODEL,
  readMetaConfig,
  type MetaApiClient,
  type MetaConfig,
  type MetaResponsesRequest,
  type MetaResponseResult,
} from "./meta-client.js";
import { extractPlanFromImage } from "./extract-image.js";
import { extractPlanFromText, parsePlanOutput } from "./extract-plan.js";
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  validatePlanningImage,
} from "./extract-image.js";
import { PlanExtractionSchema } from "./schemas.js";

const testConfig = {
  apiKey: "unit-test-key",
  baseUrl: META_API_BASE_URL,
  model: META_SPARK_MODEL,
} as const;

const successPayload = {
  id: "resp_test",
  model: META_SPARK_MODEL,
  output_text: "A short synthetic answer.",
  usage: {
    input_tokens: 8,
    output_tokens: 6,
    total_tokens: 14,
    input_tokens_details: { cached_tokens: 0 },
  },
};

function jsonResponse(value: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
      ...Object.fromEntries(new Headers(headers)),
    },
  });
}

function mockClient(
  outputText: string,
  inspect?: (request: MetaResponsesRequest) => void,
): MetaApiClient {
  let requestCount = 0;
  return {
    baseUrl: testConfig.baseUrl,
    model: testConfig.model,
    getRequestCount: () => requestCount,
    async createResponse(request): Promise<MetaResponseResult> {
      requestCount += 1;
      inspect?.(request);
      return {
        id: "mock_response",
        model: META_SPARK_MODEL,
        outputText,
        usage: null,
        durationMs: 0,
      };
    },
  };
}

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

test("configuration requires a key and pins Meta host plus Standard Spark", () => {
  assert.throws(() => readMetaConfig({}), MetaConfigurationError);
  assert.throws(
    () =>
      readMetaConfig({
        MODEL_API_KEY: "test",
        MODEL_API_BASE_URL: "https://example.invalid/v1",
      }),
    MetaConfigurationError,
  );
  assert.throws(
    () =>
      readMetaConfig({
        MODEL_API_KEY: "test",
        MODEL_SPARK: "muse-spark-1.3-contributor",
      }),
    MetaConfigurationError,
  );
  assert.deepEqual(readMetaConfig({ MODEL_API_KEY: " test " }), {
    apiKey: "test",
    baseUrl: META_API_BASE_URL,
    model: META_SPARK_MODEL,
  });
  assert.throws(
    () =>
      createMetaClient({
        config: {
          ...testConfig,
          baseUrl: "https://example.invalid/v1",
        } as unknown as MetaConfig,
      }),
    MetaConfigurationError,
  );
});

test("client uses the Responses endpoint and reports safe usage metadata", async () => {
  let requestUrl = "";
  let requestBody: Record<string, unknown> = {};
  let authorization = "";
  const metadata: unknown[] = [];
  const client = createMetaClient({
    config: testConfig,
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return jsonResponse(successPayload);
    },
    onUsage: (usage) => metadata.push(usage),
  });

  const result = await client.createResponse({ input: "small test request" });
  assert.equal(requestUrl, "https://api.meta.ai/v1/responses");
  assert.equal(client.baseUrl, META_API_BASE_URL);
  assert.equal(client.model, META_SPARK_MODEL);
  assert.equal("apiKey" in client, false);
  assert.equal(authorization, "Bearer unit-test-key");
  assert.equal(requestBody.model, META_SPARK_MODEL);
  assert.equal(result.outputText, "A short synthetic answer.");
  assert.equal(result.model, META_SPARK_MODEL);
  assert.equal(result.usage?.total_tokens, 14);
  assert.equal(client.getRequestCount(), 1);
  assert.equal((metadata[0] as { inputTokens: number }).inputTokens, 8);
});

test("401 errors do not expose upstream body content and are not retried", async () => {
  let attempts = 0;
  const client = createMetaClient({
    config: testConfig,
    fetchImpl: async () => {
      attempts += 1;
      return new Response(
        JSON.stringify({ error: { message: "private upstream detail" } }),
        { status: 401 },
      );
    },
  });

  await assert.rejects(
    client.createResponse({ input: "test" }),
    (error: unknown) => {
      assert.ok(error instanceof MetaApiError);
      assert.equal(error.code, "authentication");
      assert.equal(error.message.includes("private upstream detail"), false);
      assert.equal(error.message.includes(testConfig.apiKey), false);
      return true;
    },
  );
  assert.equal(attempts, 1);
});

test("response from a different model ID is rejected", async () => {
  const client = createMetaClient({
    config: testConfig,
    fetchImpl: async () =>
      jsonResponse({ ...successPayload, model: "muse-spark-1.3-contributor" }),
  });

  await assert.rejects(
    client.createResponse({ input: "test" }),
    (error: unknown) => {
      assert.ok(error instanceof MetaApiError);
      assert.equal(error.code, "unexpected_model");
      assert.equal(error.message.includes("contributor"), false);
      return true;
    },
  );
});

test("request timeout is enforced and reported safely", async () => {
  const client = createMetaClient({
    config: testConfig,
    timeoutMs: 5,
    maxRetries: 0,
    fetchImpl: (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      }),
  });

  await assert.rejects(
    client.createResponse({ input: "test" }),
    (error: unknown) => {
      assert.ok(error instanceof MetaApiError);
      assert.equal(error.code, "timeout");
      assert.equal(error.message.includes(testConfig.apiKey), false);
      return true;
    },
  );
});

test("429 and transient server errors retry with bounded attempts", async () => {
  let attempts = 0;
  const delays: number[] = [];
  const client = createMetaClient({
    config: testConfig,
    maxRetries: 2,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response("limited", {
          status: 429,
          headers: { "retry-after": "0" },
        });
      }
      if (attempts === 2) return new Response("busy", { status: 503 });
      return jsonResponse(successPayload);
    },
    random: () => 0,
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    },
  });

  const result = await client.createResponse({ input: "test" });
  assert.equal(result.outputText, "A short synthetic answer.");
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [0, 400]);
});

test("connection failures retry only to the configured limit", async () => {
  let attempts = 0;
  const client = createMetaClient({
    config: testConfig,
    maxRetries: 2,
    fetchImpl: async () => {
      attempts += 1;
      throw new TypeError("network details are not surfaced");
    },
    sleep: async () => undefined,
  });

  await assert.rejects(
    client.createResponse({ input: "test" }),
    (error: unknown) => {
      assert.ok(error instanceof MetaApiError);
      assert.equal(error.code, "connection");
      assert.equal(error.message.includes("network details"), false);
      return true;
    },
  );
  assert.equal(attempts, 3);
});

test("malformed API JSON is returned as a safe error", async () => {
  const client = createMetaClient({
    config: testConfig,
    fetchImpl: async () => new Response("{", { status: 200 }),
  });
  await assert.rejects(
    client.createResponse({ input: "test" }),
    (error: unknown) => {
      assert.ok(error instanceof MetaApiError);
      assert.equal(error.code, "invalid_response");
      return true;
    },
  );
});

test("structured extraction validates valid JSON and rejects malformed output", async () => {
  await assert.rejects(
    extractPlanFromText("A planning idea", mockClient("not JSON")),
    InvalidModelOutputError,
  );
  await assert.rejects(
    extractPlanFromText(
      "A planning idea",
      mockClient(JSON.stringify({ title: "Only title" })),
    ),
    InvalidModelOutputError,
  );
  await assert.rejects(
    extractPlanFromText("A planning idea", mockClient("{}")),
    InvalidModelOutputError,
  );
  await assert.rejects(extractPlanFromText("   ", mockClient("{}")), TypeError);
});

test("offline language fixtures preserve constraints and ambiguity in validated candidates", async () => {
  const fixtureUrl = new URL(
    "./fixtures/ambiguous-inputs.json",
    import.meta.url,
  );
  const fixtures = JSON.parse(await readFile(fixtureUrl, "utf8")) as Array<{
    name: string;
    input: string;
    expected: unknown;
  }>;
  assert.equal(fixtures.length, 5);

  for (const fixture of fixtures) {
    const outputText = JSON.stringify(fixture.expected);
    const plan = await extractPlanFromText(
      fixture.input,
      mockClient(outputText),
    );
    assert.equal(
      PlanExtractionSchema.safeParse(fixture.expected).success,
      true,
      fixture.name,
    );
    assert.deepEqual(plan, fixture.expected, fixture.name);
  }

  const tagalog = fixtures.find(
    (fixture) => fixture.name === "Tagalog school conflict",
  );
  assert.ok(tagalog);
  const tagalogPlan = parsePlanOutput(JSON.stringify(tagalog.expected));
  assert.equal(tagalogPlan.constraints[0]?.kind, "hard_requirement");
  assert.equal(tagalogPlan.location.value, null);

  const tentative = fixtures.find(
    (fixture) => fixture.name === "Tentative Sunday",
  );
  assert.ok(tentative);
  const tentativePlan = parsePlanOutput(JSON.stringify(tentative.expected));
  assert.equal(tentativePlan.dateOrDateRange.isAmbiguous, true);
  assert.equal(tentativePlan.location.value, null);

  const approximate = fixtures.find(
    (fixture) => fixture.name === "Approximate beach group plan",
  );
  assert.ok(approximate);
  const approximatePlan = parsePlanOutput(JSON.stringify(approximate.expected));
  assert.equal(approximatePlan.estimatedParticipants.value, 8);
  assert.equal(approximatePlan.estimatedParticipants.isApproximate, true);
  assert.equal(approximatePlan.budget.amount, 500);
  assert.equal(approximatePlan.budget.currency, "pesos");
  assert.equal(approximatePlan.budget.isPerPerson, true);
  assert.equal(approximatePlan.budget.isApproximate, true);
  assert.equal(approximatePlan.dateOrDateRange.isAmbiguous, true);
  assert.equal(approximatePlan.location.value, null);
});

test("planning image validation enforces type, signature, byte size, and pixel bounds", () => {
  assert.equal(
    validatePlanningImage({ bytes: pngHeader(120, 80), mimeType: "image/png" }),
    "image/png",
  );
  assert.throws(
    () =>
      validatePlanningImage({
        bytes: pngHeader(1, 1),
        mimeType: "image/svg+xml",
      }),
    InvalidImageError,
  );
  assert.throws(
    () =>
      validatePlanningImage({
        bytes: pngHeader(1, 1),
        mimeType: "image/jpeg",
      }),
    InvalidImageError,
  );
  assert.throws(
    () =>
      validatePlanningImage({
        bytes: new Uint8Array(MAX_IMAGE_BYTES + 1),
        mimeType: "image/png",
      }),
    InvalidImageError,
  );
  assert.throws(
    () =>
      validatePlanningImage({
        bytes: pngHeader(MAX_IMAGE_PIXELS + 1, 1),
        mimeType: "image/png",
      }),
    InvalidImageError,
  );
});

test("the synthetic planning screenshot is an accepted in-memory PNG", async () => {
  const imageUrl = new URL(
    "./fixtures/planning-screenshot.png",
    import.meta.url,
  );
  const bytes = new Uint8Array(await readFile(imageUrl));
  assert.equal(
    validatePlanningImage({ bytes, mimeType: "image/png" }),
    "image/png",
  );
});

test("image extraction sends an inline data URL to the injected client", async () => {
  let sawImageBlock = false;
  const client = mockClient("{}", (request) => {
    assert.ok(Array.isArray(request.input));
    const message = request.input[0];
    assert.ok(message && typeof message === "object" && "content" in message);
    const content = message.content;
    assert.equal(content[1]?.type, "input_image");
    if (content[1]?.type === "input_image") {
      assert.match(content[1].image_url, /^data:image\/png;base64,/);
      sawImageBlock = true;
    }
  });

  await assert.rejects(
    extractPlanFromImage(
      { bytes: pngHeader(32, 32), mimeType: "image/png" },
      client,
    ),
    InvalidModelOutputError,
  );
  assert.equal(sawImageBlock, true);
  assert.equal(client.getRequestCount(), 1);
});

test("a real-test request budget can include retries without exceeding its cap", async () => {
  const client = createMetaClient({
    config: testConfig,
    maxRetries: 2,
    maxTotalRequests: 2,
    fetchImpl: async () => new Response("busy", { status: 503 }),
    sleep: async () => undefined,
  });

  await assert.rejects(
    client.createResponse({ input: "test" }),
    (error: unknown) => {
      assert.ok(error instanceof MetaApiError);
      assert.equal(error.code, "request_budget_exhausted");
      return true;
    },
  );
  assert.equal(client.getRequestCount(), 2);
});
