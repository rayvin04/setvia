import {
  DashboardSnapshotSchema,
  type DashboardSnapshot,
} from "../../shared/dashboard";

export const scenarios = [
  { id: "hike", label: "Mountain hike" },
  { id: "beach", label: "Beach trip" },
  { id: "family", label: "Family reunion" },
  { id: "kickoff", label: "Project kickoff" },
  { id: "safety", label: "Critical safety blocker" },
  { id: "blocked", label: "Blocked analysis" },
  { id: "empty", label: "Not evaluated" },
  { id: "loading", label: "Loading preview" },
] as const;
export const viewers = ["alex", "sam", "jo", "mika"] as const;
export type ScenarioId = (typeof scenarios)[number]["id"];
export type ViewerId = (typeof viewers)[number];
export type PreviewFrame = "initial" | "updated" | "revised" | "carpool";

export async function fetchPreview(
  scenario: Exclude<ScenarioId, "loading">,
  viewer: ViewerId,
  frame: PreviewFrame,
  signal: AbortSignal,
): Promise<DashboardSnapshot> {
  const response = await fetch("/dashboard-preview/" + scenario + ".json", {
    signal,
    credentials: "omit",
    cache: "force-cache",
    headers: { Accept: "application/json" },
  });
  if (!response.ok)
    throw new Error("The dashboard preview couldn’t load. Try again.");
  const fixture = (await response.json()) as Partial<
    Record<PreviewFrame, Partial<Record<ViewerId, unknown>>>
  >;
  const parsed = DashboardSnapshotSchema.safeParse(fixture[frame]?.[viewer]);
  if (!parsed.success || parsed.data.source !== "synthetic")
    throw new Error("The preview returned an unsupported room view.");
  return parsed.data;
}
