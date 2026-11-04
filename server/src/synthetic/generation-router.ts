import { createHash, timingSafeEqual } from "node:crypto";
import express, { Router, type Request, type Response } from "express";
import { MetaConfigurationError } from "../ai/errors.js";
import type { MetaClientOptions } from "../ai/meta-client.js";
import {
  createScenarioGenerationClient,
  generateScenario,
  GenerateScenarioRequestSchema,
  ScenarioGenerationError,
  SCENARIO_GENERATOR_PROMPT_VERSION,
  type ScenarioGenerationHooks,
} from "./generate.js";

export interface ScenarioGenerationRouterOptions {
  hooks: ScenarioGenerationHooks;
  internalToken: string;
  env?: Record<string, string | undefined>;
  client?: Pick<MetaClientOptions, "config" | "fetchImpl" | "timeoutMs">;
  now?: () => Date;
}

function statusFor(error: unknown) {
  if (error instanceof MetaConfigurationError) return 503;
  if (error instanceof ScenarioGenerationError && error.accountingFailed) return 503;
  if (error instanceof ScenarioGenerationError) return error.attempts > 0 ? 502 : 400;
  return 500;
}

function safeMessage(error: unknown) {
  if (error instanceof ScenarioGenerationError) return error.message;
  if (error instanceof MetaConfigurationError) return "Meta scenario generation is not configured on this local server.";
  return "Muse Spark could not produce a validated synthetic scenario.";
}

/**
 * Mount on the Setvia API process with RoomRuntime.getAuxiliaryInferenceHooks().
 * This router intentionally has no direct HTTP bypass and records every attempt.
 */
export function createScenarioGenerationRouter(options: ScenarioGenerationRouterOptions) {
  if (!/^[A-Za-z0-9_-]{43,256}$/.test(options.internalToken)) {
    throw new Error("SCENARIO_GENERATOR_INTERNAL_TOKEN_INVALID");
  }
  const router = Router();
  const now = options.now ?? (() => new Date());
  const expectedTokenDigest = createHash("sha256").update(options.internalToken).digest();

  router.use((request: Request, response: Response, next) => {
    // Only the private Studio service may use this request-accounted route. Browser
    // requests are rejected even if a hostile page attempts a direct POST.
    if (request.header("origin")) {
      response.status(403).json({ error: "This internal endpoint does not accept browser requests." });
      return;
    }
    const match = /^Bearer ([A-Za-z0-9_-]{43,256})$/.exec(request.header("authorization") ?? "");
    const tokenDigest = createHash("sha256").update(match?.[1] ?? "").digest();
    if (!match || !timingSafeEqual(expectedTokenDigest, tokenDigest)) {
      response.status(401).json({ error: "This internal endpoint is not authorized." });
      return;
    }
    next();
  });
  router.use(express.json({ limit: "24kb", strict: true }));

  router.get("/health", (_request: Request, response: Response) => {
    response.json({ available: true, model: "muse-spark-1.3", promptVersion: SCENARIO_GENERATOR_PROMPT_VERSION });
  });

  router.post("/", async (request: Request, response: Response) => {
    const parsed = GenerateScenarioRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Generation settings do not match the scenario contract." });
      return;
    }

    let client;
    try {
      client = createScenarioGenerationClient({
        input: parsed.data,
        hooks: options.hooks,
        env: options.env,
        client: options.client,
      });
    } catch (error) {
      response.status(statusFor(error)).json({ error: safeMessage(error), attempts: 0, playbackStarted: false });
      return;
    }

    try {
      const result = await generateScenario(parsed.data, client);
      const generatedAt = now().toISOString();
      response.status(201).json({
        scenario: result.scenario,
        provenance: {
          source: "Meta Muse Spark",
          model: result.model,
          promptVersion: SCENARIO_GENERATOR_PROMPT_VERSION,
          responseId: result.responseId,
          generatedAt,
          priceSnapshotDate: "2026-11-03",
          attempts: result.attempts,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          estimatedCostMicros: result.estimatedCostMicros,
          durationMs: result.durationMs,
        },
        validation: "passed",
        playbackStarted: false,
      });
    } catch (error) {
      response.status(statusFor(error)).json({
        error: safeMessage(error),
        attempts: error instanceof ScenarioGenerationError ? error.attempts : client.getRequestCount(),
        playbackStarted: false,
      });
    }
  });

  return router;
}
