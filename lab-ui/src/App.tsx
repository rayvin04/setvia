import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowUpRight, ClipboardCheck, GitCompareArrows, RefreshCw } from "lucide-react";
import type { LabRecord } from "../../server/src/agents/lab.js";
import { RUBRIC_DIMENSIONS, type ScenarioId } from "../../server/src/agents/scenarios.js";

type Review = {
  version: "setvia-lab-review-v1";
  reportId: string;
  scenarioId: NonNullable<LabRecord["scenarioId"]>;
  ratings: Record<(typeof RUBRIC_DIMENSIONS)[number], number>;
  comments: string;
  reviewedAt: string;
};
type RunSummary = {
  id: string;
  filename: string;
  modifiedAt: string;
  mode: "MOCK" | "LIVE";
  model: string | null;
  promptVersions: string[];
  scenarios: string[];
  recordCount: number;
  attempts: number;
  totalTokens: number | null;
  estimatedCostMicros: number | null;
  outcomes: Array<{ scenarioId?: string; outcome: string; readiness: string | null }>;
  liveRunId: string | null;
  cumulativeCostMicros: number | null;
  cumulativeBudgetMicros: number | null;
};
type ReviewedLabRecord = LabRecord & { review: Review | null };
type RunDetail = RunSummary & { records: ReviewedLabRecord[] };
type Tab = "overview" | "compare" | "inputs" | "review";

const money = (micros: number | null | undefined) => micros === null || micros === undefined ? "Unknown" : "$" + (micros / 1_000_000).toFixed(4);
const timestamp = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const json = (value: unknown) => JSON.stringify(value, null, 2);
const badgeClass = (value: string) => `badge badge-${value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`;

function StatusBadge({ children }: { children: string }) {
  return <span className={badgeClass(children)}>{children.replaceAll("_", " ")}</span>;
}

function findingGroups(record: LabRecord) {
  return record.cycle.finalEvaluation?.findings ?? [];
}

export function App() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [scenarioId, setScenarioId] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [activeTrace, setActiveTrace] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  async function refreshRuns() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/runs", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Could not read private Lab history.");
      const data = await response.json() as { runs: RunSummary[] };
      setRuns(data.runs);
      const nextId = selectedId && data.runs.some((run) => run.id === selectedId) ? selectedId : data.runs[0]?.id ?? "";
      setSelectedId(nextId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not read Lab history.");
    } finally {
      setLoading(false);
    }
  }

  async function loadRun(id: string) {
    if (!id) {
      setDetail(null);
      return;
    }
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(id)}`, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Could not load the selected run.");
      const loaded = await response.json() as RunDetail;
      setDetail(loaded);
      setScenarioId((current) => loaded.records.some((record) => record.scenarioId === current) ? current : loaded.records[0]?.scenarioId ?? "");
      setActiveTrace(0);
    } catch (caught) {
      setDetail(null);
      setError(caught instanceof Error ? caught.message : "Could not load the selected run.");
    }
  }

  useEffect(() => { void refreshRuns(); }, []);
  useEffect(() => { void loadRun(selectedId); }, [selectedId]);

  const record = useMemo(() => detail?.records.find((candidate) => candidate.scenarioId === scenarioId) ?? detail?.records[0] ?? null, [detail, scenarioId]);
  const traces = record?.cycle.traces ?? [];
  const currentTrace = traces[Math.min(activeTrace, Math.max(traces.length - 1, 0))];
  const compared = compareIds.map((id) => runs.find((run) => run.id === id)).filter((run): run is RunSummary => !!run);

  function toggleCompare(id: string) {
    setCompareIds((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 2 ? [...current, id] : [current[1]!, id]);
  }

  async function saveReview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !record?.scenarioId) return;
    const form = new FormData(event.currentTarget);
    const ratings = Object.fromEntries(RUBRIC_DIMENSIONS.map((dimension) => [dimension, Number(form.get(dimension))]));
    if (Object.values(ratings).some((rating) => !Number.isInteger(rating) || rating < 1 || rating > 5)) {
      setError("Rate all nine dimensions from 1 to 5 before saving.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ reportId: detail.id, scenarioId: record.scenarioId, ratings, comments: String(form.get("comments") ?? "") }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Review could not be saved.");
      setNotice("Review saved to the private Setvia Lab workspace.");
      await loadRun(detail.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Review could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="shell">
      <aside className="rail" aria-label="Lab navigation">
        <a className="brand" href="#top" aria-label="Setvia Lab home"><span className="brand-mark"><img src="/favicon.svg" alt="" /></span><span><strong>SETVIA<span className="brand-period">.</span></strong><small>LAB WORKSPACE</small></span></a>
        <nav className="rail-nav" aria-label="Lab sections">
          <button className={`rail-link ${tab === "overview" || tab === "inputs" ? "active" : ""}`} type="button" onClick={() => setTab("overview")} aria-current={tab === "overview" || tab === "inputs" ? "page" : undefined}><span className="rail-icon" aria-hidden="true"><Activity size={17} strokeWidth={1.8} /></span><span>Agent evaluation</span></button>
          <button className={`rail-link ${tab === "compare" ? "active" : ""}`} type="button" onClick={() => setTab("compare")} aria-current={tab === "compare" ? "page" : undefined}><span className="rail-icon" aria-hidden="true"><GitCompareArrows size={17} strokeWidth={1.8} /></span><span>Compare runs</span></button>
          <button className={`rail-link ${tab === "review" ? "active" : ""}`} type="button" onClick={() => setTab("review")} aria-current={tab === "review" ? "page" : undefined}><span className="rail-icon" aria-hidden="true"><ClipboardCheck size={17} strokeWidth={1.8} /></span><span>Manual review</span></button>
        </nav>
        <div className="rail-spacer" />
        <div className="local-card"><span className="local-dot" /> Local only <small>Private reports stay on this machine.</small></div>
        <div className="rail-foot">MUSE SPARK · STANDARD<br />Synthetic and live evaluations</div>
      </aside>

      <main className="main" id="top">
        <header className="topbar">
          <div className="breadcrumbs"><span>Setvia Lab</span><i>/</i><strong>{tabLabel(tab)}</strong></div>
          <div className="top-actions"><span className="local-pill"><span className="local-dot" /> Local only</span><button className={`icon-button ${loading ? "is-refreshing" : ""}`} type="button" onClick={() => void refreshRuns()} disabled={loading} aria-label={loading ? "Refreshing run history" : "Refresh run history"} title={loading ? "Refreshing history" : "Refresh history"}><RefreshCw size={16} strokeWidth={1.8} aria-hidden="true" /></button></div>
        </header>

        <div className="page-head">
          <div><h1>{tab === "compare" ? "Compare evaluations" : tab === "inputs" ? "Scenario evidence" : tab === "review" ? "Human review" : "Agent evaluation"}</h1><p className="subhead">Inspect the reasoning path, evidence quality, constraints, and cost behind each Setvia run.</p></div>
          {detail && <label className="scenario-select">Scenario<select value={scenarioId} onChange={(event) => setScenarioId(event.target.value)}>{detail.records.map((item, index) => <option key={`${item.scenarioId ?? index}`} value={item.scenarioId ?? ""}>{item.scenarioId ?? "Run"} · {item.scenario?.split("—").at(-1)?.trim() ?? "Scenario"}</option>)}</select></label>}
        </div>

        {error && <div className="alert error" role="alert">{error}</div>}
        {notice && <div className="alert success" role="status">{notice}</div>}

        <section className="metrics" aria-label="Selected run summary">
          <Metric label="Model" value={detail?.model ?? "No live model run"} note={detail?.promptVersions.join(" · ") || "Mock run or no history"} />
          <Metric label="HTTP attempts" value={String(record?.liveHttpAttempts?.length ?? record?.cycle.attempts ?? 0)} note={detail?.mode === "LIVE" ? "Retries disabled · bounded per scenario" : "Mock calls · no network"} />
          <Metric label="Token usage" value={detail?.totalTokens?.toLocaleString() ?? "Unknown"} note="Input + output · hidden reasoning stays hidden" />
          <Metric label="Estimated spend" value={money(detail?.estimatedCostMicros)} note={detail?.cumulativeCostMicros !== null && detail?.cumulativeCostMicros !== undefined ? `${money(detail.cumulativeCostMicros)} cumulative of ${money(detail.cumulativeBudgetMicros)}` : "Standard prices · no cached discount"} />
        </section>

        <div className="workbench">
          <section className="history-panel panel">
            <div className="panel-heading"><h2>Run archive</h2><span className="count" aria-label={`${runs.length} saved runs`}>{runs.length.toString().padStart(2, "0")}</span></div>
            <p className="panel-copy">Mock and live runs, with private human reviews.</p>
            <div className="run-list" aria-label="Run history">
              {loading && <div className="empty-state">Reading local history…</div>}
              {!loading && runs.length === 0 && <div className="empty-state"><strong>No run reports yet.</strong><span>Run the mock suite or a pre-approved live evaluation to populate this workspace.</span></div>}
              {runs.map((run) => <article className={`run-card ${run.id === selectedId ? "selected" : ""}`} key={run.id}>
                <button className="run-open" type="button" onClick={() => { setSelectedId(run.id); setTab("overview"); }} aria-current={run.id === selectedId ? "true" : undefined}>
                  <span className="run-card-top"><StatusBadge>{run.mode}</StatusBadge><time>{timestamp(run.modifiedAt)}</time></span>
                  <strong>{run.promptVersions[0] ?? (run.mode === "MOCK" ? "Orchestration mock" : "Prompt version unknown")}</strong>
                  <span className="run-card-meta">{run.scenarios.join(" · ")} <i>·</i> {run.attempts} calls</span>
                  <span className="run-card-foot"><span>{run.model ?? "No model"}</span><b>{money(run.estimatedCostMicros)}</b></span>
                </button>
                <label className="compare-check"><input type="checkbox" checked={compareIds.includes(run.id)} onChange={() => toggleCompare(run.id)} aria-label={`Select ${run.filename} for comparison`} /><span>Compare</span></label>
              </article>)}
            </div>
            <button className="secondary-button full" type="button" onClick={() => setTab("compare")} disabled={compareIds.length !== 2}>Open two-run comparison <ArrowUpRight size={15} strokeWidth={1.8} aria-hidden="true" /></button>
          </section>

          <section className="detail-panel">
            {!record && <div className="panel blank-panel"><div className="blank-mark"><img src="/favicon.svg" alt="" /></div><h2>Your evaluation bench</h2><p>Run artifacts are loaded from the private local Lab folder. Nothing here triggers a model request.</p><button className="secondary-button" type="button" onClick={() => void refreshRuns()}>Refresh history</button></div>}
            {record && detail && <>
              <div className="summary-panel panel">
                <div className="summary-top"><div><div className="summary-meta"><StatusBadge>{record.mode}</StatusBadge><span>{record.promptVersion ?? "agents-v1"}</span></div><h2>{record.scenario?.split("—").at(-1)?.trim() ?? "Scenario"}</h2><p className="muted">{record.scenario}</p></div><StatusBadge>{record.cycle.outcome}</StatusBadge></div>
                <div className="summary-bottom"><div><span>Readiness</span><strong>{record.cycle.readiness?.percentage ?? "—"}<small>{record.cycle.readiness ? "%" : ""}</small></strong></div><div><span>State</span><strong className="state-value">{record.cycle.readiness?.status?.replaceAll("_", " ") ?? "Not evaluated"}</strong></div><div><span>Final Judge</span><strong className="state-value">{record.cycle.finalEvaluation ? "Complete" : "Unavailable"}</strong></div><p>Human approval and safety remain separate decisions.</p></div>
                {record.cycle.readiness ? <progress className={`readiness-progress readiness-${record.cycle.readiness.status.toLowerCase().replaceAll("_", "-")}`} max={100} value={record.cycle.readiness.percentage} aria-label={`Deterministic readiness ${record.cycle.readiness.percentage} percent`} /> : <p className="readiness-unavailable">No deterministic readiness result for this run.</p>}
              </div>

              <nav className="tabs" aria-label="Evaluation views">
                {(["overview", "compare", "inputs", "review"] as const).map((key) => <button key={key} type="button" className={tab === key ? "tab active" : "tab"} onClick={() => setTab(key)} aria-pressed={tab === key}>{tabLabel(key)}</button>)}
              </nav>

              {tab === "compare" && <CompareView ids={compareIds} runs={compared} />}
              {tab === "overview" && <>
                <section className="agent-path panel">
                  <div className="panel-heading"><h2>Agent path</h2><span className="trace-count">{traces.length} structured calls</span></div>
                  <p className="panel-copy">The orchestrator calls only what the current decision requires. Click a stage to inspect its validated handoff.</p>
                  <ol className="agent-steps">
                    {traces.map((trace, index) => <li key={`${trace.sequence}-${trace.role}`} className={index === activeTrace ? "current" : ""}>
                      <button type="button" onClick={() => setActiveTrace(index)} aria-pressed={index === activeTrace}>
                        <span className="step-no">{String(index + 1).padStart(2, "0")}</span><span className="step-copy"><strong>{trace.role}</strong><small>{trace.phase} · {trace.status}</small></span><ArrowUpRight className="step-chevron" size={15} strokeWidth={1.8} aria-hidden="true" />
                      </button>
                    </li>)}
                    {traces.length === 0 && <li className="empty-state">This run has no agent traces.</li>}
                  </ol>
                </section>
                {currentTrace && <section className="trace-inspector panel">
                  <div className="inspector-title"><div><h2>{currentTrace.role}</h2><p className="trace-subtitle">Step {String(currentTrace.sequence).padStart(2, "0")} · {currentTrace.phase}</p></div><StatusBadge>{currentTrace.status}</StatusBadge></div>
                  {currentTrace.failureCode && <div className="alert error" role="alert"><strong>{currentTrace.failureCode}</strong><br />{currentTrace.failureMessage ?? "This agent call failed; detailed payload omitted."}</div>}
                  <div className="trace-facts"><div><span>REQUESTED BY</span><strong>{currentTrace.requestedBy}</strong></div><div><span>ATTEMPTS</span><strong>{currentTrace.attempts}</strong></div><div><span>TOKENS</span><strong>{currentTrace.inputTokens === null || currentTrace.outputTokens === null ? "Unknown" : `${currentTrace.inputTokens.toLocaleString()} in · ${currentTrace.outputTokens.toLocaleString()} out`}</strong></div><div><span>EST. COST</span><strong>{money(currentTrace.estimatedCostMicros)}</strong></div></div>
                  <div className="trace-columns"><div className="code-card"><div className="code-head"><span>Input context</span><span>Structured</span></div><pre>{json(currentTrace.input)}</pre></div><div className="code-card output"><div className="code-head"><span>Validated output</span><span>JSON schema</span></div><pre>{json(currentTrace.output)}</pre></div></div>
                  {record.liveHttpAttempts && <div className="request-journal"><div className="panel-heading"><h3>HTTP request journal</h3><span className="trace-count">Retries are off</span></div><div className="table-scroll"><table><thead><tr><th>Role</th><th>HTTP</th><th>Duration</th><th>Input / output</th><th>Reasoning tokens</th><th>Request hash</th><th>Cost counted</th></tr></thead><tbody>{record.liveHttpAttempts.map((attempt) => <tr key={attempt.id}><td>{attempt.role}</td><td>{attempt.httpStatus ?? "Pending"}</td><td>{attempt.durationMs === null ? "—" : `${attempt.durationMs} ms`}</td><td>{attempt.inputTokens ?? "—"} / {attempt.outputTokens ?? "—"}</td><td>{attempt.reasoningTokens ?? "—"}</td><td><code>{attempt.requestHash.slice(0, 12)}</code></td><td>{money(attempt.estimatedCostMicros ?? attempt.reservedCostMicros)}</td></tr>)}</tbody></table></div><p className="footnote">Reasoning-token counts are usage metadata only. Hidden reasoning text is never requested or displayed.</p></div>}
                </section>}
                <RealityChecks record={record} />
              </>}

              {tab === "inputs" && <InputsView record={record} />}
              {tab === "review" && <ReviewView record={record} reportId={detail.id} saving={saving} onSubmit={saveReview} />}
            </>}
          </section>
        </div>
        <footer className="page-footer"><span>SETVIA LAB · PRIVATE LOCAL REVIEW</span><span>AI findings are evidence to inspect. People make the decision.</span></footer>
      </main>
    </div>
  );
}

function tabLabel(tab: Tab) {
  return ({ overview: "Overview", compare: "Compare", inputs: "Inputs & ground truth", review: "Manual review" } as const)[tab];
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <article className="metric"><span className="metric-label">{label}</span><strong title={value}>{value}</strong><small>{note}</small></article>;
}

function RealityChecks({ record }: { record: LabRecord }) {
  const readiness = record.cycle.readiness;
  const findings = findingGroups(record);
  return <section className="reality-panel panel">
    <div className="panel-heading"><h2>Reality Check</h2><span className="trace-count">Deterministic readiness</span></div>
    <div className="category-grid">
      {(readiness?.categories ?? []).map((category) => {
        const related = findings.filter((finding) => finding.category === category.category);
        return <article className="category-card" key={category.category}><div className="category-title"><strong>{category.category}</strong><StatusBadge>{category.status}</StatusBadge></div><div className="category-score"><progress max={100} value={category.percentage} aria-label={`${category.category} ${category.percentage} percent`} /><span>{category.percentage}%</span></div>{related.length > 0 ? <ul>{related.map((finding) => <li key={finding.id}><span className={badgeClass(finding.severity)}>{finding.severity}</span><p>{finding.message}</p><small>{finding.uncertainty} uncertainty · {finding.evidenceIds.length} evidence IDs</small></li>)}</ul> : <p className="no-finding">No validated finding in this category.</p>}</article>;
      })}
      {!readiness && <div className="empty-state">No deterministic Reality Check is available.</div>}
    </div>
    <p className="safety-note"><span aria-hidden="true">!</span> A clear category or high percentage does not establish safety. Critical unresolved findings block a ready state.</p>
  </section>;
}

function CompareView({ ids, runs }: { ids: string[]; runs: RunSummary[] }) {
  const [details, setDetails] = useState<RunDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (ids.length !== 2) { setDetails([]); return () => { active = false; }; }
    setLoading(true);
    setError("");
    void Promise.all(ids.map(async (id) => {
      const response = await fetch(`/api/runs/${encodeURIComponent(id)}`, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Could not load both run records for comparison.");
      return await response.json() as RunDetail;
    })).then((result) => { if (active) setDetails(result); })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "Comparison could not load."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [ids.join("|")]);

  if (runs.length !== 2) return <section className="panel compare-empty"><div className="compare-symbol" aria-hidden="true"><GitCompareArrows size={22} strokeWidth={1.8} /></div><h2>Select two runs</h2><p>Choose two records from the archive. Setvia Lab will compare prompt versions, findings, outcomes, human ratings, calls, tokens, cost, and readiness.</p><span>{ids.length} of 2 selected</span></section>;
  if (loading) return <section className="panel compare-empty" role="status">Loading both execution records…</section>;
  if (error) return <section className="panel compare-empty" role="alert">{error}</section>;

  const [left, right] = details;
  const allScenarioIds = [...new Set(details.flatMap((run) => run.records.map((record) => record.scenarioId).filter((value): value is ScenarioId => !!value)))].sort();
  return <section className="compare-view">
    <div className="compare-title"><h2>Evaluation delta</h2><span className="trace-count">{runs[0]?.promptVersions.join(", ") || "mock"} ↔ {runs[1]?.promptVersions.join(", ") || "mock"}</span></div>
    <div className="compare-grid">{runs.map((run) => <article className="panel compare-card" key={run.id}><div className="compare-run-meta"><StatusBadge>{run.mode}</StatusBadge><span>{run.promptVersions.join(" · ") || "No prompt version"}</span></div><h3>{run.filename}</h3><p className="muted">{timestamp(run.modifiedAt)}</p><dl><div><dt>Scenarios</dt><dd>{run.scenarios.join(" · ")}</dd></div><div><dt>Model</dt><dd>{run.model ?? "None"}</dd></div><div><dt>HTTP / mock calls</dt><dd>{run.attempts}</dd></div><div><dt>Tokens</dt><dd>{run.totalTokens?.toLocaleString() ?? "Unknown"}</dd></div><div><dt>Estimated cost</dt><dd>{money(run.estimatedCostMicros)}</dd></div></dl></article>)}</div>
    {allScenarioIds.map((id) => {
      const a = left?.records.find((item) => item.scenarioId === id);
      const b = right?.records.find((item) => item.scenarioId === id);
      const sides: Array<{ item?: ReviewedLabRecord; run?: RunSummary }> = [{ item: a, run: runs[0] }, { item: b, run: runs[1] }];
      return <article className="panel scenario-compare" key={id}><div className="scenario-compare-head"><div><span className="scenario-id">Scenario {id}</span><h3>{a?.scenario?.split("—").at(-1)?.trim() ?? b?.scenario?.split("—").at(-1)?.trim() ?? "Scenario"}</h3></div><span className="trace-count">{a && b ? "Matched scenario" : "Only in one run"}</span></div>
        <div className="scenario-pair">{sides.map(({ item, run }, index) => <section className="scenario-side" key={run?.id ?? index}><div className="scenario-side-head"><strong>{run?.promptVersions.join(" · ") || run?.mode || "Missing"}</strong>{item && <StatusBadge>{item.cycle.outcome}</StatusBadge>}</div>{item ? <><div className="scenario-side-stats"><span>Readiness<strong>{item.cycle.readiness?.percentage ?? "—"}% · {item.cycle.readiness?.status?.replaceAll("_", " ") ?? "unknown"}</strong></span><span>Questions<strong>{item.cycle.questions.length}</strong></span><span>Critical findings<strong>{findingGroups(item).filter((finding) => finding.severity === "critical" && finding.status !== "resolved").length}</strong></span><span>Agent calls<strong>{item.cycle.traces.length}</strong></span></div><div className="finding-compare">{findingGroups(item).map((finding) => <div key={finding.id}><span className={badgeClass(finding.severity)}>{finding.severity}</span><span>{finding.category}</span><p>{finding.message}</p></div>)}{findingGroups(item).length === 0 && <p className="no-finding">No validated findings.</p>}</div>{item.review && <p className="review-summary">Human review saved · average rating {averageRating(item.review.ratings).toFixed(1)} / 5</p>}</> : <p className="no-finding">This scenario is absent from the selected report.</p>}</section>)}</div>
        {a?.review && b?.review && <div className="table-scroll rating-compare"><table><caption>Human rubric comparison</caption><thead><tr><th>Dimension</th><th>{runs[0]?.promptVersions.join(" · ") || "Run 1"}</th><th>{runs[1]?.promptVersions.join(" · ") || "Run 2"}</th><th>Change</th></tr></thead><tbody>{RUBRIC_DIMENSIONS.map((dimension) => { const first = a.review!.ratings[dimension]; const second = b.review!.ratings[dimension]; return <tr key={dimension}><td>{pretty(dimension)}</td><td>{first}</td><td>{second}</td><td>{second - first > 0 ? `+${second - first}` : second - first}</td></tr>; })}</tbody></table></div>}
      </article>;
    })}
    <p className="footnote">Compare model findings to the authored ground truth and human ratings. The readiness score is deterministic, but finding coverage depends on model output.</p>
  </section>;
}

function averageRating(ratings: Review["ratings"]) { return RUBRIC_DIMENSIONS.reduce((sum, dimension) => sum + ratings[dimension], 0) / RUBRIC_DIMENSIONS.length; }

function InputsView({ record }: { record: LabRecord }) {
  return <section className="inputs-view panel"><div className="panel-heading"><h2>Scenario evidence</h2><StatusBadge>synthetic</StatusBadge></div><div className="evidence-stats"><div><span>Event attendees</span><strong>{record.eventAttendance?.estimatedAttendeeCount ?? "—"} estimated</strong><small>{record.eventAttendance?.confirmedAttendeeCount ?? "Unknown"} confirmed</small></div><div><span>Active room</span><strong>{record.eventAttendance?.roomParticipantCount ?? record.participantCount ?? "—"} planners</strong><small>{record.eventAttendance?.requiredApproverIds.length ?? "—"} required approvers</small></div><div><span>Response coverage</span><strong>{record.eventAttendance?.respondedRoomParticipants ?? "—"} responded</strong><small>{record.eventAttendance?.nonrespondingRoomParticipants ?? "—"} no response</small></div></div><h3>Participant statements</h3><div className="input-list">{(record.inputStatements ?? []).map((person) => <details key={person.participantId} className="input-person"><summary><span><strong>{person.participantLabel}</strong><small>{person.role} · {person.responseStatus}</small></span><b>{person.statements.length} statements</b></summary><ul>{person.statements.map((statement) => <li key={statement.statementId}><p>{statement.text}</p><div className="statement-meta"><span>{statement.audience.replaceAll("_", " ")}</span><span>{statement.consent.replaceAll("_", " ")}</span><span>{statement.confirmed ? "Confirmed" : "Unconfirmed"}</span></div></li>)}</ul></details>)}</div><div className="ground-truth"><div><h3>Ground truth</h3><p>Expected findings and stopping conditions were authored before the model run. Compare evidence coverage and severity, not exact wording.</p></div><pre>{json(record.groundTruth ?? record.expected ?? "No authored ground truth.")}</pre></div></section>;
}

function ReviewView({ record, reportId, saving, onSubmit }: { record: LabRecord & { review: Review | null }; reportId: string; saving: boolean; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) {
  return <section className="review-view panel"><div className="panel-heading"><h2>Reasoning quality rubric</h2><StatusBadge>{record.review ? "reviewed" : "not reviewed"}</StatusBadge></div><p className="panel-copy">Rate the model’s visible structured output against the authored ground truth. These ratings are separate from deterministic readiness and participant approval.</p><form onSubmit={onSubmit} key={`${reportId}:${record.scenarioId}:${record.review?.reviewedAt ?? "new"}`}><div className="rubric-grid">{RUBRIC_DIMENSIONS.map((dimension) => <label className="rating-row" key={dimension}><span><strong>{pretty(dimension)}</strong><small>{record.rubric?.criteria[dimension] ?? "Assess against the scenario evidence and expected behavior."}</small></span><select name={dimension} defaultValue={String(record.review?.ratings[dimension] ?? record.rubric?.ratings[dimension] ?? "")} required aria-label={`${pretty(dimension)} rating`}><option value="" disabled>Select</option>{[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>{score} · {ratingText(score)}</option>)}</select></label>)}</div><label className="comments-label">Reviewer notes<textarea name="comments" maxLength={4_000} defaultValue={record.review?.comments ?? record.rubric?.comments ?? ""} rows={5} placeholder="What did the Judge miss? Were the questions useful? Did a prompt change improve the result?" /></label><div className="review-actions"><p>{record.review ? `Last saved ${timestamp(record.review.reviewedAt)}` : "Ratings save to a private local sidecar report."}</p><button className="primary-button" type="submit" disabled={saving}>{saving ? "Saving…" : "Save human review"}<ArrowUpRight size={16} strokeWidth={1.8} aria-hidden="true" /></button></div></form></section>;
}

function pretty(value: string) { return value.replace(/[A-Z]/g, (letter) => ` ${letter}`).replace(/^./, (first) => first.toUpperCase()).trim(); }
function ratingText(score: number) { return ({ 1: "missed", 2: "weak", 3: "adequate", 4: "strong", 5: "excellent" } as Record<number, string>)[score]!; }
