import type { PlanExtraction } from "../shared/plan-schema.js";

export const CATEGORY_OPTIONS = [
  { value: "trip", label: "Trip or outing" },
  { value: "family", label: "Family gathering" },
  { value: "meeting", label: "Professional meeting" },
  { value: "project", label: "Group project" },
  { value: "celebration", label: "Event or celebration" },
  { value: "other", label: "Other" },
] as const;

export type PlanningCategory =
  (typeof CATEGORY_OPTIONS)[number]["value"];
export type CategoryValue = PlanningCategory | "";
export type ParticipantRange =
  | "2-4"
  | "5-10"
  | "11-20"
  | "21-50"
  | "51+"
  | "exact"
  | "";
export type BudgetScope = "per-person" | "total" | "not-stated" | "";
export type ParticipantStatus = "estimated" | "invited" | "confirmed" | "unknown" | "";

export interface PlanDraft {
  category: CategoryValue;
  title: string;
  description: string;
  date: string;
  time: string;
  duration: string;
  location: string;
  budgetAmount: string;
  budgetCurrency: string;
  budgetScope: BudgetScope;
  participantRange: ParticipantRange;
  participantStatus: ParticipantStatus;
  participantExact: string;
  objective: string;
  categoryDetails: string;
  constraints: string;
  preferences: string;
  notes: string;
}

export type PlanField = keyof PlanDraft;

export const EMPTY_PLAN_DRAFT: PlanDraft = {
  category: "",
  title: "",
  description: "",
  date: "",
  time: "",
  duration: "",
  location: "",
  budgetAmount: "",
  budgetCurrency: "",
  budgetScope: "",
  participantRange: "",
  participantStatus: "",
  participantExact: "",
  objective: "",
  categoryDetails: "",
  constraints: "",
  preferences: "",
  notes: "",
};

export const CATEGORY_LABELS: Record<PlanningCategory, string> = {
  trip: "Trip or outing",
  family: "Family gathering",
  meeting: "Professional meeting",
  project: "Group project",
  celebration: "Event or celebration",
  other: "Other",
};

export function categoryForEventType(
  eventType: PlanExtraction["eventType"],
): CategoryValue {
  switch (eventType) {
    case "trip":
      return "trip";
    case "gathering":
      return "family";
    case "meeting":
    case "work":
      return "meeting";
    case "project":
    case "school":
      return "project";
    case "celebration":
      return "celebration";
    case "other":
      return "other";
    default:
      return "";
  }
}

export type ReviewStatus =
  | "needs-review"
  | "conflict"
  | "accepted"
  | "rejected"
  | "kept"
  | "matched";

export interface FieldSuggestion {
  field: PlanField;
  value: string;
  displayValue: string;
  evidence: string | null;
  uncertainty: string | null;
  isApproximate: boolean;
  details: PlanExtraction["constraints"];
}

export interface FieldReview extends FieldSuggestion {
  status: ReviewStatus;
}

export type ReviewMap = Partial<Record<PlanField, FieldReview>>;

function participantRangeFor(count: number): Exclude<ParticipantRange, "exact" | ""> {
  if (count <= 4) return "2-4";
  if (count <= 10) return "5-10";
  if (count <= 20) return "11-20";
  if (count <= 50) return "21-50";
  return "51+";
}

function evidenceFor(
  details: Array<{ evidence: string | null }>,
): string | null {
  const evidence = details
    .map((detail) => detail.evidence?.trim())
    .filter((value): value is string => Boolean(value));
  return evidence.length > 0 ? evidence.join("\n") : null;
}

function uncertaintyForDetails(details: PlanExtraction["constraints"]): string | null {
  if (details.some((item) => item.certainty === "uncertain")) return "Some details are marked uncertain in the source.";
  if (details.some((item) => item.certainty === "tentative")) return "Some details are tentative in the source.";
  return null;
}

export function mapExtractionToSuggestions(
  plan: PlanExtraction,
): FieldSuggestion[] {
  const suggestions: FieldSuggestion[] = [];
  const add = (
    field: PlanField,
    value: string | null | undefined,
    displayValue: string,
    evidence: string | null,
    options: {
      uncertainty?: string | null;
      isApproximate?: boolean;
      details?: PlanExtraction["constraints"];
    } = {},
  ) => {
    if (value === null || value === undefined || value.trim() === "") return;
    suggestions.push({
      field,
      value,
      displayValue,
      evidence,
      uncertainty: options.uncertainty ?? null,
      isApproximate: options.isApproximate ?? false,
      details: options.details ?? [],
    });
  };

  const category = categoryForEventType(plan.eventType);
  if (category) {
    add(
      "category",
      category,
      CATEGORY_LABELS[category],
      plan.eventTypeEvidence,

    );
  }

  add("title", plan.title, plan.title ?? "", plan.titleEvidence);
  add("description", plan.description, plan.description ?? "", plan.descriptionEvidence);
  add(
    "date",
    plan.dateOrDateRange.value,
    plan.dateOrDateRange.value ?? "",
    plan.dateOrDateRange.evidence,
    {
      uncertainty: plan.dateOrDateRange.isAmbiguous
        ? "The source does not identify one confirmed calendar date."
        : null,
    },
  );
  add(
    "time",
    plan.time.value,
    plan.time.value ?? "",
    plan.time.evidence,
    {
      uncertainty: plan.time.isAmbiguous
        ? "The source leaves the time unclear."
        : null,
    },
  );
  add(
    "duration",
    plan.duration.value,
    plan.duration.value ?? "",
    plan.duration.evidence,
    { isApproximate: plan.duration.isApproximate },
  );
  add(
    "location",
    plan.location.value,
    plan.location.value ?? "",
    plan.location.evidence,
    {
      uncertainty: plan.location.isConfirmed
        ? null
        : "The source does not show a confirmed destination or venue.",
    },
  );

  if (plan.budget.amount !== null) {
    add(
      "budgetAmount",
      String(plan.budget.amount),
      (plan.budget.isApproximate ? "About " : "") +
        (plan.budget.currency ? plan.budget.currency + " " : "") +
        String(plan.budget.amount),
      plan.budget.evidence,
      { isApproximate: plan.budget.isApproximate },
    );
    add(
      "budgetScope",
      plan.budget.isPerPerson === null
        ? "not-stated"
        : plan.budget.isPerPerson
          ? "per-person"
          : "total",
      plan.budget.isPerPerson === null
        ? "Spending scope not stated"
        : plan.budget.isPerPerson
          ? "Per person"
          : "Total plan budget",
      plan.budget.evidence,
      {
        uncertainty:
          plan.budget.isPerPerson === null
            ? "The source does not say whether this amount is per person or for the whole plan."
            : null,
      },
    );
  }
  add(
    "budgetCurrency",
    plan.budget.currency,
    plan.budget.currency ?? "",
    plan.budget.evidence,
  );

  if (plan.estimatedParticipants.value !== null) {
    const count = plan.estimatedParticipants.value;
    const participantStatusLabels = {
      estimated: "Estimated count",
      invited: "Invited people",
      confirmed: "Confirmed attendees",
      unknown: "Status unclear",
    } as const;
    add("participantStatus", plan.estimatedParticipants.attendanceStatus, participantStatusLabels[plan.estimatedParticipants.attendanceStatus], plan.estimatedParticipants.evidence);
    if (plan.estimatedParticipants.isApproximate) {
      const range = participantRangeFor(count);
      add(
        "participantRange",
        range,
        "About " + count + " people · " + range + " range",
        plan.estimatedParticipants.evidence,
        { isApproximate: true },
      );
    } else {
      add(
        "participantRange",
        "exact",
        "Exact count: " + count,
        plan.estimatedParticipants.evidence,
      );
      add(
        "participantExact",
        String(count),
        String(count) + " people",
        plan.estimatedParticipants.evidence,
      );
    }
  }

  add(
    "objective",
    plan.objective.value,
    plan.objective.value ?? "",
    plan.objective.evidence,
  );

  const constraints = plan.constraints.map((item) => item.description);
  if (constraints.length > 0) {
    add(
      "constraints",
      constraints.join("\n"),
      constraints.join(" · "),
      evidenceFor(plan.constraints),
      { details: plan.constraints, uncertainty: uncertaintyForDetails(plan.constraints) },
    );
  }

  const preferences = plan.preferences.map((item) => item.description);
  if (preferences.length > 0) {
    add(
      "preferences",
      preferences.join("\n"),
      preferences.join(" · "),
      evidenceFor(plan.preferences),
      { details: plan.preferences, uncertainty: uncertaintyForDetails(plan.preferences) },
    );
  }

  const notes = plan.importantNotes.map((item) => item.description);
  if (notes.length > 0) {
    add(
      "notes",
      notes.join("\n"),
      notes.join(" · "),
      evidenceFor(plan.importantNotes),
      { details: plan.importantNotes, uncertainty: uncertaintyForDetails(plan.importantNotes) },
    );
  }

  return suggestions;
}

export function mergeSuggestions(
  current: PlanDraft,
  candidates: FieldSuggestion[],
  manuallyEdited: ReadonlySet<PlanField>,
): { draft: PlanDraft; reviews: ReviewMap } {
  const draft = { ...current };
  const reviews: ReviewMap = {};

  for (const candidate of candidates) {
    const currentValue = draft[candidate.field];
    const hasCurrentValue = currentValue.trim().length > 0;

    let status: ReviewStatus = "needs-review";
    if (manuallyEdited.has(candidate.field)) {
      status = currentValue === candidate.value ? "matched" : "conflict";
    } else if (!hasCurrentValue) {
      draft[candidate.field] = candidate.value as never;
    } else if (currentValue !== candidate.value) {
      status = "conflict";
    }

    reviews[candidate.field] = { ...candidate, status };
  }

  return { draft, reviews };
}

export function acceptNonConflicting(
  reviews: ReviewMap,
): ReviewMap {
  return Object.fromEntries(
    Object.entries(reviews).map(([field, review]) => [
      field,
      review?.status === "needs-review"
        ? { ...review, status: "accepted" as const }
        : review,
    ]),
  ) as ReviewMap;
}

export function resolveSuggestion(
  draft: PlanDraft,
  reviews: ReviewMap,
  manuallyEdited: ReadonlySet<PlanField>,
  field: PlanField,
  action: "accept" | "reject" | "use" | "keep",
): {
  draft: PlanDraft;
  reviews: ReviewMap;
  manuallyEdited: Set<PlanField>;
} {
  const review = reviews[field];
  if (!review) {
    return { draft, reviews, manuallyEdited: new Set(manuallyEdited) };
  }

  const nextDraft = { ...draft };
  const nextReviews = { ...reviews };
  const nextManuallyEdited = new Set(manuallyEdited);

  if (action === "use") {
    nextDraft[field] = review.value as never;
    nextManuallyEdited.add(field);
    nextReviews[field] = { ...review, status: "accepted" };
  } else if (action === "keep") {
    nextManuallyEdited.add(field);
    nextReviews[field] = { ...review, status: "kept" };
  } else if (action === "reject") {
    if (
      !nextManuallyEdited.has(field) &&
      nextDraft[field] === review.value
    ) {
      nextDraft[field] = "" as never;
    }
    nextReviews[field] = { ...review, status: "rejected" };
  } else {
    nextManuallyEdited.add(field);
    nextReviews[field] = { ...review, status: "accepted" };
  }

  return {
    draft: nextDraft,
    reviews: nextReviews,
    manuallyEdited: nextManuallyEdited,
  };
}export function editDraftField(
  draft: PlanDraft,
  reviews: ReviewMap,
  manuallyEdited: ReadonlySet<PlanField>,
  field: PlanField,
  value: string,
): {
  draft: PlanDraft;
  reviews: ReviewMap;
  manuallyEdited: Set<PlanField>;
} {
  const nextDraft = { ...draft, [field]: value } as PlanDraft;
  const nextReviews = { ...reviews };
  const nextManuallyEdited = new Set(manuallyEdited);
  nextManuallyEdited.add(field);

  const review = nextReviews[field];
  if (review && review.status !== "rejected") {
    nextReviews[field] = {
      ...review,
      status: value === review.value ? "matched" : "conflict",
    };
  }

  return {
    draft: nextDraft,
    reviews: nextReviews,
    manuallyEdited: nextManuallyEdited,
  };
}






export function clearTrackedAutofill(
  draft: PlanDraft,
  trackedFields: ReadonlySet<PlanField>,
  protectedFields: ReadonlySet<PlanField>,
): PlanDraft {
  const next = { ...draft };
  for (const field of trackedFields) {
    if (!protectedFields.has(field)) {
      next[field] = EMPTY_PLAN_DRAFT[field] as never;
    }
  }
  return next;
}
