import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  ScenarioDraftSchema,
  ScenarioRecordSchema,
  scenarioValidationSummary,
  type ScenarioDraft,
  type ScenarioRecord,
} from "./scenario-schema.js";

function isInside(parent: string, candidate: string) {
  const value = relative(parent, candidate);
  return value.length > 0 && value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}

async function assertDirectory(path: string, parentReal: string) {
  try {
    const stats = await lstat(path);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("PRIVATE_SCENARIO_PATH_NOT_DIRECTORY");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(path, { mode: 0o700 });
    const stats = await lstat(path);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("PRIVATE_SCENARIO_PATH_NOT_DIRECTORY");
  }
  const pathReal = await realpath(path);
  if (!isInside(parentReal, pathReal)) throw new Error("PRIVATE_SCENARIO_PATH_ESCAPE");
  return pathReal;
}

export interface ScenarioGenerationMetadata {
  generationRequestId: string | null;
  generatedAt: string;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostMicros: number | null;
}

export class SyntheticScenarioStore {
  private rootPromise: Promise<string> | null = null;
  private writeQueue = Promise.resolve();

  constructor(private readonly privateRoot: string, private readonly publicRoot: string) {
    if (!isAbsolute(privateRoot) || !isAbsolute(publicRoot))
      throw new Error("PRIVATE_AND_PUBLIC_ROOTS_MUST_BE_ABSOLUTE");
  }

  private root() {
    if (!this.rootPromise) this.rootPromise = this.resolveRoot();
    return this.rootPromise;
  }

  private async resolveRoot() {
    const privateRoot = resolve(this.privateRoot);
    const publicRoot = await realpath(resolve(this.publicRoot));
    await mkdir(privateRoot, { recursive: true, mode: 0o700 });
    const privateReal = await realpath(privateRoot);
    const privateStat = await lstat(privateRoot);
    if (!privateStat.isDirectory() || privateStat.isSymbolicLink())
      throw new Error("PRIVATE_ROOT_NOT_REGULAR_DIRECTORY");

    const target = resolve(privateReal, "lab", "synthetic-scenarios");
    if (!isInside(privateReal, target) || isInside(publicRoot, target))
      throw new Error("SYNTHETIC_DATA_MUST_STAY_OUTSIDE_PUBLIC_REPOSITORY");
    const lab = await assertDirectory(resolve(privateReal, "lab"), privateReal);
    return assertDirectory(resolve(lab, "synthetic-scenarios"), privateReal);
  }

  async list(): Promise<ScenarioRecord[]> {
    const root = await this.root();
    const { readdir } = await import("node:fs/promises");
    const filenames = (await readdir(root)).filter((name) => /^[a-zA-Z0-9_-]{1,64}-v[0-9]{4}\.json$/.test(name));
    const records: ScenarioRecord[] = [];
    for (const filename of filenames) {
      const path = resolve(root, filename);
      const stats = await lstat(path);
      if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("PRIVATE_SCENARIO_FILE_NOT_REGULAR");
      const value = ScenarioRecordSchema.parse(JSON.parse(await readFile(path, "utf8")));
      records.push(value);
    }
    const latest = new Map<string, ScenarioRecord>();
    for (const record of records) {
      const current = latest.get(record.datasetId);
      if (!current || record.datasetVersion > current.datasetVersion) latest.set(record.datasetId, record);
    }
    return [...latest.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(datasetId: string, version?: number): Promise<ScenarioRecord | null> {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(datasetId)) return null;
    const records = await this.list();
    if (version === undefined) return records.find((record) => record.datasetId === datasetId) ?? null;
    const root = await this.root();
    const filename = `${datasetId}-v${String(version).padStart(4, "0")}.json`;
    const path = resolve(root, filename);
    if (!isInside(root, path)) throw new Error("PRIVATE_SCENARIO_PATH_ESCAPE");
    try {
      const stats = await lstat(path);
      if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("PRIVATE_SCENARIO_FILE_NOT_REGULAR");
      const record = ScenarioRecordSchema.parse(JSON.parse(await readFile(path, "utf8")));
      return record.datasetId === datasetId && record.datasetVersion === version ? record : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async save(input: {
    scenario: unknown;
    generation: ScenarioGenerationMetadata;
    datasetId?: string;
    editedPaths?: string[];
    approvedForPlayback?: boolean;
  }): Promise<ScenarioRecord> {
    const scenario: ScenarioDraft = ScenarioDraftSchema.parse(input.scenario);
    const task = this.writeQueue.then(() => this.saveExclusive({ ...input, scenario }));
    this.writeQueue = task.then(() => undefined, () => undefined);
    return task;
  }

  private async saveExclusive(input: {
    scenario: ScenarioDraft;
    generation: ScenarioGenerationMetadata;
    datasetId?: string;
    editedPaths?: string[];
    approvedForPlayback?: boolean;
  }) {
    const root = await this.root();
    const datasetId = input.datasetId ?? `scenario-${randomUUID()}`;
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(datasetId)) throw new Error("INVALID_DATASET_ID");
    const prior = await this.get(datasetId);
    if (input.datasetId && !prior) throw new Error("SYNTHETIC_SCENARIO_NOT_FOUND");
    const version = (prior?.datasetVersion ?? 0) + 1;
    const now = new Date().toISOString();
    const priorProvenance = prior?.provenance;
    const humanEdits = [...(priorProvenance?.humanEdits ?? [])];
    const editedPaths = (input.editedPaths ?? []).map((path) => path.trim()).filter(Boolean).slice(0, 100);
    if (editedPaths.length) humanEdits.push({ editedAt: now, editedPaths });
    const record = ScenarioRecordSchema.parse({
      formatVersion: "setvia-synthetic-scenario-v1",
      datasetId,
      datasetVersion: version,
      createdAt: now,
      scenario: input.scenario,
      provenance: {
        source: "Meta Muse Spark",
        model: "muse-spark-1.3",
        promptVersion: "scenario-generator-v1",
        generationRequestId: priorProvenance?.generationRequestId ?? input.generation.generationRequestId,
        generatedAt: priorProvenance?.generatedAt ?? input.generation.generatedAt,
        inputTokens: priorProvenance?.inputTokens ?? input.generation.inputTokens,
        outputTokens: priorProvenance?.outputTokens ?? input.generation.outputTokens,
        estimatedCostMicros: priorProvenance?.estimatedCostMicros ?? input.generation.estimatedCostMicros,
        humanEdits,
        validation: scenarioValidationSummary(input.scenario),
      },
      review: {
        approvedForPlayback: input.approvedForPlayback ?? false,
        approvedAt: input.approvedForPlayback ? now : null,
      },
    });
    const path = resolve(root, `${datasetId}-v${String(version).padStart(4, "0")}.json`);
    if (!isInside(root, path)) throw new Error("PRIVATE_SCENARIO_PATH_ESCAPE");
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, path);
    return record;
  }

  async approve(datasetId: string, expectedVersion: number) {
    const prior = await this.get(datasetId);
    if (!prior) throw new Error("SYNTHETIC_SCENARIO_NOT_FOUND");
    if (prior.datasetVersion !== expectedVersion) throw new Error("STALE_SCENARIO_VERSION");
    return this.save({
      scenario: prior.scenario,
      generation: {
        generationRequestId: prior.provenance.generationRequestId,
        generatedAt: prior.provenance.generatedAt,
        inputTokens: prior.provenance.inputTokens,
        outputTokens: prior.provenance.outputTokens,
        estimatedCostMicros: prior.provenance.estimatedCostMicros,
      },
      datasetId,
      approvedForPlayback: true,
    });
  }

  async saveRun(runId: string, record: unknown) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(runId)) throw new Error("INVALID_SIMULATION_RUN_ID");
    const root = await this.root();
    const runsDir = resolve(root, "runs");
    const runsReal = await assertDirectory(runsDir, await realpath(this.privateRoot));
    const path = resolve(runsReal, `${runId}.json`);
    if (!isInside(runsReal, path)) throw new Error("PRIVATE_RUN_PATH_ESCAPE");
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  }

  async listRuns() {
    const root = await this.root();
    const runsDir = resolve(root, "runs");
    try {
      const runsReal = await realpath(runsDir);
      const { readdir } = await import("node:fs/promises");
      const files = (await readdir(runsReal)).filter((name) => /^[a-zA-Z0-9_-]{1,64}\.json$/.test(name));
      const results: unknown[] = [];
      for (const name of files) {
        const path = resolve(runsReal, name);
        if (!isInside(runsReal, path)) throw new Error("PRIVATE_RUN_PATH_ESCAPE");
        const stats = await lstat(path);
        if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("PRIVATE_RUN_FILE_NOT_REGULAR");
        results.push(JSON.parse(await readFile(path, "utf8")) as unknown);
      }
      return results;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async readRun(runId: string) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(runId)) return null;
    const root = await this.root();
    const runsDir = resolve(root, "runs");
    try {
      const runsReal = await realpath(runsDir);
      const path = resolve(runsReal, `${runId}.json`);
      if (!isInside(runsReal, path)) throw new Error("PRIVATE_RUN_PATH_ESCAPE");
      const stats = await lstat(path);
      if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("PRIVATE_RUN_FILE_NOT_REGULAR");
      return JSON.parse(await readFile(path, "utf8")) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
}
