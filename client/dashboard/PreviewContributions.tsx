import { LockKeyhole, MessageCircle, Users } from "lucide-react";
import { formatTime } from "./model";
import type { PreviewContribution } from "./preview-interactions";

export function PreviewContributions({
  contributions,
  latest = false,
}: {
  contributions: PreviewContribution[];
  latest?: boolean;
}) {
  if (!contributions.length) return null;
  const visible = latest
    ? contributions.slice(-1)
    : [...contributions].reverse();
  return (
    <section
      className={`preview-contributions${latest ? " latest-contribution" : " dashboard-panel"}`}
      aria-label={
        latest ? "Latest preview response" : "Responses recorded in preview"
      }
    >
      {!latest ? (
        <h2>
          Room contributions <span>Preview</span>
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
              Recorded in preview · {formatTime(entry.recordedAt)}
            </time>
          </li>
        ))}
      </ol>
    </section>
  );
}
