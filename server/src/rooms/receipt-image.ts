import { createHash, randomUUID } from "node:crypto";
import { isMuseImageConfigured, MuseImageError, generateReceiptImage } from "../ai/muse-image.js";
import {
  projectReceiptImageStatus,
  type Auth,
  type Room,
} from "../agents/contracts.js";
import { authorize } from "../agents/rooms.js";
import { RoomStore, StateError } from "../agents/store.js";
import type { GenerateReceiptImageRequest } from "../../../shared/room-api.js";
import {
  ReceiptImageAssetStore,
  ReceiptImageBudget,
  isWebp,
} from "./receipt-image-storage.js";

interface ActiveImageTask {
  promise: Promise<void>;
  controller: AbortController;
  requestId: string;
}

interface ReceiptImageManagerOptions {
  store: RoomStore;
  privateRoot: string;
  publicRoot: string;
  beforeAttempt?: () => void | Promise<void>;
  publishGroup(roomId: string): void | Promise<void>;
  apiKey?: string;
  budget?: ReceiptImageBudget | null;
  generateImage?: typeof generateReceiptImage;
}

type ReceiptImageStatus = ReturnType<typeof projectReceiptImageStatus>;

export class ReceiptImageManager {
  private readonly assets: ReceiptImageAssetStore;
  private readonly active = new Map<string, ActiveImageTask>();
  private readonly busyRooms = new Set<string>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly budget: ReceiptImageBudget | null;
  private closed = false;

  private constructor(private readonly options: ReceiptImageManagerOptions) {
    this.assets = new ReceiptImageAssetStore(options.privateRoot, options.publicRoot);
    this.budget = options.budget ?? null;
  }

  static async open(options: Omit<ReceiptImageManagerOptions, "budget">) {
    let budget: ReceiptImageBudget | null = null;
    try {
      budget = await ReceiptImageBudget.open(options.privateRoot, options.publicRoot);
    } catch {
      // A broken optional image ledger disables this feature only; it must not
      // prevent the independent live planning runtime from starting.
    }
    return new ReceiptImageManager({ ...options, budget });
  }

  request(roomId: string, auth: Auth, input: GenerateReceiptImageRequest) {
    if (this.closed) return Promise.reject(new StateError("RUNTIME_CLOSED"));
    return this.serial(roomId, () => this.requestSerial(roomId, auth, input));
  }

  async read(roomId: string, auth: Auth) {
    const room = await this.options.store.read(roomId);
    authorize(room, auth);
    if (room.receiptImage.status !== "ready") throw new StateError("RECEIPT_IMAGE_NOT_READY");
    const bytes = await this.assets.read(roomId);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (
      room.receiptImage.byteLength !== bytes.length ||
      room.receiptImage.sha256 !== digest ||
      !isWebp(bytes)
    ) throw new StateError("RECEIPT_IMAGE_STORAGE_INVALID");
    return { bytes, sha256: digest };
  }

  recover(roomId: string, auth: Auth) {
    if (this.closed) return Promise.resolve();
    return this.serial(roomId, () => this.recoverSerial(roomId, auth));
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const task of this.active.values()) task.controller.abort();
    await Promise.allSettled([...this.active.values()].map((task) => task.promise));
    await this.budget?.close();
  }

  private serial<T>(roomId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(roomId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(work);
    this.queues.set(roomId, next);
    return next.finally(() => {
      if (this.queues.get(roomId) === next) this.queues.delete(roomId);
    });
  }

  private async requestSerial(roomId: string, auth: Auth, input: GenerateReceiptImageRequest) {
    let room = await this.options.store.read(roomId);
    authorize(room, auth);
    this.assertCurrent(room, auth, input.expectedRevision, input.proposalVersion);

    if (room.receiptImage.status === "generating") {
      if (!this.active.has(roomId)) await this.recoverSerial(roomId, auth);
      room = await this.options.store.read(roomId);
      authorize(room, auth);
      return projectReceiptImageStatus(room.receiptImage);
    }
    if (room.receiptImage.status === "ready" || room.receiptImage.status === "capped")
      return projectReceiptImageStatus(room.receiptImage);
    if (room.receiptImage.status === "failed" && !input.retry)
      return projectReceiptImageStatus(room.receiptImage);
    if (input.retry && room.receiptImage.status !== "failed")
      throw new StateError("INVALID_RECEIPT_IMAGE_RETRY");
    if (room.receiptImage.status === "failed" && room.receiptImage.attemptCount !== 1)
      return projectReceiptImageStatus(room.receiptImage);
    if (room.receiptImage.status === "idle" && room.receiptImage.attemptCount !== 0)
      throw new StateError("RECEIPT_IMAGE_STATE_INVALID");
    if (!isMuseImageConfigured(this.options.apiKey)) throw new StateError("RECEIPT_IMAGE_NOT_CONFIGURED");
    if (!this.budget) throw new StateError("RECEIPT_IMAGE_BUDGET_UNAVAILABLE");
    await this.options.beforeAttempt?.();

    this.busyRooms.add(roomId);
    let reservedAttemptId: string | null = null;
    let handedOffToProvider = false;
    try {
      let attemptId: string;
      try {
        attemptId = await this.budget.reserve();
        reservedAttemptId = attemptId;
      } catch (error) {
        if (!(error instanceof StateError) || error.code !== "RECEIPT_IMAGE_BUDGET_LIMIT") throw error;
        const capped = await this.options.store.transaction(roomId, (draft) => {
          if (!draft) throw new StateError("ROOM_NOT_FOUND");
          authorize(draft, auth);
          this.assertCurrent(draft, auth, input.expectedRevision, input.proposalVersion);
          draft.receiptImage = {
            ...draft.receiptImage,
            status: "capped",
            activeRequestId: null,
            updatedAt: new Date().toISOString(),
            lastFailure: null,
          };
          this.bumpPublicSequence(draft);
          return projectReceiptImageStatus(draft.receiptImage);
        });
        await this.publish(roomId);
        return capped;
      }

      const requestId = randomUUID();
      const generating = await this.options.store.transaction(roomId, (draft) => {
        if (!draft) throw new StateError("ROOM_NOT_FOUND");
        authorize(draft, auth);
        this.assertCurrent(draft, auth, input.expectedRevision, input.proposalVersion);
        const current = draft.receiptImage;
        if (current.status !== "idle" && current.status !== "failed")
          return projectReceiptImageStatus(current);
        if (input.retry && (current.status !== "failed" || current.attemptCount !== 1))
          throw new StateError("INVALID_RECEIPT_IMAGE_RETRY");
        const attemptCount = current.attemptCount + 1;
        if (attemptCount > 2) return projectReceiptImageStatus(current);
        draft.receiptImage = {
          ...current,
          status: "generating",
          attemptCount,
          proposalVersion: draft.proposalVersion,
          updatedAt: new Date().toISOString(),
          activeRequestId: requestId,
          byteLength: null,
          sha256: null,
          lastFailure: null,
        };
        this.bumpPublicSequence(draft);
        return projectReceiptImageStatus(draft.receiptImage);
      });

      if (generating.status !== "generating") {
        return generating;
      }

      await this.publish(roomId);
      const controller = new AbortController();
      const task = this.runGeneration(
        roomId,
        auth,
        requestId,
        attemptId,
        room.eventType,
        room.proposal.label,
        controller,
      );
      this.active.set(roomId, { promise: task, controller, requestId });
      handedOffToProvider = true;
      void task.catch(() => {});
      return generating;
    } finally {
      if (reservedAttemptId && !handedOffToProvider) {
        await this.budget.releaseUnsent(reservedAttemptId).catch(() => {});
      }
      if (!this.active.has(roomId)) this.busyRooms.delete(roomId);
    }
  }

  private async runGeneration(
    roomId: string,
    auth: Auth,
    requestId: string,
    attemptId: string,
    eventType: string,
    proposalLabel: string,
    controller: AbortController,
  ) {
    const startedAt = Date.now();
    let ledgerSettled = false;
    let imageStored = false;
    try {
      const bytes = await (this.options.generateImage ?? generateReceiptImage)(eventType, {
        proposalLabel,
        apiKey: this.options.apiKey,
        signal: controller.signal,
      });
      await this.budget!.settle(attemptId, {
        outcome: "returned",
        httpStatus: 200,
        durationMs: Date.now() - startedAt,
        outputBytes: bytes.length,
      });
      ledgerSettled = true;
      const metadata = await this.assets.save(roomId, bytes);
      imageStored = true;
      await this.options.store.transaction(roomId, (draft) => {
        if (!draft) throw new StateError("ROOM_NOT_FOUND");
        if (
          draft.receiptImage.status !== "generating" ||
          draft.receiptImage.activeRequestId !== requestId
        ) return;
        draft.receiptImage = {
          ...draft.receiptImage,
          status: "ready",
          activeRequestId: null,
          byteLength: metadata.byteLength,
          sha256: metadata.sha256,
          updatedAt: new Date().toISOString(),
          lastFailure: null,
        };
        this.bumpPublicSequence(draft);
      });
    } catch (error) {
      const metaError = error instanceof MuseImageError ? error : null;
      if (!ledgerSettled) {
        await this.budget!.settle(attemptId, {
          outcome: metaError?.code === "provider" ? "provider_error" : "unknown",
          httpStatus: metaError?.httpStatus ?? null,
          durationMs: Date.now() - startedAt,
          outputBytes: null,
        }).catch(() => {});
      }
      if (!imageStored) {
        await this.options.store.transaction(roomId, (draft) => {
          if (!draft) throw new StateError("ROOM_NOT_FOUND");
          if (
            draft.receiptImage.status !== "generating" ||
            draft.receiptImage.activeRequestId !== requestId
          ) return;
          draft.receiptImage = {
            ...draft.receiptImage,
            status: "failed",
            activeRequestId: null,
            updatedAt: new Date().toISOString(),
            lastFailure: metaError?.code === "provider"
              ? "provider"
              : metaError?.code === "invalid_response"
                ? "invalid_output"
                : metaError?.code === "transport"
                  ? "transport"
                  : "storage",
          };
          this.bumpPublicSequence(draft);
        }).catch(() => {});
      }
    } finally {
      const active = this.active.get(roomId);
      if (active?.requestId === requestId) this.active.delete(roomId);
      this.busyRooms.delete(roomId);
      try { await this.recover(roomId, auth); } catch { /* next authorized snapshot can recover */ }
      await this.publish(roomId);
    }
  }

  private async recoverSerial(roomId: string, auth: Auth) {
    const room = await this.options.store.read(roomId);
    authorize(room, auth);
    if (room.receiptImage.status !== "generating" || this.busyRooms.has(roomId)) return;
    let stored: { byteLength: number; sha256: string } | null = null;
    try {
      const bytes = await this.assets.read(roomId);
      stored = { byteLength: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    } catch {
      // An interrupted call cannot safely be replayed without an explicit retry.
    }
    const changed = await this.options.store.transaction(roomId, (draft) => {
      if (!draft) throw new StateError("ROOM_NOT_FOUND");
      authorize(draft, auth);
      if (
        draft.receiptImage.status !== "generating" ||
        draft.receiptImage.activeRequestId !== room.receiptImage.activeRequestId
      ) return false;
      draft.receiptImage = stored
        ? {
            ...draft.receiptImage,
            status: "ready",
            activeRequestId: null,
            byteLength: stored.byteLength,
            sha256: stored.sha256,
            updatedAt: new Date().toISOString(),
            lastFailure: null,
          }
        : {
            ...draft.receiptImage,
            status: "failed",
            activeRequestId: null,
            updatedAt: new Date().toISOString(),
            lastFailure: "interrupted",
          };
      this.bumpPublicSequence(draft);
      return true;
    });
    if (changed) await this.publish(roomId);
  }

  private assertCurrent(room: Room, auth: Auth, expectedRevision: number, proposalVersion: number) {
    const viewerRevision = room.revision + (room.privateRevisions[auth.participantId] ?? 0);
    if (viewerRevision !== expectedRevision || room.proposalVersion !== proposalVersion)
      throw new StateError("STALE_STATE");
  }

  private bumpPublicSequence(room: Room) {
    // Illustration status is public activity, but it does not change the plan,
    // approvals, or proposal revision.
    room.publicSequence++;
    room.eventSequence++;
  }

  private async publish(roomId: string) {
    try { await this.options.publishGroup(roomId); } catch { /* Next snapshot remains authoritative. */ }
  }
}
