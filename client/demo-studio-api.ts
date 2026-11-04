import type { ScenarioDraft, ScenarioRecord } from "../server/src/synthetic/scenario-schema";

const base = "/api/demo-studio";

export interface RoomTabSession {
  roomId: string;
  participantId: string;
  token: string;
}

export interface ScenarioGenerationInput {
  category: string;
  difficulty: "easy" | "medium" | "hard" | "adversarial";
  expectedAttendeeCount: number;
  activePlannerCount: number;
  messageCount: number;
  timeZone: string;
  dateLocal: string | null;
}

export interface GenerationProvenance {
  source: "Meta Muse Spark";
  model: "muse-spark-1.3";
  promptVersion: "scenario-generator-v1";
  responseId: string | null;
  generatedAt: string;
  priceSnapshotDate: "2026-11-03";
  attempts: number;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostMicros: number | null;
  durationMs: number;
}

export interface ScenarioGenerationDraft {
  generationId: string;
  scenario: ScenarioDraft;
  provenance: GenerationProvenance;
  validation: "passed";
  playbackStarted: false;
}

export interface StudioHealth {
  localOnly: true;
  roomApi: {
    mode: "synthetic-live-demo" | "local-live" | "unavailable";
    enabled: boolean;
    budget: null | {
      attempts: number;
      remainingAttempts: number | null;
      reservedTokens: number;
      remainingTokens: number | null;
      reservedCostMicros: number;
      remainingCostMicros: number | null;
    };
  };
  scenarioGeneratorMounted: boolean;
  apiOrigin?: string;
}

export interface StudioSimulation {
  run: {
    runId: string;
    datasetId: string;
    datasetVersion: number;
    mode: "LIVE";
    status: string;
    label: string;
    startedAt: string;
    completedAt: string | null;
    events: Array<{ id: string; phase: string; outcome: string; note: string; snapshot: unknown; capturedAt: string }>;
    roomIdHash: string;
  };
  cursor: number;
  total: number;
  busy: boolean;
  paused: boolean;
  updatedAt: string;
  currentSnapshot: unknown;
  dataset?: { id: string; version: number; name: string; eventType: string; expectedAttendees: number; activePlanners: number };
  mode?: "RECORDED";
  playbackId?: string;
  dashboardSession?: RoomTabSession;
  dashboardInvitation?: string;
  participantNames?: Array<{ id: string; name: string; role: string; joined: boolean }>;
}

export interface RecordedRunSummary {
  runId: string;
  datasetId: string;
  datasetVersion: number;
  label: string;
  startedAt: string;
  completedAt: string | null;
  status: string;
  events: number;
  roomIdHash: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      headers: {
        Accept: "application/json",
        ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...init?.headers,
      },
    });
  } catch {
    throw new Error("The local Demo Studio API is unavailable. Start it with `npm run demo:studio`.");
  }
  let value: unknown;
  try { value = await response.json(); } catch { value = null; }
  if (!response.ok) {
    const message = value && typeof value === "object" && "error" in value && typeof value.error === "string"
      ? value.error
      : "The local Demo Studio action could not be completed.";
    throw new Error(message);
  }
  return value as T;
}

const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const getStudioHealth = () => request<StudioHealth>("/health");
export const listScenarios = async () => (await request<{ scenarios: ScenarioRecord[] }>("/scenarios")).scenarios;
export const getScenario = async (datasetId: string, version?: number) => {
  const query = version ? `?version=${encodeURIComponent(String(version))}` : "";
  return (await request<{ scenario: ScenarioRecord }>(`/scenarios/${encodeURIComponent(datasetId)}${query}`)).scenario;
};
export const generateScenario = (input: ScenarioGenerationInput) => request<ScenarioGenerationDraft>("/generate", json(input));
export const saveNewScenario = async (generationId: string, scenario: ScenarioDraft, editedPaths: string[]) =>
  (await request<{ scenario: ScenarioRecord }>("/scenarios", json({ generationId, scenario, editedPaths }))).scenario;
export const saveScenarioVersion = async (datasetId: string, expectedVersion: number, scenario: ScenarioDraft, editedPaths: string[]) =>
  (await request<{ scenario: ScenarioRecord }>(`/scenarios/${encodeURIComponent(datasetId)}`, {
    method: "PUT", body: JSON.stringify({ expectedVersion, scenario, editedPaths }),
  })).scenario;
export const approveScenario = async (datasetId: string, expectedVersion: number) =>
  (await request<{ scenario: ScenarioRecord }>(`/scenarios/${encodeURIComponent(datasetId)}/approve`, json({ expectedVersion }))).scenario;
export const listRecordedRuns = async () => (await request<{ recordings: RecordedRunSummary[] }>("/recordings")).recordings;
export const loadRecordedRun = async (runId: string) =>
  (await request<{ simulation: StudioSimulation }>(`/recordings/${encodeURIComponent(runId)}/play`, json({}))).simulation;
export const startLiveRun = async (datasetId: string, version: number) =>
  (await request<{ simulation: StudioSimulation }>("/simulations", json({ datasetId, version }))).simulation;
export const getSimulation = async (runId: string) =>
  (await request<{ simulation: StudioSimulation }>(`/simulations/${encodeURIComponent(runId)}`)).simulation;
export const nextSimulationEvent = async (runId: string) =>
  (await request<{ simulation: StudioSimulation }>(`/simulations/${encodeURIComponent(runId)}/next`, json({}))).simulation;
export const playSimulation = async (runId: string, speed: number) =>
  (await request<{ simulation: StudioSimulation }>(`/simulations/${encodeURIComponent(runId)}/play`, json({ speed }))).simulation;
export const pauseSimulation = async (runId: string) =>
  (await request<{ simulation: StudioSimulation }>(`/simulations/${encodeURIComponent(runId)}/pause`, json({}))).simulation;
export const resumeSimulation = async (runId: string, speed: number) =>
  (await request<{ simulation: StudioSimulation }>(`/simulations/${encodeURIComponent(runId)}/resume`, json({ speed }))).simulation;
export const skipSimulationEvent = async (runId: string) =>
  (await request<{ simulation: StudioSimulation }>(`/simulations/${encodeURIComponent(runId)}/skip`, json({}))).simulation;
export const resetSimulation = async (runId: string) =>
  (await request<{ simulation: StudioSimulation }>(`/simulations/${encodeURIComponent(runId)}/reset`, json({}))).simulation;
export const submitManualIntervention = async (runId: string, input: { participantId: string; text: string; visibility: "group" | "private" }) =>
  (await request<{ simulation: StudioSimulation }>(`/simulations/${encodeURIComponent(runId)}/manual`, json(input))).simulation;
