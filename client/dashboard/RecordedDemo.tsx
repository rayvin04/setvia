import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiEndpoint } from "../api-url";
import { RecordedDemoSchema, type RecordedDemo as Recording } from "../../shared/recorded-demo";
import { PlanningDashboard, type SectionId } from "./Dashboard";
import { DecisionReceipt } from "./DecisionReceipt";
import { projectDecisionReceipt, projectReceiptEvidence } from "./decision-receipt";
import "./live-room.css";
import "./recorded-demo.css";

export default function RecordedDemo() {
  const { recordingId = "" } = useParams();
  const [recording, setRecording] = useState<Recording | null>(null);
  const [error, setError] = useState("");
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [section, setSection] = useState<SectionId>("overview");
  useEffect(() => {
    const controller = new AbortController();
    setRecording(null);
    setError("");
    void fetch(apiEndpoint(`/demo/recordings/${encodeURIComponent(recordingId)}`), {
      signal: controller.signal, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", redirect: "error",
    }).then(async (response) => {
      if (!response.ok) throw new Error("This demo preview is unavailable.");
      const parsed = RecordedDemoSchema.parse(await response.json());
      if (parsed.recordingId !== recordingId) throw new Error("This recording could not be verified.");
      setRecording(parsed);
      setFrame(parsed.frames.length - 1);
    }).catch(() => { if (!controller.signal.aborted) setError("This demo preview is unavailable. Refresh to try again."); });
    return () => controller.abort();
  }, [recordingId]);
  useEffect(() => {
    if (!playing || !recording) return;
    if (frame >= recording.frames.length - 1) { setPlaying(false); return; }
    const timer = window.setTimeout(() => setFrame((value) => value + 1), 5_000);
    return () => window.clearTimeout(timer);
  }, [playing, frame, recording]);
  if (!recording) return <div className="room-access-state" role={error ? "alert" : "status"}>
    <h1>{error ? "Recording unavailable" : "Opening demo preview…"}</h1>
    <p>{error || "Loading the recorded fictional planning story."}</p>
    {error ? <Link to="/demos" className="dashboard-button primary">Explore demos</Link> : null}
  </div>;
  const snapshot = recording.frames[frame]!.snapshot;
  const receipt = projectDecisionReceipt(snapshot);
  const disclosedReceipt = { ...receipt, title: `Demo preview · ${receipt.title}`,
    eventCard: { ...receipt.eventCard, description: `Prepared demo preview; mock inference. ${receipt.eventCard.description ?? ""}` } };
  return <div className="live-room-shell recorded-demo-shell">
    <section className="recorded-demo-toolbar" aria-label="Recorded preview controls">
      <div className="recorded-demo-disclosure"><strong>Demo preview</strong><span>Sample participants · Mock inference · Read only</span></div>
      <div className="recorded-demo-controls">
        {recording.frames.map((entry, index) => <button key={entry.label} className="dashboard-button subtle" type="button"
          aria-pressed={frame === index} onClick={() => { setPlaying(false); setFrame(index); }}>
          {entry.label} · {entry.snapshot.room.readiness?.percentage ?? 0}%
        </button>)}
        <button className="dashboard-button primary" type="button" onClick={() => {
          if (playing) setPlaying(false); else { setFrame(0); setPlaying(true); }
        }}>{playing ? "Pause replay" : "Replay progression"}</button>
      </div>
    </section>
    <PlanningDashboard snapshot={snapshot} contributions={snapshot.contributions} activeSection={section} onSectionChange={setSection}
      recorded titleStatus={<span className="recorded-demo-state">Recorded mock review</span>}
      onFocusComposer={() => document.getElementById("recorded-next-step")?.scrollIntoView({ block: "center" })} />
    <section id="recorded-next-step" className="recorded-demo-next" aria-label="Recorded next step">
      <strong>{snapshot.room.readiness?.percentage === 90 ? "Five checks complete. One final concern remains." : "A recorded planning milestone."}</strong>
      <p>{snapshot.room.questions[0]?.text ?? "Review the recorded group decisions above."}</p>
      <small>Prepared preview · Original live room unchanged.</small>
    </section>
    <section className="live-decision-receipt"><DecisionReceipt receipt={disclosedReceipt} evidence={projectReceiptEvidence(snapshot)} /></section>
  </div>;
}
