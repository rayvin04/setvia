import assert from "node:assert/strict";
import { test } from "node:test";
import type { PlanExtraction } from "../shared/plan-schema.js";
import {
  acceptNonConflicting,
  clearTrackedAutofill,
  EMPTY_PLAN_DRAFT,
  mapExtractionToSuggestions,
  mergeSuggestions,
  resolveSuggestion,
  editDraftField,
} from "./plan-mapping.js";

function extraction(overrides: Partial<PlanExtraction> = {}): PlanExtraction {
  return {
    title: null,
    titleEvidence: null,
    eventType: null,
    eventTypeEvidence: null,
    description: null,
    descriptionEvidence: null,
    estimatedParticipants: {
      value: null,
      isApproximate: false,
      attendanceStatus: "unknown",
      evidence: null,
    },
    dateOrDateRange: {
      value: null,
      isRelative: false,
      isAmbiguous: false,
      evidence: null,
    },
    time: { value: null, isAmbiguous: false, evidence: null },
    duration: { value: null, isApproximate: false, evidence: null },
    location: { value: null, isConfirmed: false, evidence: null },
    budget: {
      amount: null,
      currency: null,
      isPerPerson: null,
      isApproximate: false,
      evidence: null,
    },
    objective: { value: null, evidence: null },
    constraints: [],
    preferences: [],
    importantNotes: [],
    uncertainties: [],
    missingInformation: [],
    suggestedQuestions: [],
    ...overrides,
  };
}

test("invitation suggestions map title, category, date, time, and venue without inventing people", () => {
  const suggestions = mapExtractionToSuggestions(
    extraction({
      title: "Alex's Birthday Party",
      titleEvidence: "You're invited to Alex's Birthday Party!",
      eventTypeEvidence: "Birthday Party",
      eventType: "celebration",
      dateOrDateRange: {
        value: "November 14, 2026",
        isRelative: false,
        isAmbiguous: false,
        evidence: "November 14, 2026",
      },
      time: {
        value: "6:00 PM",
        isAmbiguous: false,
        evidence: "6:00 PM",
      },
      location: {
        value: "Sunset Garden, Naga City",
        isConfirmed: true,
        evidence: "Sunset Garden, Naga City",
      },
    }),
  );

  assert.equal(
    suggestions.find((item) => item.field === "category")?.value,
    "celebration",
  );
  assert.equal(
    suggestions.find((item) => item.field === "title")?.value,
    "Alex's Birthday Party",
  );
  assert.equal(
    suggestions.find((item) => item.field === "date")?.value,
    "November 14, 2026",
  );
  assert.equal(
    suggestions.find((item) => item.field === "time")?.value,
    "6:00 PM",
  );
  assert.equal(
    suggestions.find((item) => item.field === "location")?.value,
    "Sunset Garden, Naga City",
  );
  assert.equal(
    suggestions.some(
      (item) => item.field === "participantRange" || item.field === "budgetAmount",
    ),
    false,
  );
});

test("approximate per-person budgets and headcounts remain labeled", () => {
  const suggestions = mapExtractionToSuggestions(
    extraction({
      estimatedParticipants: {
        value: 8,
        isApproximate: true,
        attendanceStatus: "estimated",
        evidence: "Maybe 8 people are coming.",
      },
      budget: {
        amount: 500,
        currency: "pesos",
        isPerPerson: true,
        isApproximate: true,
        evidence: "around 500 pesos each",
      },
    }),
  );

  const participants = suggestions.find(
    (item) => item.field === "participantRange",
  );
  const budget = suggestions.find((item) => item.field === "budgetAmount");
  const scope = suggestions.find((item) => item.field === "budgetScope");

  assert.equal(participants?.value, "5-10");
  assert.equal(suggestions.find((item) => item.field === "participantStatus")?.value, "estimated");
  assert.equal(participants?.isApproximate, true);
  assert.match(participants?.displayValue ?? "", /About 8/);
  assert.equal(budget?.value, "500");
  assert.equal(budget?.isApproximate, true);
  assert.equal(scope?.value, "per-person");
});

test("clear source-backed suggestions auto-apply while uncertain, approximate, and conflicting values stay out", () => {
  const candidates = mapExtractionToSuggestions(extraction({
    title: "Sunday Picnic",
    titleEvidence: "Sunday picnic at the park",
    eventType: "other",
    eventTypeEvidence: "planning event",
    dateOrDateRange: {
      value: "sometime next week",
      isRelative: true,
      isAmbiguous: true,
      evidence: "Maybe next week",
    },
    estimatedParticipants: {
      value: 8,
      isApproximate: true,
      attendanceStatus: "estimated",
      evidence: "Around eight people",
    },
  }));
  const current = { ...EMPTY_PLAN_DRAFT, title: "My Sunday Plan" };
  const merged = mergeSuggestions(current, candidates, new Set(["title"]));

  assert.equal(merged.draft.category, "other");
  assert.equal(merged.reviews.category?.status, "accepted");
  assert.equal(merged.draft.title, "My Sunday Plan");
  assert.equal(merged.reviews.title?.status, "conflict");
  assert.equal(merged.draft.date, "");
  assert.equal(merged.reviews.date?.status, "needs-review");
  assert.equal(merged.draft.participantRange, "");
  assert.equal(merged.reviews.participantRange?.status, "needs-review");
});

test("autofill fills blank fields and preserves manual values as conflicts", () => {
  const candidate = extraction({
    title: "AI title",
    titleEvidence: "The invitation title is AI title.",
    dateOrDateRange: {
      value: "Sunday",
      isRelative: true,
      isAmbiguous: true,
      evidence: "Maybe Sunday?",
    },
  });
  const manual = new Set(["title" as const]);
  const result = mergeSuggestions(
    { ...EMPTY_PLAN_DRAFT, title: "My title" },
    mapExtractionToSuggestions(candidate),
    manual,
  );

  assert.equal(result.draft.title, "My title");
  assert.equal(result.reviews.title?.status, "conflict");
  assert.equal(result.draft.date, "");
  assert.equal(result.reviews.date?.status, "needs-review");
  assert.equal(
    result.reviews.date?.uncertainty,
    "The source does not identify one confirmed calendar date.",
  );

  const accepted = acceptNonConflicting(result.reviews);
  assert.equal(accepted.title?.status, "conflict");
  assert.equal(accepted.date?.status, "needs-review");
});

test("rejection removes only an AI-filled value and explicit use resolves a conflict", () => {
  const suggestions = mapExtractionToSuggestions(
    extraction({ title: "Suggested title", titleEvidence: "Suggested title" }),
  );
  const filled = mergeSuggestions(EMPTY_PLAN_DRAFT, suggestions, new Set());
  const rejected = resolveSuggestion(
    filled.draft,
    filled.reviews,
    new Set(),
    "title",
    "reject",
  );
  assert.equal(rejected.draft.title, "");
  assert.equal(rejected.reviews.title?.status, "rejected");

  const conflict = mergeSuggestions(
    { ...EMPTY_PLAN_DRAFT, title: "Typed title" },
    suggestions,
    new Set(["title" as const]),
  );
  const chosen = resolveSuggestion(
    conflict.draft,
    conflict.reviews,
    new Set(["title" as const]),
    "title",
    "use",
  );
  assert.equal(chosen.draft.title, "Suggested title");
  assert.equal(chosen.reviews.title?.status, "accepted");
  assert.equal(chosen.manuallyEdited.has("title"), true);
});
test("manual edits made after autofill become conflicts and are preserved", () => {
  const suggestions = mapExtractionToSuggestions(extraction({ title: "From poster", titleEvidence: "From poster" }));
  const filled = mergeSuggestions(EMPTY_PLAN_DRAFT, suggestions, new Set());
  const edited = editDraftField(filled.draft, filled.reviews, new Set(), "title", "My title");
  assert.equal(edited.draft.title, "My title");
  assert.equal(edited.reviews.title?.status, "conflict");
  const resolved = resolveSuggestion(edited.draft, edited.reviews, edited.manuallyEdited, "title", "keep");
  assert.equal(resolved.draft.title, "My title");
  assert.equal(resolved.reviews.title?.status, "kept");
});





test("invited counts stay distinct from confirmed attendees", () => {
  const suggestions = mapExtractionToSuggestions(extraction({
    estimatedParticipants: {
      value: 12,
      isApproximate: false,
      attendanceStatus: "invited",
      evidence: "12 people invited",
    },
  }));
  assert.equal(suggestions.find((item) => item.field === "participantStatus")?.value, "invited");
  assert.equal(suggestions.find((item) => item.field === "participantStatus")?.displayValue, "Invited people");
  assert.equal(suggestions.some((item) => item.displayValue === "Confirmed attendees"), false);
});

test("new extraction clears tracked unreviewed suggestions but preserves protected values", () => {
  const old = mapExtractionToSuggestions(extraction({ title: "Old source value", titleEvidence: "Old source value" }));
  const filled = mergeSuggestions(EMPTY_PLAN_DRAFT, old, new Set());
  const nextBase = clearTrackedAutofill(
    filled.draft,
    new Set(["title" as const]),
    new Set(),
  );
  assert.equal(nextBase.title, "");

  const protectedDraft = clearTrackedAutofill(
    { ...filled.draft, title: "Reviewed value" },
    new Set(["title" as const]),
    new Set(["title" as const]),
  );
  assert.equal(protectedDraft.title, "Reviewed value");
});
