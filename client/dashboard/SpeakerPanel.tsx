import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowUpRight,
  Check,
  LockKeyhole,
  MessageCircle,
  Plus,
  Send,
  Users,
} from "lucide-react";
import { Mascot } from "../Mascot";
import type {
  DashboardAction,
  DashboardSnapshot,
} from "../../shared/dashboard";
import { speakerPresentation } from "./model";

export function SpeakerPanel({
  snapshot,
  onAction,
  onReview,
  busy,
}: {
  snapshot: DashboardSnapshot;
  onAction?: (action: DashboardAction) => void;
  onReview: (findingId: string) => void;
  busy: boolean;
}) {
  const { room } = snapshot;
  const speaker = speakerPresentation(room);
  const [selected, setSelected] = useState<string | null>(null);
  const [information, setInformation] = useState("");
  const reduced = useReducedMotion();
  const question = speaker.question;
  const disabled =
    !onAction || busy || !room.analysisCurrent || room.analysisIncomplete;
  const send = (option: string) => {
    if (!question) return;
    if (option.toLowerCase() === "review details") {
      onReview(question.findingId);
      return;
    }
    setSelected(option);
    onAction?.({
      kind: "answer",
      questionId: question.id,
      option,
      expectedRevision: room.revision,
      proposalVersion: room.proposalVersion,
    });
  };
  return (
    <section
      className={`speaker-panel dashboard-panel expression-${speaker.expression}`}
      aria-labelledby="speaker-title"
    >
      <div className="speaker-heading">
        <h2 id="speaker-title">
          <span className="speaker-online" />
          Setvia’s latest finding
        </h2>
        <span className="audience-label">
          {question?.visibility === "private" ? (
            <>
              <LockKeyhole size={12} aria-hidden="true" />
              Only you
            </>
          ) : (
            <>
              <Users size={12} aria-hidden="true" />
              For the group
            </>
          )}
        </span>
      </div>
      <div className="speaker-stage">
        <motion.div
          className="speaker-cat"
          key={question?.id ?? speaker.kind}
          initial={false}
          animate={
            reduced
              ? { opacity: 1 }
              : {
                  rotate:
                    speaker.expression === "curious" ? [0, -4, 0] : [0, 2, 0],
                  y: [0, -3, 0],
                }
          }
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        >
          <Mascot />
        </motion.div>
        <span className="speaker-stage-line" />
      </div>
      <div className="speaker-copy">
        <h3 aria-describedby="speaker-message-type">{speaker.text}</h3>
        <span className="message-kind" id="speaker-message-type">
          <MessageCircle size={13} aria-hidden="true" />
          {speaker.kind}
        </span>
      </div>
      {question ? (
        <div className="speaker-actions">
          {question.options.length ? (
            <div
              className="question-options"
              role="group"
              aria-label="Answer options"
            >
              {question.options.map((option) => (
                <button
                  className={selected === option ? "is-selected" : ""}
                  type="button"
                  key={option}
                  disabled={disabled}
                  aria-pressed={selected === option}
                  onClick={() => send(option)}
                >
                  <span>{option}</span>
                  {selected === option ? (
                    <Check size={15} aria-hidden="true" />
                  ) : (
                    <ArrowUpRight size={15} aria-hidden="true" />
                  )}
                </button>
              ))}
            </div>
          ) : null}
          <details
            className="additional-information"
            open={!question.options.length ? true : undefined}
          >
            <summary>
              <Plus size={14} aria-hidden="true" />
              {question.options.length ? "Add a detail" : "Your answer"}
            </summary>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (information.trim())
                  onAction?.({
                    kind: "information",
                    questionId: question.id,
                    text: information,
                    expectedRevision: room.revision,
                    proposalVersion: room.proposalVersion,
                  });
              }}
            >
              <label htmlFor="speaker-information">
                {question.visibility === "private"
                  ? "Private answer for Setvia"
                  : "Additional information for Setvia"}
              </label>
              <textarea
                id="speaker-information"
                rows={3}
                maxLength={1000}
                value={information}
                onChange={(event) => setInformation(event.target.value)}
                placeholder="What would help this plan work for you?"
                disabled={disabled}
                required
              />
              <button
                className="dashboard-button primary"
                type="submit"
                disabled={disabled || !information.trim()}
              >
                {snapshot.source === "synthetic"
                  ? "Preview answer"
                  : "Send answer"}
                <Send size={14} aria-hidden="true" />
              </button>
            </form>
          </details>
          <p className="answer-privacy">
            <LockKeyhole size={12} aria-hidden="true" />
            {snapshot.source === "synthetic"
              ? "Preview answers stay in this page."
              : "Your raw answer is private."}
          </p>
        </div>
      ) : (
        <p className="no-questions">
          {room.loopState === "BLOCKED"
            ? "No new questions were published."
            : room.readiness
              ? "No pending question for you."
              : "No questions yet."}
        </p>
      )}
    </section>
  );
}
