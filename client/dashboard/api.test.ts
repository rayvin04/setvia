import test from "node:test";
import assert from "node:assert/strict";
import { createPreviewFixture } from "../../server/src/dashboard/fixtures.js";
import { fetchPreview } from "./api.js";

test("preview API loads the selected offline scenario, participant and frame", async () => {
  const fixture = await createPreviewFixture("study");
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedInit = init;
    return {
      ok: true,
      async json() {
        return {
          initial: fixture.initial.alex,
          updated: fixture.updated.alex,
          revised: fixture.revised.alex,
          review: fixture.review.alex,
          carpool: fixture.carpool.alex,
        };
      },
    } as Response;
  };
  try {
    const snapshot = await fetchPreview(
      "study",
      "alex",
      "review",
      new AbortController().signal,
    );
    assert.equal(requestedUrl, "/dashboard-preview/study/alex.json");
    assert.equal(requestedInit?.credentials, "omit");
    assert.equal(requestedInit?.cache, "force-cache");
    assert.equal(snapshot.source, "synthetic");
    assert.equal(snapshot.room.eventType, "Group project");
    assert.equal(snapshot.room.loopState, "COMPLETED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preview API rejects an unexpected non-synthetic fixture", async () => {
  const fixture = await createPreviewFixture("beach");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        initial: {
          alex: { ...fixture.initial.alex, source: "room" },
        },
      };
    },
  }) as Response;
  try {
    await assert.rejects(
      fetchPreview(
        "beach",
        "alex",
        "initial",
        new AbortController().signal,
      ),
      /unsupported room view/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
