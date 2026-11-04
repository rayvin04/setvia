import { z } from "zod";
import { PlanExtractionSchema, type PlanExtraction } from "../shared/plan-schema.js";
import { apiEndpoint } from "./api-url";

export class PlanApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanApiError";
  }
}

export type FetchLike = typeof fetch;

const RESPONSE_SCHEMA = z.object({ plan: PlanExtractionSchema }).strict();
function messageForStatus(status: number): string {
  switch (status) {
    case 400:
      return "Check the plan details and try again.";
    case 413:
      return "That image is larger than the 5 MiB limit.";
    case 415:
      return "Choose a PNG, JPEG, or WebP image.";
    case 429:
      return "Setvia or Meta is handling too many requests. Wait a moment and try again.";
    case 503:
      return "AI plan autofill is unavailable for this session. Enter the plan manually; Setvia will analyze the live room conversation.";
    case 504:
      return "Muse Spark took too long to respond. Try again.";
    case 502:
      return "Muse Spark could not return complete planning details. Try again.";
    default:
      return "Setvia could not complete the extraction. Try again.";
  }
}

async function parseResponse(response: Response): Promise<PlanExtraction> {
  if (!response.ok) {
    throw new PlanApiError(messageForStatus(response.status));
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new PlanApiError("Setvia received an unreadable response. Try again.");
  }

  const parsed = RESPONSE_SCHEMA.safeParse(payload);
  if (!parsed.success) {
    throw new PlanApiError("Setvia received incomplete planning details. Try again.");
  }
  return parsed.data.plan;
}

function defaultFetch(): FetchLike {
  return globalThis.fetch.bind(globalThis);
}

export async function extractPlanFromText(
  description: string,
  fetcher: FetchLike = defaultFetch(),
): Promise<PlanExtraction> {
  try {
    const response = await fetcher(apiEndpoint("/ai/extract/text"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description }),
    });
    return await parseResponse(response);
  } catch (error) {
    if (error instanceof PlanApiError) throw error;
    throw new PlanApiError(
      "Could not reach Setvia. Check your connection and try again.",
    );
  }
}

export async function extractPlanFromImage(
  image: Blob,
  fetcher: FetchLike = defaultFetch(),
): Promise<PlanExtraction> {
  try {
    const response = await fetcher(apiEndpoint("/ai/extract/image"), {
      method: "POST",
      headers: { "Content-Type": image.type },
      body: image,
    });
    return await parseResponse(response);
  } catch (error) {
    if (error instanceof PlanApiError) throw error;
    throw new PlanApiError(
      "Could not reach Setvia. Check your connection and try again.",
    );
  }
}
