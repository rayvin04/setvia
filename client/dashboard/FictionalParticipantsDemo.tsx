import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, Square } from "lucide-react";
import type { DashboardSnapshot } from "../../shared/dashboard.js";
import type { ParticipantSession } from "../../shared/room-api.js";
import { BEACH_TRIP_DEMO_BATCHES, BEACH_TRIP_DEMO_PARTICIPANTS } from "./beach-trip-demo.js";
import {
  getRoomInvitation,
  getRoomSnapshot,
  joinRoom,
  RoomApiError,
  submitRoomMessage,
} from "./room-api.js";

type DemoStatus = "idle" | "joining" | "running" | "sending" | "paused" | "stopped" | "complete" | "error";

export function FictionalParticipantsDemo({
  roomId,
  organizer,
  room,
  onStartFreshRoom,
}: {
  roomId: string;
  organizer: ParticipantSession;
  room: DashboardSnapshot["room"];
  onStartFreshRoom: () => void;
}) {
  const [status, setStatus] = useState<DemoStatus>("idle");
  const [sentCount, setSentCount] = useState(0);
  const [error, setError] = useState("");
  const [messageIds] = useState(() => BEACH_TRIP_DEMO_PARTICIPANTS.map(() => crypto.randomUUID()));
  const sessions = useRef(new Map<string, ParticipantSession>());
  const cursor = useRef(0);
  const timer = useRef<number | null>(null);
  const controller = useRef<AbortController | null>(null);
  const running = useRef(false);
  const stopRequested = useRef(false);

  const alreadyStarted = room.participants.some((participant) =>
    BEACH_TRIP_DEMO_PARTICIPANTS.some((persona) => participant.name === persona.name),
  );

  function clearTimer() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }

  useEffect(() => () => {
    running.current = false;
    clearTimer();
    controller.current?.abort();
  }, []);

  async function sendNextBatch() {
    if (!running.current) return;
    const batch = BEACH_TRIP_DEMO_BATCHES[Math.floor(cursor.current / 2)];
    if (!batch) {
      running.current = false;
      setStatus("complete");
      return;
    }

    setStatus("sending");
    try {
      for (const persona of batch) {
        if (!running.current) break;
        const personaIndex = BEACH_TRIP_DEMO_PARTICIPANTS.findIndex((candidate) => candidate.id === persona.id);
        const session = sessions.current.get(persona.id);
        if (!session) throw new RoomApiError("A fictional participant session is missing. Start a fresh demo room to continue.");
        const current = await getRoomSnapshot(organizer, controller.current?.signal);
        await submitRoomMessage(session, {
          roomId,
          viewerId: session.participantId,
          messageId: messageIds[personaIndex],
          expectedRevision: current.room.revision,
          proposalVersion: current.room.proposalVersion,
          text: persona.message,
          visibility: "group",
          questionId: null,
          replyOption: null,
        }, controller.current?.signal ?? new AbortController().signal);
        cursor.current += 1;
        setSentCount(cursor.current);
      }

      if (stopRequested.current) {
        setStatus("stopped");
        return;
      }
      if (!running.current) {
        setStatus("paused");
        return;
      }
      if (cursor.current >= BEACH_TRIP_DEMO_PARTICIPANTS.length) {
        running.current = false;
        setStatus("complete");
        return;
      }
      setStatus("running");
      timer.current = window.setTimeout(() => {
        timer.current = null;
        void sendNextBatch();
      }, 8_000);
    } catch (failure) {
      running.current = false;
      setStatus("error");
      setError(failure instanceof RoomApiError
        ? failure.message
        : "A fictional message could not be sent. The live room remains available.");
    }
  }

  async function prepareParticipants(signal: AbortSignal) {
    const invitation = getRoomInvitation(roomId);
    if (!invitation) throw new RoomApiError("The organizer invitation is unavailable. Start a fresh demo room.");
    let latest = await getRoomSnapshot(organizer, signal);
    if (latest.room.participants.some((participant) =>
      BEACH_TRIP_DEMO_PARTICIPANTS.some((persona) => participant.name === persona.name),
    )) {
      throw new RoomApiError("Fictional participants are already in this room. Start a fresh demo room to replay the scenario.");
    }
    for (const persona of BEACH_TRIP_DEMO_PARTICIPANTS) {
      if (sessions.current.has(persona.id)) continue;
      const joined = await joinRoom(roomId, invitation, persona.name, signal, { persistSession: false });
      sessions.current.set(persona.id, joined.session);
      latest = joined.snapshot;
    }
    return latest;
  }

  async function start() {
    if (status === "joining" || status === "sending" || status === "complete" || status === "stopped" || alreadyStarted)
      return;
    setError("");
    stopRequested.current = false;
    if (cursor.current === 0 && sessions.current.size === 0) {
      setStatus("joining");
      controller.current = new AbortController();
      try {
        await prepareParticipants(controller.current.signal);
      } catch (failure) {
        setStatus("error");
        setError(failure instanceof RoomApiError
          ? failure.message
          : "The fictional participants could not join this room.");
        return;
      }
    }
    running.current = true;
    setStatus("running");
    clearTimer();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void sendNextBatch();
    }, cursor.current === 0 ? 2_000 : 1_000);
  }

  function pause() {
    if (!running.current) return;
    running.current = false;
    clearTimer();
    if (status !== "sending") setStatus("paused");
  }

  function stop() {
    stopRequested.current = true;
    running.current = false;
    clearTimer();
    if (status !== "sending") setStatus("stopped");
  }

  const canStart = !alreadyStarted && ["idle", "paused", "error"].includes(status);
  const active = status === "running" || status === "sending";

  return (
    <section className="live-demo-panel" aria-labelledby="live-demo-title">
      <div className="live-demo-copy">
        <h2 id="live-demo-title">Weekend Beach Trip</h2>
        <p>Four fictional planners join through the room API and share thoughts over time. Their chat is scripted; Setvia’s agents analyze the real conversation with Muse Spark. You can message the group at any point. Room analyses use the bounded Meta allowance.</p>
        <small>{sentCount} of {BEACH_TRIP_DEMO_PARTICIPANTS.length} simulated messages sent · messages already posted stay in the room.</small>
      </div>
      <div className="live-demo-actions">
        {canStart ? <button type="button" className="dashboard-button primary" disabled={status === "joining"} onClick={() => void start()}>
          <Play size={14} aria-hidden="true" />{status === "error" ? "Try again" : "Start conversation"}
        </button> : null}
        {status === "joining" ? <span className="live-demo-status" role="status">Adding fictional participants…</span> : null}
        {active ? <button type="button" className="dashboard-button subtle" onClick={pause}><Pause size={14} aria-hidden="true" />Pause</button> : null}
        {status === "paused" ? <button type="button" className="dashboard-button primary" onClick={() => void start()}><Play size={14} aria-hidden="true" />Resume</button> : null}
        {active || status === "paused" ? <button type="button" className="dashboard-button subtle" onClick={stop}><Square size={13} aria-hidden="true" />Stop</button> : null}
        {status === "complete" ? <span className="live-demo-status" role="status">Scenario complete. Human approval remains in your control.</span> : null}
        {status === "stopped" || alreadyStarted ? <span className="live-demo-status" role="status">To replay, create a fresh demo room. The current conversation is preserved.</span> : null}
        {status === "idle" && !alreadyStarted ? <button type="button" className="dashboard-button subtle" onClick={onStartFreshRoom}><RotateCcw size={14} aria-hidden="true" />New demo room</button> : null}
        {status === "complete" || status === "stopped" || (alreadyStarted && !active && status !== "joining")
          ? <button type="button" className="dashboard-button subtle" onClick={onStartFreshRoom}><RotateCcw size={14} aria-hidden="true" />Start fresh</button>
          : null}
      </div>
      {error ? <p className="live-demo-error" role="alert">{error}</p> : null}
    </section>
  );
}
