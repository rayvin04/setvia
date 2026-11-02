import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, FormEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowLeft, Check, ImagePlus, LockKeyhole, Plus, Sparkles, Trash2, X } from "lucide-react";
import { Link } from "react-router-dom";
import { Mascot } from "./Mascot";
import "./planning.css";
import {
  acceptNonConflicting, CATEGORY_LABELS, CATEGORY_OPTIONS, EMPTY_PLAN_DRAFT, clearTrackedAutofill,
  editDraftField, mapExtractionToSuggestions, mergeSuggestions, resolveSuggestion,
  type BudgetScope, type CategoryValue, type FieldReview, type PlanDraft,
  type PlanField, type PlanningCategory, type ReviewMap,
} from "./plan-mapping";
import { PlanApiError, extractPlanFromImage, extractPlanFromText } from "./plan-api";
import { clearLocalDraft, loadLocalDraft, saveLocalDraft } from "./draft-store";
import { ProxyStatementSchema, type PlanExtraction, type ProxyStatement } from "../shared/plan-schema.js";

type SourceMode = "text" | "image";
type ProxyForm = Omit<ProxyStatement, "confirmedByParticipant"> & { confirmedByParticipant: boolean };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const GENERAL_FIELDS: PlanField[] = ["title", "description", "date", "time", "location"];
const ALL_EXTRA_FIELDS: PlanField[] = [
  "duration", "participantRange", "participantStatus", "participantExact", "budgetAmount", "budgetCurrency",
  "budgetScope", "objective", "categoryDetails", "constraints", "preferences", "notes",
];
const ADAPTIVE_FIELDS: Record<PlanningCategory, PlanField[]> = {
  trip: ["duration", "participantRange", "participantStatus", "participantExact", "budgetAmount", "budgetCurrency", "budgetScope", "categoryDetails", "constraints", "preferences", "notes"],
  family: ["participantRange", "participantStatus", "participantExact", "budgetAmount", "budgetCurrency", "budgetScope", "constraints", "preferences", "notes", "categoryDetails"],
  meeting: ["duration", "participantRange", "participantStatus", "participantExact", "objective", "categoryDetails", "constraints", "notes"],
  project: ["participantRange", "participantStatus", "participantExact", "objective", "categoryDetails", "constraints", "notes"],
  celebration: ["participantRange", "participantStatus", "participantExact", "budgetAmount", "budgetCurrency", "budgetScope", "constraints", "preferences", "notes", "categoryDetails"],
  other: ALL_EXTRA_FIELDS,
};
const FIELD_LABELS: Record<PlanField, string> = {
  category: "Planning category", title: "Plan title", description: "Description",
  date: "Date or date range", time: "Time", duration: "Duration", location: "Location",
  budgetAmount: "Budget amount", budgetCurrency: "Currency", budgetScope: "Budget applies to",
  participantRange: "Estimated group size", participantExact: "Exact participant count", participantStatus: "Participant count status",
  objective: "Main objective", categoryDetails: "Additional details",
  constraints: "Constraints", preferences: "Preferences", notes: "Important notes",
};

function readInitialDraft(): { draft: PlanDraft; enabled: boolean } {
  try {
    const restored = loadLocalDraft(window.localStorage);
    return { draft: restored ?? { ...EMPTY_PLAN_DRAFT }, enabled: restored !== null };
  } catch {
    return { draft: { ...EMPTY_PLAN_DRAFT }, enabled: false };
  }
}
function allowedImage(file: File): string | null {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return "Choose a PNG, JPEG, or WebP image.";
  if (!file.size) return "This image is empty.";
  if (file.size > MAX_IMAGE_BYTES) return "Choose an image smaller than 5 MiB.";
  return null;
}
function labelFor(field: PlanField, category: CategoryValue): string {
  if (field === "date" && category === "project") return "Deadline or date range";
  if (field === "location" && category === "trip") return "Destination";
  if (field === "location" && category === "meeting") return "Meeting link or location";
  if (field === "location" && (category === "family" || category === "celebration")) return "Venue";
  if (field === "objective" && category === "meeting") return "Meeting objective";
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
  if (field === "category") return CATEGORY_LABELS[value as PlanningCategory] ?? value;
  if (field === "participantRange") {
    const labels: Record<string, string> = { "2-4": "2–4 people", "5-10": "5–10 people", "11-20": "11–20 people", "21-50": "21–50 people", "51+": "51 or more people", exact: "Exact count" };
    return labels[value] ?? value;
  }
  if (field === "participantStatus") {
    const labels: Record<string, string> = { estimated: "Estimated count", invited: "Invited people", confirmed: "Confirmed attendees", unknown: "Status unclear" };
    return labels[value] ?? value;
  }
  if (field === "budgetScope") {
    const labels: Record<BudgetScope, string> = { "": "", "per-person": "Per person", total: "Total plan budget", "not-stated": "Scope not stated" };
    return labels[value as BudgetScope] ?? value;
  }
  return value || "Not provided";
}
function statusLabel(status: FieldReview["status"]): string {
  const labels: Record<FieldReview["status"], string> = {
    "needs-review": "Review this suggestion", conflict: "Conflicts with your entry",
    accepted: "Accepted", rejected: "Rejected", kept: "Kept your value", matched: "Matches your edit",
  };
  return labels[status];
}

export function StartPlanning() {
  const initialRef = useRef<{ draft: PlanDraft; enabled: boolean } | null>(null);
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
  const [extractionMeta, setExtractionMeta] = useState<Pick<PlanExtraction, "uncertainties" | "missingInformation" | "suggestedQuestions"> | null>(null);
  const [saveEnabled, setSaveEnabled] = useState(initial.enabled);
  const [draftMessage, setDraftMessage] = useState(initial.enabled ? "A saved draft was restored on this device." : "");
  const [proxyForm, setProxyForm] = useState<ProxyForm>({ representedParticipant: "", suppliedBy: "", statement: "", confirmedByParticipant: false });
  const [proxyStatements, setProxyStatements] = useState<ProxyStatement[]>([]);
  const [proxyError, setProxyError] = useState("");
  const draftRef = useRef(draft);
  const reviewsRef = useRef(reviews);
  const manuallyEditedRef = useRef(new Set<PlanField>());
  const trackedAutofillFieldsRef = useRef(new Set<PlanField>());
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!selectedImage) { setPreviewUrl(""); return; }
    const url = URL.createObjectURL(selectedImage);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedImage]);
  useEffect(() => {
    if (!saveEnabled) return;
    let saved = false;
    try { saved = saveLocalDraft(window.localStorage, draft); } catch { saved = false; }
    setDraftMessage(saved ? "Draft saved on this device." : "Browser storage is unavailable, so this draft is not being saved.");
  }, [draft, saveEnabled]);

  function updateField(field: PlanField, value: string) {
    const next = editDraftField(draftRef.current, reviewsRef.current, manuallyEditedRef.current, field, value);
    draftRef.current = next.draft;
    reviewsRef.current = next.reviews;
    manuallyEditedRef.current = next.manuallyEdited;
    trackedAutofillFieldsRef.current.delete(field);
    setDraft(next.draft);
    setReviews(next.reviews);
  }
  function handleImageSelection(file: File | undefined) {
    if (!file) return;
    const error = allowedImage(file);
    if (error) {
      setSelectedImage(null); setImageError(error); setStatusMessage("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setImageError(""); setStatusMessage(""); setSelectedImage(file);
  }
  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    handleImageSelection(event.currentTarget.files?.[0]);
  }
  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault(); setDragActive(false);
    handleImageSelection(event.dataTransfer.files[0]);
  }

  async function performAutofill() {
    setBusy(true);
    setStatusMessage(sourceMode === "image" ? "Sending the image to Muse Spark for analysis…" : "Sending your description to Muse Spark…");
    setImageError("");
    try {
      const plan = sourceMode === "image"
        ? await extractPlanFromImage(selectedImage!)
        : await extractPlanFromText(sourceText.trim());
      const suggestions = mapExtractionToSuggestions(plan);
      const refreshedDraft = clearTrackedAutofill(draftRef.current, trackedAutofillFieldsRef.current, manuallyEditedRef.current);
      const merged = mergeSuggestions(refreshedDraft, suggestions, manuallyEditedRef.current);
      draftRef.current = merged.draft;
      reviewsRef.current = merged.reviews;
      trackedAutofillFieldsRef.current.clear();
      for (const suggestion of suggestions) {
        if (merged.reviews[suggestion.field]?.status === "needs-review") trackedAutofillFieldsRef.current.add(suggestion.field);
      }
      setDraft(merged.draft);
      setReviews(merged.reviews);
      setExtractionMeta({
        uncertainties: plan.uncertainties,
        missingInformation: plan.missingInformation,
        suggestedQuestions: plan.suggestedQuestions,
      });
      setStatusMessage(suggestions.length
        ? "Muse Spark returned " + suggestions.length + " field suggestions. Review each suggestion before continuing."
        : "Muse Spark did not find clear planning details. Add more source information and try again.");
    } catch (error) {
      setStatusMessage(error instanceof PlanApiError
        ? error.message
        : "Planning extraction failed. Your current form values are still here.");
    } finally {
      setBusy(false);
    }
  }
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (sourceMode === "text" && !sourceText.trim()) {
      setStatusMessage("Add a short description before asking Setvia to autofill."); return;
    }
    if (sourceMode === "text" && sourceText.length > 8_000) {
      setStatusMessage("Keep the description under 8,000 characters."); return;
    }
    if (sourceMode === "image" && !selectedImage) {
      setImageError("Choose an image before asking Setvia to autofill."); return;
    }
    void performAutofill();
  }
  function resolveField(field: PlanField, action: "accept" | "reject" | "use" | "keep") {
    const next = resolveSuggestion(draftRef.current, reviewsRef.current, manuallyEditedRef.current, field, action);
    draftRef.current = next.draft;
    reviewsRef.current = next.reviews;
    manuallyEditedRef.current = next.manuallyEdited;
    trackedAutofillFieldsRef.current.delete(field);
    setDraft(next.draft); setReviews(next.reviews);
  }
  function acceptAll() {
    for (const [field, review] of Object.entries(reviewsRef.current) as [PlanField, FieldReview][]) {
      if (review?.status === "needs-review") {
        manuallyEditedRef.current.add(field);
        trackedAutofillFieldsRef.current.delete(field);
      }
    }
    const next = acceptNonConflicting(reviewsRef.current);
    reviewsRef.current = next; setReviews(next);
  }
  function focusField(field: PlanField) {
    if (!GENERAL_FIELDS.includes(field) && field !== "category" && detailsRef.current) detailsRef.current.open = true;
    window.requestAnimationFrame(() => {
      if (field === "category") document.querySelector<HTMLInputElement>('input[name="category"]')?.focus();
      else document.getElementById("field-" + field)?.focus();
    });
  }
  function toggleLocalDraft(event: ChangeEvent<HTMLInputElement>) {
    const enabled = event.currentTarget.checked;
    if (enabled) {
      let saved = false;
      try { saved = saveLocalDraft(window.localStorage, draftRef.current); } catch { saved = false; }
      if (!saved) { setDraftMessage("Browser storage is unavailable, so this draft is not being saved."); return; }
      setSaveEnabled(true); setDraftMessage("Draft saving is on for this device."); return;
    }
    setSaveEnabled(false);
    try {
      clearLocalDraft(window.localStorage);
      setDraftMessage("Local saving is off and the stored draft was cleared.");
    } catch {
      setDraftMessage("Local saving is off. The browser could not clear its stored copy.");
    }
  }
  function clearDraft() {
    try { clearLocalDraft(window.localStorage); } catch { /* Keep the in-memory form usable. */ }
    const empty = { ...EMPTY_PLAN_DRAFT };
    draftRef.current = empty; reviewsRef.current = {}; manuallyEditedRef.current = new Set(); trackedAutofillFieldsRef.current = new Set();
    setDraft(empty); setReviews({}); setExtractionMeta(null); setSourceText(""); setSelectedImage(null);
    setProxyStatements([]); setSaveEnabled(false); setDraftMessage("The local draft and form fields were cleared.");
    setStatusMessage(""); setImageError("");
  }
  function addProxyStatement() {
    const parsed = ProxyStatementSchema.safeParse(proxyForm);
    if (!parsed.success) {
      setProxyError("Add the represented person, who told you, and what they said."); return;
    }
    setProxyStatements((items) => [...items, parsed.data]);
    setProxyForm({ representedParticipant: "", suppliedBy: "", statement: "", confirmedByParticipant: false });
    setProxyError("");
  }

  function renderField(field: PlanField) {
    const id = "field-" + field;
    const label = labelFor(field, draft.category);
    const value = draft[field] as string;
    const review = reviews[field];
    const suggested = Boolean(review) && review?.status !== "rejected" && review?.status !== "conflict";
    const className = "plan-control" + (suggested ? " plan-control-suggested" : "");
    const helper = field === "participantStatus"
      ? "Invited people are not the same as confirmed attendees."
      : field === "date"
      ? "Relative wording stays as written until you confirm the calendar date."
      : field === "participantRange"
        ? "A suggested group size does not confirm attendance."
        : field === "budgetScope"
          ? "Personal spending limits are separate from the total plan budget."
          : "";
    if (field === "category") return null;
    if (field === "participantRange" || field === "participantStatus" || field === "budgetScope") {
      const options = field === "participantRange"
        ? [["", "Not provided"], ["2-4", "2–4 people"], ["5-10", "5–10 people"], ["11-20", "11–20 people"], ["21-50", "21–50 people"], ["51+", "51 or more"], ["exact", "Exact count"]]
        : field === "participantStatus"
          ? [["", "Choose a status"], ["estimated", "Estimated count"], ["invited", "Invited people"], ["confirmed", "Confirmed attendees"], ["unknown", "Status unclear"]]
          : [["", "Choose a scope"], ["per-person", "Per person"], ["total", "Total plan budget"], ["not-stated", "Scope not stated"]];
      return <div className="plan-field" key={field}>
        <label htmlFor={id}>{label}</label>
        <select id={id} className={className} value={value} aria-describedby={helper ? id + "-help" : undefined} onChange={(event) => updateField(field, event.currentTarget.value)}>
          {options.map(([optionValue, optionLabel]) => <option value={optionValue} key={optionValue}>{optionLabel}</option>)}
        </select>
        {helper && <p className="field-helper" id={id + "-help"}>{helper}</p>}
      </div>;
    }
    if (field === "participantExact") {
      return <div className="plan-field" key={field}>
        <label htmlFor={id}>{label}</label>
        <input id={id} className={className} type="number" inputMode="numeric" min="1" max="1000000" value={value} onChange={(event) => updateField(field, event.currentTarget.value)} />
      </div>;
    }
    const longText = ["description", "objective", "categoryDetails", "constraints", "preferences", "notes"].includes(field);
    const placeholders: Partial<Record<PlanField, string>> = {
      title: "A name the group will recognize", description: "What is the plan about?",
      date: "A date, range, or wording like “next Friday”", time: "A time or time window",
      duration: "How long the plan may take", location: "A destination, venue, or meeting link",
      budgetAmount: "Amount, if known", budgetCurrency: "e.g. PHP, USD",
      objective: "What should this plan accomplish?", categoryDetails: "Agenda, transport, scope, or preparation details",
      constraints: "Needs or limits the group should respect", preferences: "Things the group would prefer",
      notes: "Other details to keep in mind",
    };
    const maxLength: Partial<Record<PlanField, number>> = {
      title: 120, description: 500, date: 160, time: 100, duration: 100, location: 240,
      budgetAmount: 32, budgetCurrency: 24, objective: 500, categoryDetails: 1000,
      constraints: 1200, preferences: 1200, notes: 1200,
    };
    return <div className="plan-field" key={field}>
      <label htmlFor={id}>{label}</label>
      {longText
        ? <textarea id={id} className={className} value={value} maxLength={maxLength[field]} placeholder={placeholders[field]} aria-describedby={helper ? id + "-help" : undefined} rows={field === "description" ? 3 : 2} onChange={(event) => updateField(field, event.currentTarget.value)} />
        : <input id={id} className={className} type="text" inputMode={field === "budgetAmount" ? "decimal" : undefined} value={value} maxLength={maxLength[field]} placeholder={placeholders[field]} aria-describedby={helper ? id + "-help" : undefined} onChange={(event) => updateField(field, event.currentTarget.value)} />}
      {helper && <p className="field-helper" id={id + "-help"}>{helper}</p>}
    </div>;
  }

  const adaptive = draft.category ? ADAPTIVE_FIELDS[draft.category as PlanningCategory] : [];
  const visibleFields = [...GENERAL_FIELDS, ...adaptive].filter((field, index, fields) => {
    const include = field !== "participantExact" || draft.participantRange === "exact" || reviews[field] !== undefined;
    return include && fields.indexOf(field) === index;
  });
  const extraFields = ALL_EXTRA_FIELDS.filter((field) => !visibleFields.includes(field))
    .filter((field) => field !== "participantExact" || draft.participantRange === "exact" || reviews[field] !== undefined);
  const reviewEntries = Object.entries(reviews) as [PlanField, FieldReview][];
  const pendingCount = reviewEntries.filter(([, item]) => item.status === "needs-review").length;

  return (
    <section className="planning-page">
      <div className="planning-top section-shell">
        <Link className="back-link" to="/"><ArrowLeft size={17} aria-hidden="true" />Back to Setvia</Link>
        <div className="planning-heading">
          <div>
            <span className="planning-kicker"><Sparkles size={15} aria-hidden="true" /> Meta Muse Spark · real extraction</span>
            <h1>What are we planning?</h1>
            <p>Start with an idea or a planning image. Setvia will fill in what it can, then leave the choices with you.</p>
          </div>
          <div className={"planning-mascot" + (busy ? " is-analysing" : "")}><Mascot /></div>
        </div>
        <form className="planning-layout" onSubmit={handleSubmit}>
          <aside className="planning-source-column">
            <section className="source-card" aria-labelledby="source-heading">
              <div className="card-heading"><span className="section-index">01</span><div><h2 id="source-heading">Bring the plan in</h2><p>Describe it or share the image you already have.</p></div></div>
              <div className="source-mode" role="group" aria-label="Choose an autofill source">
                <button type="button" aria-pressed={sourceMode === "text"} className={sourceMode === "text" ? "is-active" : ""} onClick={() => { setSourceMode("text"); setStatusMessage(""); }}>Describe your plan</button>
                <button type="button" aria-pressed={sourceMode === "image"} className={sourceMode === "image" ? "is-active" : ""} onClick={() => { setSourceMode("image"); setStatusMessage(""); }}>Upload an image</button>
              </div>
              {sourceMode === "text" ? (
                <div className="source-panel">
                  <label htmlFor="plan-source-text">What have you heard so far?</label>
                  <textarea id="plan-source-text" value={sourceText} maxLength={8000} rows={8} placeholder="We’re thinking of going to the beach on Sunday. Around ₱500 each, and Jamie can drive if we leave early." onChange={(event) => setSourceText(event.currentTarget.value)} />
                  <div className="character-count">{sourceText.length.toLocaleString()} / 8,000</div>
                </div>
              ) : (
                <div className="source-panel">
                  <label className="upload-drop" htmlFor="plan-source-image" data-drag-active={dragActive}
                    onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
                    onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
                    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false); }}
                    onDrop={handleDrop}>
                    <input ref={fileInputRef} id="plan-source-image" className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" aria-describedby="image-upload-help" onChange={handleFileChange} />
                    <span className="upload-icon"><ImagePlus size={24} aria-hidden="true" /></span>
                    <span className="upload-title">Drop an image here or browse</span>
                    <span id="image-upload-help" className="upload-help">PNG, JPEG, or WebP · up to 5 MiB</span>
                  </label>
                  {imageError && <p className="inline-error" role="alert">{imageError}</p>}
                  {selectedImage && previewUrl && <div className="image-preview">
                    <img src={previewUrl} alt="Preview of the selected planning image" />
                    <div className="image-preview-meta"><span title={selectedImage.name}>{selectedImage.name}</span><small>{(selectedImage.size / 1024 / 1024).toFixed(2)} MiB</small></div>
                    <button type="button" className="icon-button" aria-label="Remove selected image" onClick={() => { setSelectedImage(null); setImageError(""); if (fileInputRef.current) fileInputRef.current.value = ""; }}><X size={17} aria-hidden="true" /></button>
                  </div>}
                  {selectedImage && <div className="image-actions"><button type="button" className="text-button" onClick={() => fileInputRef.current?.click()}>Replace image</button></div>}
                </div>
              )}
              <div className="source-privacy"><LockKeyhole size={16} aria-hidden="true" /><p>Your source is sent to Meta’s API through Setvia’s server for extraction. Setvia holds uploaded images in memory for the request and does not save them to this device or a database.</p></div>
              <button className="button button-primary autofill-button" type="submit" disabled={busy}><Sparkles size={18} aria-hidden="true" />{busy ? "Analyzing with Muse Spark…" : "Autofill with Setvia"}</button>
              <p className="source-disclaimer">Muse Spark returns suggestions. Review them before relying on any detail.</p>
            </section>

            <section className="draft-card" aria-labelledby="draft-heading">
              <div className="draft-card-heading"><h2 id="draft-heading">Keep your progress</h2><span>On this device</span></div>
              <label className="draft-toggle"><input type="checkbox" checked={saveEnabled} onChange={toggleLocalDraft} /><span>Save this draft in this browser</span></label>
              <p>Only form fields are saved. The source text, image, extracted evidence, and proxy statements stay out of local storage.</p>
              <p className="draft-status" role="status">{draftMessage}</p>
              <button type="button" className="text-button clear-draft" onClick={clearDraft}><Trash2 size={15} aria-hidden="true" />Clear draft and form</button>
            </section>
          </aside>

          <div className="plan-editor">
            <section className="plan-card" aria-labelledby="plan-heading">
              <div className="card-heading"><span className="section-index">02</span><div><h2 id="plan-heading">Shape your plan</h2><p>Choose a category if you know it. Muse Spark can suggest one too.</p></div></div>
              <fieldset className="category-fieldset">
                <legend>What kind of plan is this? <span>Optional</span></legend>
                <div className="category-grid">
                  {CATEGORY_OPTIONS.map((option) => <label className="category-option" key={option.value} htmlFor={"category-" + option.value}>
                    <input id={"category-" + option.value} type="radio" name="category" value={option.value} checked={draft.category === option.value} onChange={() => updateField("category", option.value)} />
                    <span>{option.label}</span>
                  </label>)}
                </div>
              </fieldset>
              <div className="plan-field-grid">{visibleFields.map(renderField)}</div>
              {extraFields.length > 0 && <details className="more-fields" ref={detailsRef}>
                <summary>More planning details <span>Optional</span></summary>
                <div className="plan-field-grid">{extraFields.map(renderField)}</div>
              </details>}
            </section>

            {reviewEntries.length > 0 && <motion.section className="review-card" aria-labelledby="review-heading"
              initial={{ opacity: 0, y: reducedMotion ? 0 : 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reducedMotion ? 0.12 : 0.22 }}>
              <div className="review-heading-row">
                <div className="card-heading"><span className="section-index">03</span><div><h2 id="review-heading">Review suggestions</h2><p>Check the filled fields, keep what fits, and resolve any conflicts.</p></div></div>
                {pendingCount > 0 && <button type="button" className="button button-secondary accept-all" onClick={acceptAll}><Check size={16} aria-hidden="true" />Accept all non-conflicting ({pendingCount})</button>}
              </div>
              <div className="review-list">
                {reviewEntries.map(([field, review]) => {
                  const current = draft[field] as string;
                  const conflict = review.status === "conflict";
                  return <article className={"suggestion-item suggestion-" + review.status} key={field}>
                    <div className="suggestion-topline"><h3>{labelFor(field, draft.category)}</h3><span className="suggestion-status">{statusLabel(review.status)}</span></div>
                    {conflict
                      ? <div className="suggestion-comparison"><p><span>Your entry</span><strong>{displayValue(field, current)}</strong></p><p><span>Muse Spark suggests</span><strong>{displayValue(field, review.value)}</strong></p></div>
                      : <p className="suggestion-value">{displayValue(field, review.value)}</p>}
                    {review.isApproximate && <p className="suggestion-note">Approximate value</p>}
                    {review.uncertainty && <p className="suggestion-uncertainty">{review.uncertainty}</p>}
                    {review.evidence && <blockquote className="source-evidence"><span>Source evidence</span>“{review.evidence}”</blockquote>}
                    {review.details.length > 0 && <details className="suggestion-details">
                      <summary>More source detail</summary>
                      <ul>{review.details.map((detail, index) => <li key={field + "-" + index}>
                        {detail.speaker && <strong className="detail-speaker">Reported by {detail.speaker}: </strong>}{detail.description}
                        {detail.evidence && <blockquote>“{detail.evidence}”</blockquote>}
                        {detail.certainty !== "confirmed" && <small>{detail.certainty === "tentative" ? "Tentative" : "Uncertain"}</small>}
                      </li>)}</ul>
                    </details>}
                    <div className="suggestion-actions">
                      <button type="button" className="text-button" onClick={() => focusField(field)}>Edit field</button>
                      {review.status === "needs-review" && <>
                        <button type="button" className="button button-small button-primary" onClick={() => resolveField(field, "accept")}>Accept suggestion</button>
                        <button type="button" className="button button-small button-quiet" onClick={() => resolveField(field, "reject")}>Reject</button>
                      </>}
                      {review.status === "conflict" && <>
                        <button type="button" className="button button-small button-secondary" onClick={() => resolveField(field, "keep")}>Keep my value</button>
                        <button type="button" className="button button-small button-primary" onClick={() => resolveField(field, "use")}>Use suggestion</button>
                      </>}
                      {review.status === "matched" && <button type="button" className="button button-small button-primary" onClick={() => resolveField(field, "accept")}>Confirm match</button>}
                      {(review.status === "accepted" || review.status === "kept") && <button type="button" className="button button-small button-quiet" onClick={() => resolveField(field, "reject")}>Remove suggestion</button>}
                      {review.status === "rejected" && <button type="button" className="button button-small button-secondary" onClick={() => resolveField(field, "use")}>Use suggestion</button>}
                    </div>
                  </article>;
                })}
              </div>
            </motion.section>}

            {extractionMeta && <section className="open-questions-card" aria-labelledby="questions-heading">
              <div className="card-heading"><span className="section-index">04</span><div><h2 id="questions-heading">What still needs an answer?</h2><p>Only details the source leaves open are listed here.</p></div></div>
              {extractionMeta.uncertainties.length > 0 && <div className="question-group"><h3>Needs confirmation</h3><ul>{extractionMeta.uncertainties.map((item, index) => <li key={"uncertainty-" + index}>{item}</li>)}</ul></div>}
              {extractionMeta.missingInformation.length > 0 && <div className="question-group"><h3>Not provided</h3><ul>{extractionMeta.missingInformation.map((item, index) => <li key={"missing-" + index}>{item}</li>)}</ul></div>}
              {extractionMeta.suggestedQuestions.length > 0 && <div className="question-group"><h3>Questions to ask</h3><ul>{extractionMeta.suggestedQuestions.map((item, index) => <li key={"question-" + index}>{item}</li>)}</ul></div>}
              {extractionMeta.uncertainties.length === 0 && extractionMeta.missingInformation.length === 0 && extractionMeta.suggestedQuestions.length === 0 && <p className="no-questions">No additional uncertainties or missing details were returned.</p>}
            </section>}

            <section className="proxy-card" aria-labelledby="proxy-heading">
              <details>
                <summary id="proxy-heading"><span><Plus size={16} aria-hidden="true" />Add on someone’s behalf</span><small>Unconfirmed by default</small></summary>
                <p className="proxy-explanation">Record what someone told you without treating it as their approval or final attendance decision. These notes stay in this page session.</p>
                <div className="proxy-input-grid">
                  <div className="plan-field"><label htmlFor="proxy-person">Who is this about?</label><input id="proxy-person" type="text" maxLength={80} value={proxyForm.representedParticipant} onChange={(event) => setProxyForm({ ...proxyForm, representedParticipant: event.currentTarget.value })} /></div>
                  <div className="plan-field"><label htmlFor="proxy-supplier">Who told you?</label><input id="proxy-supplier" type="text" maxLength={80} value={proxyForm.suppliedBy} onChange={(event) => setProxyForm({ ...proxyForm, suppliedBy: event.currentTarget.value })} /></div>
                  <div className="plan-field proxy-statement"><label htmlFor="proxy-statement">What did they say?</label><textarea id="proxy-statement" rows={2} maxLength={300} value={proxyForm.statement} onChange={(event) => setProxyForm({ ...proxyForm, statement: event.currentTarget.value })} /></div>
                  <label className="proxy-confirm"><input type="checkbox" checked={proxyForm.confirmedByParticipant} onChange={(event) => setProxyForm({ ...proxyForm, confirmedByParticipant: event.currentTarget.checked })} />Confirmed directly by this participant</label>
                </div>
                {proxyError && <p className="inline-error" role="alert">{proxyError}</p>}
                <button type="button" className="button button-secondary proxy-add" onClick={addProxyStatement}><Plus size={16} aria-hidden="true" />Add statement</button>
                {proxyStatements.length > 0 && <ul className="proxy-list">{proxyStatements.map((item, index) => <li key={item.representedParticipant + "-" + index}>
                  <div><strong>{item.representedParticipant}</strong><span>{item.confirmedByParticipant ? "Confirmed directly" : "Not confirmed"}</span><p>“{item.statement}” <small>Reported by {item.suppliedBy}</small></p></div>
                  <button type="button" className="icon-button" aria-label={"Remove statement about " + item.representedParticipant} onClick={() => setProxyStatements((items) => items.filter((_, itemIndex) => itemIndex !== index))}><X size={16} aria-hidden="true" /></button>
                </li>)}</ul>}
              </details>
            </section>
            <p className="planning-footnote">This creates a local planning draft only. Shared rooms and group decisions are part of a later phase.</p>
          </div>
        </form>
        <div className="planning-live-status" role="status" aria-live="polite" aria-atomic="true">
          {busy && <span className="status-dot" aria-hidden="true" />}
          {statusMessage}
        </div>
      </div>
    </section>
  );
}
