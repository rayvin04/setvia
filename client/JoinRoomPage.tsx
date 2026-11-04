import { useState } from "react";
import { CircleAlert, LockKeyhole } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { joinRoom, RoomApiError } from "./dashboard/room-api";
import "./join-room.css";

function readInvitation(raw: string) {
  try {
    const url = new URL(raw.trim(), window.location.origin);
    const roomMatch = url.pathname.match(/\/rooms\/([a-zA-Z0-9_-]{1,80})\/?$/);
    const roomId =
      url.searchParams.get("room") ??
      url.searchParams.get("roomId") ??
      roomMatch?.[1] ??
      "";
    const invitation =
      new URLSearchParams(url.hash.replace(/^#/, "")).get("invite") ?? "";
    if (
      !/^[a-zA-Z0-9_-]{1,80}$/.test(roomId) ||
      !/^[a-f0-9]{64}$/.test(invitation)
    )
      return null;
    return { roomId, invitation };
  } catch {
    return null;
  }
}

export function JoinRoomPage() {
  const navigate = useNavigate();
  const [link, setLink] = useState(() =>
    window.location.href.includes("#invite=") ? window.location.href : "",
  );
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function join() {
    if (busy) return;
    setError("");
    const parsed = readInvitation(link);
    if (!parsed) {
      setError(
        "Paste the full invitation link. Its invite token must remain after the #invite= part.",
      );
      return;
    }
    if (!name.trim()) {
      setError("Add the name your group will see.");
      return;
    }
    setBusy(true);
    try {
      const result = await joinRoom(
        parsed.roomId,
        parsed.invitation,
        name.trim(),
      );
      // The invite token is a fragment (never sent in the HTTP Referer). Remove
      // it from this tab as soon as the participant session has been exchanged.
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}?room=${encodeURIComponent(parsed.roomId)}`,
      );
      navigate(`/rooms/${parsed.roomId}`, {
        replace: true,
        state: { initialSnapshot: result.snapshot },
      });
    } catch (failure) {
      setError(
        failure instanceof RoomApiError
          ? failure.message
          : "The invitation could not be used. Check the link and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="form-page section-shell room-join-page">
      <h1>Your people are waiting.</h1>
      <p>Join with a name. No account is required.</p>
      <form
        className="room-join-form"
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          void join();
        }}
      >
        <div className="room-join-field">
          <label htmlFor="room-invite-link">Invitation link</label>
          <input
            id="room-invite-link"
            value={link}
            onChange={(event) => setLink(event.currentTarget.value)}
            placeholder="Paste the full room invitation…"
            autoComplete="off"
            autoCapitalize="none"
            inputMode="url"
            spellCheck={false}
            required
            disabled={busy}
            aria-describedby="room-invite-hint"
          />
          <p className="room-join-hint" id="room-invite-hint">
            Use the full invitation link shared by your host.
          </p>
        </div>
        <div className="room-join-field">
          <label htmlFor="room-join-name">Your name</label>
          <input
            id="room-join-name"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder="What should we call you?"
            autoComplete="nickname"
            maxLength={40}
            required
            disabled={busy}
          />
        </div>
        <div className="room-join-disclosure">
          <LockKeyhole size={16} aria-hidden="true" />
          <span>
            Room messages may be processed by Meta’s Model API. A private answer
            is hidden from other participants, but Meta still receives it.
          </span>
        </div>
        {error ? (
          <p className="room-join-error" role="alert">
            <CircleAlert size={15} aria-hidden="true" />
            {error}
          </p>
        ) : null}
        <button className="button button-primary" type="submit" disabled={busy}>
          {busy ? "Joining room…" : "Join planning room"}
        </button>
      </form>
    </section>
  );
}
