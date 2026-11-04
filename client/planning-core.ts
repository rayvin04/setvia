import type { PlanDraft, PlanField } from "./plan-mapping";

export type CoreField =
  "title" | "location" | "people" | "schedule" | "description";
export function peopleValue(draft: PlanDraft): string {
  return (
    draft.participantExact ||
    (draft.participantRange === "exact" ? "" : draft.participantRange)
  );
}
export function scheduleValue(draft: PlanDraft): string {
  return [draft.date, draft.time].filter(Boolean).join(" · ");
}
// Only an explicit edit updates the existing draft; hidden and restored fields stay intact.
export function coreFieldEdits(
  field: CoreField,
  value: string,
): [PlanField, string][] {
  if (field === "schedule")
    return [
      ["date", value],
      ["time", ""],
    ];
  if (field === "people") {
    const range = ["2-4", "5-10", "11-20", "21-50", "51+"].includes(value);
    return [
      ["participantRange", value ? (range ? value : "exact") : ""],
      ["participantExact", range ? "" : value],
      ["participantStatus", value ? "estimated" : ""],
    ];
  }
  return [[field, value]];
}
export function validateStartingPoint(
  draft: PlanDraft,
): Partial<Record<CoreField, string>> {
  const errors: Partial<Record<CoreField, string>> = {};
  if (!draft.title.trim()) errors.title = "Give your plan a name.";
  const count = draft.participantExact.trim();
  if (
    count &&
    (!/^\d+$/.test(count) || Number(count) < 1 || Number(count) > 1_000_000)
  )
    errors.people =
      "Enter a whole number from 1 to 1,000,000, or leave it open.";
  return errors;
}

export async function extractionIsReachable(
  signal: AbortSignal,
): Promise<boolean> {
  try {
    const response = await fetch("/api/health", {
      signal,
      headers: { Accept: "application/json" },
    });
    if (
      !response.ok ||
      !response.headers.get("content-type")?.includes("application/json")
    )
      return false;
    const body: unknown = await response.json();
    return (
      typeof body === "object" &&
      body !== null &&
      "status" in body &&
      body.status === "ok"
    );
  } catch {
    return false;
  }
}
