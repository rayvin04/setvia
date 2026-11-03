import {
  mkdir,
  readFile,
  rename,
  writeFile,
  open,
  stat,
} from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { RoomSchema, type Room } from "./contracts.js";

export class StateError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "StateError";
  }
}
export interface Persistence {
  load(id: string): Promise<Room | null>;
  save(room: Room): Promise<void>;
}
export class MemoryPersistence implements Persistence {
  private rooms = new Map<string, Room>();
  async load(id: string) {
    return structuredClone(this.rooms.get(id) ?? null);
  }
  async save(room: Room) {
    this.rooms.set(room.id, RoomSchema.parse(structuredClone(room)));
  }
}
export class JsonPersistence implements Persistence {
  readonly root: string;
  constructor(root: string, publicRepository: string) {
    this.root = resolve(root);
    const rel = relative(resolve(publicRepository), this.root);
    if (
      !isAbsolute(root) ||
      !rel ||
      (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel))
    )
      throw new StateError("PRIVATE_STORAGE_REQUIRED");
  }
  private path(id: string) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new StateError("INVALID_ID");
    return resolve(this.root, id + ".json");
  }
  async load(id: string) {
    const path = this.path(id);
    try {
      if ((await stat(path)).size > 4 * 1024 * 1024)
        throw new StateError("CORRUPT_SNAPSHOT");
      const parsed = RoomSchema.parse(JSON.parse(await readFile(path, "utf8")));
      if (parsed.id !== id) throw new StateError("CORRUPT_SNAPSHOT");
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      // Preserve corrupt evidence privately; never silently restore an older budget/approval.
      try {
        await rename(path, path + "." + randomUUID() + ".corrupt");
      } catch {
        /* retain original on rename failure */
      }
      throw new StateError("CORRUPT_SNAPSHOT");
    }
  }
  async save(room: Room) {
    const parsed = RoomSchema.parse(room);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const target = this.path(parsed.id);
    const temporary = target + "." + randomUUID() + ".tmp";
    const serialized = JSON.stringify(parsed);
    if (Buffer.byteLength(serialized) > 4 * 1024 * 1024)
      throw new StateError("SNAPSHOT_LIMIT");
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(serialized);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, target);
    // Directory fsync is not supported on all Windows filesystems. The rename is
    // atomic; deployment-specific crash durability still requires verification.
    if (process.platform !== "win32") {
      const directory = await open(this.root, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
  }
}
export class RoomStore {
  private rooms = new Map<string, Room>();
  private queues = new Map<string, Promise<unknown>>();
  constructor(readonly persistence: Persistence) {}
  async transaction<T>(
    id: string,
    change: (room: Room | null) => T | Promise<T>,
  ): Promise<T> {
    const previous = this.queues.get(id) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        let current = this.rooms.get(id) ?? (await this.persistence.load(id));
        if (current && !this.rooms.has(id) && current.activeCycleId) {
          current.activeCycleId = null;
          if (current.lastCycle) {
            current.lastCycle.outcome = "BLOCKED";
            current.lastCycle.reason = "RESTART_INTERRUPTED";
            current.lastCycle.finalEvaluation = null;
            current.lastCycle.readiness = current.readiness;
          }
          await this.persistence.save(current);
        }
        const before = current ? JSON.stringify(current) : null;
        const draft = current ? structuredClone(current) : null;
        const result = await change(draft);
        if (draft) {
          if (JSON.stringify(draft) !== before)
            await this.persistence.save(draft);
          this.rooms.set(id, structuredClone(draft));
        }
        return result;
      });
    this.queues.set(id, next);
    try {
      return await next;
    } finally {
      if (this.queues.get(id) === next) this.queues.delete(id);
    }
  }
  async create(room: Room) {
    await this.transaction(room.id, async (existing) => {
      if (existing) throw new StateError("ROOM_EXISTS");
      const parsed = RoomSchema.parse(room);
      await this.persistence.save(parsed);
      this.rooms.set(room.id, structuredClone(parsed));
    });
  }
  async read(id: string): Promise<Room> {
    return this.transaction(id, (room) => {
      if (!room) throw new StateError("ROOM_NOT_FOUND");
      return structuredClone(room);
    });
  }
}

