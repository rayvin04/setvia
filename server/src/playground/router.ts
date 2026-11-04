import { Router, json } from "express";
import { z } from "zod";
import { PlaygroundRequestSchema } from "../../../shared/playground.js";
import { MetaApiError } from "../ai/errors.js";
import { PlanningScopeError } from "../ai/planning-scope.js";
import { StateError } from "../agents/store.js";
import { PlaygroundError, type createPlaygroundService } from "./service.js";

export function createPlaygroundRouter(
  service?: ReturnType<typeof createPlaygroundService>,
) {
  const router = Router();
  router.use(json({ limit: "2kb", strict: true }));
  router.post("/run", async (request, response) => {
    const parsed = PlaygroundRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return response
        .status(400)
        .json({
          error:
            "Choose one of the playground scenarios. Personal thoughts must be 10–240 characters.",
        });
    if (!service)
      return response
        .status(503)
        .json({
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
      if (error instanceof PlaygroundError) {
        if (error.retryAfter)
          response.setHeader("Retry-After", error.retryAfter);
        return response.status(error.status).json({ error: error.message });
      }
      if (error instanceof PlanningScopeError)
        return response
          .status(422)
          .json({
            error:
              "Keep your thought about a plan: a budget, a time, a ride, or something to bring.",
          });
      if (error instanceof StateError && error.code === "CALL_ALLOWANCE_REQUIRED")
        return response.status(503).json({ error: "The AI playground is not ready to start a request." });
      if (
        error instanceof MetaApiError &&
        ["forbidden", "authentication", "request_limit", "accounting"].includes(
          error.code,
        )
      )
        return response
          .status(503)
          .json({
            error:
              "Live AI is unavailable right now. Try a previously run example, or come back later.",
          });
      if (error instanceof MetaApiError && error.code === "rate_limit") {
        response.setHeader("Retry-After", "30");
        return response
          .status(429)
          .json({ error: "Meta is busy. Please wait a moment and try again." });
      }
      if (error instanceof z.ZodError || error instanceof StateError)
        return response
          .status(502)
          .json({
            error:
              "That answer didn’t pass Setvia’s checks. Try again, or try another scenario.",
          });
      response
        .status(502)
        .json({
          error:
            "The AI couldn’t finish this time. Please try again in a moment.",
        });
    }
  });
  return router;
}
