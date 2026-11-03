import { motion, useReducedMotion } from "motion/react";
import {
  CornerDownRight,
  LockKeyhole,
  MessageCircle,
  Users,
} from "lucide-react";
import { Mascot } from "../Mascot";
import type { DashboardSnapshot } from "../../shared/dashboard";
import { speakerPresentation } from "./model";
import { currentQuestion } from "./composer-model";

export function SpeakerPanel({
  snapshot,
  onRespond,
  reactionKey = "",
}: {
  snapshot: DashboardSnapshot;
  onRespond?: () => void;
  reactionKey?: string;
}) {
  const { room } = snapshot;
  const speaker = speakerPresentation(room);
  const question = currentQuestion(room);
  const finding =
    room.findings.find((f) => f.id === question?.findingId) ??
    room.findings.find((f) => f.status !== "resolved");
  const publishedFinding = room.messages.find((m) => m.questionId === null);
  const explanation =
    room.loopState === "BLOCKED" || !room.analysisCurrent || !room.readiness
      ? speaker.text
      : (finding?.message ??
        publishedFinding?.text ??
        (question
          ? "Setvia has a question for you. Answer it in the composer below."
          : speaker.text));
  const reduced = useReducedMotion();
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
              For you
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
          key={`${question?.id ?? speaker.kind}-${reactionKey}`}
          initial={false}
          animate={
            reduced
              ? { opacity: 1 }
              : {
                  rotate: [0, speaker.expression === "concerned" ? 2 : -3, 0],
                  y: [0, -2, 0],
                }
          }
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          <Mascot />
        </motion.div>
      </div>
      <div className="speaker-copy">
        <h3>{explanation}</h3>
        <span className="message-kind">
          <MessageCircle size={12} aria-hidden="true" />
          {question ? "Your next response is below" : speaker.kind}
        </span>
      </div>
      <button
        className="speaker-respond"
        type="button"
        disabled={!onRespond}
        onClick={onRespond}
      >
        <CornerDownRight size={14} aria-hidden="true" />
        {question ? "Answer Setvia below" : "Share a thought"}
      </button>
    </section>
  );
}
