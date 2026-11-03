import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CircleAlert, LockKeyhole, Radio, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { PlanDraft } from "../plan-mapping";
import { createRoom, getRoomHealth, RoomApiError, type RoomHealth } from "./room-api";

export function RoomLaunch({ draft }: { draft: PlanDraft }) {
  const navigate = useNavigate();
  const [health, setHealth] = useState<RoomHealth | null>(null);
  const [nickname, setNickname] = useState("");
  const [understandsMeta, setUnderstandsMeta] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const readyDraft = Boolean(draft.title.trim());
  const eventType = useMemo(() => {
    const kind = draft.category?.trim() || "event";
    return `${kind} planning`.slice(0, 80);
  }, [draft.category]);

  useEffect(() => {
    const controller = new AbortController();
    void getRoomHealth(controller.signal).then(setHealth).catch(() => {
      if (!controller.signal.aborted) setHealth({ enabled: false, mode: "unavailable" });
    });
    return () => controller.abort();
  }, []);

  async function startRoom() {
    if (busy) return;
    setError("");
    setNotice("");
    if (!health?.enabled) {
      setError("The local live-room server is not running. Start the authorized local API and try again.");
      return;
    }
    if (!readyDraft) {
      setError("Add a plan title before creating a room.");
      return;
    }
    if (!nickname.trim()) {
      setError("Choose the name your group will see.");
      return;
    }
    if (!understandsMeta) {
      setError("Confirm the Meta processing disclosure before starting a live room.");
      return;
    }
    const values: Record<string, string | number | boolean | null> = {};
    for (const [key, raw] of Object.entries(draft)) {
      if (typeof raw === "string" && raw.trim()) values[key] = raw.trim().slice(0, 500);
    }
    values.category = draft.category || "other";
    setBusy(true);
    try {
      const created = await createRoom({
        creatorName: nickname.trim(),
        eventType,
        proposal: {
          id: `plan-${crypto.randomUUID()}`,
          label: draft.title.trim().slice(0, 120),
          values,
        },
        estimatedAttendeeCount: draft.participantExact && /^\d+$/.test(draft.participantExact)
          ? Number(draft.participantExact)
          : null,
        confirmedAttendeeCount: null,
      });
      setNotice("Your room is ready. Copy its invitation link from the room header.");
      navigate(`/rooms/${created.roomId}`);
    } catch (failure) {
      setError(failure instanceof RoomApiError ? failure.message : "The room could not be created. Your draft is still here.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="room-launch" aria-labelledby="room-launch-title">
      <div className="room-launch-heading">
        <Radio size={19} aria-hidden="true" />
        <div>
          <h2 id="room-launch-title">Bring your group in</h2>
          <p>Create a real local planning room, then invite people with a private link.</p>
        </div>
      </div>
      <div className="room-launch-fields">
        <label htmlFor="room-creator-name">Your name in the room</label>
        <input
          id="room-creator-name"
          value={nickname}
          autoComplete="nickname"
          maxLength={40}
          placeholder="What should we call you?"
          onChange={(event) => setNickname(event.currentTarget.value)}
        />
      </div>
      <label className="room-launch-consent">
        <input type="checkbox" checked={understandsMeta} onChange={(event) => setUnderstandsMeta(event.currentTarget.checked)} />
        <span>
          I understand that room messages are processed by Meta’s Model API. Private responses stay hidden from other participants, but are still sent to Meta for private analysis.
        </span>
      </label>
      <div className="room-launch-foot">
        <p><LockKeyhole size={14} aria-hidden="true" /> Room snapshots and credentials stay on the local private host.</p>
        <span className="room-launch-mode">
          {health?.mode === "offline-mock" ? "Offline mock test · no Meta requests" : health?.mode === "synthetic-live-demo" ? "Live Muse Spark · synthetic demo mode" : "Live Muse Spark · local server"}
        </span>
      </div>
      {health && !health.enabled ? (
        <p className="room-launch-unavailable"><CircleAlert size={15} aria-hidden="true" /> Real rooms are not available from this server. The synthetic dashboard preview remains available.</p>
      ) : null}
      {error ? <p className="room-launch-error" role="alert"><CircleAlert size={15} aria-hidden="true" />{error}</p> : null}
      {notice ? <p className="room-launch-notice" role="status"><ShieldCheck size={15} aria-hidden="true" />{notice}</p> : null}
      <button type="button" className="button button-primary room-launch-button" disabled={busy || !health?.enabled} onClick={() => void startRoom()}>
        {busy ? "Opening room…" : "Create a live room"}
        <ArrowRight size={17} aria-hidden="true" />
      </button>
    </section>
  );
}
