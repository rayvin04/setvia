import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, CircleAlert, CircleCheck, CircleX, Info, Sparkles, TriangleAlert, X } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Header } from "../components";
import { useSetviaSounds } from "../sound";
import { MessageComposer, type MessageComposerHandle } from "./MessageComposer";
import { PlanningDashboard, type SectionId } from "./Dashboard";
import { DecisionReceipt } from "./DecisionReceipt";
import { ReceiptEditor } from "./ReceiptEditor";
import {
  projectDecisionReceipt,
  projectReceiptEvidence,
} from "./decision-receipt";
import { currentQuestion, questionQuickReplies } from "./composer-model";
import { acceptDashboardUpdate, readinessPresentation } from "./model";
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
  retryRoomAnalysis,
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

type NoticeTone = "neutral" | "warning" | "success" | "failure" | "action";
type NoticeCue = "warning" | "error" | "check" | "complete" | "receive" | "processing";
type Notice = { id: string; text: string; section: SectionId; tone: NoticeTone };

function liveStatusLabel(stream: StreamStatus | "loading" | "offline") {
  if (stream === "connected") return "Connected";
  if (stream === "reconnecting") return "Reconnecting";
  if (stream === "unauthorized") return "Session expired";
  if (stream === "offline") return "Server unavailable";
  return "Connecting";
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
  const [findingFlash, setFindingFlash] = useState(false);
  const [speakerResponseKey, setSpeakerResponseKey] = useState("");
  const [composerHeight, setComposerHeight] = useState(0);
  const [composerInset, setComposerInset] = useState(0);
  const composer = useRef<MessageComposerHandle>(null);
  const lastActivityIds = useRef<Set<string> | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const findingTimer = useRef<number | null>(null);
  const speakerTimer = useRef<number | null>(null);
  const previousSpeakerMessages = useRef<string[] | null>(null);
  const reduced = useReducedMotion();
  const { unlockFromGesture, play } = useSetviaSounds();
  const previousStreamStatus = useRef<StreamStatus | "loading" | "offline">("loading");
  const previousAnalysisState = useRef<string | null>(null);

  const showNotice = useCallback((nextNotice: Notice, cue?: NoticeCue) => {
    setNotice(nextNotice);
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => {
      setNotice((current) => current?.id === nextNotice.id ? null : current);
    }, 7_000);
    const sound = cue ?? (
      nextNotice.tone === "failure" ? "error"
        : nextNotice.tone === "warning" || nextNotice.tone === "action" ? "warning"
          : nextNotice.tone === "success" ? "check" : "receive"
    );
    play(sound);
  }, [play]);

  useEffect(() => {
    document.title = snapshot?.room.proposal.label.trim() || "Setvia";
    return () => {
      document.title = "Setvia";
    };
  }, [snapshot?.room.proposal.label]);

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
      if (findingTimer.current !== null) window.clearTimeout(findingTimer.current);
      if (speakerTimer.current !== null) window.clearTimeout(speakerTimer.current);
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
    if (newEntries.some((entry) => entry.kind === "finding_detected")) {
      setFindingFlash(true);
      if (findingTimer.current !== null) window.clearTimeout(findingTimer.current);
      findingTimer.current = window.setTimeout(() => setFindingFlash(false), 900);
    }
    const meaningful = newEntries.filter((entry) => entry.kind !== "analysis_started");
    if (!meaningful.length) return;
    const priority = (kind: string) => kind === "analysis_blocked" || kind === "finding_detected" ? 4
      : kind === "issue_resolved" || kind === "participant_approved" || kind === "readiness_changed" ? 3
        : kind === "question_asked" || kind === "participant_responded" || kind === "participant_joined" ? 2
          : kind === "analysis_completed" ? 1 : 0;
    const first = [...meaningful].sort((a, b) => priority(b.kind) - priority(a.kind))[0]!;
    const readyForReview = snapshot.room.readiness?.status === "ready_for_human_review";
    const tone: NoticeTone = first.kind === "analysis_blocked" || first.kind === "finding_detected" || (first.kind === "readiness_changed" && readyForReview) ? "action"
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
    const cue: NoticeCue | undefined = first.kind === "analysis_completed" ? "complete"
      : first.kind === "participant_responded" || first.kind === "question_asked" ? "receive"
        : undefined;
    showNotice(nextNotice, cue);
  }, [snapshot, showNotice]);

  useEffect(() => {
    const previous = previousStreamStatus.current;
    if (streamStatus !== previous) {
      if (streamStatus === "connected") play("connect");
      else if (previous === "connected") play("disconnect");
      previousStreamStatus.current = streamStatus;
    }
  }, [streamStatus, play]);

  const analysisActivityState = snapshot && streamStatus === "connected"
    ? [snapshot.room.analysisStatus, snapshot.room.privateAnalysisStatus].includes("running") ? "running"
      : [snapshot.room.analysisStatus, snapshot.room.privateAnalysisStatus].includes("queued") ? "queued"
        : [snapshot.room.analysisStatus, snapshot.room.privateAnalysisStatus].includes("blocked") ? "blocked"
          : [snapshot.room.analysisStatus, snapshot.room.privateAnalysisStatus].includes("complete") ? "complete"
            : "idle"
    : null;

  useEffect(() => {
    const previous = previousAnalysisState.current;
    if (analysisActivityState === "running" && previous !== "running") play("start");
    else if (analysisActivityState === "complete" && previous && previous !== "complete") play("complete");
    else if (analysisActivityState === "blocked" && previous && previous !== "blocked") play("warning");
    previousAnalysisState.current = analysisActivityState;
  }, [analysisActivityState, play]);

  useEffect(() => {
    if (!snapshot) return;
    const signatures = snapshot.room.messages.map((message) =>
      JSON.stringify([
        message.proposalVersion,
        message.questionId,
        message.targetId,
        message.visibility,
        message.text,
      ]),
    );
    const previous = previousSpeakerMessages.current;
    previousSpeakerMessages.current = signatures;
    if (!previous || streamStatus !== "connected") return;
    const counts = new Map<string, number>();
    for (const signature of previous) counts.set(signature, (counts.get(signature) ?? 0) + 1);
    const added = [...signatures].reverse().find((signature) => {
      const count = counts.get(signature) ?? 0;
      if (count > 0) {
        counts.set(signature, count - 1);
        return false;
      }
      return true;
    });
    if (!added) return;
    setSpeakerResponseKey(`${snapshot.sequence}:${added}`);
    if (speakerTimer.current !== null) window.clearTimeout(speakerTimer.current);
    speakerTimer.current = window.setTimeout(() => setSpeakerResponseKey(""), 1_250);
  }, [snapshot, streamStatus]);

  useEffect(() => {
    if (streamStatus === "connected") return;
    setSpeakerResponseKey("");
    if (speakerTimer.current !== null) window.clearTimeout(speakerTimer.current);
  }, [streamStatus]);

  const onSubmit = useCallback<SubmitPlanningMessage>(async (input, signal) => {
    if (!session) throw new RoomApiError("This tab has no active room session.", 401);
    unlockFromGesture();
    try {
      const result = await submitRoomMessage(session, input, signal);
      acceptSnapshot(result.snapshot);
      void getRoomHealth(signal).then(setHealth).catch(() => {});
      setError("");
      play("send");
      return result.receipt;
    } catch (failure) {
      showNotice({
        id: `message-failed-${Date.now()}`,
        text: failure instanceof Error ? failure.message : "Your message could not be sent.",
        section: "activity",
        tone: "failure",
      }, "error");
      throw failure;
    }
  }, [session, unlockFromGesture, play, acceptSnapshot, showNotice]);

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
      showNotice({ id: `revision-${next.sequence}`, text: "The room proposed a new version. Previous approvals are cleared while Setvia checks it.", section: "plan", tone: "neutral" }, "receive");
    } catch (failure) {
      showNotice({ id: `proposal-failed-${Date.now()}`, text: failure instanceof RoomApiError ? failure.message : "The proposal changed. Review the latest version and try again.", section: "plan", tone: "failure" }, "error");
    } finally { setBusy(false); }
  }

  async function approve() {
    if (!snapshot || !session || busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await approveRoomProposal(session, snapshot.room.proposalVersion);
      acceptSnapshot(next);
      showNotice({ id: `approved-${next.sequence}`, text: "Your approval was recorded for this proposal.", section: "overview", tone: "success" }, "check");
    } catch (failure) {
      showNotice({ id: `approval-failed-${Date.now()}`, text: failure instanceof RoomApiError ? failure.message : "Approval could not be recorded. Review the current plan.", section: "overview", tone: "failure" }, "error");
    } finally { setBusy(false); }
  }

  async function copyInvitation() {
    if (!inviteLink) return;
    try {
      await copyText(inviteLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
      showNotice({ id: `invite-copied-${Date.now()}`, text: "Invitation link copied to your clipboard.", section: "people", tone: "success" }, "check");
    } catch {
      showNotice({ id: `invite-copy-failed-${Date.now()}`, text: "Clipboard access is unavailable. Check your browser’s clipboard permission and try again.", section: "people", tone: "failure" }, "error");
    }
  }

  async function copyRoomCode() {
    try {
      await copyText(roomCodeFromId(roomId));
      showNotice({ id: `room-code-copied-${Date.now()}`, text: "Room code copied to your clipboard.", section: "people", tone: "success" }, "check");
    } catch {
      showNotice({ id: `room-code-copy-failed-${Date.now()}`, text: "Clipboard access is unavailable. Check your browser’s clipboard permission and try again.", section: "people", tone: "failure" }, "error");
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
      showNotice({ id: `leave-failed-${Date.now()}`, text: failure instanceof RoomApiError ? failure.message : "You could not leave the room. Try again.", section: "overview", tone: "failure" }, "error");
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
    <div className="dashboard-shell dashboard-refined live-room-shell room-access-shell">
      <Header room={{ roomCode: roomCodeFromId(roomId), copied: false }} />
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

  const sharedRunning = snapshot?.room.analysisStatus === "running";
  const privateRunning = snapshot?.room.privateAnalysisStatus === "running";
  const analysisLabel = analysisActivityState === "running"
    ? sharedRunning && privateRunning
      ? "Setvia is analyzing shared and private details"
      : privateRunning
        ? "Setvia is analyzing your private response"
        : "Setvia is analyzing the plan"
    : analysisActivityState === "queued"
      ? "Setvia analysis is queued"
      : analysisActivityState === "blocked"
        ? "Analysis needs attention."
        : snapshot?.room.loopState === "WAIT_FOR_PARTICIPANT"
          ? question ? "Setvia needs an answer." : "Waiting for a participant."
          : snapshot?.room.analysisStatus === "complete" ? "Analysis complete."
            : "Preparing the first review.";
  const analysisVisualState = analysisActivityState === "running" ? "active"
    : analysisActivityState === "queued" ? "queued"
      : analysisActivityState === "blocked" ? "blocked"
        : "idle";

  const approvalControl = snapshot ? (
    <div className="live-approval-control">
      {snapshot.room.participants.find((p) => p.id === snapshot.room.viewerId)?.approved ? (
        <strong className="live-approved"><Check size={15} aria-hidden="true" /> You approved this version</strong>
      ) : (
        <button
          type="button"
          className="dashboard-button primary"
          disabled={!readyToApprove || busy}
          title={!readyToApprove ? "Approval is available after the current analysis is complete." : undefined}
          onClick={() => void approve()}
        >
          Approve proposal
        </button>
      )}
      <span>{snapshot.room.approvalCount} of {snapshot.room.participants.length} approved</span>
    </div>
  ) : null;
  const analysisStatus = analysisLabel ? (
    <div className="live-analysis-status" data-state={analysisVisualState} role="status" aria-live="polite" aria-atomic="true">
      <span className="live-analysis-orbit" aria-hidden="true"><i /><i /><b /></span>
      <strong>{analysisLabel}</strong>
      {snapshot?.room.analysisStatus === "blocked" ? <>
        <span>{readinessPresentation(snapshot.room).detail}</span>
        <button type="button" className="dashboard-button subtle" disabled={busy} onClick={async () => {
          setBusy(true);
          try { acceptSnapshot(await retryRoomAnalysis(session, snapshot.room.revision)); }
          catch (failure) { setError(failure instanceof Error ? failure.message : "Analysis could not be retried."); }
          finally { setBusy(false); }
        }}>Retry analysis</button>
      </> : null}
    </div>
  ) : null;

  return (
    <div
      className="dashboard-shell dashboard-refined live-room-shell"
      data-finding-flash={findingFlash || undefined}
      onPointerDownCapture={unlockFromGesture}
      onKeyDownCapture={unlockFromGesture}
      style={{ "--composer-height": `${composerHeight}px`, "--composer-inset": `${composerInset}px` } as CSSProperties}
    >
      <Header room={{
        roomCode: roomCodeFromId(roomId),
        roomTitle: snapshot?.room.proposal.label,
        eventType: snapshot?.room.eventType,
        inviteLink: inviteLink ?? undefined,
        copied,
        onCopyLink: () => void copyInvitation(),
        onCopyCode: () => void copyRoomCode(),
        onLeave: participant ? () => void leave() : undefined,
        leaving,
      }} />
      {snapshot && streamStatus !== "connected" ? <p className="live-connection-note" role="status"><CircleAlert size={15} aria-hidden="true" />{liveStatusLabel(streamStatus)}. Showing the last received room state.</p> : null}
      {budget ? <p className="live-budget-note">Meta request usage recorded · {budget.attempts} HTTP attempts · ${(budget.reservedCostMicros / 1_000_000).toFixed(2)} estimated or reserved</p> : null}
      {error ? <div className="live-error" role="alert"><CircleAlert size={16} aria-hidden="true" /><span>{error}</span></div> : null}
      {snapshot && participant && isBeachTripDemo ? <FictionalParticipantsDemo
        roomId={roomId}
        organizer={session}
        room={snapshot.room}
        onStartFreshRoom={() => void startFreshDemoRoom()}
      /> : null}

      {snapshot ? (
        <>
          <PlanningDashboard
            snapshot={snapshot}
            onAction={(input) => void action(input)}
            busy={busy}
            notice={notice?.text ?? ""}
            activeSection={section}
            onSectionChange={setSection}
            onFocusComposer={() => composer.current?.focus()}
            contributions={contributions}
            contributionMode="room"
            speakerResponseKey={speakerResponseKey}
            titleActions={approvalControl}
            titleStatus={analysisStatus}
            agentActivity={streamStatus !== "connected" ? "idle" : snapshot.room.analysisStatus === "running" ? "active" : snapshot.room.analysisStatus === "queued" ? "queued" : "idle"}
          />
          {snapshot.room.candidates.some((candidate) => candidate.ownerId === session.participantId) ? (
            <details className="live-suggestion-review" open>
              <summary>Confirm your extracted planning details</summary>
              <p>Confirm accurate details to advance validation. Private suggestions join the shared plan only when you confirm and share them.</p>
              {snapshot.room.candidates.filter((candidate) => candidate.ownerId === session.participantId).map((candidate) => (
                <div key={candidate.id}><span>{candidate.key}: {String(candidate.value)}</span>
                  <button type="button" className="dashboard-button subtle" disabled={busy} onClick={async () => {
                    setBusy(true);
                    try { acceptSnapshot(await sharePrivateCandidate(session, candidate.id, snapshot.room.revision)); }
                    catch (failure) { setError(failure instanceof Error ? failure.message : "The detail could not be confirmed."); }
                    finally { setBusy(false); }
                  }}>{candidate.visibility === "private" ? "Confirm and share" : "Confirm detail"}</button>
                </div>
              ))}
            </details>
          ) : null}
          {participant && snapshot.source === "room" ? (
            <section className="live-decision-receipt" aria-label="Decision Receipt">
              <DecisionReceipt
                receipt={projectDecisionReceipt(snapshot)}
                evidence={projectReceiptEvidence(snapshot)}
              />
              <ReceiptEditor
                key={snapshot.room.roomId}
                room={snapshot.room}
                onSave={async (revision, proposal) => {
                  const next = await reviseRoomProposal(session, revision, proposal);
                  acceptSnapshot(next);
                }}
              />
            </section>
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
        {notice ? <motion.div key={notice.id} className={`live-toast toast-${notice.tone}`} initial={{ opacity: 0, x: reduced ? 0 : 16, scale: reduced ? 1 : 0.98 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: reduced ? 0 : 16, scale: reduced ? 1 : 0.98 }} transition={{ type: "spring", bounce: 0, visualDuration: reduced ? 0.12 : 0.28 }} role={notice.tone === "failure" || notice.tone === "action" ? "alert" : "status"} aria-live={notice.tone === "failure" || notice.tone === "action" ? "assertive" : "polite"}>
          <button type="button" className="live-toast-main" onClick={() => jumpTo(notice.section)}>
            <span className="live-toast-icon" aria-hidden="true">
              {notice.tone === "success" ? <CircleCheck size={19} />
                : notice.tone === "failure" ? <CircleX size={19} />
                  : notice.tone === "action" ? <Sparkles size={19} />
                    : notice.tone === "warning" ? <TriangleAlert size={19} /> : <Info size={19} />}
            </span>
            <span className="live-toast-copy">
              <strong>{notice.tone === "action" ? "Action needed" : notice.tone === "failure" ? "Couldn’t complete that" : notice.tone === "success" ? "Update complete" : notice.tone === "warning" ? "Needs attention" : "Room update"}</strong>
              <span>{notice.text}</span>
              <em>View update</em>
            </span>
          </button>
          <button type="button" aria-label="Dismiss notification" onClick={() => setNotice(null)}><X size={15} aria-hidden="true" /></button>
        </motion.div> : null}
      </AnimatePresence>
    </div>
  );
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("Clipboard access is unavailable.");
}
