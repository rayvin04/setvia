import express, { type NextFunction, type Request, type Response } from "express";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { GenerateScenarioRequestSchema } from "../server/src/synthetic/generate.js";
import { ScenarioDraftSchema } from "../server/src/synthetic/scenario-schema.js";
import { SyntheticScenarioStore } from "../server/src/synthetic/store.js";
import { SyntheticRoomApiClient } from "../server/src/synthetic/room-client.js";
import { SyntheticSimulationService } from "../server/src/synthetic/simulator.js";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const privateRoot = process.env.SETVIA_PRIVATE_ROOT?.trim();
if (!privateRoot) throw new Error("Set SETVIA_PRIVATE_ROOT to the local private Setvia workspace before starting Demo Studio.");

const port = Number(process.env.SETVIA_DEMO_STUDIO_PORT ?? "4318");
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("SETVIA_DEMO_STUDIO_PORT must be a valid port.");

const allowedOrigins = new Set((process.env.SETVIA_DEMO_STUDIO_UI_ORIGINS ?? "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://localhost:4173")
  .split(",").map((origin) => origin.trim()).filter(Boolean));
const rooms = new SyntheticRoomApiClient();
const generatorToken = process.env.SETVIA_DEMO_API_TOKEN?.trim();
const generatorHeaders = generatorToken ? { Authorization: `Bearer ${generatorToken}` } : {};
const store = new SyntheticScenarioStore(resolve(privateRoot), appRoot);
const simulation = new SyntheticSimulationService(store, rooms);
const drafts = new Map<string, {
  generatedAt: string;
  generationRequestId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostMicros: number | null;
}>();

function localHost(hostHeader: string | undefined, localPort: number) {
  if (!hostHeader) return false;
  try {
    const url = new URL(`http://${hostHeader}`);
    return ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && Number(url.port || 80) === localPort;
  } catch { return false; }
}

function errorText(error: unknown) {
  if (error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)) return error.message.replaceAll("_", " ").toLocaleLowerCase();
  if (error instanceof Error && error.name === "RoomApiClientError") return error.message.slice(0, 240);
  return "The local Demo Studio action could not be completed.";
}

function statusFor(error: unknown) {
  if (error instanceof Error && error.message === "HUMAN_REVIEW_REQUIRED") return 409;
  if (error instanceof Error && error.message === "SYNTHETIC_LIVE_ROOM_SERVER_REQUIRED") return 503;
  if (error instanceof Error && error.message === "LIVE_ROOM_BUDGET_EXHAUSTED") return 409;
  if (error instanceof Error && error.message === "SYNTHETIC_SCENARIO_NOT_FOUND") return 404;
  if (error instanceof Error && error.message === "STALE_SCENARIO_VERSION") return 409;
  if (error instanceof Error && error.message === "RECORDING_NOT_FOUND") return 404;
  if (error instanceof Error && error.message === "SIMULATION_NOT_FOUND") return 404;
  if (error instanceof Error && error.message === "SIMULATION_AUTOPLAY_ACTIVE") return 409;
  if (error instanceof Error && error.message === "SIMULATION_STEP_IN_PROGRESS") return 409;
  if (error instanceof Error && error.name === "RoomApiClientError") return error.message.includes("budget") ? 409 : 502;
  return 400;
}

const GenerationResponseSchema = z.object({
  scenario: ScenarioDraftSchema,
  provenance: z.object({
    source: z.literal("Meta Muse Spark"),
    model: z.literal("muse-spark-1.3"),
    promptVersion: z.literal("scenario-generator-v1"),
    responseId: z.string().max(200).nullable(),
    generatedAt: z.string().datetime(),
    priceSnapshotDate: z.literal("2026-11-03"),
    attempts: z.number().int().min(0).max(1),
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    estimatedCostMicros: z.number().int().nonnegative().nullable(),
    durationMs: z.number().int().nonnegative(),
  }).strict(),
  validation: z.literal("passed"),
  playbackStarted: z.literal(false),
}).strict();

const app = express();
app.disable("x-powered-by");
app.use((request, response, next) => {
  const localPort = request.socket.localPort ?? 0;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (!localHost(request.headers.host, localPort)) return response.status(421).json({ error: "Local access only." });
  if (request.method === "POST" || request.method === "PUT") {
    const origin = request.headers.origin;
    if (typeof origin !== "string" || !allowedOrigins.has(origin)) return response.status(403).json({ error: "Same-origin local Studio request required." });
  }
  next();
});
app.use(express.json({ limit: "1mb", strict: true }));

app.get("/api/demo-studio/health", async (_request, response) => {
  try {
    const [roomHealth, generationHealth] = await Promise.all([
      rooms.health(),
      fetch(`${rooms.baseUrl}/api/demo/scenarios/health`, { headers: generatorHeaders, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(3_000) })
        .then(async (upstream) => upstream.ok ? await upstream.json() as { available?: unknown } : null)
        .catch(() => null),
    ]);
    response.json({
      localOnly: true,
      roomApi: { mode: roomHealth.mode, enabled: roomHealth.enabled, budget: roomHealth.budget ?? null },
      scenarioGeneratorMounted: Boolean(generationHealth && generationHealth.available === true),
      apiOrigin: rooms.baseUrl,
    });
  } catch {
    response.status(503).json({ localOnly: true, roomApi: { mode: "unavailable", enabled: false, budget: null }, scenarioGeneratorMounted: false });
  }
});

app.get("/api/demo-studio/scenarios", async (_request, response) => {
  try { response.json({ scenarios: await store.list() }); }
  catch { response.status(500).json({ error: "Private scenario storage is unavailable." }); }
});

app.get("/api/demo-studio/scenarios/:datasetId", async (request, response) => {
  const versionValue = request.query.version;
  const version = versionValue === undefined ? undefined : Number(versionValue);
  if (version !== undefined && (!Number.isInteger(version) || version < 1)) return response.status(400).json({ error: "Invalid dataset version." });
  try {
    const scenario = await store.get(request.params.datasetId ?? "", version);
    return scenario ? response.json({ scenario }) : response.status(404).json({ error: "Scenario not found." });
  } catch { return response.status(500).json({ error: "Private scenario storage is unavailable." }); }
});

app.post("/api/demo-studio/generate", async (request, response) => {
  const parsed = GenerateScenarioRequestSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: "Generation settings do not match the scenario contract." });

  try {
    const upstream = await fetch(`${rooms.baseUrl}/api/demo/scenarios`, {
      method: "POST",
      headers: { ...generatorHeaders, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
    let payload: unknown;
    try { payload = await upstream.json(); } catch { payload = null; }
    if (!upstream.ok) {
      const error = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error.slice(0, 300)
        : "Muse Spark scenario generation is unavailable. Confirm the shared-budget generator route is mounted on Setvia's API server.";
      return response.status(upstream.status).json({ error, attempts: payload && typeof payload === "object" && "attempts" in payload ? payload.attempts : 0, playbackStarted: false });
    }
    const generated = GenerationResponseSchema.safeParse(payload);
    if (!generated.success) return response.status(502).json({ error: "The Setvia API returned an invalid scenario generation result; nothing was saved." });
    const generationId = randomUUID();
    drafts.set(generationId, {
      generatedAt: generated.data.provenance.generatedAt,
      generationRequestId: generated.data.provenance.responseId,
      inputTokens: generated.data.provenance.inputTokens,
      outputTokens: generated.data.provenance.outputTokens,
      estimatedCostMicros: generated.data.provenance.estimatedCostMicros,
    });
    return response.status(201).json({ generationId, ...generated.data });
  } catch {
    return response.status(503).json({ error: "The local Setvia API is unavailable. No generation was started." });
  }
});

app.post("/api/demo-studio/scenarios", async (request, response) => {
  const parsed = z.object({
    generationId: z.string().uuid(),
    scenario: ScenarioDraftSchema,
    editedPaths: z.array(z.string().max(120)).max(100),
  }).strict().safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: "The edited scenario failed validation. Nothing was saved." });
  const generation = drafts.get(parsed.data.generationId);
  if (!generation) return response.status(409).json({ error: "This generated draft is no longer available; generate it again or load a saved version." });
  try {
    const saved = await store.save({ scenario: parsed.data.scenario, generation, editedPaths: parsed.data.editedPaths });
    drafts.delete(parsed.data.generationId);
    return response.status(201).json({ scenario: saved, playbackStarted: false });
  } catch { return response.status(500).json({ error: "Scenario could not be written to the private dataset folder." }); }
});

app.put("/api/demo-studio/scenarios/:datasetId", async (request, response) => {
  const parsed = z.object({
    expectedVersion: z.number().int().positive(),
    scenario: ScenarioDraftSchema,
    editedPaths: z.array(z.string().max(120)).max(100),
  }).strict().safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: "The edited scenario failed validation. Nothing was saved." });
  try {
    const prior = await store.get(request.params.datasetId ?? "");
    if (!prior) return response.status(404).json({ error: "Scenario not found." });
    if (prior.datasetVersion !== parsed.data.expectedVersion) return response.status(409).json({ error: "The scenario changed in another tab. Reload the latest version before editing." });
    const saved = await store.save({
      scenario: parsed.data.scenario,
      datasetId: prior.datasetId,
      editedPaths: parsed.data.editedPaths,
      generation: {
        generationRequestId: prior.provenance.generationRequestId,
        generatedAt: prior.provenance.generatedAt,
        inputTokens: prior.provenance.inputTokens,
        outputTokens: prior.provenance.outputTokens,
        estimatedCostMicros: prior.provenance.estimatedCostMicros,
      },
    });
    return response.json({ scenario: saved, playbackStarted: false });
  } catch { return response.status(500).json({ error: "Scenario could not be written to the private dataset folder." }); }
});

app.post("/api/demo-studio/scenarios/:datasetId/approve", async (request, response) => {
  const parsed = z.object({ expectedVersion: z.number().int().positive() }).strict().safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: "Review requires the current scenario version." });
  try { response.json({ scenario: await store.approve(request.params.datasetId ?? "", parsed.data.expectedVersion) }); }
  catch (error) { response.status(statusFor(error)).json({ error: errorText(error) }); }
});

app.get("/api/demo-studio/recordings", async (_request, response) => {
  try { response.json({ recordings: await simulation.listRecordedRuns() }); }
  catch { response.status(500).json({ error: "Private simulation history is unavailable." }); }
});

app.post("/api/demo-studio/recordings/:runId/play", async (request, response) => {
  try { response.json({ simulation: await simulation.loadRecorded(request.params.runId ?? "") }); }
  catch (error) { response.status(statusFor(error)).json({ error: errorText(error) }); }
});

app.post("/api/demo-studio/simulations", async (request, response) => {
  const parsed = z.object({ datasetId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), version: z.number().int().positive() }).strict().safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: "Select a saved scenario version before live playback." });
  try { response.status(201).json({ simulation: await simulation.startLive(parsed.data.datasetId, parsed.data.version) }); }
  catch (error) { response.status(statusFor(error)).json({ error: errorText(error) }); }
});

app.get("/api/demo-studio/simulations/:runId", (request, response) => {
  try { response.json({ simulation: simulation.get(request.params.runId ?? "") }); }
  catch (error) { response.status(statusFor(error)).json({ error: errorText(error) }); }
});

app.post("/api/demo-studio/simulations/:runId/next", async (request, response) => {
  try { response.json({ simulation: await simulation.next(request.params.runId ?? "") }); }
  catch (error) { response.status(statusFor(error)).json({ error: errorText(error) }); }
});

app.post("/api/demo-studio/simulations/:runId/play", async (request, response) => {
  const parsed = z.object({ speed: z.number().min(0.25).max(4) }).strict().safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: "Playback speed must be between 0.25× and 4×." });
  try { response.json({ simulation: await simulation.play(request.params.runId ?? "", parsed.data.speed) }); }
  catch (error) { response.status(statusFor(error)).json({ error: errorText(error) }); }
});

app.post("/api/demo-studio/simulations/:runId/pause", async (request, response) => {
  try { response.json({ simulation: await simulation.pause(request.params.runId ?? "") }); }
  catch (error) { response.status(statusFor(error)).json({ error: errorText(error) }); }
});

app.post("/api/demo-studio/simulations/:runId/resume", async (request, response) => {
  const parsed = z.object({ speed: z.number().min(0.25).max(4).optional() }).strict().safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: "Invalid playback speed." });
  try { response.json({ simulation: await simulation.resume(request.params.runId ?? "", parsed.data.speed) }); }
  catch (error) { response.status(statusFor(error)).json({ error: errorText(error) }); }
});

app.post("/api/demo-studio/simulations/:runId/skip", async (request, response) => {
  try { response.json({ simulation: await simulation.skipCurrent(request.params.runId ?? "") }); }
  catch (error) { response.status(statusFor(error)).json({ error: errorText(error) }); }
});

app.post("/api/demo-studio/simulations/:runId/manual", async (request, response) => {
  try { response.json({ simulation: await simulation.intervene(request.params.runId ?? "", request.body) }); }
  catch (error) { response.status(statusFor(error)).json({ error: errorText(error) }); }
});

app.post("/api/demo-studio/simulations/:runId/reset", async (request, response) => {
  try { response.status(201).json({ simulation: await simulation.reset(request.params.runId ?? "") }); }
  catch (error) { response.status(statusFor(error)).json({ error: errorText(error) }); }
});

app.use("/api/demo-studio", (_request, response) => response.status(404).json({ error: "Demo Studio API route not found." }));
app.use((_request: Request, response: Response) => response.status(404).json({ error: "Demo Studio is served by the Setvia local app." }));
app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  response.status(400).json({ error: errorText(error) });
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Setvia Demo Studio API is local at http://127.0.0.1:${port}`);
  console.log("Open /demo-studio in the Setvia app. Generation proxies through the shared Setvia API budget.");
});
