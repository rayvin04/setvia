import { readFile } from "node:fs/promises";
import {
  createMetaClient,
  readMetaConfig,
} from "../server/src/ai/meta-client.js";
import { extractPlanFromImage } from "../server/src/ai/extract-image.js";
import { extractPlanFromText } from "../server/src/ai/extract-plan.js";
import type { SafeUsageMetadata } from "../server/src/ai/meta-client.js";

const INPUT_PRICE_PER_MILLION = 1.25;
const CACHED_INPUT_PRICE_PER_MILLION = 0.15;
const OUTPUT_PRICE_PER_MILLION = 4.25;
const PRICE_SNAPSHOT_DATE = "2026-11-03";

function reportChecks(
  title: string,
  checks: Array<{ name: string; passed: boolean }>,
): void {
  console.log(title);
  for (const check of checks) {
    console.log((check.passed ? "PASS " : "REVIEW ") + check.name);
  }
  const failed = checks.filter((check) => !check.passed);
  if (failed.length > 0) {
    throw new Error(
      title +
        " did not match the known synthetic inputs: " +
        failed.map((check) => check.name).join(", "),
    );
  }
}

function formatUsage(metadata: SafeUsageMetadata): string {
  const parts = [
    "model=" + metadata.model,
    "duration=" + metadata.durationMs + "ms",
    "input_tokens=" + (metadata.inputTokens ?? "unavailable"),
    "output_tokens=" + (metadata.outputTokens ?? "unavailable"),
  ];
  if (metadata.cachedInputTokens !== null) {
    parts.push("cached_input_tokens=" + metadata.cachedInputTokens);
  }
  if (metadata.inputTokens !== null && metadata.outputTokens !== null) {
    const cached = Math.min(
      metadata.cachedInputTokens ?? 0,
      metadata.inputTokens,
    );
    const standardInput = metadata.inputTokens - cached;
    const estimate =
      (standardInput * INPUT_PRICE_PER_MILLION +
        cached * CACHED_INPUT_PRICE_PER_MILLION +
        metadata.outputTokens * OUTPUT_PRICE_PER_MILLION) /
      1_000_000;
    parts.push(
      "published_price_estimate_" +
        PRICE_SNAPSHOT_DATE +
        "=$" +
        estimate.toFixed(6),
    );
  } else {
    parts.push("published_price_estimate=unavailable");
  }
  return parts.join(", ");
}

function boundedTestSetting(
  name: string,
  fallback: number,
  maximum: number,
  minimum = 0,
): number {
  const configured = process.env[name];
  const value = configured === undefined ? fallback : Number(configured);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(name + " must be an integer from " + minimum + " to " + maximum + ".");
  }
  return value;
}

async function main(): Promise<void> {
  const config = readMetaConfig();
  if (process.env.META_TESTS_BILLING_CHECKED !== "1") {
    throw new Error(
      "Before live calls, review your Meta Model API billing, available credits, and team limits. After that review, set META_TESTS_BILLING_CHECKED=1 for this command.",
    );
  }

  const usage: SafeUsageMetadata[] = [];
  const maxRetries = boundedTestSetting("META_TESTS_MAX_RETRIES", 1, 1);
  const maxTotalRequests = boundedTestSetting("META_TESTS_MAX_REQUESTS", 4, 4, 1);
  const client = createMetaClient({
    config,
    maxRetries,
    maxTotalRequests,
    onUsage: (metadata) => {
      usage.push(metadata);
      console.log(formatUsage(metadata));
    },
  });

  try {
    const smoke = await client.createResponse({
      instructions:
        "Give exactly three concise clarification questions. Do not use tools or web search.",
      reasoning: { effort: "minimal" },
      input: [
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Suggest three important questions to clarify a weekend beach trip.",
            },
          ],
        },
      ],
      max_output_tokens: 2048,
    });
    console.log("Connectivity smoke test");
    console.log("Endpoint: " + config.baseUrl + "/responses");
    console.log("Model: " + smoke.model + " (Standard)");
    console.log(smoke.outputText);
    if (client.getRequestCount() >= maxTotalRequests) {
      console.log("Structured extraction skipped: no HTTP request budget remains.");
      return;
    }

    const plan = await extractPlanFromText(
      "Our friends want to go to the beach next weekend. Maybe 8 people are coming. Some have school on Saturday, and the budget is around 500 pesos each. We haven't decided on a location.",
      client,
    );
    console.log("Structured planning extraction");
    console.log(JSON.stringify(plan, null, 2));
    const schoolConstraint = plan.constraints.some(
      (item) =>
        item.kind === "hard_requirement" &&
        /saturday/i.test(item.description + " " + (item.evidence ?? "")),
    );
    reportChecks("Text extraction comparison", [
      {
        name: "about 8 participants preserved as approximate",
        passed:
          plan.estimatedParticipants.value === 8 &&
          plan.estimatedParticipants.isApproximate,
      },
      {
        name: "next weekend preserved as relative and ambiguous",
        passed:
          (plan.dateOrDateRange.value ?? "")
            .toLowerCase()
            .includes("next weekend") &&
          plan.dateOrDateRange.isRelative &&
          plan.dateOrDateRange.isAmbiguous,
      },
      {
        name: "undecided location left unknown",
        passed: plan.location.value === null && !plan.location.isConfirmed,
      },
      {
        name: "around 500 pesos each preserved as approximate per-person budget",
        passed:
          plan.budget.amount === 500 &&
          plan.budget.currency !== null &&
          plan.budget.isPerPerson === true &&
          plan.budget.isApproximate,
      },
      {
        name: "Saturday school note kept as a hard constraint",
        passed: schoolConstraint,
      },
    ]);

    if (client.getRequestCount() >= maxTotalRequests) {
      console.log("Screenshot extraction skipped: no HTTP request budget remains.");
      return;
    }
    const imageUrl = new URL(
      "../server/src/ai/fixtures/planning-screenshot.png",
      import.meta.url,
    );
    const imageBytes = new Uint8Array(await readFile(imageUrl));
    const imagePlan = await extractPlanFromImage(
      { bytes: imageBytes, mimeType: "image/png" },
      client,
    );
    console.log("Synthetic screenshot extraction");
    console.log(JSON.stringify(imagePlan, null, 2));
    const imageDetails = [...imagePlan.constraints, ...imagePlan.preferences];
    const hasDriveNote = imageDetails.some((item) =>
      /drive|driver/i.test(item.description + " " + (item.evidence ?? "")),
    );
    const hasSaturdayRestriction = imagePlan.constraints.some(
      (item) =>
        item.kind === "hard_requirement" &&
        /saturday/i.test(item.description + " " + (item.evidence ?? "")) &&
        /unavailable|not available|can't|cannot|isn't/i.test(
          item.description + " " + (item.evidence ?? ""),
        ),
    );
    reportChecks("Screenshot extraction comparison", [
      {
        name: "Sunday option identified as uncertain",
        passed:
          (imagePlan.dateOrDateRange.value ?? "")
            .toLowerCase()
            .includes("sunday") && imagePlan.dateOrDateRange.isAmbiguous,
      },
      {
        name: "₱500 spending limit extracted",
        passed: imagePlan.budget.amount === 500,
      },
      { name: "driving note extracted", passed: hasDriveNote },
      {
        name: "Saturday unavailability kept as a hard constraint",
        passed: hasSaturdayRestriction,
      },
      {
        name: "undecided destination left unknown",
        passed:
          imagePlan.location.value === null && !imagePlan.location.isConfirmed,
      },
    ]);
  } finally {
    console.log(
      "Real Meta API HTTP request attempts: " +
        client.getRequestCount() +
        " (maximum " + maxTotalRequests + " this run, including retries).",
    );
  }
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Meta integration test failed.";
  console.error("Meta integration test stopped: " + message);
  process.exitCode = 1;
});
