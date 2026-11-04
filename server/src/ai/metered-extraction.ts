import { createHash, randomUUID } from "node:crypto";
import {
  LIVE_ATTEMPT_RESERVATION_MICROS,
  LIVE_ATTEMPT_RESERVATION_TOKENS,
} from "../../../scripts/live-budget-journal.js";
import type { AuxiliaryInferenceHooks } from "../rooms/runtime.js";
import { MetaApiError } from "./errors.js";
import { createMetaClient, type MetaApiClient, type MetaConfig } from "./meta-client.js";

export function createMeteredExtractionClient(config: MetaConfig, hooks: AuxiliaryInferenceHooks): MetaApiClient {
  let attempts = 0;
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    getRequestCount: () => attempts,
    async createResponse(request, options) {
      const context = {
        invocationId: randomUUID(),
        requestHash: createHash("sha256").update(JSON.stringify(request)).digest("hex"),
        role: "Plan Extraction" as const,
        promptVersion: "agents-v1",
      };
      const client = createMetaClient({
        config,
        maxRetries: 0,
        maxTotalRequests: 1,
        acquireAttempt: hooks.acquireAttempt,
        onHttpEvent: async (event) => {
          if (event.phase === "started") {
            await hooks.beforeAttempt();
            try {
              await hooks.reserveAttempt({
                tokens: LIVE_ATTEMPT_RESERVATION_TOKENS,
                costMicros: LIVE_ATTEMPT_RESERVATION_MICROS,
              });
              await hooks.recordHttpEvent({ ...event, ...context });
              attempts++;
            } catch {
              throw new MetaApiError("accounting", "The request could not be recorded before Meta inference.");
            }
            return;
          }
          try {
            await hooks.recordHttpEvent({ ...event, ...context });
          } catch {
            throw new MetaApiError("accounting", "The Meta request usage could not be recorded.");
          }
        },
        onUsage: async (usage, requestNumber) => {
          try {
            await hooks.recordHttpEvent({
              ...context, phase: "usage", usage, requestNumber, durationMs: usage.durationMs,
            });
          } catch {
            throw new MetaApiError("accounting", "The Meta request usage could not be recorded.");
          }
        },
      });
      return client.createResponse(request, options);
    },
  };
}
