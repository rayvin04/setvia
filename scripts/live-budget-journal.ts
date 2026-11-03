import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { Roles } from "../server/src/agents/contracts.js";
import type { MetaHttpEvent } from "../server/src/agents/meta-gateway.js";
import type { LiveAttemptRecord } from "../server/src/agents/lab.js";

export const LIVE_COST_BUDGET_MICROS = 10_000_000;
export const LIVE_ATTEMPT_RESERVATION_MICROS = 104_000;
export const LIVE_MAX_HTTP_ATTEMPTS = 70;
export const LIVE_ATTEMPT_RESERVATION_TOKENS = 64_000;
export const LIVE_TOKEN_BUDGET = 3_200_000;
const LEDGER_NAME = "live-budget-ledger-v1.json";
const LOCK_NAME = "live-budget-ledger-v1.lock";

const AttemptSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  scenarioId: z.string().min(1).max(20),
  model: z.literal("muse-spark-1.3"),
  promptVersion: z.string().regex(/^agents-v[0-9]+$/),
  role: z.enum([...Roles, "Scenario Generator"]),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  invocationId: z.string().uuid().optional(),
  status: z.enum(["reserved", "response_received", "transport_error", "usage_recorded"]),
  httpStatus: z.number().int().min(100).max(599).nullable(),
  startedAt: z.string().datetime(),
  durationMs: z.number().int().nonnegative().nullable(),
  reservedCostMicros: z.number().int().nonnegative(),
  reservedTokens: z.number().int().nonnegative().max(LIVE_ATTEMPT_RESERVATION_TOKENS).optional(),
  estimatedCostMicros: z.number().int().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  cachedInputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  reasoningTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
  responseId: z.string().nullable(),
}).strict();
type ValidatedLiveAttemptRecord = z.infer<typeof AttemptSchema>;

const LedgerSchema = z.object({
  version: z.literal("live-budget-ledger-v1"),
  budgetMicros: z.literal(LIVE_COST_BUDGET_MICROS),
  attempts: z.array(AttemptSchema),
}).strict();
type Ledger = z.infer<typeof LedgerSchema>;

function tokensAtRisk(attempt: ValidatedLiveAttemptRecord) {
  const reported = attempt.totalTokens ?? (
    attempt.inputTokens !== null && attempt.outputTokens !== null
      ? attempt.inputTokens + attempt.outputTokens
      : null
  );
  return reported ?? attempt.reservedTokens ?? LIVE_ATTEMPT_RESERVATION_TOKENS;
}

function tokenReservationExceeded(attempt: ValidatedLiveAttemptRecord) {
  return tokensAtRisk(attempt) > (attempt.reservedTokens ?? LIVE_ATTEMPT_RESERVATION_TOKENS);
}

function inside(parent: string, candidate: string) {
  const rel = relative(parent, candidate);
  return rel.length > 0 && rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
}

async function readLedger(path: string): Promise<Ledger> {
  try {
    const ledgerStat = await lstat(path);
    if (!ledgerStat.isFile() || ledgerStat.isSymbolicLink()) throw new Error("LIVE_BUDGET_LEDGER_NOT_REGULAR");
    const text = await readFile(path, "utf8");
    if (!text.endsWith("\n")) throw new Error("LIVE_BUDGET_LEDGER_INCOMPLETE");
    const snapshots = text.trimEnd().split("\n").map((line) => LedgerSchema.parse(JSON.parse(line)));
    if (snapshots.length === 0) throw new Error("LIVE_BUDGET_LEDGER_EMPTY");
    return snapshots[snapshots.length - 1]!;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: "live-budget-ledger-v1", budgetMicros: LIVE_COST_BUDGET_MICROS, attempts: [] };
    }
    throw new Error("LIVE_BUDGET_LEDGER_INVALID; no model request was sent.");
  }
}

function processExists(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export class LiveBudgetJournal {
  private readonly runAttempts = new Map<string, string>();
  private released = false;
  private tail: Promise<void> = Promise.resolve();

  private constructor(
    private readonly directory: string,
    private readonly ledgerPath: string,
    private readonly lockPath: string,
    readonly runId: string,
    readonly scenarioIds: readonly string[],
  ) {}

  static async open(privateRoot: string, publicRoot: string, scenarioIds: readonly string[]) {
    const privatePath = resolve(privateRoot);
    const publicPath = resolve(publicRoot);
    if (privatePath === publicPath || inside(publicPath, privatePath))
      throw new Error("PRIVATE_LIVE_LEDGER_REQUIRED");
    await mkdir(privatePath, { recursive: true, mode: 0o700 });
    const privateReal = await realpath(privatePath);
    const publicReal = await realpath(publicPath).catch(() => publicPath);
    if (privateReal === publicReal || inside(publicReal, privateReal))
      throw new Error("PRIVATE_LIVE_LEDGER_REQUIRED");
    const labPath = resolve(privateReal, "lab");
    if (!inside(privateReal, labPath)) throw new Error("PRIVATE_LIVE_LEDGER_REQUIRED");
    await mkdir(labPath, { recursive: true, mode: 0o700 });
    const labStat = await lstat(labPath);
    const labReal = await realpath(labPath);
    if (!labStat.isDirectory() || labStat.isSymbolicLink() || !inside(privateReal, labReal))
      throw new Error("PRIVATE_LIVE_LEDGER_REQUIRED");
    const livePath = resolve(labReal, "live");
    if (!inside(labReal, livePath)) throw new Error("PRIVATE_LIVE_LEDGER_REQUIRED");
    await mkdir(livePath, { recursive: true, mode: 0o700 });
    const liveStat = await lstat(livePath);
    const directory = await realpath(livePath);
    if (!liveStat.isDirectory() || liveStat.isSymbolicLink() || !inside(labReal, directory))
      throw new Error("PRIVATE_LIVE_LEDGER_REQUIRED");
    const ledgerPath = resolve(directory, LEDGER_NAME);
    const lockPath = resolve(directory, LOCK_NAME);
    const runId = randomUUID();
    const lockContent = JSON.stringify({ pid: process.pid, runId, startedAt: new Date().toISOString() });
    try {
      await writeFile(lockPath, lockContent, { encoding: "utf8", flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let stale = false;
      try {
        const lock = JSON.parse(await readFile(lockPath, "utf8")) as { pid?: unknown };
        if (typeof lock.pid === "number" && Number.isInteger(lock.pid)) stale = !processExists(lock.pid);
      } catch {
        stale = false;
      }
      if (!stale) throw new Error("LIVE_RUN_ALREADY_ACTIVE; no model request was sent.");
      await rm(lockPath, { force: true });
      try {
        await writeFile(lockPath, lockContent, { encoding: "utf8", flag: "wx", mode: 0o600 });
      } catch {
        throw new Error("LIVE_RUN_ALREADY_ACTIVE; no model request was sent.");
      }
    }
    const journal = new LiveBudgetJournal(directory, ledgerPath, lockPath, runId, [...scenarioIds]);
    try {
      await journal.mutate((ledger) => ledger);
    } catch (error) {
      await journal.release();
      throw error;
    }
    return journal;
  }

  async handle(event: MetaHttpEvent, scenarioId: string) {
    if (!this.scenarioIds.includes(scenarioId)) throw new Error("LIVE_SCENARIO_NOT_RESERVED");
    if (event.invocationId !== undefined && !z.string().uuid().safeParse(event.invocationId).success)
      throw new Error("LIVE_EVENT_ID_INVALID");
    const eventKey = `${event.invocationId ?? "legacy"}:${event.requestNumber}`;
    let reservationExceeded = false;
    let costReservationExceeded = false;
    await this.mutate((ledger) => {
      if (event.phase === "started") {
        const priorId = this.runAttempts.get(eventKey);
        const prior = ledger.attempts.find((attempt) => attempt.id === priorId);
        if (event.invocationId && priorId)
          throw new Error("LIVE_EVENT_ID_REUSED; no additional request was sent.");
        if (!event.invocationId && prior && ["reserved", "response_received"].includes(prior.status) &&
          (prior.httpStatus === null || prior.httpStatus < 400))
          throw new Error("LIVE_EVENT_ID_REQUIRED; overlapping calls need distinct identities.");
        if (ledger.attempts.some(tokenReservationExceeded))
          throw new Error("LIVE_TOKEN_RESERVATION_BREACH; no additional request was sent.");
        if (ledger.attempts.some((attempt) => (attempt.estimatedCostMicros ?? 0) > attempt.reservedCostMicros))
          throw new Error("LIVE_COST_RESERVATION_BREACH; no additional request was sent.");
        if (ledger.attempts.length >= LIVE_MAX_HTTP_ATTEMPTS)
          throw new Error("LIVE_HTTP_ATTEMPT_LIMIT; no additional request was sent.");
        const costAtRisk = ledger.attempts.reduce(
          (sum, attempt) => sum + (attempt.estimatedCostMicros ?? attempt.reservedCostMicros),
          0,
        );
        if (costAtRisk + LIVE_ATTEMPT_RESERVATION_MICROS > ledger.budgetMicros)
          throw new Error("LIVE_CUMULATIVE_BUDGET_LIMIT; no additional request was sent.");
        const tokensAtRiskTotal = ledger.attempts.reduce((sum, attempt) => sum + tokensAtRisk(attempt), 0);
        if (tokensAtRiskTotal + LIVE_ATTEMPT_RESERVATION_TOKENS > LIVE_TOKEN_BUDGET)
          throw new Error("LIVE_CUMULATIVE_TOKEN_LIMIT; no additional request was sent.");
        const attempt: ValidatedLiveAttemptRecord = {
          id: randomUUID(),
          runId: this.runId,
          scenarioId,
          model: "muse-spark-1.3",
          promptVersion: event.promptVersion,
          role: event.role,
          requestHash: event.requestHash,
          ...(event.invocationId ? { invocationId: event.invocationId } : {}),
          status: "reserved",
          httpStatus: null,
          startedAt: new Date().toISOString(),
          durationMs: null,
          reservedCostMicros: LIVE_ATTEMPT_RESERVATION_MICROS,
          reservedTokens: LIVE_ATTEMPT_RESERVATION_TOKENS,
          estimatedCostMicros: null,
          inputTokens: null,
          cachedInputTokens: null,
          outputTokens: null,
          reasoningTokens: null,
          totalTokens: null,
          responseId: null,
        };
        ledger.attempts.push(attempt);
        this.runAttempts.set(eventKey, attempt.id);
        return ledger;
      }

      const attemptId = this.runAttempts.get(eventKey);
      const attempt = ledger.attempts.find((candidate) => candidate.id === attemptId);
      if (!attempt) throw new Error("LIVE_ATTEMPT_JOURNAL_MISSING; stopping before another request.");
      if (event.phase === "response") {
        attempt.httpStatus = event.status ?? null;
        attempt.durationMs = event.durationMs ?? null;
        attempt.status = (event.status ?? 0) >= 200 && (event.status ?? 0) < 300
          ? "response_received"
          : "reserved";
      } else if (event.phase === "transport_error") {
        attempt.durationMs = event.durationMs ?? null;
        attempt.status = "transport_error";
      } else if (event.phase === "usage") {
        const usage = event.usage;
        if (!usage) throw new Error("LIVE_USAGE_EVENT_INVALID");
        const observedTokens = usage.totalTokens ?? (
          usage.inputTokens !== null && usage.outputTokens !== null
            ? usage.inputTokens + usage.outputTokens
            : null
        );
        if (observedTokens !== null && observedTokens > LIVE_ATTEMPT_RESERVATION_TOKENS)
          reservationExceeded = true;
        attempt.durationMs = usage.durationMs;
        attempt.inputTokens = usage.inputTokens;
        attempt.cachedInputTokens = usage.cachedInputTokens;
        attempt.outputTokens = usage.outputTokens;
        attempt.reasoningTokens = usage.reasoningTokens;
        attempt.totalTokens = usage.totalTokens;
        attempt.responseId = usage.responseId;
        if (usage.inputTokens !== null && usage.outputTokens !== null) {
          // Deliberately ignore cached-input discounts in the spend guard.
          attempt.estimatedCostMicros = Math.ceil(
            (usage.inputTokens * 1_250_000 + usage.outputTokens * 4_250_000) / 1_000_000,
          );
        }
        if ((attempt.estimatedCostMicros ?? 0) > attempt.reservedCostMicros)
          costReservationExceeded = true;
        attempt.status = "usage_recorded";
      }
      return ledger;
    });
    if (reservationExceeded)
      throw new Error("LIVE_ATTEMPT_TOKEN_RESERVATION_EXCEEDED; stopping after this response.");
    if (costReservationExceeded)
      throw new Error("LIVE_ATTEMPT_COST_RESERVATION_EXCEEDED; stopping after this response.");
  }

  async attemptsFor(scenarioId: string): Promise<LiveAttemptRecord[]> {
    const ledger = await this.enqueue(() => readLedger(this.ledgerPath));
    return ledger.attempts
      .filter((attempt) => attempt.runId === this.runId && attempt.scenarioId === scenarioId)
      .map((attempt) => ({ ...attempt }));
  }

  async snapshot() {
    const ledger = await this.enqueue(() => readLedger(this.ledgerPath));
    const attempts = ledger.attempts;
    const tokenExposure = attempts.reduce((sum, attempt) => sum + tokensAtRisk(attempt), 0);
    return {
      runId: this.runId,
      attempts: attempts.length,
      runAttempts: attempts.filter((attempt) => attempt.runId === this.runId).length,
      attemptBudget: LIVE_MAX_HTTP_ATTEMPTS,
      remainingAttempts: Math.max(0, LIVE_MAX_HTTP_ATTEMPTS - attempts.length),
      estimatedCostMicros: attempts.reduce(
        (sum, attempt) => sum + (attempt.estimatedCostMicros ?? attempt.reservedCostMicros),
        0,
      ),
      budgetMicros: ledger.budgetMicros,
      tokensAtRisk: tokenExposure,
      tokenBudget: LIVE_TOKEN_BUDGET,
      remainingTokens: Math.max(0, LIVE_TOKEN_BUDGET - tokenExposure),
    };
  }

  async release() {
    if (this.released) return;
    this.released = true;
    await this.tail;
    try {
      const lock = JSON.parse(await readFile(this.lockPath, "utf8")) as { runId?: unknown };
      if (lock.runId === this.runId) await rm(this.lockPath, { force: true });
    } catch {
      // Keep the ledger intact if a lock was already removed or cannot be read.
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.released) return Promise.reject(new Error("LIVE_JOURNAL_CLOSED"));
    const result = this.tail.then(operation);
    this.tail = result.then(() => {}, () => {});
    return result;
  }

  private mutate(update: (ledger: Ledger) => Ledger) {
    return this.enqueue(() => this.appendMutation(update));
  }

  private async appendMutation(update: (ledger: Ledger) => Ledger) {
    const ledger = await readLedger(this.ledgerPath);
    const next = update(ledger);
    LedgerSchema.parse(next);
    try {
      const fileStat = await lstat(this.ledgerPath);
      const fileReal = await realpath(this.ledgerPath);
      if (!fileStat.isFile() || fileStat.isSymbolicLink() || !inside(this.directory, fileReal))
        throw new Error("LIVE_BUDGET_LEDGER_INVALID; no model request was sent.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    // Append snapshots instead of replacing a file: Windows can reject rename-over-existing.
    // A missing trailing newline signals an interrupted write, which readLedger fails closed on.
    const handle = await open(this.ledgerPath, "a", 0o600);
    try {
      await handle.writeFile(JSON.stringify(next) + "\n", "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}
