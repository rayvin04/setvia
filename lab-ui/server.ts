import express, { type NextFunction, type Request, type Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { CycleSchema } from "../server/src/agents/contracts.js";
import { RUBRIC_DIMENSIONS, SCENARIO_IDS, type ScenarioId } from "../server/src/agents/scenarios.js";
import type { LabRecord } from "../server/src/agents/lab.js";

const uiRoot = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(uiRoot, "..");
const privateRoot = resolve(process.env.SETVIA_PRIVATE_ROOT ?? resolve(appRoot, "..", "setvia-local"));
const privateLabRoot = resolve(privateRoot, "lab");
const distRoot = resolve(uiRoot, "dist");
const MAX_REPORT_BYTES = 12 * 1024 * 1024;
const ScenarioSchema = z.enum(["A", "B", "C", "D", "E", "E_STRESS"]);
const ReviewSchema = z.object({
  version: z.literal("setvia-lab-review-v1"),
  reportId: z.string().regex(/^[a-f0-9]{24}$/),
  scenarioId: ScenarioSchema,
  ratings: z.record(z.enum(RUBRIC_DIMENSIONS), z.number().int().min(1).max(5)),
  comments: z.string().max(4_000),
  reviewedAt: z.string().datetime(),
}).strict();
type Review = z.infer<typeof ReviewSchema>;

interface RunFile {
  id: string;
  filename: string;
  modifiedAt: string;
  records: LabRecord[];
}

function isInside(parent: string, candidate: string) {
  const rel = relative(parent, candidate);
  return rel.length > 0 && rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
}

function allowedScenario(value: unknown): value is ScenarioId {
  return typeof value === "string" && ScenarioSchema.safeParse(value).success;
}

function guardRecord(record: LabRecord) {
  if (!record || typeof record !== "object" || record.simulation !== true || !allowedScenario(record.scenarioId))
    throw new Error("SIMULATION_RECORD_REQUIRED");
  CycleSchema.parse(record.cycle);
  for (const participant of record.inputStatements ?? []) {
    for (const statement of participant.statements) {
      if (statement.audience === "listener_only" && !statement.text.startsWith("[PRIVATE LISTENER-ONLY RESPONSE REDACTED]"))
        throw new Error("PRIVATE_INPUT_NOT_REDACTED");
    }
  }
  for (const trace of record.cycle.traces) {
    if (trace.role === "Listener" &&
      (!JSON.stringify(trace.input).includes("redacted") || !JSON.stringify(trace.output).includes("redacted")))
      throw new Error("PRIVATE_LISTENER_TRACE_NOT_REDACTED");
  }
}

async function readReports(): Promise<RunFile[]> {
  const allowedDirs = [privateLabRoot, resolve(privateLabRoot, "live")];
  const rootReal = await realpath(privateLabRoot).catch(() => null);
  if (!rootReal) return [];
  const publicReal = await realpath(appRoot).catch(() => resolve(appRoot));
  if (rootReal === publicReal || isInside(publicReal, rootReal)) return [];
  const runs: RunFile[] = [];
  for (const directory of allowedDirs) {
    let directoryReal: string;
    try {
      const directoryStat = await lstat(directory);
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) continue;
      directoryReal = await realpath(directory);
      if (!isInside(rootReal, directoryReal) && directoryReal !== rootReal) continue;
    } catch {
      continue;
    }
    let names: string[];
    try {
      names = await readdir(directoryReal);
    } catch {
      continue;
    }
    for (const filename of names) {
      if (!/^run-[A-Za-z0-9T_.-]+\.json$/.test(filename)) continue;
      const file = resolve(directoryReal, filename);
      try {
        const fileStat = await lstat(file);
        if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size > MAX_REPORT_BYTES) continue;
        const fileReal = await realpath(file);
        if (!isInside(directoryReal, fileReal)) continue;
        const parsed: unknown = JSON.parse(await readFile(fileReal, "utf8"));
        if (!parsed || typeof parsed !== "object" || !("fixtureVersion" in parsed) ||
          !["lab-v1", "lab-v2"].includes(String(parsed.fixtureVersion)) || !("records" in parsed) || !Array.isArray(parsed.records)) continue;
        const records = (parsed.records as LabRecord[]).filter((record) => {
          try {
            guardRecord(record);
            return true;
          } catch {
            return false;
          }
        });
        if (records.length === 0) continue;
        const id = createHash("sha256").update(relative(rootReal, fileReal)).digest("hex").slice(0, 24);
        const fileInfo = await stat(fileReal);
        runs.push({ id, filename, modifiedAt: fileInfo.mtime.toISOString(), records });
      } catch {
        // Corrupt or unredacted reports are omitted from the local UI.
      }
    }
  }
  return runs.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

async function readReviews() {
  const reviewDir = resolve(privateLabRoot, "reviews");
  const reviews = new Map<string, Review>();
  try {
    const directoryStat = await lstat(reviewDir);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) return reviews;
    const directoryReal = await realpath(reviewDir);
    const rootReal = await realpath(privateLabRoot);
    if (!isInside(rootReal, directoryReal)) return reviews;
    for (const filename of await readdir(directoryReal)) {
      if (!/^review-[a-f0-9]{24}-(A|B|C|D|E|E_STRESS)-[0-9TZ_.-]+-[a-f0-9-]+\.json$/.test(filename)) continue;
      try {
        const file = resolve(directoryReal, filename);
        const fileStat = await lstat(file);
        if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size > 32_000) continue;
        const review = ReviewSchema.parse(JSON.parse(await readFile(file, "utf8")));
        const key = `${review.reportId}:${review.scenarioId}`;
        const prior = reviews.get(key);
        if (!prior || prior.reviewedAt < review.reviewedAt) reviews.set(key, review);
      } catch {
        // Invalid manual reviews are ignored and never become executable input.
      }
    }
  } catch {
    // No review directory yet.
  }
  return reviews;
}

function summarize(run: RunFile) {
  const scenarios = [...new Set(run.records.map((record) => record.scenarioId).filter(allowedScenario))];
  const attempts = run.records.flatMap((record) => record.liveHttpAttempts ?? []);
  const traces = run.records.flatMap((record) => record.cycle.traces);
  const knownTokens = attempts.length > 0
    ? attempts.every((attempt) => attempt.inputTokens !== null && attempt.outputTokens !== null)
    : traces.every((trace) => trace.inputTokens !== null && trace.outputTokens !== null);
  const estimatedCostMicros = attempts.length > 0
    ? attempts.reduce((sum, attempt) => sum + (attempt.estimatedCostMicros ?? attempt.reservedCostMicros), 0)
    : traces.every((trace) => trace.estimatedCostMicros !== null)
      ? traces.reduce((sum, trace) => sum + trace.estimatedCostMicros!, 0)
      : null;
  const totalTokens = knownTokens
    ? attempts.length > 0
      ? attempts.reduce((sum, attempt) => sum + attempt.inputTokens! + attempt.outputTokens!, 0)
      : traces.reduce((sum, trace) => sum + trace.inputTokens! + trace.outputTokens!, 0)
    : null;
  return {
    id: run.id,
    filename: run.filename,
    modifiedAt: run.modifiedAt,
    mode: run.records.some((record) => record.mode === "LIVE") ? "LIVE" : "MOCK",
    model: run.records.find((record) => record.model)?.model ?? null,
    promptVersions: [...new Set(run.records.map((record) => record.promptVersion).filter((version): version is string => !!version))],
    scenarios,
    recordCount: run.records.length,
    attempts: attempts.length > 0 ? attempts.length : run.records.reduce((sum, record) => sum + record.cycle.attempts, 0),
    totalTokens,
    estimatedCostMicros,
    outcomes: run.records.map((record) => ({ scenarioId: record.scenarioId, outcome: record.cycle.outcome, readiness: record.cycle.readiness?.status ?? null })),
    liveRunId: run.records.find((record) => record.liveRunId)?.liveRunId ?? null,
    cumulativeCostMicros: run.records.at(-1)?.liveBudgetSnapshot?.estimatedCostMicros ?? null,
    cumulativeBudgetMicros: run.records.at(-1)?.liveBudgetSnapshot?.budgetMicros ?? null,
  };
}

function isLocalHost(hostHeader: string | undefined, localPort: number) {
  if (!hostHeader) return false;
  try {
    const url = new URL(`http://${hostHeader}`);
    return ["127.0.0.1", "localhost"].includes(url.hostname) &&
      (url.port ? Number(url.port) : 80) === localPort;
  } catch {
    return false;
  }
}

export function createLabUiApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const localPort = req.socket.localPort ?? 0;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'");
    if (!isLocalHost(req.headers.host, localPort)) return res.status(421).send("Local access only.");
    if (req.method === "POST") {
      const origin = req.headers.origin;
      if (typeof origin !== "string") return res.status(403).send("Same-origin request required.");
      try {
        const parsed = new URL(origin);
        if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(parsed.hostname) || Number(parsed.port || 80) !== localPort)
          return res.status(403).send("Same-origin request required.");
      } catch {
        return res.status(403).send("Same-origin request required.");
      }
    }
    next();
  });
  app.use(express.json({ limit: "24kb", strict: true }));

  app.get("/api/runs", async (_req, res) => {
    const runs = await readReports();
    res.json({ runs: runs.map(summarize) });
  });

  app.get("/api/runs/:id", async (req, res) => {
    if (!/^[a-f0-9]{24}$/.test(req.params.id ?? "")) return res.status(400).json({ error: "Invalid run identifier." });
    const runs = await readReports();
    const run = runs.find((candidate) => candidate.id === req.params.id);
    if (!run) return res.status(404).json({ error: "Run not found." });
    const reviews = await readReviews();
    res.json({
      ...summarize(run),
      records: run.records.map((record) => ({
        ...record,
        review: record.scenarioId ? reviews.get(`${run.id}:${record.scenarioId}`) ?? null : null,
      })),
    });
  });

  app.post("/api/reviews", async (req, res) => {
    const parsed = z.object({
      reportId: z.string().regex(/^[a-f0-9]{24}$/),
      scenarioId: ScenarioSchema,
      ratings: z.record(z.enum(RUBRIC_DIMENSIONS), z.number().int().min(1).max(5)),
      comments: z.string().max(4_000),
    }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Review fields do not match the Lab rubric." });
    const ratingKeys = Object.keys(parsed.data.ratings).sort();
    if (ratingKeys.join("|") !== [...RUBRIC_DIMENSIONS].sort().join("|"))
      return res.status(400).json({ error: "Every review dimension requires a rating from 1 to 5." });
    const runs = await readReports();
    const run = runs.find((candidate) => candidate.id === parsed.data.reportId);
    if (!run || !run.records.some((record) => record.scenarioId === parsed.data.scenarioId))
      return res.status(404).json({ error: "Scenario report not found." });
    const review: Review = {
      version: "setvia-lab-review-v1",
      reportId: parsed.data.reportId,
      scenarioId: parsed.data.scenarioId,
      ratings: parsed.data.ratings,
      comments: parsed.data.comments,
      reviewedAt: new Date().toISOString(),
    };
    const reviewDir = resolve(privateLabRoot, "reviews");
    if (!isInside(privateRoot, reviewDir)) return res.status(500).json({ error: "Private review directory check failed." });
    await mkdir(reviewDir, { recursive: true, mode: 0o700 });
    const reviewDirStat = await lstat(reviewDir);
    const reviewDirReal = await realpath(reviewDir);
    const labRootReal = await realpath(privateLabRoot);
    if (!reviewDirStat.isDirectory() || reviewDirStat.isSymbolicLink() || !isInside(labRootReal, reviewDirReal))
      return res.status(500).json({ error: "Private review directory check failed." });
    const filename = `review-${review.reportId}-${review.scenarioId}-${review.reviewedAt.replace(/[:.]/g, "-")}-${randomUUID()}.json`;
    const filePath = resolve(reviewDirReal, filename);
    const temporary = filePath + ".tmp";
    await writeFile(temporary, JSON.stringify(review, null, 2), { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, filePath);
    res.status(201).json({ review });
  });

  app.get("/", async (_req, res) => {
    try {
      const index = resolve(distRoot, "index.html");
      const indexReal = await realpath(index);
      if (!isInside(distRoot, indexReal)) return res.status(404).send("Lab UI build not found.");
      res.type("html").send(await readFile(indexReal, "utf8"));
    } catch {
      res.status(404).send("Build the private Lab UI with npm run lab:ui:build.");
    }
  });

  app.use(express.static(distRoot, { dotfiles: "deny", index: false, fallthrough: true }));
  app.use((_req, res) => res.status(404).send("Not found."));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: "Setvia Lab request failed." });
  });
  return app;
}

const port = Number(process.env.SETVIA_LAB_UI_PORT ?? "4176");
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("SETVIA_LAB_UI_PORT must be between 1024 and 65535.");
  createLabUiApp().listen(port, "127.0.0.1", () => {
    console.log(`Private Setvia Lab is listening at http://127.0.0.1:${port}`);
    console.log(`Private reports: ${privateLabRoot}`);
  });
}
