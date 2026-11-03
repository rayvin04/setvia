import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { LIVE_ATTEMPT_RESERVATION_MICROS, LIVE_ATTEMPT_RESERVATION_TOKENS, LIVE_COST_BUDGET_MICROS, LIVE_MAX_HTTP_ATTEMPTS, LIVE_TOKEN_BUDGET, LiveBudgetJournal } from "./live-budget-journal.js";
import type { MetaHttpEvent } from "../server/src/agents/meta-gateway.js";

const event = (phase: MetaHttpEvent["phase"], requestNumber = 1): MetaHttpEvent => ({
  phase,
  requestNumber,
  requestHash: "a".repeat(64),
  role: "Judge",
  promptVersion: "agents-v1",
});

async function tempRoots(t: { after(callback: () => void | Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), "setvia-live-ledger-test-"));
  t.after(async () => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    assert.ok(root.includes("setvia-live-ledger-test-"));
    await rm(root, { recursive: true, force: true });
  });
  return { root, privateRoot: join(root, "private"), publicRoot: join(root, "repo") };
}

test("live request journal persists reservations, HTTP status, usage, and private-safe identifiers", async (t) => {
  const { root, privateRoot, publicRoot } = await tempRoots(t);
  const journal = await LiveBudgetJournal.open(privateRoot, publicRoot, ["A"]);
  try {
    await journal.handle(event("started"), "A");
    assert.equal((await journal.snapshot()).estimatedCostMicros, LIVE_ATTEMPT_RESERVATION_MICROS);
    await journal.handle({ ...event("response"), status: 200, durationMs: 450 }, "A");
    await journal.handle({
      ...event("usage"),
      usage: {
        model: "muse-spark-1.3",
        responseId: "resp-synthetic",
        inputTokens: 1000,
        cachedInputTokens: 900,
        outputTokens: 500,
        totalTokens: 1500,
        reasoningTokens: 100,
        durationMs: 480,
      },
    }, "A");
    const attempts = await journal.attemptsFor("A");
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]?.status, "usage_recorded");
    assert.equal(attempts[0]?.httpStatus, 200);
    assert.equal(attempts[0]?.inputTokens, 1000);
    assert.equal(attempts[0]?.cachedInputTokens, 900);
    assert.equal(attempts[0]?.estimatedCostMicros, 3375);
    assert.equal(JSON.stringify(attempts).includes("synthetic-key"), false);
    const disk = await readFile(join(privateRoot, "lab", "live", "live-budget-ledger-v1.json"), "utf8");
    assert.ok(disk.includes("requestHash"));
  } finally {
    await journal.release();
  }
  const restarted = await LiveBudgetJournal.open(privateRoot, publicRoot, ["A"]);
  try {
    const snapshot = await restarted.snapshot();
    assert.equal(snapshot.attempts, 1);
    assert.equal(snapshot.estimatedCostMicros, 3375);
  } finally {
    await restarted.release();
  }
  assert.ok(root.length > 0);
});

test("unknown usage still stops at the cumulative token ceiling after attempt authorization expands", async (t) => {
  const { privateRoot, publicRoot } = await tempRoots(t);
  const journal = await LiveBudgetJournal.open(privateRoot, publicRoot, ["A"]);
  try {
    const maximumUnknownAttempts = Math.floor(LIVE_TOKEN_BUDGET / LIVE_ATTEMPT_RESERVATION_TOKENS);
    for (let index = 0; index < maximumUnknownAttempts; index++)
      await journal.handle(event("started", index + 1), "A");
    const before = await journal.snapshot();
    assert.equal(before.attempts, maximumUnknownAttempts);
    assert.equal(before.tokensAtRisk, LIVE_TOKEN_BUDGET);
    assert.equal(before.remainingTokens, 0);
    assert.equal(before.remainingAttempts, LIVE_MAX_HTTP_ATTEMPTS - maximumUnknownAttempts);
    await assert.rejects(journal.handle(event("started", maximumUnknownAttempts + 1), "A"), /LIVE_CUMULATIVE_TOKEN_LIMIT/);
    assert.equal((await journal.snapshot()).attempts, maximumUnknownAttempts);
    assert.ok(before.estimatedCostMicros <= LIVE_COST_BUDGET_MICROS);
    assert.equal(before.estimatedCostMicros, maximumUnknownAttempts * LIVE_ATTEMPT_RESERVATION_MICROS);
  } finally {
    await journal.release();
  }
});

test("the expanded HTTP attempt ceiling remains enforced with observed usage", async (t) => {
  const { privateRoot, publicRoot } = await tempRoots(t);
  const journal = await LiveBudgetJournal.open(privateRoot, publicRoot, ["A"]);
  try {
    for (let requestNumber = 1; requestNumber < LIVE_MAX_HTTP_ATTEMPTS; requestNumber++) {
      await journal.handle(event("started", requestNumber), "A");
      await journal.handle({ ...event("usage", requestNumber), usage: {
        model: "muse-spark-1.3", responseId: "synthetic", inputTokens: 1, outputTokens: 1,
        totalTokens: 2, cachedInputTokens: 0, reasoningTokens: 0, durationMs: 1,
      } }, "A");
    }
    const contenders = await Promise.allSettled([70, 71, 72, 73].map((number) => journal.handle(event("started", number), "A")));
    assert.equal(contenders.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal((await journal.snapshot()).attempts, 70);
    await assert.rejects(journal.handle(event("started", 71), "A"), /LIVE_HTTP_ATTEMPT_LIMIT/);
  } finally { await journal.release(); }
});

test("concurrent journal writes retain every call and correlate repeated provider request numbers by invocation", async (t) => {
  const { privateRoot, publicRoot } = await tempRoots(t);
  const journal = await LiveBudgetJournal.open(privateRoot, publicRoot, ["A"]);
  const ids = Array.from({ length: 16 }, () => randomUUID());
  try {
    await Promise.all(ids.map((invocationId) => journal.handle({ ...event("started"), invocationId }, "A")));
    await Promise.all([...ids].reverse().map((invocationId) => {
      const tokens = ids.indexOf(invocationId) + 1;
      return journal.handle({ ...event("usage"), invocationId, usage: {
        model: "muse-spark-1.3", responseId: `synthetic-${tokens}`, inputTokens: tokens, outputTokens: tokens,
        totalTokens: tokens * 2, cachedInputTokens: 0, reasoningTokens: 0, durationMs: 1,
      } }, "A");
    }));
    const attempts = await journal.attemptsFor("A");
    assert.equal(attempts.length, ids.length);
    for (const [index, id] of ids.entries()) {
      const attempt = attempts.find((item) => item.invocationId === id);
      assert.equal(attempt?.status, "usage_recorded");
      assert.equal(attempt.inputTokens, index + 1);
      assert.equal(attempt.responseId, `synthetic-${index + 1}`);
    }
    await assert.rejects(journal.handle({ ...event("started"), invocationId: ids[0] }, "A"), /LIVE_EVENT_ID_REUSED/);
    assert.equal((await journal.snapshot()).attempts, ids.length);
  } finally { await journal.release(); }
  await assert.rejects(journal.handle({ ...event("started"), invocationId: randomUUID() }, "A"), /LIVE_JOURNAL_CLOSED/);
});

test("legacy callers fail closed instead of overlapping a reused provider request number", async (t) => {
  const { privateRoot, publicRoot } = await tempRoots(t);
  const journal = await LiveBudgetJournal.open(privateRoot, publicRoot, ["A"]);
  try {
    await journal.handle(event("started"), "A");
    await assert.rejects(journal.handle(event("started"), "A"), /LIVE_EVENT_ID_REQUIRED/);
    assert.equal((await journal.snapshot()).attempts, 1);
  } finally { await journal.release(); }
});

test("token usage above a call reservation is recorded and permanently stops further live requests", async (t) => {
  const { privateRoot, publicRoot } = await tempRoots(t);
  const journal = await LiveBudgetJournal.open(privateRoot, publicRoot, ["A", "B"]);
  try {
    await journal.handle(event("started", 1), "A");
    await assert.rejects(journal.handle({
      ...event("usage"),
      usage: {
        model: "muse-spark-1.3",
        responseId: "resp-over-reservation",
        inputTokens: LIVE_ATTEMPT_RESERVATION_TOKENS + 1,
        cachedInputTokens: 0,
        outputTokens: 0,
        totalTokens: LIVE_ATTEMPT_RESERVATION_TOKENS + 1,
        reasoningTokens: 0,
        durationMs: 480,
      },
    }, "A"), /LIVE_ATTEMPT_TOKEN_RESERVATION_EXCEEDED/);
    assert.equal((await journal.snapshot()).tokensAtRisk, LIVE_ATTEMPT_RESERVATION_TOKENS + 1);
    await assert.rejects(journal.handle(event("started", 2), "B"), /LIVE_TOKEN_RESERVATION_BREACH/);
    assert.equal((await journal.snapshot()).attempts, 1);
  } finally {
    await journal.release();
  }
});

test("live ledger lock excludes concurrent writers and public storage", async (t) => {
  const { privateRoot, publicRoot } = await tempRoots(t);
  const journal = await LiveBudgetJournal.open(privateRoot, publicRoot, ["A"]);
  try {
    await assert.rejects(LiveBudgetJournal.open(privateRoot, publicRoot, ["B"]), /LIVE_RUN_ALREADY_ACTIVE/);
  } finally {
    await journal.release();
  }
  await assert.rejects(LiveBudgetJournal.open(publicRoot, publicRoot, ["A"]), /PRIVATE_LIVE_LEDGER_REQUIRED/);
});

test("live ledger refuses symlinked private directories and writes nothing through them", async (t) => {
  const { root, privateRoot, publicRoot } = await tempRoots(t);
  const redirected = join(root, "redirected");
  await mkdir(redirected);
  await mkdir(privateRoot);
  try {
    await symlink(redirected, join(privateRoot, "lab"), "junction");
  } catch (error) {
    if (["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) {
      t.skip("The runtime does not allow temporary directory junctions.");
      return;
    }
    throw error;
  }
  await assert.rejects(LiveBudgetJournal.open(privateRoot, publicRoot, ["A"]), /PRIVATE_LIVE_LEDGER_REQUIRED/);

  const safePrivateRoot = join(root, "safe-private");
  const redirectedLiveDir = join(root, "redirected-live");
  const sentinel = join(redirectedLiveDir, "sentinel.txt");
  await mkdir(join(safePrivateRoot, "lab"), { recursive: true });
  await mkdir(redirectedLiveDir);
  await writeFile(sentinel, "sentinel", "utf8");
  await symlink(redirectedLiveDir, join(safePrivateRoot, "lab", "live"), "junction");
  await assert.rejects(LiveBudgetJournal.open(safePrivateRoot, publicRoot, ["A"]), /PRIVATE_LIVE_LEDGER_REQUIRED/);
  assert.equal(await readFile(sentinel, "utf8"), "sentinel");
});
