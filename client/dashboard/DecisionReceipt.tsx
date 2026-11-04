import { useId, useState } from "react";
import { Avatar } from "../Mascot";
import { createEventCard } from "./event-card";
import type { projectDecisionReceipt } from "./decision-receipt";
import { createReceiptPdf } from "./receipt-pdf";
import "./decision-receipt.css";

type Receipt = ReturnType<typeof projectDecisionReceipt>;

export function DecisionReceipt({
  receipt,
  evidence,
}: {
  receipt: Receipt;
  evidence: ReadonlyMap<string, string>;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function download(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch {
      setError("The download couldn’t be created. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function saveFile(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const { eventCard } = receipt;
  return (
    <section className="decision-receipt" aria-labelledby={id}>
      <header className="decision-receipt-overview">
        <div>
          <p className="decision-receipt-state">
            Decision Receipt · {receipt.status}
          </p>
          <h2 id={id}>{receipt.title}</h2>
          {eventCard.description && <p>{eventCard.description}</p>}
          <p>
            {[eventCard.date, eventCard.time, eventCard.location]
              .filter(Boolean)
              .join(" · ") || "Event details are still open."}
          </p>
        </div>
        <div className="decision-receipt-readiness">
          <strong>
            {receipt.readiness ? `${receipt.readiness.percentage}%` : "—"}
          </strong>
          <span>
            {receipt.status === "Blocked" ? "Planning blocked" : "Readiness"}
          </span>
        </div>
      </header>
      <div className="decision-receipt-people">
        <span>
          {receipt.approvalCount} of {receipt.participantCount} members approved
        </span>
        {eventCard.expectedAttendees !== undefined && (
          <span>{eventCard.expectedAttendees} expected attendees</span>
        )}
        <ul aria-label="Room members">
          {receipt.participants.map((person, index) => (
            <li key={person.id}>
              <Avatar index={index} /> {person.name}
            </li>
          ))}
        </ul>
      </div>
      <div className="decision-receipt-columns">
        <section>
          <h3>
            {receipt.status === "Final" ? "What was agreed" : "What’s proposed"}
          </h3>
          {receipt.decisions.length ? (
            <dl>
              {receipt.decisions.map((decision) => (
                <div key={decision.key}>
                  <dt>{decision.label}</dt>
                  <dd>{decision.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p>No details have been added yet.</p>
          )}
        </section>
        <section>
          <h3>Blind spots caught by Setvia</h3>
          {receipt.findings.length ? (
            <ul className="decision-receipt-findings">
              {receipt.findings.map((finding) => (
                <li key={finding.id}>
                  <span>
                    {finding.category} · {finding.severity} · {finding.status}
                  </span>
                  <p>{finding.message}</p>
                  {finding.evidenceIds.some((key) => evidence.has(key)) && (
                    <details>
                      <summary>Supporting group messages</summary>
                      {finding.evidenceIds.map((key) => {
                        const message = evidence.get(key);
                        return message ? (
                          <blockquote key={key}>{message}</blockquote>
                        ) : null;
                      })}
                    </details>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>No current findings are available.</p>
          )}
        </section>
      </div>
      <div className="decision-receipt-actions">
        <button
          type="button"
          className="dashboard-button primary"
          disabled={busy}
          onClick={() =>
            void download(async () =>
              saveFile(
                await createReceiptPdf(receipt),
                "setvia-decision-receipt.pdf",
              ),
            )
          }
        >
          Download Decision Receipt
        </button>
        <button
          type="button"
          className="dashboard-button subtle"
          disabled={busy}
          onClick={() =>
            void download(async () =>
              saveFile(
                await createEventCard(receipt.eventCard),
                "setvia-event-card.png",
              ),
            )
          }
        >
          Download Event Card
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
