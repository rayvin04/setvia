import { Router, json } from "express";
import { z } from "zod";
import {
  PLAYGROUND_CONTRACT_VERSION,
  PlaygroundAgents,
  PlaygroundRequestSchema,
  playgroundScenarios,
} from "../../../shared/playground.js";
import { MetaApiError } from "../ai/errors.js";
import { PlanningScopeError } from "../ai/planning-scope.js";
import { StateError } from "../agents/store.js";
import {
  PlaygroundError,
  playgroundFailureCode,
  type createPlaygroundService,
} from "./service.js";

export function createPlaygroundRouter(
  service?: ReturnType<typeof createPlaygroundService>,
) {
  const router = Router();
  router.use(json({ limit: "2kb", strict: true }));
  router.get("/status", (_request, response) => {
    response.json({
      enabled: Boolean(service),
      inferenceEnabled: service?.status().inferenceEnabled ?? false,
      contractVersion: PLAYGROUND_CONTRACT_VERSION,
      model: "muse-spark-1.3",
      scenarios: Object.fromEntries(
        PlaygroundAgents.map((agent) => [
          agent,
          playgroundScenarios[agent].map((scenario) => scenario.id),
        ]),
      ),
    });
  });
  router.post("/run", async (request, response) => {
    const parsed = PlaygroundRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const invalid = new Set(
        parsed.error.issues.map((issue) => issue.path[0]),
      );
      const [code, error] = invalid.has("text")
        ? [
            "invalid_text",
            "Personal Listener thoughts must be 10–240 characters and describe a plan.",
          ]
        : invalid.has("scenarioId")
          ? [
              "scenario_unavailable",
              "This example is not available on this playground server. Refresh the page and try again.",
            ]
          : invalid.has("sessionId")
            ? [
                "invalid_session",
                "Please refresh the page to start a new playground session.",
              ]
            : [
                "invalid_request",
                "Choose a supported playground example and try again.",
              ];
      return response.status(400).json({ code, error });
    }
    if (!service)
      return response.status(503).json({
        code: "unavailable",
        error: "The AI playground is resting. Please try again later.",
      });
    try {
      response.json(
        await service.run(
          parsed.data,
          request.ip ?? request.socket.remoteAddress ?? "unknown",
        ),
      );
    } catch (error) {
      const code = playgroundFailureCode(error);
      if (error instanceof PlaygroundError) {
        if (error.retryAfter)
          response.setHeader("Retry-After", error.retryAfter);
        return response
          .status(error.status)
          .json({ code, error: error.message });
      }
      if (error instanceof PlanningScopeError)
        return response.status(422).json({
          code: "planning_scope",
          error:
            "Keep your thought about a plan: a budget, a time, a ride, or something to bring.",
        });
      if (
        error instanceof StateError &&
        error.code === "CALL_ALLOWANCE_REQUIRED"
      )
        return response
          .status(503)
          .json({
            code,
            error: "The AI playground is not ready to start a request.",
          });
      if (
        error instanceof MetaApiError &&
        ["forbidden", "authentication", "request_limit", "accounting"].includes(
          error.code,
        )
      )
        return response.status(503).json({
          code,
          error:
            "Live AI is unavailable right now. Try a previously run example, or come back later.",
        });
      if (error instanceof MetaApiError && error.code === "rate_limit") {
        response.setHeader("Retry-After", "30");
        return response
          .status(429)
          .json({
            code,
            error: "Meta is busy. Please wait a moment and try again.",
          });
      }
      if (error instanceof z.ZodError || error instanceof StateError)
        return response.status(502).json({
          code,
          error:
            "That answer didn’t pass Setvia’s checks. Try again, or try another scenario.",
        });
      response.status(502).json({
        code,
        error:
          "The AI couldn’t finish this time. Please try again in a moment.",
      });
    }
  });
  return router;
}
