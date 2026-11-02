import assert from "node:assert/strict";
import { test } from "node:test";
import { clearLocalDraft, loadLocalDraft, LOCAL_DRAFT_KEY, saveLocalDraft } from "./draft-store.js";
import { EMPTY_PLAN_DRAFT } from "./plan-mapping.js";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

test("opt-in draft data can be recovered after a reload", () => {
  const storage = new MemoryStorage();
  const draft = {
    ...EMPTY_PLAN_DRAFT,
    category: "trip" as const,
    title: "Weekend by the sea",
    participantRange: "5-10" as const,
    budgetAmount: "500",
    budgetScope: "per-person" as const,
  };
  assert.equal(saveLocalDraft(storage, draft), true);
  assert.deepEqual(loadLocalDraft(storage), draft);
});

test("local draft payload contains form values only, with no image, source, evidence, or proxy data", () => {
  const storage = new MemoryStorage();
  assert.equal(saveLocalDraft(storage, { ...EMPTY_PLAN_DRAFT, title: "Invitation" }), true);
  const payload = storage.getItem(LOCAL_DRAFT_KEY) ?? "";
  assert.match(payload, /"title":"Invitation"/);
  assert.doesNotMatch(payload, /data:image|sourceText|evidence|representedParticipant|suppliedBy/);
});

test("invalid stored drafts are cleared without preventing use", () => {
  const storage = new MemoryStorage();
  storage.setItem(LOCAL_DRAFT_KEY, "{bad json");
  assert.equal(loadLocalDraft(storage), null);
  assert.equal(storage.getItem(LOCAL_DRAFT_KEY), null);
});

test("drafts can be cleared and storage failures are handled", () => {
  const storage = new MemoryStorage();
  saveLocalDraft(storage, { ...EMPTY_PLAN_DRAFT, title: "Clear me" });
  assert.equal(clearLocalDraft(storage), true);
  assert.equal(loadLocalDraft(storage), null);

  const broken = {
    getItem() { throw new Error("disabled"); },
    setItem() { throw new Error("quota"); },
    removeItem() { throw new Error("disabled"); },
  };
  assert.equal(loadLocalDraft(broken), null);
  assert.equal(saveLocalDraft(broken, EMPTY_PLAN_DRAFT), false);
  assert.equal(clearLocalDraft(broken), false);
});
