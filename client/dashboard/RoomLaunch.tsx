import { useEffect, useMemo, useState } from "react";
import { CircleAlert, LockKeyhole, Radio, ShieldCheck, Waves } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { PlanDraft } from "../plan-mapping";
import { useSetviaSounds } from "../sound";
import { createRoom, getRoomHealth, RoomApiError, type RoomHealth } from "./room-api";
import { beachTripDemoRequest, BEACH_TRIP_DEMO_QUERY } from "./beach-trip-demo";

export function RoomLaunch({ draft }: { draft: PlanDraft }) {
  const navigate = useNavigate();
  const sounds = useSetviaSounds();
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
      setError("Setvia's live planning service is unavailable right now. Try again in a moment.");
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
    sounds.unlockFromGesture();
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
      sounds.play("complete");
      navigate(`/rooms/${created.roomId}`);
    } catch (failure) {
      sounds.play("error");
      setError(failure instanceof RoomApiError ? failure.message : "The room could not be created. Your draft is still here.");
    } finally {
      setBusy(false);
    }
  }

  async function startBeachTripDemo() {
    if (busy) return;
    setError("");
    setNotice("");
    if (!health?.enabled) {
      setError("Setvia's live planning service is unavailable right now. Try again in a moment.");
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
    sounds.unlockFromGesture();
    setBusy(true);
    try {
      const created = await createRoom(beachTripDemoRequest(nickname.trim()));
      sounds.play("complete");
      navigate(`/rooms/${created.roomId}?demo=${BEACH_TRIP_DEMO_QUERY}`);
    } catch (failure) {
      sounds.play("error");
      setError(failure instanceof RoomApiError ? failure.message : "The demo room could not be created. Try again.");
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
          <p>Create a real planning room, then invite people with a private link.</p>
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
        <p><LockKeyhole size={14} aria-hidden="true" /> Room data stays in authorized server-side files. Meta credentials never enter the browser.</p>
        <span className="room-launch-mode">
          {health?.mode === "offline-mock" ? "Offline mock test · no Meta requests" : health?.mode === "synthetic-live-demo" ? "Live Muse Spark · synthetic test" : health?.mode === "local-live" ? "Live Muse Spark · secure server" : health?.mode === "unavailable" ? "Room service unavailable" : "Checking room service…"}
        </span>
      </div>
      {health && !health.enabled ? (
        <p className="room-launch-unavailable"><CircleAlert size={15} aria-hidden="true" /> Real rooms are not available right now. The synthetic dashboard preview remains available.</p>
      ) : null}
      {error ? <p className="room-launch-error" role="alert"><CircleAlert size={15} aria-hidden="true" />{error}</p> : null}
      {notice ? <p className="room-launch-notice" role="status"><ShieldCheck size={15} aria-hidden="true" />{notice}</p> : null}
      <button type="button" className="button button-primary room-launch-button" disabled={busy || !health?.enabled} onClick={() => void startRoom()}>
        {busy ? "Opening room…" : "Create Live Room"}
      </button>
      <div className="room-launch-demo">
        <div><strong>Want to see it in action?</strong><span>A ready-made Beach Trip room starts with four fictional planners. Your chat and Setvia's analysis are live.</span></div>
        <button type="button" className="button button-secondary" disabled={busy || !health?.enabled} onClick={() => void startBeachTripDemo()}>
          <Waves size={16} aria-hidden="true" />{busy ? "Opening demo…" : "Try the live demo"}
        </button>
      </div>
    </section>
  );
}
