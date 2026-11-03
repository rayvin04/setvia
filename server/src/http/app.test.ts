import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import {
  META_API_BASE_URL,
  META_SPARK_MODEL,
  type MetaApiClient,
  type MetaConfig,
  type MetaResponseResult,
  type MetaResponsesRequest,
} from "../ai/meta-client.js";
import { MetaApiError } from "../ai/errors.js";
import { MAX_IMAGE_BYTES } from "../ai/extract-image.js";
import type { PlanExtraction } from "../../../shared/plan-schema.js";
import { createApp } from "./app.js";

const validPlan: PlanExtraction = {
  title: "Fictional planning test",
  titleEvidence: null,
  eventType: "meeting",
  eventTypeEvidence: null,
  description: "A synthetic planning example.",
  descriptionEvidence: null,
  estimatedParticipants: {
    value: null,
    isApproximate: false,
    attendanceStatus: "unknown",
    evidence: null,
  },
  dateOrDateRange: {
    value: null,
    isRelative: false,
    isAmbiguous: false,
    evidence: null,
  },
  time: { value: null, isAmbiguous: false, evidence: null },
  duration: { value: null, isApproximate: false, evidence: null },
  location: {
    value: null,
    isConfirmed: false,
    evidence: null,
  },
  budget: {
    amount: null,
    currency: null,
    isPerPerson: null,
    isApproximate: false,
    evidence: null,
  },
  objective: { value: null, evidence: null },
  constraints: [],
  preferences: [],
  importantNotes: [],
  uncertainties: [],
  missingInformation: [],
  suggestedQuestions: [],
};

const config: MetaConfig = {
  apiKey: "never-exposed-test-key",
  baseUrl: META_API_BASE_URL,
  model: META_SPARK_MODEL,
};

function mockClient(
  outputText = JSON.stringify(validPlan),
  fail?: Error,
): { client: MetaApiClient; requests: MetaResponsesRequest[] } {
  const requests: MetaResponsesRequest[] = [];
  const client: MetaApiClient = {
    baseUrl: META_API_BASE_URL,
    model: META_SPARK_MODEL,
    getRequestCount: () => requests.length,
    async createResponse(request): Promise<MetaResponseResult> {
      requests.push(request);
      if (fail) throw fail;
      return {
        id: "response_mock",
        model: META_SPARK_MODEL,
        outputText,
        usage: null,
        durationMs: 1,
      };
    },
  };
  return { client, requests };
}

async function withServer<T>(
  app: ReturnType<typeof createApp>,
  action: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  try {
    return await action("http://127.0.0.1:" + address.port);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

test("text route calls the existing structured extractor and returns a validated plan", async () => {
  const { client, requests } = mockClient();
  await withServer(createApp({ client }), async (baseUrl) => {
    const response = await fetch(baseUrl + "/api/ai/extract/text", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "A fictional group meeting next week." }),
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual((await responseBody(response)).plan, validPlan);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.text?.format.type, "json_schema");
  });
});

test("standalone extraction cannot bypass the bounded room runtime's inference ledgers", async () => {
  const { client, requests } = mockClient();
  await withServer(createApp({ client, rooms: {} as never }), async (baseUrl) => {
    for (const path of ["text", "image"]) {
      const response = await fetch(`${baseUrl}/api/ai/extract/${path}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: "Do not bypass a room's exhausted budget." }),
      });
      assert.equal(response.status, 503);
      assert.match(String((await responseBody(response)).error), /Enter the starting plan manually/);
    }
    assert.equal(requests.length, 0);
  });
});

test("image route validates and sends an in-memory image block to the extractor", async () => {
  const { client, requests } = mockClient();
  const bytes = new Uint8Array(
    await readFile(new URL("../ai/fixtures/planning-screenshot.png", import.meta.url)),
  );

  await withServer(createApp({ client }), async (baseUrl) => {
    const response = await fetch(baseUrl + "/api/ai/extract/image", {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: bytes,
    });

    assert.equal(response.status, 200);
    assert.deepEqual((await responseBody(response)).plan, validPlan);
    assert.equal(requests.length, 1);
    const input = requests[0]?.input;
    assert.ok(Array.isArray(input));
    const content = input[0]?.content;
    assert.ok(content);
    assert.equal(content[1]?.type, "input_image");
    if (content[1]?.type === "input_image") {
      assert.match(content[1].image_url, /^data:image\/png;base64,/);
    }
  });
});

test("text route rejects empty input without calling Meta", async () => {
  const { client, requests } = mockClient();
  await withServer(createApp({ client }), async (baseUrl) => {
    const response = await fetch(baseUrl + "/api/ai/extract/text", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "   " }),
    });
    assert.equal(response.status, 400);
    assert.equal(requests.length, 0);
  });
});

test("image route rejects unsupported types, empty files, and invalid signatures", async () => {
  const { client, requests } = mockClient();
  await withServer(createApp({ client }), async (baseUrl) => {
    const unsupported = await fetch(baseUrl + "/api/ai/extract/image", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "not an image",
    });
    assert.equal(unsupported.status, 415);

    const empty = await fetch(baseUrl + "/api/ai/extract/image", {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: new Uint8Array(),
    });
    assert.equal(empty.status, 400);

    const invalid = await fetch(baseUrl + "/api/ai/extract/image", {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: new TextEncoder().encode("not a PNG"),
    });
    assert.equal(invalid.status, 400);
    assert.equal(requests.length, 0);
  });
});

test("image route enforces the byte limit before calling Meta", async () => {
  const { client, requests } = mockClient();
  await withServer(createApp({ client }), async (baseUrl) => {
    const response = await fetch(baseUrl + "/api/ai/extract/image", {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: new Uint8Array(MAX_IMAGE_BYTES + 1),
    });
    assert.equal(response.status, 413);
    assert.equal(requests.length, 0);
  });
});

test("Meta failures are sanitized and never return a key-like message or stack", async () => {
  const marker = "test-secret-should-never-escape";
  const { client } = mockClient("", new MetaApiError("authentication", marker));
  await withServer(createApp({ client }), async (baseUrl) => {
    const response = await fetch(baseUrl + "/api/ai/extract/text", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "A fictional plan." }),
    });
    const raw = await response.text();
    assert.equal(response.status, 503);
    assert.equal(raw.includes(marker), false);
    assert.equal(raw.includes("stack"), false);
  });
});

test("empty model output becomes a safe gateway error", async () => {
  const { client } = mockClient("");
  await withServer(createApp({ client }), async (baseUrl) => {
    const response = await fetch(baseUrl + "/api/ai/extract/text", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "A fictional plan." }),
    });
    assert.equal(response.status, 502);
    assert.deepEqual(await responseBody(response), {
      error: "The extracted details could not be validated. Try clearer source material.",
    });
  });
});

test("request rate limit bounds extraction calls per client address", async () => {
  const { client, requests } = mockClient();
  await withServer(
    createApp({
      client,
      rateLimit: { limit: 1, windowMs: 60_000, now: () => 1_000 },
    }),
    async (baseUrl) => {
      const request = () =>
        fetch(baseUrl + "/api/ai/extract/text", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ description: "A fictional plan." }),
        });
      assert.equal((await request()).status, 200);
      const limited = await request();
      assert.equal(limited.status, 429);
      assert.ok(limited.headers.has("retry-after"));
      assert.equal(requests.length, 1);
    },
  );
});

test("synthetic invitation image returns only stated celebration details", async () => {
  const plan: PlanExtraction = {
    ...validPlan,
    title: "Alex’s Birthday Party",
    titleEvidence: "Alex’s Birthday Party",
    eventType: "celebration",
    eventTypeEvidence: "YOU’RE INVITED",
    description: "Alex’s birthday party invitation.",
    descriptionEvidence: "YOU’RE INVITED",
    dateOrDateRange: { value: "November 14, 2026", isRelative: false, isAmbiguous: false, evidence: "November 14, 2026" },
    time: { value: "6:00 PM", isAmbiguous: false, evidence: "6:00 PM" },
    location: { value: "Sunset Garden, Naga City", isConfirmed: true, evidence: "Sunset Garden · Naga City" },
  };
  const { client, requests } = mockClient(JSON.stringify(plan));
  const bytes = new Uint8Array(await readFile(new URL("../ai/fixtures/synthetic-invitation.png", import.meta.url)));

  await withServer(createApp({ client }), async (baseUrl) => {
    const response = await fetch(baseUrl + "/api/ai/extract/image", {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: bytes,
    });
    assert.equal(response.status, 200);
    const result = (await responseBody(response)).plan as PlanExtraction;
    assert.equal(result.eventType, "celebration");
    assert.equal(result.dateOrDateRange.value, "November 14, 2026");
    assert.equal(result.time.value, "6:00 PM");
    assert.equal(result.location.value, "Sunset Garden, Naga City");
    assert.equal(result.estimatedParticipants.value, null);
    assert.equal(result.budget.amount, null);
    assert.equal(requests.length, 1);
  });
});
