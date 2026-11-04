import { LockKeyhole, MessageCircle, Users } from "lucide-react";
import { formatTime } from "./model";
import type { ContributionView } from "./preview-interactions";

export function PreviewContributions({
  contributions,
  latest = false,
  mode = "preview",
}: {
  contributions: ContributionView[];
  latest?: boolean;
  mode?: "preview" | "room";
}) {
  if (!contributions.length) return null;
  const visible = latest
    ? contributions.slice(-1)
    : [...contributions].reverse();
  return (
    <section
      className={`preview-contributions${latest ? " latest-contribution" : " dashboard-panel"}`}
      aria-label={
        latest ? "Latest room response" : "Room contributions"
      }
    >
      {!latest ? (
        <h2>
          Room contributions <span>{mode === "preview" ? "Preview" : "Live"}</span>
        </h2>
      ) : null}
      <ol>
        {visible.map((entry) => (
          <li key={entry.id}>
            <div>
              <strong>{entry.participantName}</strong>
              <span>
                {entry.visibility === "private" ? (
                  <LockKeyhole size={12} aria-hidden="true" />
                ) : (
                  <Users size={12} aria-hidden="true" />
                )}
                {entry.visibility === "private"
                  ? "Private answer"
                  : "Shared with group"}
              </span>
            </div>
            <p>{entry.text}</p>
            <time dateTime={entry.recordedAt}>
              <MessageCircle size={11} aria-hidden="true" />
              {mode === "preview" ? "Recorded in preview" : "Recorded in room"} · {formatTime(entry.recordedAt)}
            </time>
          </li>
        ))}
      </ol>
    </section>
  );
}
