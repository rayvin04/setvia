import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedProductionBudgetLedgers } from "./storage-seed.js";

test("production bootstrap imports the prior usage ledgers once and keeps the durable copies authoritative", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "setvia-storage-seed-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const privateRoot = join(root, "private");
  const publicRoot = join(root, "repo");
  const secrets = join(root, "secrets");
  await mkdir(secrets, { recursive: true });
  const globalLedger = Buffer.from('{"version":"live-budget-ledger-v1"}\n');
  const stageLedger = Buffer.from('{"tokens":64000,"costMicros":104000}\n');
  const globalSeed = join(secrets, "global.b64");
  const stageSeed = join(secrets, "stage.ndjson");
  await writeFile(globalSeed, gzipSync(globalLedger).toString("base64"));
  await writeFile(stageSeed, stageLedger);

  const files = { globalLedgerBase64File: globalSeed, stageBudgetFile: stageSeed };
  await seedProductionBudgetLedgers(privateRoot, publicRoot, files);
  const copiedGlobal = join(privateRoot, "lab", "live", "live-budget-ledger-v1.json");
  const copiedStage = join(privateRoot, "room-state", "integration-budget.ndjson");
  assert.deepEqual(await readFile(copiedGlobal), globalLedger);
  assert.deepEqual(await readFile(copiedStage), stageLedger);

  await writeFile(copiedGlobal, Buffer.from("new durable history\n"));
  await seedProductionBudgetLedgers(privateRoot, publicRoot, files);
  assert.equal(await readFile(copiedGlobal, "utf8"), "new durable history\n");
});
