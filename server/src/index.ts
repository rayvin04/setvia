import { resolve } from "node:path";
import { createApp } from "./http/app.js";
import { createMetaClient, readMetaConfig } from "./ai/meta-client.js";
import { MetaApiError } from "./ai/errors.js";
import { InferenceConcurrencyLimiter, inferenceEnabled, readInferenceConcurrency, readParticipantCooldownMs } from "./ai/inference-control.js";
import { createLocalRoomRuntime, createRoomMetaGateway, DEFAULT_ROOM_PROMPT_VERSION, IntegrationRunBudget } from "./rooms/runtime.js";
import { seedProductionBudgetLedgers } from "./storage-seed.js";
import { createScenarioGenerationRouter } from "./synthetic/generation-router.js";
import { createMeteredExtractionClient } from "./ai/metered-extraction.js";
import { createPlaygroundService } from "./playground/service.js";
import { createPlaygroundRouter } from "./playground/router.js";
import { LIVE_ATTEMPT_RESERVATION_MICROS, LIVE_ATTEMPT_RESERVATION_TOKENS } from "../../scripts/live-budget-journal.js";

const port = Number(process.env.PORT ?? "3001");
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

const production = process.env.NODE_ENV === "production";
const host = process.env.HOST ?? "127.0.0.1";
if (production) {
  if (host !== "127.0.0.1") {
    throw new Error("Production must listen on 127.0.0.1 behind the reverse proxy.");
  }
  if (process.env.SETVIA_LIVE_ENABLED !== "1") {
    throw new Error("Production requires SETVIA_LIVE_ENABLED=1.");
  }
  if (process.env.SETVIA_LIVE_BILLING_CHECKED !== "1") {
    throw new Error("Production requires the approved live billing check.");
  }
  if (!process.env.SETVIA_PRIVATE_ROOT) {
    throw new Error("Production requires SETVIA_PRIVATE_ROOT on durable storage.");
  }
  if (!process.env.SETVIA_ROOM_ORIGINS?.trim()) {
    throw new Error("Production requires an explicit SETVIA_ROOM_ORIGINS allowlist.");
  }
  if (!process.env.SETVIA_PROMPT_ROOT || !process.env.MODEL_API_KEY?.trim()) {
    throw new Error("Production requires private prompt files and the server-side Meta API key.");
  }
  if (!process.env.SETVIA_LIVE_BUDGET_SEED_FILE || !process.env.SETVIA_STAGE_BUDGET_SEED_FILE) {
    throw new Error("Production requires the existing bounded-usage ledgers to be migrated.");
  }
}

const metaConfig = readMetaConfig();
const limiter = new InferenceConcurrencyLimiter(readInferenceConcurrency());
const acquireAttempt = () => limiter.acquire();
const ensureInferenceEnabled = () => {
  if (!inferenceEnabled()) throw new MetaApiError("forbidden", "Inference is disabled.");
};
const client = createMetaClient({
  config: metaConfig,
  maxRetries: 1,
  acquireAttempt,
  beforeAttempt: ensureInferenceEnabled,
});
const appRoot = resolve(process.cwd());
const enabled = process.env.SETVIA_LIVE_ENABLED === "1";
const liveEnabled = enabled;
if (liveEnabled && process.env.SETVIA_LIVE_BILLING_CHECKED !== "1") {
  throw new Error("Set SETVIA_LIVE_BILLING_CHECKED=1 only after reviewing the Meta billing limits.");
}
if (process.env.SETVIA_SYNTHETIC_DEMO === "1" && !liveEnabled) {
  throw new Error("Synthetic live room mode requires SETVIA_LIVE_ENABLED=1.");
}

const roomOrigins = (process.env.SETVIA_ROOM_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const privateRoot = resolve(
  process.env.SETVIA_PRIVATE_ROOT ?? resolve(appRoot, "..", "setvia-local"),
);
if (production) {
  await seedProductionBudgetLedgers(privateRoot, appRoot, {
    globalLedgerBase64File: process.env.SETVIA_LIVE_BUDGET_SEED_FILE!,
    stageBudgetFile: process.env.SETVIA_STAGE_BUDGET_SEED_FILE!,
  });
}
const runtime = liveEnabled
  ? await createLocalRoomRuntime({
      privateRoot,
      publicRoot: appRoot,
      ...(process.env.SETVIA_PROMPT_ROOT ? { promptRoot: resolve(process.env.SETVIA_PROMPT_ROOT) } : {}),
      promptVersion: process.env.SETVIA_PROMPT_VERSION ?? DEFAULT_ROOM_PROMPT_VERSION,
      syntheticDemo: process.env.SETVIA_SYNTHETIC_DEMO === "1",
      acquireAttempt,
      beforeAttempt: ensureInferenceEnabled,
      participantCooldownMs: readParticipantCooldownMs(),
    })
  : undefined;
const demoApiToken = process.env.SETVIA_DEMO_API_TOKEN?.trim();
if (demoApiToken && !/^[A-Za-z0-9_-]{43,256}$/.test(demoApiToken)) {
  throw new Error("SETVIA_DEMO_API_TOKEN must be a base64url token with at least 32 random bytes.");
}
const demoScenarioRouter = runtime && demoApiToken
  ? createScenarioGenerationRouter({
      hooks: runtime.getAuxiliaryInferenceHooks(),
      env: process.env,
      internalToken: demoApiToken,
    })
  : undefined;
let playgroundBudget: IntegrationRunBudget | undefined;
let playgroundService: ReturnType<typeof createPlaygroundService> | undefined;
if (runtime && process.env.SETVIA_PLAYGROUND_ENABLED === "1") {
  try {
    const allowance = Number(process.env.SETVIA_PLAYGROUND_BUDGET_MICROS ?? "2000000");
    if (!Number.isSafeInteger(allowance) || allowance < LIVE_ATTEMPT_RESERVATION_MICROS || allowance > 100_000_000)
      throw new Error("SETVIA_PLAYGROUND_BUDGET_MICROS must fit inside the $100 application ceiling.");
    const attempts = Math.min(24, Math.floor(allowance / LIVE_ATTEMPT_RESERVATION_MICROS));
    playgroundBudget = await IntegrationRunBudget.open(resolve(privateRoot, "public-playground", "allowance.ndjson"), {
      attempts, costMicros: allowance, tokens: attempts * LIVE_ATTEMPT_RESERVATION_TOKENS,
    });
    const hooks = runtime.getAuxiliaryInferenceHooks();
    const gateway = await createRoomMetaGateway(
      privateRoot,
      process.env.SETVIA_PROMPT_VERSION ?? DEFAULT_ROOM_PROMPT_VERSION,
      hooks.recordHttpEvent,
      process.env.SETVIA_PROMPT_ROOT,
      { acquireAttempt: hooks.acquireAttempt, beforeAttempt: hooks.beforeAttempt },
    );
    playgroundService = createPlaygroundService({
      gateway,
      inferenceEnabled,
      cacheRoot: resolve(privateRoot, "public-playground", "cache"),
      reserveAttempt: async (allowance) => {
        await playgroundBudget!.reserve(allowance);
        await hooks.reserveAttempt(allowance);
      },
    });
  } catch {
    await playgroundBudget?.close();
    playgroundBudget = undefined;
    console.error("The public playground is unavailable; existing rooms remain enabled.");
  }
}
const app = createApp({
  client,
  meteredExtractionClient: runtime && createMeteredExtractionClient(metaConfig, runtime.getAuxiliaryInferenceHooks()),
  rooms: runtime,
  roomOrigins: roomOrigins.length ? roomOrigins : undefined,
  trustProxy: production ? 1 : undefined,
  demoScenarioRouter,
  playgroundRouter: createPlaygroundRouter(playgroundService),
  inferenceEnabled,
});
const server = app.listen(port, host);
await new Promise<void>((resolveReady, reject) => {
  server.once("listening", resolveReady);
  server.once("error", reject);
});
console.log(
  `Setvia API listening on ${host}:${port}${runtime ? " (live rooms enabled)" : ""}`,
);
let closing = false;
const close = () => {
  if (closing) return;
  closing = true;
  const closedRuntime = runtime?.close();
  void playgroundBudget?.close().catch(() => { process.exitCode = 1; });
  server.close();
  void closedRuntime?.catch(() => { process.exitCode = 1; });
};
process.once("SIGINT", close);
process.once("SIGTERM", close);
