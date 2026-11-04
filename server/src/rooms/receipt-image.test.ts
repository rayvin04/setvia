import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fixture } from "../agents/fixtures.js";
import { projectReceiptImageStatus } from "../agents/contracts.js";
import { ReceiptImageManager } from "./receipt-image.js";
import { MuseImageError } from "../ai/muse-image.js";

const webp = Buffer.from("RIFF0000WEBP", "ascii");

async function waitForStatus(
  store: Awaited<ReturnType<typeof fixture>>["store"],
  roomId: string,
  status: "ready" | "failed" | "capped",
) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const room = await store.read(roomId);
    if (room.receiptImage.status === status) return room;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`Receipt image did not reach ${status}`);
}

async function withManager(
  run: (f: Awaited<ReturnType<typeof fixture>>, paths: { root: string; publicRoot: string; privateRoot: string }) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "setvia-receipt-image-"));
  const publicRoot = join(root, "public");
  const privateRoot = join(root, "private");
  await mkdir(publicRoot, { recursive: true });
  const f = await fixture([], "trip");
  try {
    await run(f, { root, publicRoot, privateRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function requestForRoom(
  store: Awaited<ReturnType<typeof fixture>>["store"],
  roomId: string,
  retry = false,
) {
  const room = await store.read(roomId);
  return { expectedRevision: room.revision, proposalVersion: room.proposalVersion, retry };
}

test("receipt image requests coalesce, keep bytes private, and require room authorization", async () => {
  await withManager(async (f, paths) => {
    let generationStarted!: () => void;
    const started = new Promise<void>((resolve) => { generationStarted = resolve; });
    let finishGeneration!: () => void;
    const gate = new Promise<void>((resolve) => { finishGeneration = resolve; });
    let generationCount = 0;
    const manager = await ReceiptImageManager.open({
      store: f.store,
      ...paths,
      apiKey: "test-only-key",
      publishGroup: () => {},
      generateImage: async () => {
        generationCount++;
        generationStarted();
        await gate;
        return webp;
      },
    });
    try {
      const input = await requestForRoom(f.store, f.roomId);
      const first = await manager.request(f.roomId, f.auth, input);
      assert.equal(first.status, "generating");
      await started;
      const duplicate = await manager.request(f.roomId, f.auth, input);
      assert.equal(duplicate.status, "generating");
      assert.equal(generationCount, 1);

      finishGeneration();
      const ready = await waitForStatus(f.store, f.roomId, "ready");
      assert.equal(ready.receiptImage.status, "ready");
      assert.equal(ready.receiptImage.byteLength, webp.length);
      assert.doesNotMatch(JSON.stringify(ready), /UklGR|RIFF0000WEBP/);

      const image = await manager.read(f.roomId, f.other);
      assert.deepEqual(image.bytes, webp);
      await assert.rejects(
        manager.read(f.roomId, { participantId: f.auth.participantId, token: "0".repeat(64) }),
        (error: unknown) => (error as { code?: string }).code === "UNAUTHORIZED",
      );
    } finally {
      await manager.close();
    }
  });
});

test("receipt image permits one explicit retry after a provider failure", async () => {
  await withManager(async (f, paths) => {
    let generationCount = 0;
    const manager = await ReceiptImageManager.open({
      store: f.store,
      ...paths,
      apiKey: "test-only-key",
      publishGroup: () => {},
      generateImage: async () => {
        generationCount++;
        if (generationCount === 1) throw new MuseImageError("provider", 503);
        return webp;
      },
    });
    try {
      const initial = await requestForRoom(f.store, f.roomId);
      await manager.request(f.roomId, f.auth, initial);
      const failed = await waitForStatus(f.store, f.roomId, "failed");
      assert.equal(projectReceiptImageStatus(failed.receiptImage).retryAvailable, true);

      const retryInput = await requestForRoom(f.store, f.roomId, true);
      await manager.request(f.roomId, f.auth, retryInput);
      const ready = await waitForStatus(f.store, f.roomId, "ready");
      assert.equal(ready.receiptImage.attemptCount, 2);
      assert.equal(generationCount, 2);

      const third = await manager.request(f.roomId, f.auth, { ...retryInput, retry: true });
      assert.equal(third.status, "ready");
      assert.equal(generationCount, 2);
    } finally {
      await manager.close();
    }
  });
});

test("a room revision race releases an unsent image budget reservation", async () => {
  await withManager(async (f, paths) => {
    let generationCount = 0;
    const manager = await ReceiptImageManager.open({
      store: f.store,
      ...paths,
      apiKey: "test-only-key",
      publishGroup: () => {},
      beforeAttempt: async () => {
        const room = await f.store.read(f.roomId);
        await f.engine.rooms.revise(f.roomId, f.auth, room.revision, {
          ...room.proposal,
          label: "A changed plan",
        });
      },
      generateImage: async () => {
        generationCount++;
        return webp;
      },
    });
    try {
      const stale = await requestForRoom(f.store, f.roomId);
      await assert.rejects(
        manager.request(f.roomId, f.auth, stale),
        (error: unknown) => (error as { code?: string }).code === "STALE_STATE",
      );
      assert.equal(generationCount, 0);
      const budget = JSON.parse(await readFile(join(paths.privateRoot, "receipt-image-budget-v1.json"), "utf8")) as { attempts: unknown[] };
      assert.deepEqual(budget.attempts, []);
    } finally {
      await manager.close();
    }
  });
});
