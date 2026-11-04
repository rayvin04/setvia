import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, BadgeCheck, Check, ChevronDown, CircleAlert, Clock3, ExternalLink, FilePlus2, FolderOpen, Gauge, HardDrive, MessageSquare, Pause, Play, RotateCcw, Save, Shield, SkipForward, Sparkles, Users, WandSparkles } from "lucide-react";
import {
  approveScenario,
  generateScenario,
  getScenario,
  getSimulation,
  getStudioHealth,
  listRecordedRuns,
  listScenarios,
  loadRecordedRun,
  nextSimulationEvent,
  pauseSimulation,
  playSimulation,
  resetSimulation,
  resumeSimulation,
  saveNewScenario,
  saveScenarioVersion,
  skipSimulationEvent,
  startLiveRun,
  submitManualIntervention,
  type RecordedRunSummary,
  type RoomTabSession,
  type ScenarioGenerationDraft,
  type StudioHealth,
  type StudioSimulation,
} from "./demo-studio-api";
import { readDemoDashboardSession, storeDemoDashboardSession } from "./demo-room-session";
import { ScenarioDraftSchema, type ScenarioDraft, type ScenarioRecord } from "../server/src/synthetic/scenario-schema";
import "./demo-studio.css";

const categories = [
  ["beach_outing", "Beach outing"],
  ["mountain_hike", "Mountain hike"],
  ["professional_meeting", "Professional meeting"],
  ["family_reunion", "Family reunion"],
  ["large_event", "Large event"],
  ["wedding", "Wedding"],
  ["school_project", "School project"],
  ["birthday_party", "Birthday party"],
  ["conference", "Conference"],
  ["other", "Other"],
] as const;

const difficulties = ["easy", "medium", "hard", "adversarial"] as const;
const activeRunStorageKey = "setvia.demo-studio.active-run.v1";

function dateLabel(value: string | null | undefined) {
  if (!value) return "No event date";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

function usd(micros: number | null | undefined) {
  if (micros === null || micros === undefined) return "Pending usage";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(micros / 1_000_000);
}

function localTime(value: string) {
  try { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
  catch { return value; }
}

function changedPaths(before: string, after: string) {
  try {
    const prior: unknown = JSON.parse(before);
    const next: unknown = JSON.parse(after);
    const changed: string[] = [];
    const walk = (left: unknown, right: unknown, path: string) => {
      if (Object.is(left, right)) return;
      if (Array.isArray(left) && Array.isArray(right)) {
        const length = Math.max(left.length, right.length);
        for (let index = 0; index < length; index += 1) walk(left[index], right[index], `${path}[${index}]`);
        return;
      }
      if (left && right && typeof left === "object" && typeof right === "object") {
        const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
        for (const key of keys) walk((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key], path ? `${path}.${key}` : key);
        return;
      }
      changed.push(path || "scenario");
    };
    walk(prior, next, "");
    return changed.slice(0, 100);
  } catch { return ["scenario"]; }
}

function parseScenarioJson(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    const result = ScenarioDraftSchema.safeParse(parsed);
    return result.success ? { scenario: result.data, issues: [] as string[] } : {
      scenario: null,
      issues: result.error.issues.slice(0, 4).map((issue) => `${issue.path.join(".") || "scenario"}: ${issue.message}`),
    };
  } catch {
    return { scenario: null, issues: ["The scenario editor must contain valid JSON."] };
  }
}

function encodeScenario(scenario: ScenarioDraft) {
  return JSON.stringify(scenario, null, 2);
}

function roomIdFromSnapshot(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object" || !("room" in snapshot)) return "";
  const room = (snapshot as { room?: { roomId?: unknown } }).room;
  return typeof room?.roomId === "string" ? room.roomId : "";
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function RoomSnapshotReview({ snapshot }: { snapshot: unknown }) {
  const root = objectValue(snapshot);
  const room = objectValue(root?.room);
  if (!room) return null;
  const readiness = objectValue(room.readiness);
  const findings = arrayValue(room.findings).flatMap((value) => {
    const item = objectValue(value);
    return item && typeof item.message === "string" ? [{
      category: typeof item.category === "string" ? item.category : "Finding",
      severity: typeof item.severity === "string" ? item.severity : "info",
      status: typeof item.status === "string" ? item.status : "open",
      message: item.message,
    }] : [];
  });
  const questions = arrayValue(room.questions).flatMap((value) => {
    const item = objectValue(value);
    return item && typeof item.text === "string" ? [{ text: item.text, visibility: item.visibility === "private" ? "private" : "group" }] : [];
  });
  const people = arrayValue(room.participants);
  const activities = arrayValue(root?.activity).flatMap((value) => {
    const item = objectValue(value);
    return item && typeof item.summary === "string" ? [{ summary: item.summary, kind: typeof item.kind === "string" ? item.kind : "room update" }] : [];
  }).slice(-5).reverse();
  const percentage = typeof readiness?.percentage === "number" ? readiness.percentage : null;
  const readinessStatus = typeof readiness?.status === "string" ? readiness.status.replaceAll("_", " ") : "not calculated";
  const analysis = typeof room.analysisStatus === "string" ? room.analysisStatus.replaceAll("_", " ") : "unknown";

  return <div className="studio-snapshot-review">
    <div className="studio-snapshot-head">
      <div><span className="studio-kicker">LIVE VALIDATED ROOM STATE</span><strong>{analysis}</strong></div>
      {percentage !== null ? <div className="studio-readiness-value"><strong>{percentage}%</strong><small>{readinessStatus}</small></div> : null}
    </div>
    {percentage !== null ? <progress className="studio-readiness-progress" max={100} value={percentage} aria-label={`Readiness ${percentage} percent`} /> : null}
    <div className="studio-snapshot-facts"><span>{people.length} room members</span><span>{findings.length} findings</span><span>{questions.length} questions</span>{typeof room.approvalCount === "number" ? <span>{room.approvalCount} approvals</span> : null}</div>
    {findings.length ? <div className="studio-snapshot-findings"><h3>Reality Check findings</h3>{findings.slice(0, 6).map((item, index) => <div className="studio-snapshot-finding" key={`${item.category}-${index}`}><span className={`studio-severity ${item.severity}`}>{item.severity}</span><span className="studio-finding-category">{item.category} · {item.status}</span><p>{item.message}</p></div>)}</div> : null}
    {questions.length ? <div className="studio-snapshot-questions"><h3>Questions in this snapshot</h3>{questions.slice(0, 4).map((item, index) => <p key={`${item.text}-${index}`}><span className={`studio-visibility ${item.visibility}`}><span />{item.visibility}</span>{item.text}</p>)}</div> : null}
    {activities.length ? <div className="studio-snapshot-activity"><h3>Recent validated room events</h3>{activities.map((item, index) => <p key={`${item.kind}-${index}`}><span>{item.kind.replaceAll("_", " ")}</span>{item.summary}</p>)}</div> : null}
  </div>;
}

function shortId(value: string) {
  return value.length > 28 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value;
}

export default function DemoStudio() {
  const [health, setHealth] = useState<StudioHealth | null>(null);
  const [records, setRecords] = useState<ScenarioRecord[]>([]);
  const [recordings, setRecordings] = useState<RecordedRunSummary[]>([]);
  const [scenarioText, setScenarioText] = useState("");
  const [baselineText, setBaselineText] = useState("");
  const [currentRecord, setCurrentRecord] = useState<ScenarioRecord | null>(null);
  const [generation, setGeneration] = useState<ScenarioGenerationDraft | null>(null);
  const [simulation, setSimulation] = useState<StudioSimulation | null>(null);
  const [dashboardSession, setDashboardSession] = useState<RoomTabSession | null>(null);
  const [dashboardInvitation, setDashboardInvitation] = useState<string | null>(null);
  const [category, setCategory] = useState<(typeof categories)[number][0]>("beach_outing");
  const [difficulty, setDifficulty] = useState<(typeof difficulties)[number]>("medium");
  const [attendees, setAttendees] = useState(12);
  const [planners, setPlanners] = useState(5);
  const [messageCount, setMessageCount] = useState(10);
  const [timeZone, setTimeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Manila");
  const [dateLocal, setDateLocal] = useState("");
  const [speed, setSpeed] = useState(1);
  const [manualParticipant, setManualParticipant] = useState("");
  const [manualVisibility, setManualVisibility] = useState<"group" | "private">("group");
  const [manualText, setManualText] = useState("");
  const [showGroundTruth, setShowGroundTruth] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [dashboardVisible, setDashboardVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const parsed = useMemo(() => parseScenarioJson(scenarioText), [scenarioText]);
  const scenario = parsed.scenario;
  const isDirty = Boolean(scenario && scenarioText !== baselineText);
  const simulationMode = simulation?.mode === "RECORDED" ? "RECORDED" : simulation?.run.mode ?? null;
  const liveUsage = health?.roomApi.budget ?? null;
  const roomId = simulation ? roomIdFromSnapshot(simulation.currentSnapshot) : "";
  const dashboardUrl = roomId && simulation ? `/rooms/${encodeURIComponent(roomId)}?syntheticRun=${encodeURIComponent(simulation.run.runId)}` : "";
  const approved = Boolean(currentRecord?.review.approvedForPlayback);
  const canLive = Boolean(
    currentRecord && approved &&
    health?.roomApi.mode === "synthetic-live-demo" &&
    health.roomApi.enabled,
  );

  const refresh = useCallback(async () => {
    const [newHealth, newRecords, newRecordings] = await Promise.all([getStudioHealth(), listScenarios(), listRecordedRuns()]);
    setHealth(newHealth);
    setRecords(newRecords);
    setRecordings(newRecordings);
  }, []);

  useEffect(() => {
    let active = true;
    void refresh().catch((failure) => setError(failure instanceof Error ? failure.message : "Could not load the private Studio data."))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]);

  useEffect(() => {
    let active = true;
    let runId: string | null = null;
    try { runId = window.sessionStorage.getItem(activeRunStorageKey); } catch { return; }
    if (!runId) return;
    void getSimulation(runId).then((loaded) => {
      if (!active || loaded.run.mode !== "LIVE") return;
      setSimulation(loaded);
      const stored = readDemoDashboardSession(roomIdFromSnapshot(loaded.currentSnapshot));
      if (stored) {
        setDashboardSession(stored.session);
        setDashboardInvitation(stored.invitation);
      }
    }).catch(() => {
      try { window.sessionStorage.removeItem(activeRunStorageKey); } catch { /* Optional same-tab recovery. */ }
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!simulation || simulationMode !== "LIVE") return;
    let active = true;
    const timer = window.setInterval(() => {
      void getSimulation(simulation.run.runId).then((next) => { if (active) setSimulation(next); }).catch(() => {});
    }, 1_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [simulation?.run.runId, simulationMode]);

  useEffect(() => {
    const firstJoined = simulation?.participantNames?.find((participant) => participant.joined);
    if (firstJoined && !manualParticipant) setManualParticipant(firstJoined.id);
  }, [simulation?.participantNames, manualParticipant]);

  const handleAction = async (action: () => Promise<void>) => {
    setError("");
    setMessage("");
    setBusy(true);
    try { await action(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The Studio action failed."); }
    finally { setBusy(false); }
  };

  const installScenario = (next: ScenarioDraft, record: ScenarioRecord | null, draft: ScenarioGenerationDraft | null) => {
    const text = encodeScenario(next);
    setScenarioText(text);
    setBaselineText(text);
    setCurrentRecord(record);
    setGeneration(draft);
    setShowGroundTruth(false);
    setShowJson(false);
    setError("");
  };

  const editScenario = (next: ScenarioDraft) => setScenarioText(encodeScenario(next));

  const generate = () => handleAction(async () => {
    const result = await generateScenario({
      category,
      difficulty,
      expectedAttendeeCount: attendees,
      activePlannerCount: planners,
      messageCount,
      timeZone,
      dateLocal: dateLocal || null,
    });
    installScenario(result.scenario, null, result);
    setSimulation(null);
    try { window.sessionStorage.removeItem(activeRunStorageKey); } catch { /* Optional same-tab recovery. */ }
    setDashboardVisible(false);
    setMessage("Validated draft is ready for review. Playback has not started.");
  });

  const save = () => handleAction(async () => {
    if (!scenario || parsed.issues.length || !isDirty) return;
    const edited = changedPaths(baselineText, scenarioText);
    let saved: ScenarioRecord;
    if (currentRecord) saved = await saveScenarioVersion(currentRecord.datasetId, currentRecord.datasetVersion, scenario, edited);
    else if (generation) saved = await saveNewScenario(generation.generationId, scenario, edited);
    else throw new Error("Generate or load a scenario before saving.");
    installScenario(saved.scenario, saved, null);
    await refresh();
    setMessage(`Saved private dataset ${saved.datasetId}, version ${saved.datasetVersion}.`);
  });

  const approve = () => handleAction(async () => {
    if (!currentRecord || isDirty || parsed.issues.length) return;
    const approvedRecord = await approveScenario(currentRecord.datasetId, currentRecord.datasetVersion);
    installScenario(approvedRecord.scenario, approvedRecord, null);
    await refresh();
    setMessage(`Version ${approvedRecord.datasetVersion} is approved for playback.`);
  });

  const loadScenarioRecord = (record: ScenarioRecord) => handleAction(async () => {
    const loaded = await getScenario(record.datasetId, record.datasetVersion);
    installScenario(loaded.scenario, loaded, null);
    setSimulation(null);
    try { window.sessionStorage.removeItem(activeRunStorageKey); } catch { /* Optional same-tab recovery. */ }
    setDashboardVisible(false);
    setMessage(`Loaded ${loaded.datasetId}, version ${loaded.datasetVersion}.`);
  });

  const openDashboard = () => {
    const stored = roomId ? readDemoDashboardSession(roomId) : null;
    const session = dashboardSession ?? simulation?.dashboardSession ?? stored?.session;
    const invitation = dashboardInvitation ?? simulation?.dashboardInvitation ?? stored?.invitation;
    if (!session || !invitation) {
      setError("The room tab session is only returned at live room creation. Reset into a new room to open its dashboard in this tab.");
      return;
    }
    try {
      storeDemoDashboardSession(session, invitation);
      setDashboardVisible(true);
      setError("");
      setMessage("The creator session is stored in this tab. The embedded dashboard uses the normal authenticated room route.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not store the dashboard session in this tab.");
    }
  };

  const startLive = () => handleAction(async () => {
    if (!currentRecord || isDirty || !approved || !canLive) return;
    const next = await startLiveRun(currentRecord.datasetId, currentRecord.datasetVersion);
    try { window.sessionStorage.setItem(activeRunStorageKey, next.run.runId); } catch { /* Optional same-tab recovery. */ }
    if (next.dashboardSession && next.dashboardInvitation) {
      storeDemoDashboardSession(next.dashboardSession, next.dashboardInvitation);
      setDashboardSession(next.dashboardSession);
      setDashboardInvitation(next.dashboardInvitation);
    }
    setSimulation(next);
    setDashboardVisible(true);
    setMessage("Room created through Setvia's authenticated API. Start playback when you are ready.");
    await refresh();
  });

  const loadRecording = (recording: RecordedRunSummary) => handleAction(async () => {
    const loaded = await loadRecordedRun(recording.runId);
    setSimulation(loaded);
    try { window.sessionStorage.removeItem(activeRunStorageKey); } catch { /* Recorded mode does not use live session recovery. */ }
    setDashboardVisible(false);
    setMessage("Recorded synthetic demo loaded. This replay uses saved room outputs and makes no Meta requests.");
  });

  const mutateRun = (fn: (runId: string) => Promise<StudioSimulation>, success?: string) => handleAction(async () => {
    if (!simulation) return;
    const next = await fn(simulation.playbackId ?? simulation.run.runId);
    if (next.mode !== "RECORDED" && next.run.mode === "LIVE") {
      try { window.sessionStorage.setItem(activeRunStorageKey, next.run.runId); } catch { /* Optional same-tab recovery. */ }
    }
    if (next.dashboardSession && next.dashboardInvitation) {
      storeDemoDashboardSession(next.dashboardSession, next.dashboardInvitation);
      setDashboardSession(next.dashboardSession);
      setDashboardInvitation(next.dashboardInvitation);
    }
    setSimulation(next);
    if (success) setMessage(success);
    if (next.mode === "RECORDED") await refresh();
    if (next.run.mode === "LIVE") await refresh();
  });

  const editMessage = (messageId: string, text: string) => {
    if (!scenario) return;
    const next = structuredClone(scenario);
    const target = next.messages.find((item) => item.id === messageId);
    if (!target) return;
    target.text = text;
    for (const reply of next.questionResponses) if (reply.id === messageId) reply.responseText = text;
    editScenario(next);
  };

  const patchEventField = (field: "name" | "type" | "description" | "initialPlan" | "timeZone" | "dateLocal" | "expectedAttendeeCount", value: string) => {
    if (!scenario) return;
    const next = structuredClone(scenario);
    if (field === "expectedAttendeeCount") next.event.expectedAttendeeCount = Math.max(1, Number(value) || 1);
    else if (field === "dateLocal") next.event.dateLocal = value || null;
    else next.event[field] = value;
    editScenario(next);
  };

  const toggleMessageVisibility = (messageId: string, visibility: "group" | "private") => {
    if (!scenario) return;
    const next = structuredClone(scenario);
    const target = next.messages.find((item) => item.id === messageId);
    if (!target) return;
    target.visibility = visibility;
    for (const reply of next.questionResponses) if (reply.id === messageId) reply.visibility = visibility;
    for (const constraint of next.groundTruth.constraints) if (constraint.sourceMessageIds.includes(messageId)) constraint.visibility = visibility;
    editScenario(next);
  };

  const editDelay = (messageId: string, value: string) => {
    if (!scenario) return;
    const next = structuredClone(scenario);
    const target = next.messages.find((item) => item.id === messageId);
    if (!target) return;
    const seconds = Math.max(0, Math.min(900, Number(value) || 0));
    target.delaySeconds = seconds;
    for (const event of next.timeline) if (event.messageId === messageId) event.delaySeconds = seconds;
    editScenario(next);
  };

  const submitManual = () => handleAction(async () => {
    if (!simulation || !manualParticipant || !manualText.trim()) return;
    const next = await submitManualIntervention(simulation.run.runId, {
      participantId: manualParticipant,
      text: manualText.trim(),
      visibility: manualVisibility,
    });
    setSimulation(next);
    setManualText("");
    setMessage("Manual participant response submitted through the authenticated room API.");
    await refresh();
  });

  const groundTruth = scenario?.groundTruth;
  const privateMessages = scenario?.messages.filter((item) => item.visibility === "private") ?? [];
  const eventName = scenario?.event.name ?? "Scenario review";
  const nextEvent = scenario && simulation ? scenario.timeline[simulation.cursor] : null;
  const canSkip = Boolean(simulationMode === "LIVE" && nextEvent?.kind === "message" && scenario?.messages.find((item) => item.id === nextEvent.messageId)?.questionRefId);

  return (
    <div className="demo-studio-shell" aria-busy={loading || busy}>
      <aside className="studio-rail" aria-label="Demo Studio navigation">
        <a className="studio-brand" href="/" aria-label="Setvia home">
          <span className="studio-mark" aria-hidden="true">S<span>.</span></span>
          <span><strong>SETVIA</strong><small>DEMO STUDIO</small></span>
        </a>
        <div className="studio-rail-label">WORKSPACE</div>
        <a className="studio-rail-link active" href="#scenario"><Sparkles size={17} aria-hidden="true" />Scenario desk</a>
        <a className="studio-rail-link" href="#saved"><FolderOpen size={17} aria-hidden="true" />Saved datasets</a>
        <a className="studio-rail-link" href="#recorded"><Activity size={17} aria-hidden="true" />Recorded runs</a>
        <div className="studio-rail-spacer" />
        <div className="studio-private-card"><span aria-hidden="true" /><div><strong>Local workspace</strong><small>Datasets and run records stay in your private folder.</small></div></div>
        <p className="studio-rail-foot">Synthetic people · Developer tools</p>
      </aside>

      <main className="studio-main" id="scenario">
        <header className="studio-topbar">
          <div className="studio-crumb"><span>Setvia</span><i>/</i><strong>Demo Studio</strong></div>
          <div className="studio-top-actions">
            <span className="studio-local-pill"><span /> LOCAL ONLY</span>
            <a href="/demos" className="studio-text-link">Regression fixtures <ExternalLink size={14} aria-hidden="true" /></a>
          </div>
        </header>

        <div className="studio-pagehead">
          <div>
            <div className="studio-eyebrow"><WandSparkles size={14} aria-hidden="true" />MUSE-POWERED SYNTHETIC SCENARIOS</div>
            <h1>Scenario desk</h1>
            <p>Generate fictional group plans, review every participant message, and choose when to play them through Setvia.</p>
          </div>
          <div className="studio-live-label"><span /> Synthetic participants <b>·</b> Live Meta AI</div>
        </div>

        {error ? <div className="studio-alert error" role="alert"><CircleAlert size={17} aria-hidden="true" />{error}</div> : null}
        {message ? <div className="studio-alert success" role="status"><Check size={17} aria-hidden="true" />{message}</div> : null}

        <section className="studio-metrics" aria-label="Scenario counts">
          <div><span>Event attendees</span><strong>{scenario?.event.expectedAttendeeCount ?? attendees}</strong><small>expected to attend</small></div>
          <div><span>Room planners</span><strong>{scenario?.activePlannerCount ?? planners}</strong><small>fictional Setvia members</small></div>
          <div><span>Participant messages</span><strong>{scenario?.messages.length ?? messageCount}</strong><small>ordered, visibility marked</small></div>
          <div><span>Meta HTTP attempts</span><strong>{liveUsage ? liveUsage.attempts.toLocaleString() : "Unavailable"}</strong><small>recorded for this run</small></div>
        </section>

        <div className="studio-workbench">
          <aside className="studio-setup panel" aria-labelledby="setup-title">
            <div className="studio-panel-heading"><div><span className="studio-kicker">01 · CONFIGURE</span><h2 id="setup-title">Build a scenario</h2></div><span className="studio-count">A</span></div>
            <p className="studio-panel-copy">Choose the event and the people planning it. Attendees and room members are separate counts.</p>
            <label className="studio-field">Event category
              <select value={category} onChange={(event) => setCategory(event.currentTarget.value as typeof category)}>
                {categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="studio-field">Difficulty
              <select value={difficulty} onChange={(event) => setDifficulty(event.currentTarget.value as typeof difficulty)}>
                {difficulties.map((value) => <option key={value} value={value}>{value[0]!.toUpperCase() + value.slice(1)}</option>)}
              </select>
            </label>
            <div className="studio-field-pair">
              <label className="studio-field">Event attendees<input type="number" min={1} max={100000} value={attendees} onChange={(event) => setAttendees(Math.max(1, Number(event.currentTarget.value) || 1))} /></label>
              <label className="studio-field">Room planners<input type="number" min={1} max={100} value={planners} onChange={(event) => setPlanners(Math.max(1, Number(event.currentTarget.value) || 1))} /></label>
            </div>
            <label className="studio-field">Participant messages<input type="number" min={1} max={100} value={messageCount} onChange={(event) => setMessageCount(Math.max(1, Number(event.currentTarget.value) || 1))} /></label>
            <label className="studio-field">Reference timezone<input value={timeZone} onChange={(event) => setTimeZone(event.currentTarget.value)} maxLength={80} /></label>
            <label className="studio-field">Event date <span className="studio-optional">optional</span><input type="date" value={dateLocal} onChange={(event) => setDateLocal(event.currentTarget.value)} /></label>
            <div className="studio-privacy-note"><Shield size={15} aria-hidden="true" /><span>Fictional inputs only. No venue, weather, price, or safety facts are externally verified.</span></div>
            <button type="button" className="studio-primary-button studio-full" onClick={generate} disabled={busy || !health?.scenarioGeneratorMounted}>
              <Sparkles size={16} aria-hidden="true" />{busy ? "Working…" : "Generate with Muse Spark"}
            </button>
            {!health?.scenarioGeneratorMounted ? <p className="studio-inline-note">The Meta-backed scenario generator is not available on this server.</p> : null}
            {generation ? <p className="studio-inline-note">Generation does not start playback. Review and save the draft first.</p> : null}
          </aside>

          <section className="studio-center-column" aria-label="Scenario review and playback">
            <div className="studio-scenario panel">
              <div className="studio-panel-heading studio-scenario-heading">
                <div><span className="studio-kicker">02 · REVIEW INPUTS</span><h2>{scenario ? eventName : "Your scenario appears here"}</h2></div>
                {scenario ? <span className={`studio-difficulty difficulty-${scenario.difficulty}`}>{scenario.difficulty}</span> : null}
              </div>
              {!scenario ? <div className="studio-empty"><div className="studio-empty-mark"><Sparkles size={23} aria-hidden="true" /></div><strong>Start with a planning situation</strong><span>Choose a category and counts, then ask Muse Spark to create fictional participants and a message timeline.</span></div> : <>
                <div className="studio-event-edit-grid">
                  <label className="studio-field">Event name<input value={scenario.event.name} maxLength={120} onChange={(event) => patchEventField("name", event.currentTarget.value)} /></label>
                  <label className="studio-field">Event type<input value={scenario.event.type} maxLength={80} onChange={(event) => patchEventField("type", event.currentTarget.value)} /></label>
                  <label className="studio-field studio-span-2">Description<textarea rows={2} value={scenario.event.description} maxLength={800} onChange={(event) => patchEventField("description", event.currentTarget.value)} /></label>
                  <label className="studio-field studio-span-2">Initial plan shown to the room<textarea rows={2} value={scenario.event.initialPlan} maxLength={300} onChange={(event) => patchEventField("initialPlan", event.currentTarget.value)} /></label>
                </div>
                <div className="studio-event-facts"><span><Users size={14} aria-hidden="true" />{scenario.event.expectedAttendeeCount} expected attendees</span><span>{scenario.activePlannerCount} active room planners</span><span><Clock3 size={14} aria-hidden="true" />{dateLabel(scenario.event.dateLocal)} · {scenario.event.timeZone}</span></div>

                <div className="studio-section-heading"><div><span className="studio-kicker">PLANNING ROOM MEMBERS</span><strong>{scenario.participants.length} fictional profiles</strong></div><span className="studio-small-metric">{privateMessages.length} private messages</span></div>
                <div className="studio-people-grid">
                  {scenario.participants.map((person, index) => <article className="studio-person" key={person.id}>
                    <span className={`studio-avatar studio-avatar-${index % 5}`}>{person.name.slice(0, 1).toLocaleUpperCase()}</span>
                    <div className="studio-person-copy"><div><strong>{person.name}</strong><span>{person.role}</span></div><p>{person.personality}</p><small>{person.responsePattern} · {person.speakingStyle}</small><small className="studio-budget-line">Budget: {person.budget.amount === null ? "unspecified" : `${person.budget.currency} ${person.budget.amount.toLocaleString()}`}</small></div>
                  </article>)}
                </div>

                <div className="studio-section-heading studio-timeline-heading"><div><span className="studio-kicker">ROOM PLAYBACK</span><strong>Participant timeline</strong></div><span className="studio-small-metric">Join events, then messages</span></div>
                <ol className="studio-timeline">
                  {scenario.timeline.map((event, index) => {
                    const participant = scenario.participants.find((item) => item.id === event.participantId);
                    const item = event.kind === "message" ? scenario.messages.find((entry) => entry.id === event.messageId) : null;
                    const active = simulation?.run.mode === "LIVE" && index < simulation.cursor;
                    return <li className={`studio-timeline-item ${active ? "done" : ""}`} key={event.id}>
                      <div className="studio-time-rail"><span>{event.kind === "join" ? <Users size={13} aria-hidden="true" /> : <MessageSquare size={13} aria-hidden="true" />}</span><b>{String(index + 1).padStart(2, "0")}</b></div>
                      <article className="studio-transcript-row">
                        <header><div className="studio-speaker"><strong>{participant?.name ?? "Unknown planner"}</strong><small>{event.kind === "join" ? "joined the room" : participant?.role ?? "participant"}</small></div>
                          {item ? <div className="studio-message-controls"><label className={`studio-visibility ${item.visibility}`}><span />{item.visibility === "private" ? "PRIVATE" : "GROUP"}</label><label className="studio-delay">in <input aria-label={`Delay before ${participant?.name}'s message`} type="number" min={0} max={900} value={item.delaySeconds} onChange={(change) => editDelay(item.id, change.currentTarget.value)} /> sec</label></div> : <span className="studio-event-chip">JOIN</span>}
                        </header>
                        {item ? <textarea className="studio-message-editor" aria-label={`Message from ${participant?.name}`} rows={Math.min(4, Math.max(2, Math.ceil(item.text.length / 86)))} value={item.text} maxLength={1000} onChange={(change) => editMessage(item.id, change.currentTarget.value)} /> : <p className="studio-join-copy">{participant?.name} enters as {participant?.role}.</p>}
                      </article>
                    </li>;
                  })}
                </ol>

                <details className="studio-advanced" open={showJson} onToggle={(event) => setShowJson(event.currentTarget.open)}>
                  <summary><span><ChevronDown size={15} aria-hidden="true" />Advanced scenario JSON</span><small>All scenario fields, including participants and question intents</small></summary>
                  {parsed.issues.length ? <div className="studio-editor-error" role="status">{parsed.issues.join(" · ")}</div> : null}
                  <textarea className="studio-json-editor" aria-label="Edit complete scenario JSON" spellCheck={false} value={scenarioText} onChange={(event) => setScenarioText(event.currentTarget.value)} />
                </details>

                <details className="studio-groundtruth" open={showGroundTruth} onToggle={(event) => setShowGroundTruth(event.currentTarget.open)}>
                  <summary><Shield size={15} aria-hidden="true" /><span>Private evaluation annotations</span><small>Developer review only · never sent to room agents</small><ChevronDown size={15} aria-hidden="true" /></summary>
                  {groundTruth ? <div className="studio-groundtruth-body">
                    <h3>Constraints</h3>
                    {groundTruth.constraints.length ? groundTruth.constraints.map((item) => <div className="studio-truth-row" key={item.id}><span className={`studio-truth-tag ${item.hardness}`}>{item.hardness}</span><span className={`studio-visibility ${item.visibility}`}><span />{item.visibility}</span><p>{item.description}</p><small>Evidence: {item.sourceMessageIds.join(", ")}</small></div>) : <p className="studio-empty-copy">No annotated constraints.</p>}
                    <h3>Expected findings and blind spots</h3>
                    {[...groundTruth.expectedProblems, ...groundTruth.hiddenComplications].map((item) => <div className="studio-truth-row" key={item.id}><span className={`studio-severity ${item.severity}`}>{item.severity}</span><strong>{item.category}</strong><p>{item.description}</p><small>Evidence: {item.evidenceMessageIds.join(", ")}</small></div>)}
                    <h3>Evaluation notes</h3><ul>{groundTruth.evaluationNotes.map((note) => <li key={note}>{note}</li>)}</ul>
                  </div> : null}
                </details>
              </>}
            </div>

            <div className="studio-run panel" id="run">
              <div className="studio-panel-heading"><div><span className="studio-kicker">03 · PLAYBACK</span><h2>{simulation ? simulation.run.label : "Choose a playback mode"}</h2></div>{simulation ? <span className={`studio-run-status ${simulation.run.status}`}>{simulation.run.status.replaceAll("_", " ")}</span> : null}</div>
              <p className="studio-panel-copy">Recorded replays use saved outputs and make no Meta requests. Live playback uses Setvia’s real room agents and waits for their actual room state.</p>

              {!simulation ? <div className="studio-mode-grid">
                <article className="studio-mode-card"><div className="studio-mode-title"><span className="studio-mode-icon recorded"><Activity size={17} aria-hidden="true" /></span><div><strong>Recorded demo</strong><small>Saved synthetic messages · saved agent outputs</small></div></div><p>Reopen a previous room run for fast, reproducible walkthroughs. No new Meta calls.</p><a className="studio-inline-anchor" href="#recorded">Choose a saved recording <ExternalLink size={13} aria-hidden="true" /></a></article>
                <article className="studio-mode-card live"><div className="studio-mode-title"><span className="studio-mode-icon live"><Sparkles size={17} aria-hidden="true" /></span><div><strong>Synthetic participants · Live Meta AI</strong><small>Real planning agents · actual room snapshots</small></div></div><p>Available after a saved scenario receives explicit human approval. Meta requests and usage are recorded for review.</p><button type="button" className="studio-primary-button" onClick={startLive} disabled={busy || !canLive}><Play size={15} aria-hidden="true" />Start live playback</button>
                  {!approved ? <small className="studio-inline-note">Save and approve this version before live playback.</small> : null}
                  {approved && health?.roomApi.mode !== "synthetic-live-demo" ? <small className="studio-inline-note">Live synthetic room mode is not enabled on the API.</small> : null}
                </article>
              </div> : <>
                <div className="studio-playback-summary"><div className="studio-progress-copy"><strong>{simulation.cursor}<span> / {simulation.total}</span></strong><small>{simulationMode === "RECORDED" ? "saved output events" : "scenario timeline events"}</small></div><progress max={Math.max(1, simulation.total)} value={Math.min(simulation.cursor, simulation.total)} aria-label="Playback progress" /></div>
                {simulation.currentSnapshot ? <div className="studio-snapshot-strip"><span><Activity size={14} aria-hidden="true" />Last captured room state</span><RoomSnapshotReview snapshot={simulation.currentSnapshot} /></div> : null}
                <div className="studio-controls">
                  {simulationMode === "LIVE" && simulation.run.status === "completed" ? <button className="studio-control-button" type="button" disabled><Check size={15} aria-hidden="true" />Complete</button> : simulation.paused || simulation.run.status === "ready" || simulation.run.status === "waiting_for_question" ? <button className="studio-primary-button" type="button" disabled={busy || simulation.busy || (simulation.cursor >= simulation.total && simulationMode === "RECORDED")} onClick={() => mutateRun((id) => resumeSimulation(id, speed))}><Play size={15} aria-hidden="true" />{simulationMode === "RECORDED" ? "Play saved output" : "Resume"}</button> : <button className="studio-control-button" type="button" disabled={busy || simulation.busy} onClick={() => mutateRun(pauseSimulation)}><Pause size={15} aria-hidden="true" />Pause</button>}
                  <button className="studio-control-button" type="button" disabled={busy || simulation.busy || !simulation.paused || simulation.cursor >= simulation.total} onClick={() => mutateRun(nextSimulationEvent, "One timeline step completed after Setvia returned its actual room state.")}><SkipForward size={15} aria-hidden="true" />Next event</button>
                  {canSkip ? <button className="studio-control-button" type="button" disabled={busy || simulation.busy || !simulation.paused} onClick={() => mutateRun(skipSimulationEvent, "Optional scripted answer skipped because there was no matching live question.")}><SkipForward size={15} aria-hidden="true" />Skip optional reply</button> : null}
                  <label className="studio-speed"><Gauge size={15} aria-hidden="true" />Speed<select value={speed} onChange={(event) => setSpeed(Number(event.currentTarget.value))}>{[0.25, 0.5, 1, 2, 4].map((value) => <option key={value} value={value}>{value}×</option>)}</select></label>
                  <button className="studio-control-button reset" type="button" disabled={busy || simulation.busy} onClick={() => mutateRun(resetSimulation, simulationMode === "RECORDED" ? "Recording reset to the beginning." : "A new live room has been created; the previous run remains saved.")}><RotateCcw size={15} aria-hidden="true" />Replay from start</button>
                </div>
                {simulationMode === "LIVE" ? <div className="studio-manual-step">
                  <div><span className="studio-kicker">MANUAL PARTICIPANT INTERVENTION</span><p>Submit one extra message through the selected planner’s authenticated room session.</p></div>
                  <div className="studio-manual-grid">
                    <label className="studio-field">Planner<select value={manualParticipant} onChange={(event) => setManualParticipant(event.currentTarget.value)}>{simulation.participantNames?.filter((participant) => participant.joined).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
                    <label className="studio-field">Visibility<select value={manualVisibility} onChange={(event) => setManualVisibility(event.currentTarget.value as "group" | "private")}><option value="group">Group</option><option value="private">Private</option></select></label>
                    <label className="studio-field studio-manual-message">Message<textarea rows={2} maxLength={1000} value={manualText} onChange={(event) => setManualText(event.currentTarget.value)} placeholder="Add a natural participant response…" /></label>
                    <button type="button" className="studio-control-button" onClick={submitManual} disabled={busy || !simulation.paused || !manualParticipant || !manualText.trim()}><MessageSquare size={15} aria-hidden="true" />Submit response</button>
                  </div>
                </div> : <div className="studio-recorded-banner"><Check size={15} aria-hidden="true" />Recorded demonstration · saved outputs · no new Meta requests</div>}
                {simulationMode === "LIVE" ? <div className="studio-dashboard-open"><div><span className="studio-kicker">LIVE SETVIA ROOM</span><strong>{simulation.dataset?.name ?? "Synthetic planning room"}</strong><small>{simulation.dataset?.expectedAttendees ?? "—"} expected attendees · {simulation.dataset?.activePlanners ?? "—"} room planners · run {shortId(simulation.run.runId)}</small></div><button className="studio-control-button" type="button" onClick={openDashboard} disabled={!dashboardUrl}><ExternalLink size={15} aria-hidden="true" />Show live dashboard</button></div> : null}
              </>}
            </div>

            {simulationMode === "LIVE" && dashboardVisible && dashboardUrl ? <section className="studio-dashboard-panel panel" aria-label="Live Setvia planning dashboard">
              <div className="studio-panel-heading"><div><span className="studio-kicker">REAL ROOM EVENTS</span><h2>Live dashboard preview</h2></div><button className="studio-icon-button" type="button" aria-label="Hide live dashboard" onClick={() => setDashboardVisible(false)}>×</button></div>
              <p className="studio-panel-copy">The real room page uses this tab’s stored creator session and listens to validated room updates. The session token is not in the frame URL.</p>
              <iframe key={dashboardUrl} className="studio-dashboard-frame" title="Setvia live planning room" src={dashboardUrl} referrerPolicy="no-referrer" />
            </section> : null}

            <section className="studio-saved panel" id="saved">
              <div className="studio-panel-heading"><div><span className="studio-kicker">PRIVATE DATASETS</span><h2>Saved scenarios</h2></div><span className="studio-count">{records.length}</span></div>
              <p className="studio-panel-copy">Versioned JSON files are stored outside the public repository. Each edited save creates a new version.</p>
              {records.length ? <div className="studio-saved-list">{records.map((item) => <article className={`studio-saved-row ${currentRecord?.datasetId === item.datasetId ? "selected" : ""}`} key={item.datasetId}>
                <div className="studio-saved-symbol"><FilePlus2 size={16} aria-hidden="true" /></div><div className="studio-saved-info"><strong>{item.scenario.event.name}</strong><small>{item.scenario.category.replaceAll("_", " ")} · v{item.datasetVersion} · {localTime(item.createdAt)}</small></div><span className={`studio-review-chip ${item.review.approvedForPlayback ? "approved" : "review"}`}>{item.review.approvedForPlayback ? "Approved" : "Review"}</span><button type="button" className="studio-small-button" onClick={() => void loadScenarioRecord(item)} disabled={busy}>Load</button>
              </article>)}</div> : <div className="studio-list-empty"><HardDrive size={17} aria-hidden="true" />No private scenarios saved yet.</div>}
            </section>

            <section className="studio-recordings panel" id="recorded">
              <div className="studio-panel-heading"><div><span className="studio-kicker">MODE A · NO NEW INFERENCE</span><h2>Recorded runs</h2></div><span className="studio-count">{recordings.length}</span></div>
              <p className="studio-panel-copy">Each replay is clearly labeled and reads saved snapshots from a previous simulation.</p>
              {recordings.length ? <div className="studio-saved-list">{recordings.map((item) => <article className="studio-saved-row" key={item.runId}>
                <div className="studio-saved-symbol recorded"><Activity size={16} aria-hidden="true" /></div><div className="studio-saved-info"><strong>{item.label}</strong><small>{item.status.replaceAll("_", " ")} · {item.events} captured events · {localTime(item.startedAt)}</small></div><span className="studio-run-hash">{shortId(item.roomIdHash)}</span><button type="button" className="studio-small-button" onClick={() => void loadRecording(item)} disabled={busy}>Replay</button>
              </article>)}</div> : <div className="studio-list-empty"><Clock3 size={17} aria-hidden="true" />Live simulations create saved runs for later playback.</div>}
            </section>
          </section>

          <aside className="studio-review panel" aria-label="Review and approval">
            <div className="studio-panel-heading"><div><span className="studio-kicker">REVIEW GATE</span><h2>Ready when you are</h2></div><span className={`studio-approval-indicator ${approved ? "approved" : ""}`}>{approved ? <BadgeCheck size={18} aria-hidden="true" /> : <Shield size={17} aria-hidden="true" />}</span></div>
            <p className="studio-panel-copy">Generated scenarios never start paid playback automatically. Review, save, then approve a specific version.</p>
            <div className={`studio-validation ${scenario && !parsed.issues.length ? "passed" : "waiting"}`}>
              {scenario && !parsed.issues.length ? <Check size={16} aria-hidden="true" /> : <CircleAlert size={16} aria-hidden="true" />}
              <div><strong>{scenario && !parsed.issues.length ? "Schema checks passed" : "Awaiting a valid scenario"}</strong><small>{scenario ? `${scenario.messages.length} messages · ${scenario.participants.length} room members · ${scenario.event.expectedAttendeeCount} event attendees` : "Generate or load a scenario to review it."}</small></div>
            </div>
            {parsed.issues.length ? <ul className="studio-validation-issues">{parsed.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
            <div className="studio-review-actions">
              <button type="button" className="studio-primary-button studio-full" onClick={save} disabled={busy || !scenario || !isDirty || parsed.issues.length > 0 || (!generation && !currentRecord)}><Save size={15} aria-hidden="true" />Save private version</button>
              <button type="button" className="studio-control-button studio-full" onClick={approve} disabled={busy || !currentRecord || isDirty || parsed.issues.length > 0 || approved}><BadgeCheck size={15} aria-hidden="true" />{approved ? "This version is approved" : "Approve for playback"}</button>
              {isDirty ? <small className="studio-edit-indicator">Unsaved edits · {changedPaths(baselineText, scenarioText).length} fields changed</small> : null}
            </div>

            <div className="studio-provenance">
              <div className="studio-section-heading"><div><span className="studio-kicker">PROVENANCE</span><strong>{generation || currentRecord ? "Muse Spark generation" : "No generation selected"}</strong></div></div>
              {(generation || currentRecord) ? <dl>
                <div><dt>Model</dt><dd>muse-spark-1.3</dd></div>
                <div><dt>Prompt</dt><dd>{generation?.provenance.promptVersion ?? currentRecord?.provenance.promptVersion}</dd></div>
                <div><dt>Generated</dt><dd>{localTime(generation?.provenance.generatedAt ?? currentRecord?.provenance.generatedAt ?? "")}</dd></div>
                <div><dt>Dataset version</dt><dd>{currentRecord ? `v${currentRecord.datasetVersion}` : "Unsaved draft"}</dd></div>
                <div><dt>Meta requests</dt><dd>{generation?.provenance.attempts ?? (currentRecord?.provenance.generationRequestId ? "1 recorded" : "Unknown")}</dd></div>
                <div><dt>Input / output</dt><dd>{generation ? `${generation.provenance.inputTokens ?? "?"} / ${generation.provenance.outputTokens ?? "?"}` : `${currentRecord?.provenance.inputTokens ?? "?"} / ${currentRecord?.provenance.outputTokens ?? "?"}`} tokens</dd></div>
                <div><dt>Est. generation cost</dt><dd>{usd(generation?.provenance.estimatedCostMicros ?? currentRecord?.provenance.estimatedCostMicros)}</dd></div>
                {generation ? <div><dt>Price snapshot</dt><dd>{generation.provenance.priceSnapshotDate}</dd></div> : null}
              </dl> : <p className="studio-empty-copy">Model, prompt, timestamp, usage, and estimated cost appear after generation.</p>}
              <div className="studio-price-note">Standard published price snapshot: $1.25 / M input tokens and $4.25 / M output tokens. Cached-input discount is not applied to this estimate.</div>
            </div>

            <div className="studio-budget-box">
              <div><Activity size={16} aria-hidden="true" /><strong>Meta request accounting</strong></div>
              {liveUsage ? <><div className="studio-budget-numbers"><span>{liveUsage.attempts.toLocaleString()}<small> HTTP attempts recorded</small></span><span>{usd(liveUsage.reservedCostMicros)}<small> estimated or reserved</small></span></div><small>Request and usage details are retained in the private ledger.</small></> : <small>Setvia room API is not available.</small>}
            </div>
            <div className="studio-honesty"><Shield size={15} aria-hidden="true" /><span>Scenario ground truth stays in private Studio storage. Only event details and submitted participant messages reach room agents.</span></div>
          </aside>
        </div>
      </main>
    </div>
  );
}
