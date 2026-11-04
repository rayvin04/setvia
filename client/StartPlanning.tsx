import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, FormEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  Check,
  ImagePlus,
  LockKeyhole,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Mascot } from "./Mascot";
import "./planning.css";
import {
  acceptNonConflicting,
  CATEGORY_LABELS,
  CATEGORY_OPTIONS,
  EMPTY_PLAN_DRAFT,
  clearTrackedAutofill,
  editDraftField,
  mapExtractionToSuggestions,
  mergeSuggestions,
  resolveSuggestion,
  type BudgetScope,
  type CategoryValue,
  type FieldReview,
  type PlanDraft,
  type PlanField,
  type PlanningCategory,
  type ReviewMap,
} from "./plan-mapping";
import {
  PlanApiError,
  extractPlanFromImage,
  extractPlanFromText,
} from "./plan-api";
import { clearLocalDraft, loadLocalDraft, saveLocalDraft } from "./draft-store";
import {
  ProxyStatementSchema,
  type PlanExtraction,
  type ProxyStatement,
} from "../shared/plan-schema.js";
import { RoomLaunch } from "./dashboard/RoomLaunch";
import {
  coreFieldEdits,
  extractionIsReachable,
  peopleValue,
  scheduleValue,
  validateStartingPoint,
  type CoreField,
} from "./planning-core";

type SourceMode = "text" | "image";
type ProxyForm = Omit<ProxyStatement, "confirmedByParticipant"> & {
  confirmedByParticipant: boolean;
};
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALL_EXTRA_FIELDS: PlanField[] = [
  "duration",
  "participantRange",
  "participantStatus",
  "participantExact",
  "budgetAmount",
  "budgetCurrency",
  "budgetScope",
  "objective",
  "categoryDetails",
  "constraints",
  "preferences",
  "notes",
];
const FIELD_LABELS: Record<PlanField, string> = {
  category: "Planning category",
  title: "Plan title",
  description: "Description",
  date: "Date or date range",
  time: "Time",
  duration: "Duration",
  location: "Location",
  budgetAmount: "Budget amount",
  budgetCurrency: "Currency",
  budgetScope: "Budget applies to",
  participantRange: "Estimated group size",
  participantExact: "Exact participant count",
  participantStatus: "Participant count status",
  objective: "Main objective",
  categoryDetails: "Additional details",
  constraints: "Constraints",
  preferences: "Preferences",
  notes: "Important notes",
};

function readInitialDraft(): { draft: PlanDraft; enabled: boolean } {
  try {
    const restored = loadLocalDraft(window.localStorage);
    return {
      draft: restored ?? { ...EMPTY_PLAN_DRAFT },
      enabled: restored !== null,
    };
  } catch {
    return { draft: { ...EMPTY_PLAN_DRAFT }, enabled: false };
  }
}
function allowedImage(file: File): string | null {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    return "Choose a PNG, JPEG, or WebP image.";
  if (!file.size) return "This image is empty.";
  if (file.size > MAX_IMAGE_BYTES) return "Choose an image smaller than 5 MiB.";
  return null;
}
function labelFor(field: PlanField, category: CategoryValue): string {
  if (field === "date" && category === "project")
    return "Deadline or date range";
  if (field === "location" && category === "trip") return "Destination";
  if (field === "location" && category === "meeting")
    return "Meeting link or location";
  if (
    field === "location" &&
    (category === "family" || category === "celebration")
  )
    return "Venue";
  if (field === "objective" && category === "meeting")
    return "Meeting objective";
  if (field === "objective" && category === "project") return "Project goal";
  if (field === "objective" && category === "trip") return "Trip purpose";
  if (field === "categoryDetails") {
    if (category === "trip") return "Transport plan";
    if (category === "meeting") return "Agenda";
    if (category === "project") return "Scope and deliverables";
    if (category === "celebration") return "Preparation details";
    if (category === "family") return "Gathering details";
  }
  return FIELD_LABELS[field];
}
function displayValue(field: PlanField, value: string): string {
  if (field === "category")
    return CATEGORY_LABELS[value as PlanningCategory] ?? value;
  if (field === "participantRange") {
    const labels: Record<string, string> = {
      "2-4": "2–4 people",
      "5-10": "5–10 people",
      "11-20": "11–20 people",
      "21-50": "21–50 people",
      "51+": "51 or more people",
      exact: "Exact count",
    };
    return labels[value] ?? value;
  }
  if (field === "participantStatus") {
    const labels: Record<string, string> = {
      estimated: "Estimated count",
      invited: "Invited people",
      confirmed: "Confirmed attendees",
      unknown: "Status unclear",
    };
    return labels[value] ?? value;
  }
  if (field === "budgetScope") {
    const labels: Record<BudgetScope, string> = {
      "": "",
      "per-person": "Per person",
      total: "Total plan budget",
      "not-stated": "Scope not stated",
    };
    return labels[value as BudgetScope] ?? value;
  }
  return value || "Not provided";
}
function statusLabel(status: FieldReview["status"]): string {
  const labels: Record<FieldReview["status"], string> = {
    "needs-review": "Review this suggestion",
    conflict: "Conflicts with your entry",
    accepted: "Accepted",
    rejected: "Rejected",
    kept: "Kept your value",
    matched: "Matches your edit",
  };
  return labels[status];
}

export function StartPlanning() {
  const initialRef = useRef<{ draft: PlanDraft; enabled: boolean } | null>(
    null,
  );
  if (initialRef.current === null) initialRef.current = readInitialDraft();
  const initial = initialRef.current;
  const [draft, setDraft] = useState<PlanDraft>(initial.draft);
  const [reviews, setReviews] = useState<ReviewMap>({});
  const [sourceMode, setSourceMode] = useState<SourceMode>("text");
  const [sourceText, setSourceText] = useState("");
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [imageError, setImageError] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [extractionMeta, setExtractionMeta] = useState<Pick<
    PlanExtraction,
    "uncertainties" | "missingInformation" | "suggestedQuestions"
  > | null>(null);
  const [saveEnabled, setSaveEnabled] = useState(initial.enabled);
  const [draftMessage, setDraftMessage] = useState(
    initial.enabled ? "A saved draft was restored on this device." : "",
  );
  const [proxyForm, setProxyForm] = useState<ProxyForm>({
    representedParticipant: "",
    suppliedBy: "",
    statement: "",
    confirmedByParticipant: false,
  });
  const [proxyStatements, setProxyStatements] = useState<ProxyStatement[]>([]);
  const [proxyError, setProxyError] = useState("");
  const [availability, setAvailability] = useState<
    "checking" | "available" | "unavailable"
  >("checking");
  const [availabilityCheck, setAvailabilityCheck] = useState(0);
  const [formErrors, setFormErrors] = useState<
    Partial<Record<CoreField, string>>
  >({});
  const [started, setStarted] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const draftRef = useRef(draft);
  const reviewsRef = useRef(reviews);
  const manuallyEditedRef = useRef(new Set<PlanField>());
  const trackedAutofillFieldsRef = useRef(new Set<PlanField>());
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reducedMotion = useReducedMotion();
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setAvailability("checking");
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4000);
    void extractionIsReachable(controller.signal).then((available) => {
      window.clearTimeout(timeout);
      if (active) setAvailability(available ? "available" : "unavailable");
    });
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [availabilityCheck]);
  useEffect(() => {
    if (started) resultRef.current?.focus();
  }, [started]);

  useEffect(() => {
    if (!selectedImage) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(selectedImage);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedImage]);
  useEffect(() => {
    if (!saveEnabled) return;
    let saved = false;
    try {
      saved = saveLocalDraft(window.localStorage, draft);
    } catch {
      saved = false;
    }
    setDraftMessage(
      saved
        ? "Draft saved on this device."
        : "Browser storage is unavailable, so this draft is not being saved.",
    );
  }, [draft, saveEnabled]);

  function updateField(field: PlanField, value: string) {
    setStarted(false);
    const next = editDraftField(
      draftRef.current,
      reviewsRef.current,
      manuallyEditedRef.current,
      field,
      value,
    );
    draftRef.current = next.draft;
    reviewsRef.current = next.reviews;
    manuallyEditedRef.current = next.manuallyEdited;
    trackedAutofillFieldsRef.current.delete(field);
    setDraft(next.draft);
    setReviews(next.reviews);
  }
  function updateCore(field: CoreField, value: string) {
    for (const [key, next] of coreFieldEdits(field, value))
      updateField(key, next);
    setFormErrors((old) => ({ ...old, [field]: undefined }));
  }
  function handleImageSelection(file: File | undefined) {
    if (!file) return;
    const error = allowedImage(file);
    if (error) {
      setSelectedImage(null);
      setImageError(error);
      setStatusMessage("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setImageError("");
    setStatusMessage("");
    setSelectedImage(file);
  }
  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    handleImageSelection(event.currentTarget.files?.[0]);
  }
  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(false);
    handleImageSelection(event.dataTransfer.files[0]);
  }

  async function performAutofill() {
    setBusy(true);
    setStarted(false);
    setStatusMessage(
      sourceMode === "image"
        ? "Sending the image to Muse Spark for analysis…"
        : "Sending your description to Muse Spark…",
    );
    setImageError("");
    try {
      const plan =
        sourceMode === "image"
          ? await extractPlanFromImage(selectedImage!)
          : await extractPlanFromText(sourceText.trim());
      const suggestions = mapExtractionToSuggestions(plan);
      const refreshedDraft = clearTrackedAutofill(
        draftRef.current,
        trackedAutofillFieldsRef.current,
        manuallyEditedRef.current,
      );
      const merged = mergeSuggestions(
        refreshedDraft,
        suggestions,
        manuallyEditedRef.current,
      );
      draftRef.current = merged.draft;
      reviewsRef.current = merged.reviews;
      trackedAutofillFieldsRef.current.clear();
      for (const suggestion of suggestions) {
        if (merged.reviews[suggestion.field]?.status === "needs-review")
          trackedAutofillFieldsRef.current.add(suggestion.field);
      }
      setDraft(merged.draft);
      setReviews(merged.reviews);
      setExtractionMeta({
        uncertainties: plan.uncertainties,
        missingInformation: plan.missingInformation,
        suggestedQuestions: plan.suggestedQuestions,
      });
      setStatusMessage(
        suggestions.length
          ? "Muse Spark returned " +
              suggestions.length +
              " field suggestions. Review each suggestion before continuing."
          : "Muse Spark did not find clear planning details. Add more source information and try again.",
      );
    } catch (error) {
      setStatusMessage(
        error instanceof PlanApiError
          ? error.message
          : "Planning extraction failed. Your current form values are still here.",
      );
    } finally {
      setBusy(false);
    }
  }
  function requestAutofill() {
    if (busy) return;
    if (availability !== "available") return;
    if (sourceMode === "text" && !sourceText.trim()) {
      setStatusMessage(
        "Add a short description before asking Setvia to autofill.",
      );
      return;
    }
    if (sourceMode === "text" && sourceText.length > 8_000) {
      setStatusMessage("Keep the description under 8,000 characters.");
      return;
    }
    if (sourceMode === "image" && !selectedImage) {
      setImageError("Choose an image before asking Setvia to autofill.");
      return;
    }
    void performAutofill();
  }
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = validateStartingPoint(draftRef.current);
    setFormErrors(errors);
    const first = Object.keys(errors)[0];
    if (first) {
      document.getElementById("core-" + first)?.focus();
      return;
    }
    if (
      Object.values(reviewsRef.current).some(
        (review) =>
          review &&
          ["needs-review", "conflict", "matched"].includes(review.status),
      )
    ) {
      setStatusMessage(
        "Review or reject the remaining suggestions before starting.",
      );
      document.getElementById("review-heading")?.focus();
      return;
    }
    setStatusMessage("");
    setStarted(true);
  }
  function resolveField(
    field: PlanField,
    action: "accept" | "reject" | "use" | "keep",
  ) {
    const next = resolveSuggestion(
      draftRef.current,
      reviewsRef.current,
      manuallyEditedRef.current,
      field,
      action,
    );
    draftRef.current = next.draft;
    reviewsRef.current = next.reviews;
    manuallyEditedRef.current = next.manuallyEdited;
    trackedAutofillFieldsRef.current.delete(field);
    setDraft(next.draft);
    setReviews(next.reviews);
  }
  function acceptAll() {
    for (const [field, review] of Object.entries(reviewsRef.current) as [
      PlanField,
      FieldReview,
    ][]) {
      if (review?.status === "needs-review") {
        manuallyEditedRef.current.add(field);
        trackedAutofillFieldsRef.current.delete(field);
      }
    }
    const next = acceptNonConflicting(reviewsRef.current);
    reviewsRef.current = next;
    setReviews(next);
  }
  function focusField(field: PlanField) {
    const core: Partial<Record<PlanField, CoreField>> = {
      title: "title",
      location: "location",
      description: "description",
      date: "schedule",
      time: "schedule",
      participantRange: "people",
      participantExact: "people",
    };
    if (!core[field] && detailsRef.current) detailsRef.current.open = true;
    window.requestAnimationFrame(() => {
      if (field === "category")
        document
          .querySelector<HTMLInputElement>('input[name="category"]')
          ?.focus();
      else
        document
          .getElementById(
            core[field] ? "core-" + core[field] : "field-" + field,
          )
          ?.focus();
    });
  }
  function toggleLocalDraft(event: ChangeEvent<HTMLInputElement>) {
    const enabled = event.currentTarget.checked;
    if (enabled) {
      let saved = false;
      try {
        saved = saveLocalDraft(window.localStorage, draftRef.current);
      } catch {
        saved = false;
      }
      if (!saved) {
        setDraftMessage(
          "Browser storage is unavailable, so this draft is not being saved.",
        );
        return;
      }
      setSaveEnabled(true);
      setDraftMessage("Draft saving is on for this device.");
      return;
    }
    setSaveEnabled(false);
    try {
      if (!clearLocalDraft(window.localStorage))
        throw new Error("Storage unavailable");
      setDraftMessage("Local saving is off and the stored draft was cleared.");
    } catch {
      setDraftMessage(
        "Local saving is off. The browser could not clear its stored copy.",
      );
    }
  }
  function clearDraft() {
    let cleared = false;
    try {
      cleared = clearLocalDraft(window.localStorage);
    } catch {
      /* Keep the in-memory form usable. */
    }
    const empty = { ...EMPTY_PLAN_DRAFT };
    draftRef.current = empty;
    reviewsRef.current = {};
    manuallyEditedRef.current = new Set();
    trackedAutofillFieldsRef.current = new Set();
    setDraft(empty);
    setReviews({});
    setExtractionMeta(null);
    setSourceText("");
    setSelectedImage(null);
    setProxyStatements([]);
    setSaveEnabled(false);
    setDraftMessage(
      cleared
        ? "The local draft and form fields were cleared."
        : "The form was cleared. The browser could not remove its saved copy.",
    );
    setStatusMessage("");
    setImageError("");
    setFormErrors({});
    setStarted(false);
    setConfirmClear(false);
  }
  function addProxyStatement() {
    const parsed = ProxyStatementSchema.safeParse(proxyForm);
    if (!parsed.success) {
      setProxyError(
        "Add the represented person, who told you, and what they said.",
      );
      return;
    }
    setProxyStatements((items) => [...items, parsed.data]);
    setProxyForm({
      representedParticipant: "",
      suppliedBy: "",
      statement: "",
      confirmedByParticipant: false,
    });
    setProxyError("");
  }

  function renderField(field: PlanField) {
    const id = "field-" + field;
    const label = labelFor(field, draft.category);
    const value = draft[field] as string;
    const review = reviews[field];
    const suggested =
      Boolean(review) &&
      review?.status !== "rejected" &&
      review?.status !== "conflict";
    const className =
      "plan-control" + (suggested ? " plan-control-suggested" : "");
    const helper =
      field === "participantStatus"
        ? "Invited people are not the same as confirmed attendees."
        : field === "date"
          ? "Relative wording stays as written until you confirm the calendar date."
          : field === "participantRange"
            ? "A suggested group size does not confirm attendance."
            : field === "budgetScope"
              ? "Personal spending limits are separate from the total plan budget."
              : "";
    if (field === "category") return null;
    if (
      field === "participantRange" ||
      field === "participantStatus" ||
      field === "budgetScope"
    ) {
      const options =
        field === "participantRange"
          ? [
              ["", "Not provided"],
              ["2-4", "2–4 people"],
              ["5-10", "5–10 people"],
              ["11-20", "11–20 people"],
              ["21-50", "21–50 people"],
              ["51+", "51 or more"],
              ["exact", "Exact count"],
            ]
          : field === "participantStatus"
            ? [
                ["", "Choose a status"],
                ["estimated", "Estimated count"],
                ["invited", "Invited people"],
                ["confirmed", "Confirmed attendees"],
                ["unknown", "Status unclear"],
              ]
            : [
                ["", "Choose a scope"],
                ["per-person", "Per person"],
                ["total", "Total plan budget"],
                ["not-stated", "Scope not stated"],
              ];
      return (
        <div className="plan-field" key={field}>
          <label htmlFor={id}>{label}</label>
          <select
            id={id}
            className={className}
            value={value}
            aria-describedby={helper ? id + "-help" : undefined}
            onChange={(event) => updateField(field, event.currentTarget.value)}
          >
            {options.map(([optionValue, optionLabel]) => (
              <option value={optionValue} key={optionValue}>
                {optionLabel}
              </option>
            ))}
          </select>
          {helper && (
            <p className="field-helper" id={id + "-help"}>
              {helper}
            </p>
          )}
        </div>
      );
    }
    if (field === "participantExact") {
      return (
        <div className="plan-field" key={field}>
          <label htmlFor={id}>{label}</label>
          <input
            id={id}
            className={className}
            type="number"
            inputMode="numeric"
            min="1"
            max="1000000"
            value={value}
            onChange={(event) => updateField(field, event.currentTarget.value)}
          />
        </div>
      );
    }
    const longText = [
      "description",
      "objective",
      "categoryDetails",
      "constraints",
      "preferences",
      "notes",
    ].includes(field);
    const placeholders: Partial<Record<PlanField, string>> = {
      title: "A name the group will recognize",
      description: "What is the plan about?",
      date: "A date, range, or wording like “next Friday”",
      time: "A time or time window",
      duration: "How long the plan may take",
      location: "A destination, venue, or meeting link",
      budgetAmount: "Amount, if known",
      budgetCurrency: "e.g. PHP, USD",
      objective: "What should this plan accomplish?",
      categoryDetails: "Agenda, transport, scope, or preparation details",
      constraints: "Needs or limits the group should respect",
      preferences: "Things the group would prefer",
      notes: "Other details to keep in mind",
    };
    const maxLength: Partial<Record<PlanField, number>> = {
      title: 120,
      description: 500,
      date: 160,
      time: 100,
      duration: 100,
      location: 240,
      budgetAmount: 32,
      budgetCurrency: 24,
      objective: 500,
      categoryDetails: 1000,
      constraints: 1200,
      preferences: 1200,
      notes: 1200,
    };
    return (
      <div className="plan-field" key={field}>
        <label htmlFor={id}>{label}</label>
        {longText ? (
          <textarea
            id={id}
            className={className}
            value={value}
            maxLength={maxLength[field]}
            placeholder={placeholders[field]}
            aria-describedby={helper ? id + "-help" : undefined}
            rows={field === "description" ? 3 : 2}
            onChange={(event) => updateField(field, event.currentTarget.value)}
          />
        ) : (
          <input
            id={id}
            className={className}
            type="text"
            inputMode={field === "budgetAmount" ? "decimal" : undefined}
            value={value}
            maxLength={maxLength[field]}
            placeholder={placeholders[field]}
            aria-describedby={helper ? id + "-help" : undefined}
            onChange={(event) => updateField(field, event.currentTarget.value)}
          />
        )}
        {helper && (
          <p className="field-helper" id={id + "-help"}>
            {helper}
          </p>
        )}
      </div>
    );
  }

  const reviewEntries = Object.entries(reviews) as [PlanField, FieldReview][];
  const pendingCount = reviewEntries.filter(
    ([, item]) => item.status === "needs-review",
  ).length;

  return (
    <section className="planning-page planning-simple">
      <div className="planning-top section-shell">
        <div className="planning-heading">
          <div>
            <h1>What are we planning?</h1>
            <p>Start with the basics. Leave the unknowns open.</p>
          </div>
          <div className="simple-planning-mascot" aria-hidden="true">
            <Mascot />
          </div>
        </div>
        <form
          className="simple-plan-form"
          onSubmit={handleSubmit}
          noValidate
          aria-busy={busy}
        >
          <div className="planning-basics">
            <div className="core-fields">
              <div className="plan-field">
                <label htmlFor="core-title">Plan name</label>
                <input
                  id="core-title"
                  name="title"
                  value={draft.title}
                  maxLength={120}
                  autoComplete="off"
                  placeholder="Weekend Beach Trip"
                  required
                  aria-invalid={Boolean(formErrors.title)}
                  aria-describedby={
                    formErrors.title ? "title-error" : undefined
                  }
                  onChange={(event) =>
                    updateCore("title", event.currentTarget.value)
                  }
                />
                {formErrors.title && (
                  <p id="title-error" className="inline-error" role="alert">
                    {formErrors.title}
                  </p>
                )}
              </div>
              <div className="plan-field">
                <label htmlFor="core-location">Location</label>
                <input
                  id="core-location"
                  name="location"
                  value={draft.location}
                  maxLength={240}
                  placeholder="Caramoan, Camarines Sur"
                  autoComplete="off"
                  onChange={(event) =>
                    updateCore("location", event.currentTarget.value)
                  }
                />
              </div>
              <div className="core-field-pair">
                <div className="plan-field">
                  <label htmlFor="core-people">Number of people</label>
                  <input
                    id="core-people"
                    name="people"
                    type="text"
                    inputMode="numeric"
                    value={peopleValue(draft)}
                    maxLength={8}
                    placeholder="8, or leave open"
                    aria-invalid={Boolean(formErrors.people)}
                    aria-describedby={
                      formErrors.people
                        ? "people-error people-help"
                        : "people-help"
                    }
                    onChange={(event) =>
                      updateCore("people", event.currentTarget.value)
                    }
                  />
                  <p id="people-help" className="field-helper">
                    Expected attendees, including people outside the room.
                  </p>
                  {formErrors.people && (
                    <p id="people-error" className="inline-error" role="alert">
                      {formErrors.people}
                    </p>
                  )}
                </div>
                <div className="plan-field">
                  <label htmlFor="core-schedule">Date and time</label>
                  <input
                    id="core-schedule"
                    name="schedule"
                    value={scheduleValue(draft)}
                    maxLength={160}
                    placeholder="Not decided yet"
                    onChange={(event) =>
                      updateCore("schedule", event.currentTarget.value)
                    }
                  />
                </div>
              </div>
              <div className="plan-field">
                <label htmlFor="core-description">Short description</label>
                <textarea
                  id="core-description"
                  name="description"
                  rows={3}
                  value={draft.description}
                  maxLength={2000}
                  placeholder="A weekend away with friends. We still need to figure out transport and the budget."
                  onChange={(event) =>
                    updateCore("description", event.currentTarget.value)
                  }
                />
              </div>
            </div>

            <div className="plan-option-row">
              <details className="more-fields simple-more" ref={detailsRef}>
                <summary>
                  More details
                </summary>
                <fieldset className="category-fieldset">
                  <legend>Category</legend>
                  <div className="category-grid">
                    {CATEGORY_OPTIONS.map((option) => (
                      <label
                        className="category-option"
                        key={option.value}
                        htmlFor={"category-" + option.value}
                      >
                        <input
                          id={"category-" + option.value}
                          type="radio"
                          name="category"
                          value={option.value}
                          checked={draft.category === option.value}
                          onChange={() => updateField("category", option.value)}
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="plan-field-grid">
                  {ALL_EXTRA_FIELDS.map(renderField)}
                </div>
              </details>

              <details className="simple-utilities">
                <summary>
                  Draft settings
                </summary>
                <details className="simple-storage">
                  <summary>
                    Save on this device
                  </summary>
                  <label className="draft-toggle">
                    <input
                      type="checkbox"
                      checked={saveEnabled}
                      onChange={toggleLocalDraft}
                    />
                    <span>Remember this draft in this browser</span>
                  </label>
                  <p>
                    Only form fields are saved. Source text, images, evidence,
                    and statements on someone’s behalf are excluded.
                  </p>
                  <p className="draft-status" role="status">
                    {draftMessage}
                  </p>
                  {confirmClear ? (
                    <div className="confirm-clear">
                      <p>Clear the form and the saved draft?</p>
                      <button
                        type="button"
                        className="text-button clear-draft"
                        onClick={clearDraft}
                      >
                        Yes, clear draft
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setConfirmClear(false)}
                      >
                        Keep draft
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="text-button clear-draft"
                      onClick={() => setConfirmClear(true)}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                      Clear draft and form
                    </button>
                  )}
                </details>

                <section className="proxy-card" aria-labelledby="proxy-heading">
                  <details>
                    <summary id="proxy-heading">
                      <span>
                        <Plus size={16} aria-hidden="true" />
                        Add on someone’s behalf
                      </span>
                      <small>Unconfirmed by default</small>
                    </summary>
                    <p className="proxy-explanation">
                      Record what someone told you without treating it as their
                      approval or final attendance decision. These notes stay in
                      this page session.
                    </p>
                    <div className="proxy-input-grid">
                      <div className="plan-field">
                        <label htmlFor="proxy-person">Who is this about?</label>
                        <input
                          id="proxy-person"
                          type="text"
                          maxLength={80}
                          value={proxyForm.representedParticipant}
                          onChange={(event) =>
                            setProxyForm({
                              ...proxyForm,
                              representedParticipant: event.currentTarget.value,
                            })
                          }
                        />
                      </div>
                      <div className="plan-field">
                        <label htmlFor="proxy-supplier">Who told you?</label>
                        <input
                          id="proxy-supplier"
                          type="text"
                          maxLength={80}
                          value={proxyForm.suppliedBy}
                          onChange={(event) =>
                            setProxyForm({
                              ...proxyForm,
                              suppliedBy: event.currentTarget.value,
                            })
                          }
                        />
                      </div>
                      <div className="plan-field proxy-statement">
                        <label htmlFor="proxy-statement">
                          What did they say?
                        </label>
                        <textarea
                          id="proxy-statement"
                          rows={2}
                          maxLength={300}
                          value={proxyForm.statement}
                          onChange={(event) =>
                            setProxyForm({
                              ...proxyForm,
                              statement: event.currentTarget.value,
                            })
                          }
                        />
                      </div>
                      <label className="proxy-confirm">
                        <input
                          type="checkbox"
                          checked={proxyForm.confirmedByParticipant}
                          onChange={(event) =>
                            setProxyForm({
                              ...proxyForm,
                              confirmedByParticipant:
                                event.currentTarget.checked,
                            })
                          }
                        />
                        Confirmed directly by this participant
                      </label>
                    </div>
                    {proxyError && (
                      <p className="inline-error" role="alert">
                        {proxyError}
                      </p>
                    )}
                    <button
                      type="button"
                      className="button button-secondary proxy-add"
                      onClick={addProxyStatement}
                    >
                      <Plus size={16} aria-hidden="true" />
                      Add statement
                    </button>
                    {proxyStatements.length > 0 && (
                      <ul className="proxy-list">
                        {proxyStatements.map((item, index) => (
                          <li key={item.representedParticipant + "-" + index}>
                            <div>
                              <strong>{item.representedParticipant}</strong>
                              <span>
                                {item.confirmedByParticipant
                                  ? "Confirmed directly"
                                  : "Not confirmed"}
                              </span>
                              <p>
                                “{item.statement}”{" "}
                                <small>Reported by {item.suppliedBy}</small>
                              </p>
                            </div>
                            <button
                              type="button"
                              className="icon-button"
                              aria-label={
                                "Remove statement about " +
                                item.representedParticipant
                              }
                              onClick={() =>
                                setProxyStatements((items) =>
                                  items.filter(
                                    (_, itemIndex) => itemIndex !== index,
                                  ),
                                )
                              }
                            >
                              <X size={16} aria-hidden="true" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </details>
                </section>
              </details>
            </div>
            <div className="simple-submit-row">
              <p>
                This starts as a local draft. Create a room below when you’re
                ready to invite your group.
              </p>
              <motion.button
                className="button button-primary"
                type="submit"
                disabled={busy}
                whileTap={reducedMotion ? undefined : { scale: 0.97 }}
              >
                Start Planning
              </motion.button>
            </div>

            {initial.enabled && saveEnabled && !started && (
              <p className="restored-draft-note" role="status">
                Your saved draft is restored, including additional details.
              </p>
            )}
          </div>
          <aside
            className="planning-autofill"
            aria-labelledby="autofill-heading"
          >
            <div className="autofill-heading">
              <Sparkles size={19} aria-hidden="true" />
              <h2 id="autofill-heading">AI autofill</h2>
            </div>
            <p className="autofill-intro">
              Paste notes or upload an invitation.
            </p>
            <div
              className="source-mode"
              role="group"
              aria-label="Choose an autofill source"
            >
              <button
                type="button"
                aria-pressed={sourceMode === "text"}
                className={sourceMode === "text" ? "is-active" : ""}
                onClick={() => {
                  setSourceMode("text");
                  setStatusMessage("");
                }}
              >
                Paste text
              </button>
              <button
                type="button"
                aria-pressed={sourceMode === "image"}
                className={sourceMode === "image" ? "is-active" : ""}
                onClick={() => {
                  setSourceMode("image");
                  setStatusMessage("");
                }}
              >
                Upload an image
              </button>
            </div>
            {sourceMode === "text" ? (
              <div className="source-panel">
                <label htmlFor="plan-source-text">Planning notes</label>
                <textarea
                  id="plan-source-text"
                  value={sourceText}
                  maxLength={8000}
                  rows={4}
                  placeholder="Paste an invitation or what the group has discussed."
                  onChange={(event) => setSourceText(event.currentTarget.value)}
                />
              </div>
            ) : (
              <div className="source-panel">
                <label
                  className="upload-drop"
                  htmlFor="plan-source-image"
                  data-drag-active={dragActive}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setDragActive(true);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={(event) => {
                    if (
                      !event.currentTarget.contains(
                        event.relatedTarget as Node | null,
                      )
                    )
                      setDragActive(false);
                  }}
                  onDrop={handleDrop}
                >
                  <input
                    ref={fileInputRef}
                    id="plan-source-image"
                    className="visually-hidden"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    aria-describedby="image-upload-help"
                    onChange={handleFileChange}
                  />
                  <ImagePlus size={23} aria-hidden="true" />
                  <span className="upload-title">Choose or drop an image</span>
                  <span id="image-upload-help" className="upload-help">
                    PNG, JPEG, or WebP · up to 5 MiB
                  </span>
                </label>
                {imageError && (
                  <p className="inline-error" role="alert">
                    {imageError}
                  </p>
                )}
                {selectedImage && previewUrl && (
                  <div className="image-preview">
                    <img src={previewUrl} alt="Selected planning image" />
                    <div className="image-preview-meta">
                      <span>{selectedImage.name}</span>
                    </div>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Remove selected image"
                      onClick={() => {
                        setSelectedImage(null);
                        if (fileInputRef.current)
                          fileInputRef.current.value = "";
                      }}
                    >
                      <X size={17} aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>
            )}
            <div className="source-privacy">
              <LockKeyhole size={15} aria-hidden="true" />
              <p>
                Only when you extract: your source is sent to Meta through
                Setvia’s server. Images stay in request memory. Review
                suggestions before using them.
              </p>
            </div>
            <button
              className="button button-secondary autofill-button"
              type="button"
              disabled={busy || availability !== "available"}
              aria-describedby="autofill-availability"
              onClick={requestAutofill}
            >
              <Sparkles size={16} aria-hidden="true" />
              {busy ? "Extracting suggestions…" : "Autofill with Setvia"}
            </button>

            <div className="autofill-availability" data-state={availability}>
              <p id="autofill-availability" role="status">
                {availability === "checking"
                  ? "Checking AI connection…"
                  : availability === "available"
                    ? "AI connection ready. Review any suggested details."
                    : "AI connection unavailable. You can still fill in the plan."}
              </p>
              {availability === "unavailable" && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setAvailabilityCheck((value) => value + 1)}
                >
                  Check connection
                </button>
              )}
            </div>
          </aside>
          {started && (
            <motion.div
              className="starting-point-ready"
              ref={resultRef}
              tabIndex={-1}
              initial={{ opacity: reducedMotion ? 1 : 0 }}
              animate={{ opacity: 1 }}
              aria-labelledby="ready-heading"
            >
              <div className="ready-heading">
                <Check size={20} aria-hidden="true" />
                <h2 id="ready-heading">Your starting point is ready.</h2>
              </div>
              <h3>{draft.title}</h3>
              <dl>
                <div>
                  <dt>Where</dt>
                  <dd>{draft.location || "Still open"}</dd>
                </div>
                <div>
                  <dt>When</dt>
                  <dd>{scheduleValue(draft) || "Still open"}</dd>
                </div>
                <div>
                  <dt>Expected</dt>
                  <dd>
                    {peopleValue(draft)
                      ? peopleValue(draft) + " people"
                      : "Still open"}
                  </dd>
                </div>
              </dl>
              <p>
                This is a local draft, not a shared room.{" "}
                {saveEnabled
                  ? "Your form fields are saved on this device."
                  : "Keep this page open, or turn on browser saving in Draft settings."}
              </p>
              <Link className="text-button" to="/demos">
                Explore a fictional planning room
              </Link>
            </motion.div>
          )}

          {reviewEntries.length > 0 && (
            <motion.section
              className="review-card"
              aria-labelledby="review-heading"
              initial={{ opacity: 0, y: reducedMotion ? 0 : 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reducedMotion ? 0.12 : 0.22 }}
            >
              <div className="review-heading-row">
                <div className="card-heading">
                  <div>
                    <h2 id="review-heading" tabIndex={-1}>
                      Review suggestions
                    </h2>
                    <p>
                      Check the filled fields, keep what fits, and resolve any
                      conflicts.
                    </p>
                  </div>
                </div>
                {pendingCount > 0 && (
                  <button
                    type="button"
                    className="button button-secondary accept-all"
                    onClick={acceptAll}
                  >
                    <Check size={16} aria-hidden="true" />
                    Accept all non-conflicting ({pendingCount})
                  </button>
                )}
              </div>
              <div className="review-list">
                {reviewEntries.map(([field, review]) => {
                  const current = draft[field] as string;
                  const conflict = review.status === "conflict";
                  return (
                    <article
                      className={"suggestion-item suggestion-" + review.status}
                      key={field}
                    >
                      <div className="suggestion-topline">
                        <h3>{labelFor(field, draft.category)}</h3>
                        <span className="suggestion-status">
                          {statusLabel(review.status)}
                        </span>
                      </div>
                      {conflict ? (
                        <div className="suggestion-comparison">
                          <p>
                            <span>Your entry</span>
                            <strong>{displayValue(field, current)}</strong>
                          </p>
                          <p>
                            <span>Muse Spark suggests</span>
                            <strong>{displayValue(field, review.value)}</strong>
                          </p>
                        </div>
                      ) : (
                        <p className="suggestion-value">
                          {displayValue(field, review.value)}
                        </p>
                      )}
                      {review.isApproximate && (
                        <p className="suggestion-note">Approximate value</p>
                      )}
                      {review.uncertainty && (
                        <p className="suggestion-uncertainty">
                          {review.uncertainty}
                        </p>
                      )}
                      {review.evidence && (
                        <blockquote className="source-evidence">
                          <span>Source evidence</span>“{review.evidence}”
                        </blockquote>
                      )}
                      {review.details.length > 0 && (
                        <details className="suggestion-details">
                          <summary>More source detail</summary>
                          <ul>
                            {review.details.map((detail, index) => (
                              <li key={field + "-" + index}>
                                {detail.speaker && (
                                  <strong className="detail-speaker">
                                    Reported by {detail.speaker}:{" "}
                                  </strong>
                                )}
                                {detail.description}
                                {detail.evidence && (
                                  <blockquote>“{detail.evidence}”</blockquote>
                                )}
                                {detail.certainty !== "confirmed" && (
                                  <small>
                                    {detail.certainty === "tentative"
                                      ? "Tentative"
                                      : "Uncertain"}
                                  </small>
                                )}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                      <div className="suggestion-actions">
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => focusField(field)}
                        >
                          Edit field
                        </button>
                        {review.status === "needs-review" && (
                          <>
                            <button
                              type="button"
                              className="button button-small button-primary"
                              onClick={() => resolveField(field, "accept")}
                            >
                              Accept suggestion
                            </button>
                            <button
                              type="button"
                              className="button button-small button-quiet"
                              onClick={() => resolveField(field, "reject")}
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {review.status === "conflict" && (
                          <>
                            <button
                              type="button"
                              className="button button-small button-secondary"
                              onClick={() => resolveField(field, "keep")}
                            >
                              Keep my value
                            </button>
                            <button
                              type="button"
                              className="button button-small button-primary"
                              onClick={() => resolveField(field, "use")}
                            >
                              Use suggestion
                            </button>
                          </>
                        )}
                        {review.status === "matched" && (
                          <button
                            type="button"
                            className="button button-small button-primary"
                            onClick={() => resolveField(field, "accept")}
                          >
                            Confirm match
                          </button>
                        )}
                        {(review.status === "accepted" ||
                          review.status === "kept") && (
                          <button
                            type="button"
                            className="button button-small button-quiet"
                            onClick={() => resolveField(field, "reject")}
                          >
                            Remove suggestion
                          </button>
                        )}
                        {review.status === "rejected" && (
                          <button
                            type="button"
                            className="button button-small button-secondary"
                            onClick={() => resolveField(field, "use")}
                          >
                            Use suggestion
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </motion.section>
          )}

          {extractionMeta && (
            <section
              className="open-questions-card"
              aria-labelledby="questions-heading"
            >
              <div className="card-heading">
                <div>
                  <h2 id="questions-heading">What still needs an answer?</h2>
                  <p>Only details the source leaves open are listed here.</p>
                </div>
              </div>
              {extractionMeta.uncertainties.length > 0 && (
                <div className="question-group">
                  <h3>Needs confirmation</h3>
                  <ul>
                    {extractionMeta.uncertainties.map((item, index) => (
                      <li key={"uncertainty-" + index}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {extractionMeta.missingInformation.length > 0 && (
                <div className="question-group">
                  <h3>Not provided</h3>
                  <ul>
                    {extractionMeta.missingInformation.map((item, index) => (
                      <li key={"missing-" + index}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {extractionMeta.suggestedQuestions.length > 0 && (
                <div className="question-group">
                  <h3>Questions to ask</h3>
                  <ul>
                    {extractionMeta.suggestedQuestions.map((item, index) => (
                      <li key={"question-" + index}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {extractionMeta.uncertainties.length === 0 &&
                extractionMeta.missingInformation.length === 0 &&
                extractionMeta.suggestedQuestions.length === 0 && (
                  <p className="no-questions">
                    No additional uncertainties or missing details were
                    returned.
                  </p>
                )}
            </section>
          )}
        </form>
        <RoomLaunch draft={draft} />
        <div
          className="simple-live-status"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {statusMessage}
        </div>
      </div>
    </section>
  );
}
