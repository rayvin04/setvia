import { gunzipSync } from "node:zlib";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

type SeedFiles = {
  globalLedgerBase64File: string;
  stageBudgetFile: string;
};

function isWithin(parent: string, candidate: string) {
  const rel = relative(parent, candidate);
  return !rel || (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel));
}

async function existingRegularFile(path: string) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("PRODUCTION_STATE_INVALID");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function readSecretFile(path: string, maxBytes: number) {
  if (!isAbsolute(path) || !(await existingRegularFile(path)))
    throw new Error("PRODUCTION_STATE_SEED_MISSING");
  const info = await lstat(path);
  if (info.size > maxBytes) throw new Error("PRODUCTION_STATE_SEED_TOO_LARGE");
  return readFile(path);
}

async function seedOnce(destination: string, contents: Uint8Array) {
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  if (await existingRegularFile(destination)) return;
  try {
    await writeFile(destination, contents, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (!(await existingRegularFile(destination))) throw new Error("PRODUCTION_STATE_INVALID");
  }
}

/** Seeds only the pre-existing usage ledgers. Room snapshots remain private to this deployment. */
export async function seedProductionBudgetLedgers(
  privateRoot: string,
  publicRoot: string,
  files: SeedFiles,
) {
  const privatePath = resolve(privateRoot);
  const publicPath = resolve(publicRoot);
  if (isWithin(publicPath, privatePath)) throw new Error("PRIVATE_STORAGE_REQUIRED");

  const globalPath = resolve(privatePath, "lab", "live", "live-budget-ledger-v1.json");
  const stagePath = resolve(privatePath, "room-state", "integration-budget.ndjson");
  if (!isWithin(privatePath, globalPath) || !isWithin(privatePath, stagePath))
    throw new Error("PRIVATE_STORAGE_REQUIRED");

  if (!(await existingRegularFile(globalPath))) {
    const encoded = await readSecretFile(files.globalLedgerBase64File, 900_000);
    const base64 = encoded.toString("ascii").trim();
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))
      throw new Error("PRODUCTION_STATE_SEED_INVALID");
    const compressed = Buffer.from(base64, "base64");
    if (compressed.toString("base64") !== base64) throw new Error("PRODUCTION_STATE_SEED_INVALID");
    const ledger = gunzipSync(compressed, { maxOutputLength: 12 * 1024 * 1024 });
    if (!ledger.length || ledger[ledger.length - 1] !== 10) throw new Error("PRODUCTION_STATE_SEED_INVALID");
    await seedOnce(globalPath, ledger);
  }

  if (!(await existingRegularFile(stagePath))) {
    const stageLedger = await readSecretFile(files.stageBudgetFile, 128_000);
    if (!stageLedger.length || stageLedger[stageLedger.length - 1] !== 10)
      throw new Error("PRODUCTION_STATE_SEED_INVALID");
    await seedOnce(stagePath, stageLedger);
  }
}
