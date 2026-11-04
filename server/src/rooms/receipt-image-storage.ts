import { randomUUID, createHash } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { MAX_RECEIPT_IMAGE_BYTES } from "../ai/muse-image.js";
import { StateError } from "../agents/store.js";

export const RECEIPT_IMAGE_MAX_ATTEMPTS = 100;
export const RECEIPT_IMAGE_ATTEMPT_COST_MICROS = 10_000;

const BudgetEntrySchema = z
  .object({
    id: z.string().uuid(),
    reservedAt: z.iso.datetime(),
    outcome: z.enum(["reserved", "returned", "provider_error", "unknown"]),
    httpStatus: z.number().int().min(100).max(599).nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
    outputBytes: z.number().int().positive().max(MAX_RECEIPT_IMAGE_BYTES).nullable(),
  })
  .strict();

const BudgetSnapshotSchema = z
  .object({
    version: z.literal("receipt-image-budget-v1"),
    attempts: z.array(BudgetEntrySchema).max(RECEIPT_IMAGE_MAX_ATTEMPTS),
  })
  .strict();

function ensureOutsidePublicRoot(privateRoot: string, publicRoot: string) {
  const privatePath = resolve(privateRoot);
  const publicPath = resolve(publicRoot);
  const rel = relative(publicPath, privatePath);
  if (privatePath === publicPath || (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel)))
    throw new StateError("PRIVATE_STORAGE_REQUIRED");
  return privatePath;
}

async function atomicWrite(path: string, contents: string) {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path + "." + randomUUID() + ".tmp";
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  if (process.platform !== "win32") {
    const folder = await open(directory, "r");
    try { await folder.sync(); } finally { await folder.close(); }
  }
}

export class ReceiptImageBudget {
  private attempts: z.infer<typeof BudgetEntrySchema>[];
  private tail: Promise<void> = Promise.resolve();
  private constructor(private readonly path: string, attempts: z.infer<typeof BudgetEntrySchema>[]) {
    this.attempts = attempts;
  }

  static async open(privateRoot: string, publicRoot: string) {
    const root = ensureOutsidePublicRoot(privateRoot, publicRoot);
    await mkdir(root, { recursive: true, mode: 0o700 });
    await assertRealOutsidePublicRoot(root, publicRoot);
    const path = resolve(root, "receipt-image-budget-v1.json");
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024)
        throw new StateError("RECEIPT_IMAGE_BUDGET_INVALID");
      const parsed = BudgetSnapshotSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
      if (!parsed.success) throw new StateError("RECEIPT_IMAGE_BUDGET_INVALID");
      return new ReceiptImageBudget(path, parsed.data.attempts);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return new ReceiptImageBudget(path, []);
      throw error instanceof StateError ? error : new StateError("RECEIPT_IMAGE_BUDGET_INVALID");
    }
  }

  get usedAttempts() { return this.attempts.length; }
  get remainingAttempts() { return Math.max(0, RECEIPT_IMAGE_MAX_ATTEMPTS - this.usedAttempts); }

  async reserve() {
    const id = randomUUID();
    const operation = this.tail.catch(() => {}).then(async () => {
      if (this.attempts.length >= RECEIPT_IMAGE_MAX_ATTEMPTS)
        throw new StateError("RECEIPT_IMAGE_BUDGET_LIMIT");
      this.attempts = [
        ...this.attempts,
        {
          id,
          reservedAt: new Date().toISOString(),
          outcome: "reserved",
          httpStatus: null,
          durationMs: null,
          outputBytes: null,
        },
      ];
      await this.persist();
      return id;
    });
    this.tail = operation.then(() => {}, () => {});
    return operation;
  }

  async settle(id: string, result: {
    outcome: "returned" | "provider_error" | "unknown";
    httpStatus: number | null;
    durationMs: number;
    outputBytes: number | null;
  }) {
    const operation = this.tail.catch(() => {}).then(async () => {
      const index = this.attempts.findIndex((entry) => entry.id === id);
      if (index < 0) throw new StateError("RECEIPT_IMAGE_BUDGET_INVALID");
      if (this.attempts[index]!.outcome !== "reserved") return;
      const updated = [...this.attempts];
      updated[index] = { ...updated[index]!, ...result };
      this.attempts = updated;
      await this.persist();
    });
    this.tail = operation.then(() => {}, () => {});
    await operation;
  }

  async releaseUnsent(id: string) {
    const operation = this.tail.catch(() => {}).then(async () => {
      const entry = this.attempts.find((attempt) => attempt.id === id);
      if (!entry) throw new StateError("RECEIPT_IMAGE_BUDGET_INVALID");
      if (entry.outcome !== "reserved") return;
      this.attempts = this.attempts.filter((attempt) => attempt.id !== id);
      await this.persist();
    });
    this.tail = operation.then(() => {}, () => {});
    await operation;
  }

  async close() { await this.tail; }

  private async persist() {
    const snapshot = BudgetSnapshotSchema.parse({ version: "receipt-image-budget-v1", attempts: this.attempts });
    await atomicWrite(this.path, JSON.stringify(snapshot) + "\n");
  }
}

export class ReceiptImageAssetStore {
  private readonly root: string;
  constructor(privateRoot: string, private readonly publicRoot: string) {
    this.root = resolve(ensureOutsidePublicRoot(privateRoot, publicRoot), "receipt-images");
  }

  private path(roomId: string) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(roomId)) throw new StateError("INVALID_ID");
    return resolve(this.root, roomId + ".webp");
  }

  async save(roomId: string, bytes: Buffer) {
    if (!isWebp(bytes) || bytes.length > MAX_RECEIPT_IMAGE_BYTES)
      throw new StateError("RECEIPT_IMAGE_INVALID_OUTPUT");
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await assertRealOutsidePublicRoot(this.root, this.publicRoot);
    const target = this.path(roomId);
    const temporary = target + "." + randomUUID() + ".tmp";
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, target);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
    if (process.platform !== "win32") {
      const folder = await open(this.root, "r");
      try { await folder.sync(); } finally { await folder.close(); }
    }
    return {
      byteLength: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }

  async read(roomId: string) {
    await assertRealOutsidePublicRoot(this.root, this.publicRoot);
    const target = this.path(roomId);
    try {
      const stat = await lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_RECEIPT_IMAGE_BYTES)
        throw new StateError("RECEIPT_IMAGE_STORAGE_INVALID");
      const bytes = await readFile(target);
      if (!isWebp(bytes)) throw new StateError("RECEIPT_IMAGE_STORAGE_INVALID");
      return bytes;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new StateError("RECEIPT_IMAGE_NOT_READY");
      throw error;
    }
  }
}

async function assertRealOutsidePublicRoot(privatePath: string, publicRoot: string) {
  const [privateReal, publicReal] = await Promise.all([
    realpath(privatePath),
    realpath(publicRoot).catch(() => resolve(publicRoot)),
  ]);
  const rel = relative(publicReal, privateReal);
  if (privateReal === publicReal || (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel)))
    throw new StateError("PRIVATE_STORAGE_REQUIRED");
  const stat = await lstat(privatePath);
  if (stat.isSymbolicLink()) throw new StateError("PRIVATE_STORAGE_REQUIRED");
  if (stat.isDirectory() && (stat.mode & 0o077) !== 0) await chmod(privatePath, 0o700);
}

export function isWebp(bytes: Buffer) {
  return bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP";
}
