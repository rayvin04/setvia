import express, {
  type ErrorRequestHandler,
  type Request,
  type RequestHandler,
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
import { StateError } from "../agents/store.js";
import { assertPlanningScope, PLANNING_REDIRECT, PlanningScopeError } from "../ai/planning-scope.js";
import {
  ApproveProposalRequestSchema,
  CreateRoomRequestSchema,
  JoinRoomRequestSchema,
  LeaveRoomRequestSchema,
  ReviseProposalRequestSchema,
  RetryAnalysisRequestSchema,
  ShareCandidateRequestSchema,
  SubmitRoomMessageSchema,
} from "../../../shared/room-api.js";
import { roomAuthFromHeaders, roomErrorStatus, type RoomRuntime } from "../rooms/runtime.js";

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
  meteredExtractionClient?: MetaApiClient;
  rooms?: RoomRuntime | null;
  roomOrigins?: string[];
  trustProxy?: boolean | number | string;
  demoScenarioRouter?: RequestHandler;
  playgroundRouter?: RequestHandler;
  recordedDemoRouter?: RequestHandler;
  inferenceEnabled?: () => boolean;
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
  if (error instanceof PlanningScopeError) {
    return { status: 422, message: PLANNING_REDIRECT };
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
  if (error instanceof StateError) {
    return {
      status: roomErrorStatus(error.code),
      message: roomErrorMessage(error.code),
    };
  }
  if (error instanceof MetaApiError) {
    switch (error.code) {
      case "authentication":
      case "forbidden":
        return { status: 503, message: "Meta extraction is not available for this server." };
      case "rate_limit":
        return { status: 429, message: "Meta is busy. Please wait and try again." };
      case "request_limit":
        return { status: 503, message: "Planning inference needs to restart. Please try again." };
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
      case "accounting":
        return { status: 503, message: "The planning service could not record this request. Please try again." };
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

function roomErrorMessage(code: string) {
  const messages: Record<string, string> = {
    UNAUTHORIZED: "This room invitation or participant session is invalid.",
    UNAUTHORIZED_ANSWER: "This question is not available to your participant session.",
    PRIVATE_ANSWER_REQUIRED: "This question must be answered privately.",
    STALE_STATE: "The room changed. Review the latest plan and try again.",
    STALE_PROPOSAL: "That proposal version has changed. Review the latest version.",
    REVIEW_NOT_READY: "The current plan is not ready for human approval yet.",
    ROOM_NOT_FOUND: "This planning room could not be found.",
    CANDIDATE_NOT_FOUND: "That private suggestion is no longer available.",
    INPUT_QUEUE_LIMIT: "Setvia is still processing earlier responses. Try again shortly.",
    RESPONSE_LIMIT: "This room has reached its response limit.",
    PARTICIPANT_COOLDOWN: "Please wait a moment before sending another planning response.",
  };
  return messages[code] ?? "This room action could not be completed.";
}

function sendRoomFailure(response: Response, error: unknown) {
  const failure = safeFailure(error);
  response.status(failure.status).json({ error: failure.message });
}

export function createApp(options: AppOptions) {
  const app = express();
  const limit = options.rateLimit?.limit ?? 10;
  const windowMs = options.rateLimit?.windowMs ?? 60_000;
  const now = options.rateLimit?.now ?? Date.now;

  app.disable("x-powered-by");
  if (options.trustProxy !== undefined) app.set("trust proxy", options.trustProxy);
  app.use((_request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cache-Control", "no-store");
    next();
  });

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  const allowedBrowserOrigins = new Set(
    options.roomOrigins ?? [
      "http://127.0.0.1:5173",
      "http://localhost:5173",
      "http://127.0.0.1:4176",
    ],
  );
  const restrictBrowserOrigin = (request: Request, response: Response, next: (error?: unknown) => void) => {
    const origin = request.header("origin");
    if (origin && !allowedBrowserOrigins.has(origin)) {
      response.status(403).json({ error: "This browser origin cannot access the planning API." });
      return;
    }
    if (origin) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
      response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Setvia-Participant, Last-Event-ID");
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }
    if (request.method === "OPTIONS") {
      response.status(204).end();
      return;
    }
    next();
  };
  app.use("/api/rooms", restrictBrowserOrigin);
  app.use("/api/ai", restrictBrowserOrigin);
  app.use("/api/playground", restrictBrowserOrigin);
  app.use("/api/demo/recordings", restrictBrowserOrigin);
  if (options.recordedDemoRouter) app.use("/api/demo/recordings", options.recordedDemoRouter);
  if (options.playgroundRouter) app.use("/api/playground", options.playgroundRouter);
  app.get("/api/rooms/health", async (_request, response) => {
    const health = {
      enabled: Boolean(options.rooms),
      mode: options.rooms?.inferenceMode === "MOCK"
        ? "offline-mock"
        : options.rooms?.demoMode
          ? "synthetic-live-demo"
          : options.rooms
            ? "local-live"
            : "unavailable",
    } as const;
    response.json(
      process.env.NODE_ENV === "production" || !options.rooms
        ? health
        : { ...health, budget: await options.rooms.budget },
    );
  });
  app.use("/api/rooms", createRateLimiter(40, 60_000, now));
  app.use("/api/rooms", express.json({ limit: "24kb", strict: true }));

  app.post("/api/rooms", createRateLimiter(3, 60 * 60_000, now), async (request, response) => {
    if (!options.rooms) return response.status(503).json({ error: "Local real-time planning is not configured on this server." });
    const parsed = CreateRoomRequestSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Add a valid event name and starting plan." });
    try {
      response.status(201).json(await options.rooms.create(parsed.data, parsed.data.creatorName));
    } catch (error) { sendRoomFailure(response, error); }
  });

  app.post("/api/rooms/:roomId/join", async (request, response) => {
    if (!options.rooms) return response.status(503).json({ error: "Local real-time planning is not configured on this server." });
    const roomId = request.params.roomId;
    const parsed = JoinRoomRequestSchema.safeParse(request.body);
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(roomId ?? "") || !parsed.success)
      return response.status(400).json({ error: "Check the room link and participant name." });
    try { response.status(201).json(await options.rooms.join(roomId!, parsed.data.invitation, parsed.data.name)); }
    catch (error) { sendRoomFailure(response, error); }
  });

  app.get("/api/rooms/:roomId/events", async (request, response) => {
    if (!options.rooms) return response.status(503).json({ error: "Local real-time planning is not configured on this server." });
    const roomId = request.params.roomId;
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(roomId ?? "")) return response.status(400).json({ error: "Invalid room link." });
    try {
      const auth = roomAuthFromHeaders(request.headers as Record<string, unknown>);
      await options.rooms.rooms.view(roomId!, auth);
      await options.rooms.events.subscribe(roomId!, auth, response);
    } catch (error) {
      if (!response.headersSent) sendRoomFailure(response, error);
      else response.end();
    }
  });

  app.get("/api/rooms/:roomId", async (request, response) => {
    if (!options.rooms) return response.status(503).json({ error: "Local real-time planning is not configured on this server." });
    const roomId = request.params.roomId;
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(roomId ?? "")) return response.status(400).json({ error: "Invalid room link." });
    try {
      const auth = roomAuthFromHeaders(request.headers as Record<string, unknown>);
      response.json(await options.rooms.snapshot(roomId!, auth));
    } catch (error) { sendRoomFailure(response, error); }
  });

  app.post<{ roomId: string }>("/api/rooms/:roomId/messages", createRateLimiter(12, 60_000, now), async (request, response) => {
    if (!options.rooms) return response.status(503).json({ error: "Local real-time planning is not configured on this server." });
    const roomId = request.params.roomId;
    const parsed = SubmitRoomMessageSchema.safeParse(request.body);
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(roomId ?? "") || !parsed.success)
      return response.status(400).json({ error: "That response does not match the current room question." });
    try {
      const auth = roomAuthFromHeaders(request.headers as Record<string, unknown>);
      response.status(201).json(await options.rooms.submit(roomId!, auth, parsed.data));
    } catch (error) { sendRoomFailure(response, error); }
  });

  app.post("/api/rooms/:roomId/candidates/:candidateId/share", async (request, response) => {
    if (!options.rooms) return response.status(503).json({ error: "Local real-time planning is not configured on this server." });
    const { roomId, candidateId } = request.params;
    const parsed = ShareCandidateRequestSchema.safeParse({ ...request.body, candidateId });
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(roomId ?? "") || !parsed.success)
      return response.status(400).json({ error: "That suggestion is no longer available." });
    try {
      const auth = roomAuthFromHeaders(request.headers as Record<string, unknown>);
      response.json(await options.rooms.shareCandidate(roomId!, auth, parsed.data.expectedRevision, parsed.data.candidateId));
    } catch (error) { sendRoomFailure(response, error); }
  });

  app.post("/api/rooms/:roomId/proposal", async (request, response) => {
    if (!options.rooms) return response.status(503).json({ error: "Local real-time planning is not configured on this server." });
    const roomId = request.params.roomId;
    const parsed = ReviseProposalRequestSchema.safeParse(request.body);
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(roomId ?? "") || !parsed.success)
      return response.status(400).json({ error: "Check the proposal details and try again." });
    try {
      const auth = roomAuthFromHeaders(request.headers as Record<string, unknown>);
      response.json(await options.rooms.revise(roomId!, auth, parsed.data.expectedRevision, parsed.data.proposal));
    } catch (error) { sendRoomFailure(response, error); }
  });

  app.post<{ roomId: string }>("/api/rooms/:roomId/analysis/retry", createRateLimiter(3, 60_000, now), async (request, response) => {
    if (!options.rooms) return response.status(503).json({ error: "Live planning is unavailable." });
    const roomId = request.params.roomId;
    const parsed = RetryAnalysisRequestSchema.safeParse(request.body);
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(roomId ?? "") || !parsed.success)
      return response.status(400).json({ error: "Refresh the room before retrying analysis." });
    try {
      const auth = roomAuthFromHeaders(request.headers as Record<string, unknown>);
      response.json(await options.rooms.retryAnalysis(roomId!, auth, parsed.data.expectedRevision));
    } catch (error) { sendRoomFailure(response, error); }
  });

  app.post("/api/rooms/:roomId/approve", async (request, response) => {
    if (!options.rooms) return response.status(503).json({ error: "Local real-time planning is not configured on this server." });
    const roomId = request.params.roomId;
    const parsed = ApproveProposalRequestSchema.safeParse(request.body);
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(roomId ?? "") || !parsed.success)
      return response.status(400).json({ error: "Review the current proposal version and try again." });
    try {
      const auth = roomAuthFromHeaders(request.headers as Record<string, unknown>);
      response.json(await options.rooms.approve(roomId!, auth, parsed.data.version));
    } catch (error) { sendRoomFailure(response, error); }
  });

  app.post("/api/rooms/:roomId/leave", async (request, response) => {
    if (!options.rooms) return response.status(503).json({ error: "Local real-time planning is not configured on this server." });
    const roomId = request.params.roomId;
    const parsed = LeaveRoomRequestSchema.safeParse(request.body);
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(roomId ?? "") || !parsed.success)
      return response.status(400).json({ error: "Refresh the room before leaving." });
    try {
      const auth = roomAuthFromHeaders(request.headers as Record<string, unknown>);
      response.json(await options.rooms.leave(roomId!, auth, parsed.data.expectedRevision));
    } catch (error) { sendRoomFailure(response, error); }
  });

  app.use("/api/ai", (_request, response, next) => {
    if (options.inferenceEnabled?.() === false) {
      response.status(503).json({ error: "Planning inference is temporarily disabled." });
      return;
    }
    // Preserve request accounting when rooms are live; do not route extraction
    // around the private attempt journal.
    if (options.rooms && !options.meteredExtractionClient) {
      response.status(503).json({ error: "Planning extraction is temporarily unavailable on this server." });
      return;
    }
    next();
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

      assertPlanningScope(parsed.data.description);

      const plan = await extractPlanFromText(
        parsed.data.description,
        options.meteredExtractionClient ?? options.client,
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
        options.meteredExtractionClient ?? options.client,
      );
      response.json({ plan });
    },
  );

  if (options.demoScenarioRouter) {
    app.use("/api/demo/scenarios", options.demoScenarioRouter);
  }

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
