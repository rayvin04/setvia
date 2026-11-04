import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildReceiptImagePrompt,
  generateReceiptImage,
  MuseImageError,
  MUSE_IMAGE_MODEL,
} from "./muse-image.js";

const webp = Buffer.from("RIFF0000WEBP", "ascii");

test("receipt image prompts map shared event labels to broad scenes without copying names", () => {
  const beach = buildReceiptImagePrompt(
    "trip planning",
    "Weekend Beach outing · Villa Corabuddies",
  );
  assert.match(beach, /relaxed beach outing/);
  assert.match(beach, /rounded, expressive shapes/);
  assert.match(beach, /Do not depict, reuse, or copy the cat mascot/);
  assert.doesNotMatch(beach, /Villa Corabuddies|Weekend Beach outing/i);

  const mountain = buildReceiptImagePrompt(
    "trip planning",
    "Mount Mayon outing with friends",
  );
  assert.match(mountain, /outdoor adventure/);
  assert.doesNotMatch(mountain, /Mount Mayon|friends/i);
});

test("Muse Image request is server-owned, one-shot, tool-disabled, and validates WebP", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const result = await generateReceiptImage("trip planning", {
    proposalLabel: "Weekend Beach outing",
    apiKey: "test-only-key",
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify({
        data: [{ b64_json: webp.toString("base64") }],
        output_format: "webp",
      }), { headers: { "content-type": "application/json" } });
    },
  });

  assert.deepEqual(result, webp);
  assert.equal(requestUrl, "https://api.meta.ai/v1/images/generations");
  assert.equal(new Headers(requestInit?.headers).get("authorization"), "Bearer test-only-key");
  const body = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
  assert.equal(body.model, MUSE_IMAGE_MODEL);
  assert.equal(body.n, 1);
  assert.equal(body.response_format, "b64_json");
  assert.equal(body.output_format, "webp");
  assert.equal(body.reasoning_strength, "low");
  assert.deepEqual(body.tool_enablement, {
    enable_image_search: false,
    enable_web_search: false,
    enable_shell: false,
  });
});

test("receipt image generation fails closed without a credential and maps provider errors", async () => {
  let requests = 0;
  await assert.rejects(
    generateReceiptImage("trip planning", {
      apiKey: "",
      fetchImpl: async () => {
        requests++;
        return new Response("{}", { status: 200 });
      },
    }),
    (error: unknown) => error instanceof MuseImageError && error.code === "not_configured",
  );
  assert.equal(requests, 0);

  await assert.rejects(
    generateReceiptImage("trip planning", {
      apiKey: "test-only-key",
      fetchImpl: async () => new Response("{}", { status: 503 }),
    }),
    (error: unknown) => error instanceof MuseImageError && error.code === "provider" && error.httpStatus === 503,
  );
});

test("receipt image output rejects a non-WebP payload", async () => {
  const invalid = Buffer.from("not an image", "utf8");
  await assert.rejects(
    generateReceiptImage("trip planning", {
      apiKey: "test-only-key",
      fetchImpl: async () => new Response(JSON.stringify({
        data: [{ b64_json: invalid.toString("base64") }],
        output_format: "webp",
      })),
    }),
    (error: unknown) => error instanceof MuseImageError && error.code === "invalid_response",
  );
});
