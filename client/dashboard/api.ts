import {
  DashboardSnapshotSchema,
  type DashboardSnapshot,
} from "../../shared/dashboard";

export const publicDemoScenarios = [
  { id: "beach", label: "Beach trip" },
  { id: "family", label: "Family reunion" },
  { id: "kickoff", label: "Project kickoff" },
  { id: "study", label: "Group project" },
  { id: "wedding", label: "Wedding planning" },
] as const;
export const technicalScenarios = [
  { id: "hike", label: "Mountain hike" },
  { id: "safety", label: "Critical safety blocker" },
  { id: "blocked", label: "Blocked analysis" },
  { id: "empty", label: "Not evaluated" },
  { id: "loading", label: "Loading preview" },
] as const;
export const scenarios = [...publicDemoScenarios, ...technicalScenarios] as const;
export const viewers = ["alex", "sam", "jo", "mika"] as const;
export const previewFrames = [
  "initial",
  "updated",
  "revised",
  "review",
  "carpool",
] as const;
export type ScenarioId = (typeof scenarios)[number]["id"];
export type ViewerId = (typeof viewers)[number];
export type PreviewFrame = (typeof previewFrames)[number];

export async function fetchPreview(
  scenario: Exclude<ScenarioId, "loading">,
  viewer: ViewerId,
  frame: PreviewFrame,
  signal: AbortSignal,
): Promise<DashboardSnapshot> {
  const response = await fetch(
    "/dashboard-preview/" + scenario + "/" + viewer + ".json",
    {
      signal,
      credentials: "omit",
      cache: "force-cache",
      headers: { Accept: "application/json" },
    },
  );
  if (!response.ok)
    throw new Error("The dashboard preview couldn’t load. Try again.");
  const fixture = (await response.json()) as Partial<
    Record<PreviewFrame, unknown>
  >;
  const parsed = DashboardSnapshotSchema.safeParse(fixture[frame]);
  if (!parsed.success || parsed.data.source !== "synthetic")
    throw new Error("The preview returned an unsupported room view.");
  return parsed.data;
}
