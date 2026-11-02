import express, {
  type ErrorRequestHandler,
  type Request,
  type Response,
} from "express";
import { z } from "zod";
import {
  InvalidImageError,
  InvalidModelOutputError,
  MetaApiError,
  MetaConfigurationError,
} from "../ai/errors.js";
import { extractPlanFromImage } from "../ai/extract-image.js";
import { extractPlanFromText } from "../ai/extract-plan.js";
import {
  MAX_IMAGE_BYTES,
  type SupportedImageType,
} from "../ai/extract-image.js";
import type { MetaApiClient } from "../ai/meta-client.js";

const TextRequestSchema = z
  .object({
    description: z.string().trim().min(1).max(8_000),
  })
  .strict();

const IMAGE_TYPES = new Set<SupportedImageType>([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

interface RateWindow {
  expiresAt: number;
  count: number;
}

export interface AppOptions {
  client: MetaApiClient;
  rateLimit?: {
    limit?: number;
    windowMs?: number;
    now?: () => number;
  };
}

function createRateLimiter(
  limit: number,
  windowMs: number,
  now: () => number,
) {
  const windows = new Map<string, RateWindow>();

  return (request: Request, response: Response, next: (error?: unknown) => void) => {
    const key = request.ip || request.socket.remoteAddress || "unknown";
    const current = now();
    let window = windows.get(key);

    if (!window || window.expiresAt <= current) {
      window = { expiresAt: current + windowMs, count: 0 };
      windows.set(key, window);
    }

    if (window.count >= limit) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((window.expiresAt - current) / 1_000),
      );
      response.setHeader("Retry-After", String(retryAfterSeconds));
      response.status(429).json({
        error: "Too many extraction requests. Please wait before trying again.",
      });
      return;
    }

    window.count += 1;
    next();
  };
}

function parserError(error: unknown): { status: number; message: string } | null {
  if (typeof error !== "object" || error === null || !("type" in error)) {
    return null;
  }

  const type = (error as { type?: unknown }).type;
  if (type === "entity.too.large") {
    return { status: 413, message: "The request is larger than the allowed limit." };
  }
  if (type === "entity.parse.failed") {
    return { status: 400, message: "The request body must be valid JSON." };
  }
  return null;
}

function safeFailure(error: unknown): { status: number; message: string } {
  const parsing = parserError(error);
  if (parsing) return parsing;

  if (error instanceof InvalidImageError) {
    return { status: 400, message: error.message };
  }
  if (error instanceof InvalidModelOutputError) {
    return {
      status: 502,
      message: "The extracted details could not be validated. Try clearer source material.",
    };
  }
  if (error instanceof MetaConfigurationError) {
    return {
      status: 503,
      message: "Meta extraction is not configured on this server.",
    };
  }
  if (error instanceof MetaApiError) {
    switch (error.code) {
      case "authentication":
      case "forbidden":
        return { status: 503, message: "Meta extraction is not available for this server." };
      case "rate_limit":
      case "request_budget_exhausted":
        return { status: 429, message: "Meta is busy. Please wait and try again." };
      case "timeout":
        return { status: 504, message: "Meta took too long to respond. Please try again." };
      case "connection":
      case "server":
      case "not_found":
      case "invalid_response":
      case "unexpected_model":
        return {
          status: 502,
          message: "Meta could not return a complete planning extraction. Please try again.",
        };
      case "request":
        return { status: 400, message: "Meta could not process this request." };
      default:
        return { status: 502, message: "Planning extraction failed. Please try again." };
    }
  }

  if (error instanceof z.ZodError) {
    return { status: 400, message: "Check the planning details and try again." };
  }

  return { status: 500, message: "Something went wrong. Your draft is still in this browser." };
}

export function createApp(options: AppOptions) {
  const app = express();
  const limit = options.rateLimit?.limit ?? 10;
  const windowMs = options.rateLimit?.windowMs ?? 60_000;
  const now = options.rateLimit?.now ?? Date.now;

  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cache-Control", "no-store");
    next();
  });

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.use("/api/ai", createRateLimiter(limit, windowMs, now));

  app.post(
    "/api/ai/extract/text",
    express.json({ limit: "40kb", strict: true }),
    async (request, response) => {
      const parsed = TextRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({
          error: "Enter a description of up to 8,000 characters.",
        });
        return;
      }

      const plan = await extractPlanFromText(
        parsed.data.description,
        options.client,
      );
      response.json({ plan });
    },
  );

  app.post(
    "/api/ai/extract/image",
    express.raw({
      type: [...IMAGE_TYPES],
      limit: MAX_IMAGE_BYTES,
    }),
    async (request, response) => {
      const mimeType = (request.header("content-type") ?? "")
        .split(";")[0]
        ?.trim()
        .toLowerCase();

      if (!IMAGE_TYPES.has(mimeType as SupportedImageType)) {
        response.status(415).json({
          error: "Use a PNG, JPEG, or WebP image.",
        });
        return;
      }
      if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
        response.status(400).json({ error: "Choose a readable image first." });
        return;
      }

      const plan = await extractPlanFromImage(
        {
          bytes: new Uint8Array(request.body),
          mimeType,
        },
        options.client,
      );
      response.json({ plan });
    },
  );

  app.use("/api", (_request, response) => {
    response.status(404).json({ error: "API route not found." });
  });

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    const failure = safeFailure(error);
    response.status(failure.status).json({ error: failure.message });
  };
  app.use(errorHandler);

  return app;
}