import test from "node:test";
import assert from "node:assert/strict";
import {
  approveVersion,
  initialPreview,
  initialVersion,
  previewReducer,
  revisePreview,
} from "./preview-state";
import { initialHeaderState, nextHeaderState } from "./header-state";
import {
  coreFieldEdits,
  peopleValue,
  scheduleValue,
  validateStartingPoint,
} from "./planning-core";
import {
  EMPTY_PLAN_DRAFT,
  editDraftField,
  type PlanDraft,
} from "./plan-mapping";
import {
  loadLocalDraft,
  saveLocalDraft,
  type DraftStorage,
} from "./draft-store";

test("the Sunday example changes individual votes, inspects an issue, and resets completely", () => {
  const initial = initialPreview();
  let state = previewReducer(initial, {
    type: "toggle-approval",
    person: "Selena",
  });
  assert.equal(state.approvals.length, 3);
  state = previewReducer(state, { type: "toggle-approval", person: "Hu Tao" });
  assert.deepEqual(state.approvals, ["Furina", "Selena"]);
  state = previewReducer(state, { type: "inspect", detail: "open" });
  assert.equal(state.detail, "open");
  assert.deepEqual(previewReducer(state, { type: "reset" }), initial);
  assert.deepEqual(
    initial,
    initialPreview(),
    "actions must not mutate the initial example",
  );
});

test("a changed proposal starts a new approval version and reset restores v3 votes", () => {
  const v3 = initialVersion();
  const v4 = revisePreview(v3);
  assert.deepEqual(v4, { version: 4, approvals: [] });
  const approved = approveVersion(v4, "Selena");
  assert.deepEqual(
    approveVersion(approved, "Selena"),
    approved,
    "same person cannot approve twice",
  );
  assert.equal(approved.approvals.length, 1);
  assert.deepEqual(v3, initialVersion());
});

test("header requires sustained intent, tolerates jitter, and returns at the top", () => {
  let state = nextHeaderState(initialHeaderState, 80);
  assert.equal(state.compact, true);
  assert.equal(state.hidden, false);
  state = nextHeaderState(state, 300);
  assert.equal(state.hidden, true);
  for (const y of [299, 301, 300, 298]) state = nextHeaderState(state, y);
  assert.equal(
    state.hidden,
    true,
    "tiny reverse movements should not reveal it",
  );
  state = nextHeaderState(state, 270);
  assert.equal(state.hidden, false);
  state = nextHeaderState(state, 35);
  assert.equal(state.compact, false);
  assert.equal(state.hidden, false);
});

test("header compact state has hysteresis and overscroll is clamped", () => {
  let state = nextHeaderState(initialHeaderState, 71);
  assert.equal(state.compact, false);
  state = nextHeaderState(state, 73);
  state = nextHeaderState(state, 50);
  assert.equal(state.compact, true);
  assert.equal(nextHeaderState(state, -15).hidden, false);
});

function applyCore(
  draft: PlanDraft,
  field: Parameters<typeof coreFieldEdits>[0],
  value: string,
) {
  let next = draft;
  for (const [key, entry] of coreFieldEdits(field, value)) {
    next = editDraftField(next, {}, new Set(), key, entry).draft;
  }
  return next;
}

test("five-field edits preserve legacy details and do not confirm expected attendees", () => {
  const draft: PlanDraft = {
    ...EMPTY_PLAN_DRAFT,
    category: "trip",
    constraints: "Step-free venue",
    budgetAmount: "2500",
    budgetScope: "per-person",
    time: "8 AM",
    date: "Sunday",
    participantStatus: "confirmed",
  };
  assert.equal(scheduleValue(draft), "Sunday · 8 AM");
  const named = applyCore(draft, "title", "Beach weekend");
  assert.equal(named.time, "8 AM", "untouched schedule must survive");
  const people = applyCore(named, "people", "8");
  assert.equal(people.participantRange, "exact");
  assert.equal(people.participantStatus, "estimated");
  assert.equal(peopleValue(people), "8");
  const flexible = applyCore(people, "schedule", "Not decided yet");
  assert.equal(flexible.date, "Not decided yet");
  assert.equal(flexible.time, "");
  assert.equal(flexible.constraints, draft.constraints);
  assert.equal(flexible.budgetScope, draft.budgetScope);
  assert.deepEqual(validateStartingPoint(flexible), {});
});

test("starting accepts unknown details but rejects a blank name or invalid headcount", () => {
  assert.equal(
    validateStartingPoint(EMPTY_PLAN_DRAFT).title,
    "Give your plan a name.",
  );
  assert.deepEqual(
    validateStartingPoint({ ...EMPTY_PLAN_DRAFT, title: "An idea" }),
    {},
  );
  for (const count of ["0", "-1", "2.5", "many", "1000001"]) {
    assert.ok(
      validateStartingPoint(
        applyCore({ ...EMPTY_PLAN_DRAFT, title: "Trip" }, "people", count),
      ).people,
    );
  }
  const range = applyCore(
    { ...EMPTY_PLAN_DRAFT, title: "Trip" },
    "people",
    "5-10",
  );
  assert.equal(range.participantRange, "5-10");
  assert.equal(range.participantExact, "");
});

test("restoring a simplified draft retains all saved fields across a subsequent core edit", () => {
  let value: string | null = null;
  const storage: DraftStorage = {
    getItem: () => value,
    setItem: (_, next) => {
      value = next;
    },
    removeItem: () => {
      value = null;
    },
  };
  const original = {
    ...EMPTY_PLAN_DRAFT,
    title: "Reunion",
    participantRange: "11-20" as const,
    participantStatus: "invited" as const,
    category: "family" as const,
    date: "Next Sunday",
    time: "Noon",
    duration: "All afternoon",
    objective: "See everyone",
    categoryDetails: "Covered courtyard",
    constraints: "No stairs",
    preferences: "Vegetarian food",
    notes: "Bring photos",
    budgetCurrency: "PHP",
    budgetAmount: "7000",
    budgetScope: "total" as const,
  };
  assert.ok(saveLocalDraft(storage, original));
  const restored = loadLocalDraft(storage)!;
  assert.deepEqual(restored, original);
  assert.equal(peopleValue(restored), "11-20");
  const updated = applyCore(restored, "location", "Grandma’s house");
  assert.ok(saveLocalDraft(storage, updated));
  assert.deepEqual(loadLocalDraft(storage), {
    ...original,
    location: "Grandma’s house",
  });
});
