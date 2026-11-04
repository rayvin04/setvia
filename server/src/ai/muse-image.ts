import { z } from "zod";
import { META_API_BASE_URL } from "./meta-client.js";

export const MUSE_IMAGE_MODEL = "muse-image-1.0" as const;
export const MAX_RECEIPT_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 90_000;

const ImageResponseSchema = z
  .object({
    data: z.array(z.object({ b64_json: z.string().min(1).max(MAX_RESPONSE_BYTES) }).passthrough()).length(1),
    output_format: z.literal("webp"),
  })
  .passthrough();

export type MuseImageFailure = "not_configured" | "provider" | "transport" | "invalid_response";

export class MuseImageError extends Error {
  constructor(
    readonly code: MuseImageFailure,
    readonly httpStatus: number | null = null,
  ) {
    super("Meta image generation did not return a usable image.");
    this.name = "MuseImageError";
  }
}

export function isMuseImageConfigured(apiKey?: string) {
  return Boolean((apiKey ?? process.env.MODEL_API_KEY)?.trim());
}

function safeEventTheme(eventType: string, proposalLabel: string) {
  // The raw strings never enter the prompt. Use a small keyword map to keep
  // scene selection useful while stripping names, venues, and prompt text.
  const label = [eventType, proposalLabel]
    .join(" ")
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");

  if (/\b(beach|ocean|shore|swim|pool)\b/.test(label)) return "a relaxed beach outing";
  if (/\b(hik(e|ing)|trail|camp(ing)?|outdoor|nature|mount(ain)?|ski|snow)\b/.test(label)) return "an outdoor adventure";
  if (/\b(dinner|lunch|brunch|restaurant|meal|food)\b/.test(label)) return "a shared meal";
  if (/\b(meeting|workshop|presentation|conference|class)\b/.test(label)) return "a collaborative group meeting";
  if (/\b(travel|trip|road trip|vacation|holiday)\b/.test(label)) return "a group trip";
  if (/\b(birthday|party|celebration)\b/.test(label)) return "a group celebration";
  return "a friendly group gathering";
}

export function buildReceiptImagePrompt(eventType: string, proposalLabel = "") {
  const theme = safeEventTheme(eventType, proposalLabel);
  return [
    "Create one original, polished landscape illustration for a group planning decision receipt.",
    `The visual theme is ${theme}.`,
    "Use the friendly illustrated visual language of Setvia's mascot: rounded, expressive shapes, a deep blue-black background, and Setvia orange and cyan accents.",
    "Make the event setting the subject. Do not depict, reuse, or copy the cat mascot; avoid recognizable people.",
    "Do not include text, letters, numbers, logos, brands, names, or exact locations.",
  ].join(" ");
}

async function readBoundedBody(response: Response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new MuseImageError("invalid_response", response.status);
  }
  if (!response.body) throw new MuseImageError("invalid_response", response.status);

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        throw new MuseImageError("invalid_response", response.status);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}

export async function generateReceiptImage(
  eventType: string,
  options: {
    proposalLabel?: string;
    apiKey?: string;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
  } = {},
) {
  const apiKey = (options.apiKey ?? process.env.MODEL_API_KEY)?.trim();
  if (!apiKey) throw new MuseImageError("not_configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    let response: Response;
    try {
      response = await (options.fetchImpl ?? fetch)(`${META_API_BASE_URL}/images/generations`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          model: MUSE_IMAGE_MODEL,
          prompt: buildReceiptImagePrompt(eventType, options.proposalLabel ?? ""),
          n: 1,
          size: "1536x1024",
          response_format: "b64_json",
          output_format: "webp",
          reasoning_strength: "low",
          tool_enablement: {
            enable_image_search: false,
            enable_web_search: false,
            enable_shell: false,
          },
        }),
        signal: controller.signal,
      });
    } catch {
      throw new MuseImageError("transport");
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new MuseImageError("provider", response.status);
    }

    const bytes = await readBoundedBody(response);
    let payload: unknown;
    try {
      payload = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new MuseImageError("invalid_response", response.status);
    }

    const parsed = ImageResponseSchema.safeParse(payload);
    if (!parsed.success) throw new MuseImageError("invalid_response", response.status);
    const encoded = parsed.data.data[0]!.b64_json;
    const image = Buffer.from(encoded, "base64");
    if (
      image.length < 12 ||
      image.length > MAX_RECEIPT_IMAGE_BYTES ||
      image.toString("base64") !== encoded ||
      image.toString("ascii", 0, 4) !== "RIFF" ||
      image.toString("ascii", 8, 12) !== "WEBP"
    )
      throw new MuseImageError("invalid_response", response.status);

    return image;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
