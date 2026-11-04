import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, CircleAlert, Copy, LogOut, Volume2, VolumeX, X } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Wordmark } from "../components";
import { Avatar } from "../Mascot";
import { MessageComposer, type MessageComposerHandle } from "./MessageComposer";
import { PlanningDashboard, type SectionId } from "./Dashboard";
import { DecisionReceipt } from "./DecisionReceipt";
import { ReceiptEditor } from "./ReceiptEditor";
import { projectDecisionReceipt } from "./decision-receipt";
import { currentQuestion, questionQuickReplies } from "./composer-model";
import { acceptDashboardUpdate } from "./model";
import { validateDashboardAction, type DashboardAction, type DashboardSnapshot } from "../../shared/dashboard";
import { roomCodeFromId } from "../../shared/room-code";
import type { SubmitPlanningMessage } from "../../shared/planning-message";
import { BEACH_TRIP_DEMO_EVENT_TYPE, BEACH_TRIP_DEMO_QUERY, beachTripDemoRequest } from "./beach-trip-demo";
import { FictionalParticipantsDemo } from "./FictionalParticipantsDemo";
import {
  approveRoomProposal,
  createRoom,
  getInvitationLink,
  getRoomHealth,
  getRoomSession,
  getRoomSnapshot,
  leaveRoom,
  reviseRoomProposal,
  sharePrivateCandidate,
  streamRoom,
  submitRoomMessage,
  RoomApiError,
  type RoomHealth,
  type StreamStatus,
} from "./room-api";
import "./dashboard.css";
import "./dashboard-refinement.css";
import "./live-room.css";

const SOUND_KEY = "setvia.sound.enabled.v1";
type Notice = { id: string; text: string; section: SectionId; tone: "neutral" | "warning" | "success" };

function useRoomSounds() {
  const [enabled, setEnabled] = useState(() => {
    try { return window.localStorage.getItem(SOUND_KEY) === "true"; }
    catch { return false; }
  });
  const context = useRef<AudioContext | null>(null);
  const lastPlayed = useRef(0);
  const activate = useCallback(() => {
    if (!enabled || !window.AudioContext) return;
    try {
      context.current ??= new AudioContext();
      if (context.current.state === "suspended") void context.current.resume();
    } catch { /* Visual notifications remain the accessible fallback. */ }
  }, [enabled]);
  const toggle = useCallback(() => {
    const next = !enabled;
    setEnabled(next);
    try { window.localStorage.setItem(SOUND_KEY, String(next)); } catch { /* Preference is optional. */ }
    if (next) {
      try {
        context.current ??= new AudioContext();
        void context.current.resume();
      } catch { /* Unsupported audio does not affect room controls. */ }
    }
  }, [enabled]);
  const play = useCallback((kind: Notice["tone"]) => {
    if (!enabled || !context.current) return;
    const nowMs = performance.now();
    if (nowMs - lastPlayed.current < 1_200) return;
    lastPlayed.current = nowMs;
    const audio = context.current;
    const now = audio.currentTime;
    try {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(kind === "warning" ? 392 : kind === "success" ? 660 : 523, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.09, now + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.15);
    } catch { /* Audio is always secondary to the visual update. */ }
  }, [enabled]);
  useEffect(() => () => { void context.current?.close(); }, []);
  return { enabled, toggle, activate, play };
}

function liveStatusLabel(stream: StreamStatus | "loading" | "offline") {
  if (stream === "connected") return "Live updates connected";
  if (stream === "reconnecting") return "Reconnecting to the room…";
  if (stream === "unauthorized") return "This tab’s room session expired";
  if (stream === "offline") return "Room server unavailable";
  return "Opening your room…";
}

export default function LiveRoom() {
  const { roomId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const session = useMemo(() => getRoomSession(roomId), [roomId]);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [streamStatus, setStreamStatus] = useState<StreamStatus | "loading" | "offline">("loading");
  const [health, setHealth] = useState<RoomHealth | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [section, setSection] = useState<SectionId>("overview");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [inviteLink, setInviteLink] = useState(() => getInvitationLink(roomId));
  const [copied, setCopied] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [composerHeight, setComposerHeight] = useState(0);
  const [composerInset, setComposerInset] = useState(0);
  const composer = useRef<MessageComposerHandle>(null);
  const lastActivityIds = useRef<Set<string> | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const reduced = useReducedMotion();
  const sounds = useRoomSounds();

  const acceptSnapshot = useCallback((input: DashboardSnapshot) => {
    setSnapshot((current) => current ? acceptDashboardUpdate(current, input) : input);
  }, []);

  useEffect(() => {
    if (!session) {
      setStreamStatus("unauthorized");
      return;
    }
    const controller = new AbortController();
    setError("");
    setStreamStatus("loading");
    void getRoomSnapshot(session, controller.signal)
      .then((initial) => {
        if (controller.signal.aborted) return;
        acceptSnapshot(initial);
        void streamRoom(session, (next) => {
          acceptSnapshot(next);
          void getRoomHealth(controller.signal).then(setHealth).catch(() => {});
        }, setStreamStatus, controller.signal);
      })
      .catch((failure) => {
        if (controller.signal.aborted) return;
        setStreamStatus(failure instanceof RoomApiError && (failure.status === 401 || failure.status === 403) ? "unauthorized" : "offline");
        setError(failure instanceof RoomApiError ? failure.message : "The room could not be loaded. Check your connection and try again.");
      });
    void getRoomHealth(controller.signal).then(setHealth).catch(() => {});
    return () => {
      controller.abort();
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    };
  }, [session, acceptSnapshot]);

  useEffect(() => {
    if (!snapshot) return;
    const ids = new Set(snapshot.activity.map((entry) => entry.id));
    if (lastActivityIds.current === null) {
      lastActivityIds.current = ids;
      return;
    }
    const newEntries = snapshot.activity.filter((entry) => !lastActivityIds.current!.has(entry.id));
    lastActivityIds.current = ids;
    const meaningful = newEntries.filter((entry) => entry.kind !== "analysis_started");
    if (!meaningful.length) return;
    const priority = (kind: string) => kind === "analysis_blocked" || kind === "finding_detected" ? 4
      : kind === "issue_resolved" || kind === "participant_approved" || kind === "readiness_changed" ? 3
        : kind === "question_asked" || kind === "participant_responded" || kind === "participant_joined" ? 2
          : kind === "analysis_completed" ? 1 : 0;
    const first = [...meaningful].sort((a, b) => priority(b.kind) - priority(a.kind))[0]!;
    const tone: Notice["tone"] = first.kind === "analysis_blocked" || first.kind === "finding_detected" ? "warning"
      : first.kind === "issue_resolved" || first.kind === "participant_approved" || first.kind === "readiness_changed" || first.kind === "analysis_completed" ? "success"
        : "neutral";
    const sectionFor: SectionId = first.kind === "finding_detected" || first.kind === "issue_resolved" ? "issues"
      : first.kind === "participant_joined" || first.kind === "participant_responded" ? "people"
        : first.kind === "analysis_completed" || first.kind === "analysis_blocked" || first.kind === "readiness_changed" ? "overview"
          : "activity";
    const text = meaningful.length > 1
      ? `${first.summary} · ${meaningful.length - 1} related update${meaningful.length > 2 ? "s" : ""}.`
      : first.summary;
    const nextNotice = { id: first.id, text, section: sectionFor, tone };
    setNotice(nextNotice);
    sounds.play(tone);
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice((current) => current?.id === nextNotice.id ? null : current), 6_000);
  }, [snapshot, sounds]);

  const onSubmit = useCallback<SubmitPlanningMessage>(async (input, signal) => {
    if (!session) throw new RoomApiError("This tab has no active room session.", 401);
    sounds.activate();
    const result = await submitRoomMessage(session, input, signal);
    acceptSnapshot(result.snapshot);
    void getRoomHealth(signal).then(setHealth).catch(() => {});
    setError("");
    return result.receipt;
  }, [session, sounds, acceptSnapshot]);

  async function action(input: DashboardAction) {
    if (!snapshot || !session || busy) return;
    setError("");
    try {
      const checked = validateDashboardAction(snapshot.room, input);
      if (checked.kind !== "proposal") return;
      const option = snapshot.room.options.find((candidate) => candidate.id === checked.optionId);
      if (!option) throw new RoomApiError("That compromise is no longer in the current plan.", 409);
      setBusy(true);
      const next = await reviseRoomProposal(session, checked.expectedRevision, option);
      acceptSnapshot(next);
      setNotice({ id: `revision-${next.sequence}`, text: "The room proposed a new version. Previous approvals are cleared while Setvia checks it.", section: "plan", tone: "neutral" });
    } catch (failure) {
      setError(failure instanceof RoomApiError ? failure.message : "The proposal changed. Review the latest version and try again.");
    } finally { setBusy(false); }
  }

  async function shareCandidate(candidateId: string) {
    if (!snapshot || !session || busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await sharePrivateCandidate(session, candidateId, snapshot.room.revision);
      acceptSnapshot(next);
      setNotice({ id: `share-${next.sequence}`, text: "You shared this confirmed detail with the planning room.", section: "people", tone: "success" });
    } catch (failure) {
      setError(failure instanceof RoomApiError ? failure.message : "This detail could not be shared. Review the latest room state.");
    } finally { setBusy(false); }
  }

  async function approve() {
    if (!snapshot || !session || busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await approveRoomProposal(session, snapshot.room.proposalVersion);
      acceptSnapshot(next);
    } catch (failure) {
      setError(failure instanceof RoomApiError ? failure.message : "Approval could not be recorded. Review the current plan.");
    } finally { setBusy(false); }
  }

  async function copyInvitation() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setError("Clipboard access is unavailable. Select and copy the invitation link shown in this field.");
    }
  }

  async function leave() {
    if (!snapshot || !session || leaving) return;
    if (!window.confirm("Leave this room? Your private responses and private suggestions will be removed from the room.")) return;
    setLeaving(true);
    try {
      await leaveRoom(session, snapshot.room.revision);
      window.location.assign("/start");
    } catch (failure) {
      setError(failure instanceof RoomApiError ? failure.message : "You could not leave the room. Try again.");
      setLeaving(false);
    }
  }

  function jumpTo(sectionId: SectionId) {
    setSection(sectionId);
    requestAnimationFrame(() => {
      const target = document.getElementById(sectionId === "people" ? "people-title" : sectionId === "plan" ? "inline-plan-title" : "readiness-title");
      target?.setAttribute("tabindex", "-1");
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "center", behavior: reduced ? "instant" : "smooth" });
    });
  }

  if (!session) return (
    <div className="dashboard-shell dashboard-refined room-access-shell">
      <header className="dashboard-header"><Wordmark /><Link to="/join" className="dashboard-button primary">Join with an invitation</Link></header>
      <div className="room-access-state"><CircleAlert size={30} aria-hidden="true" /><h1>This tab has no room session.</h1><p>Open the invitation link and join with your name. Participant sessions stay in this browser tab.</p><Link to="/join" className="dashboard-button primary">Open invitation</Link></div>
    </div>
  );

  const participant = snapshot?.room.participants.find((person) => person.id === session.participantId);
  const question = snapshot ? currentQuestion(snapshot.room) : undefined;
  const contributions = snapshot?.contributions.map((entry) => ({
    id: entry.id,
    participantId: entry.participantId,
    participantName: entry.participantName,
    proposalVersion: entry.proposalVersion,
    visibility: entry.visibility,
    questionId: entry.questionId,
    recordedAt: entry.recordedAt,
    text: entry.text,
  })) ?? [];
  const readyToApprove = Boolean(snapshot && snapshot.room.analysisCurrent && snapshot.room.finalEvaluationAvailable && !snapshot.room.analysisIncomplete && snapshot.room.loopState === "COMPLETED" && snapshot.room.readiness?.status === "ready_for_human_review");
  const budget = health?.budget;
  const isBeachTripDemo = Boolean(
    snapshot &&
    searchParams.get("demo") === BEACH_TRIP_DEMO_QUERY &&
    snapshot.room.eventType === BEACH_TRIP_DEMO_EVENT_TYPE,
  );

  async function startFreshDemoRoom() {
    if (!participant || busy) return;
    setBusy(true);
    setError("");
    try {
      const created = await createRoom(beachTripDemoRequest(participant.name));
      window.location.assign(`/rooms/${created.roomId}?demo=${BEACH_TRIP_DEMO_QUERY}`);
    } catch (failure) {
      setError(failure instanceof RoomApiError ? failure.message : "A fresh demo room could not be opened.");
      setBusy(false);
    }
  }

  return (
    <div className="dashboard-shell dashboard-refined live-room-shell"
      style={participant ? { paddingBottom: composerHeight + composerInset + 24 } : undefined}>
      <header className="dashboard-header live-room-header">
        <Wordmark />
        <div className="live-room-mode" data-demo={health?.mode === "synthetic-live-demo"}>
          <span className="live-indicator" aria-hidden="true" />
        <strong>{health?.mode === "offline-mock" ? "Offline mock test · no Meta requests" : health?.mode === "synthetic-live-demo" ? "Synthetic live test" : health?.enabled ? "Live Muse Spark room" : "Room service unavailable"}</strong>
          {health?.enabled ? <span>· Muse Spark</span> : null}
        </div>
        <div className="live-room-header-actions">
          <span className="live-connection" data-status={streamStatus} role="status">{liveStatusLabel(streamStatus)}</span>
          <button type="button" className="dashboard-button subtle live-sound-toggle" aria-pressed={sounds.enabled} onClick={sounds.toggle}>
            {sounds.enabled ? <Volume2 size={15} aria-hidden="true" /> : <VolumeX size={15} aria-hidden="true" />}
            <span>{sounds.enabled ? "Sound on" : "Sound off"}</span>
          </button>
          {inviteLink ? <button type="button" className="dashboard-button primary live-copy-invite" onClick={() => void copyInvitation()}>
            {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
            <span>{copied ? "Copied" : "Invite people"}</span>
          </button> : null}
          {participant ? <span className="dashboard-viewer-avatar" aria-label={`Signed in as ${participant.name}`}><Avatar index={snapshot!.room.participants.findIndex((p) => p.id === participant.id)} /></span> : null}
          <button type="button" className="dashboard-button subtle live-leave" disabled={leaving} onClick={() => void leave()}><LogOut size={15} aria-hidden="true" /><span>Leave room</span></button>
        </div>
      </header>

      {inviteLink ? <div className="live-invite-field"><label htmlFor="live-invitation-url">Share invitation</label><input id="live-invitation-url" readOnly value={inviteLink} onFocus={(event) => event.currentTarget.select()} /><div className="live-room-code"><span>Room code</span><code>{roomCodeFromId(roomId)}</code></div><span>The code identifies this room. The invitation link verifies access and gives each person their own session.</span></div> : null}
      {budget ? <p className="live-budget-note">Live test budget · {budget.attempts}/{budget.attempts + budget.remainingAttempts} HTTP attempts used · ${(budget.reservedCostMicros / 1_000_000).toFixed(2)} reserved</p> : null}
      {error ? <div className="live-error" role="alert"><CircleAlert size={16} aria-hidden="true" /><span>{error}</span></div> : null}
      {snapshot && participant && isBeachTripDemo ? <FictionalParticipantsDemo
        roomId={roomId}
        organizer={session}
        room={snapshot.room}
        onStartFreshRoom={() => void startFreshDemoRoom()}
      /> : null}

      {snapshot ? (
        <>
          {snapshot.room.candidates.length ? <section className="private-candidate-strip" aria-label="Your private suggestions">
            <div><strong>Suggestions only you can see</strong><span>They stay private until you share one with the group.</span></div>
            {snapshot.room.candidates.map((candidate) => <article key={candidate.id}><p><strong>{candidate.key.replaceAll("_", " ")}</strong><span>{String(candidate.value)}</span></p><button type="button" className="dashboard-button subtle" disabled={busy} onClick={() => void shareCandidate(candidate.id)}>Share this detail</button></article>)}
          </section> : null}
          <PlanningDashboard
            snapshot={snapshot}
            onAction={(input) => void action(input)}
            busy={busy}
            notice={notice?.text ?? (snapshot.room.analysisStatus === "running" ? "Setvia is reviewing the shared plan with Muse Spark…" : "")}
            activeSection={section}
            onSectionChange={setSection}
            onFocusComposer={() => composer.current?.focus()}
            contributions={contributions}
            contributionMode="room"
          />
          <div className="live-room-actions">
            <span>{snapshot.room.approvalCount} of {snapshot.room.participants.length} approved</span>
            {snapshot.room.approved ? <strong className="live-approved"><Check size={15} aria-hidden="true" /> Everyone approved the plan</strong> : null}
            <button type="button" className="dashboard-button primary" disabled={!readyToApprove || busy || Boolean(snapshot.room.participants.find((p) => p.id === snapshot.room.viewerId)?.approved)} onClick={() => void approve()}>
              {snapshot.room.participants.find((p) => p.id === snapshot.room.viewerId)?.approved ? "You approved this version" : "Approve this proposal"}
            </button>
            {!readyToApprove ? <small>Approval opens after a current analysis completes and readiness is cleared for human review.</small> : null}
          </div>
          {participant && snapshot.source === "room" ? (
            <details className="live-decision-receipt">
              <summary>Decision Receipt</summary>
              <DecisionReceipt
                receipt={projectDecisionReceipt(snapshot)}
                evidence={new Map(snapshot.contributions
                  .filter((entry) => entry.visibility === "group" && entry.proposalVersion === snapshot.room.proposalVersion)
                  .map((entry) => [entry.id, entry.text]))}
              />
              <ReceiptEditor
                key={snapshot.room.roomId}
                room={snapshot.room}
                onSave={async (revision, proposal) => {
                  const next = await reviseRoomProposal(session, revision, proposal);
                  acceptSnapshot(next);
                }}
              />
            </details>
          ) : null}
          {participant ? <MessageComposer
            key={`${snapshot.room.roomId}-${snapshot.room.viewerId}`}
            ref={composer}
            roomId={snapshot.room.roomId}
            viewer={participant}
            revision={snapshot.room.revision}
            proposalVersion={snapshot.room.proposalVersion}
            question={question}
            replies={questionQuickReplies(question)}
            allowedVisibilities={["private", "group"]}
            onSubmit={onSubmit}
            onHeightChange={setComposerHeight}
            onBottomInsetChange={setComposerInset}
            pending={busy}
            disabledReason={snapshot.room.analysisStatus === "running" ? "You can keep drafting while analysis runs." : undefined}
            mode="room"
          /> : null}
        </>
      ) : (
        <div className="room-access-state" role={error ? "alert" : "status"}>
          {streamStatus === "loading" ? <span className="status-dot" aria-hidden="true" /> : <CircleAlert size={28} aria-hidden="true" />}
          <h1>{streamStatus === "loading" ? "Opening your planning room…" : "This room session needs a refresh."}</h1>
          <p>{error || "Setvia is loading the participant-specific view."}</p>
          {streamStatus === "unauthorized" ? <Link to="/join" className="dashboard-button primary">Join again</Link> : null}
        </div>
      )}

      <AnimatePresence initial={false}>
        {notice ? <motion.div key={notice.id} className={`live-toast toast-${notice.tone}`} initial={{ opacity: 0, y: reduced ? 0 : 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : 6 }} transition={{ duration: reduced ? 0.12 : 0.2 }} role="status" aria-live="polite">
          <button type="button" onClick={() => jumpTo(notice.section)}>{notice.text}<span>View update</span></button>
          <button type="button" aria-label="Dismiss notification" onClick={() => setNotice(null)}><X size={15} aria-hidden="true" /></button>
        </motion.div> : null}
      </AnimatePresence>
    </div>
  );
}
