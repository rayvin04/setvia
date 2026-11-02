import { z } from "zod";
import type { PlanDraft } from "./plan-mapping.js";

export const LOCAL_DRAFT_KEY = "setvia.plan-draft.v1";

const PlanDraftSchema = z
  .object({
    category: z.enum(["", "trip", "family", "meeting", "project", "celebration", "other"]),
    title: z.string().max(120),
    description: z.string().max(2_000),
    date: z.string().max(160),
    time: z.string().max(100),
    duration: z.string().max(100),
    location: z.string().max(240),
    budgetAmount: z.string().max(32),
    budgetCurrency: z.string().max(24),
    budgetScope: z.enum(["", "per-person", "total", "not-stated"]),
    participantRange: z.enum(["", "2-4", "5-10", "11-20", "21-50", "51+", "exact"]),
    participantStatus: z.enum(["", "estimated", "invited", "confirmed", "unknown"]),
    participantExact: z.string().max(8),
    objective: z.string().max(500),
    categoryDetails: z.string().max(1_000),
    constraints: z.string().max(1_200),
    preferences: z.string().max(1_200),
    notes: z.string().max(1_200),
  })
  .strict();

const PersistedDraftSchema = z
  .object({
    version: z.literal(1),
    draft: PlanDraftSchema,
  })
  .strict();

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadLocalDraft(
  storage: DraftStorage,
  key = LOCAL_DRAFT_KEY,
): PlanDraft | null {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // Storage can be disabled by the browser.
    }
    return null;
  }

  const parsed = PersistedDraftSchema.safeParse(value);
  if (!parsed.success) {
    try {
      storage.removeItem(key);
    } catch {
      // Storage can be disabled by the browser.
    }
    return null;
  }
  return parsed.data.draft;
}

export function saveLocalDraft(
  storage: DraftStorage,
  draft: PlanDraft,
  key = LOCAL_DRAFT_KEY,
): boolean {
  const parsed = PlanDraftSchema.safeParse(draft);
  if (!parsed.success) return false;

  try {
    storage.setItem(key, JSON.stringify({ version: 1, draft: parsed.data }));
    return true;
  } catch {
    return false;
  }
}

export function clearLocalDraft(
  storage: DraftStorage,
  key = LOCAL_DRAFT_KEY,
): boolean {
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
