import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { animate, motion, useReducedMotion } from "motion/react";
import {
  ArrowUpRight,
  ShieldAlert,
  CircleCheck,
  Minus,
  Mountain,
  TreePalm,
  CircleAlert,
  Sparkles,
} from "lucide-react";
import type { DashboardSnapshot } from "../../shared/dashboard";
import { readinessChange, readinessPresentation } from "./model";
import { PlanPanel } from "./PlanningPanels";
import { currentQuestion } from "./composer-model";

function AnimatedScore({
  value,
  previous,
}: {
  value: number | null;
  previous: number | null;
}) {
  const element = useRef<HTMLSpanElement>(null);
  const last = useRef<number | null>(previous);
  const reduced = useReducedMotion();
  useEffect(() => {
    const target = element.current;
    if (!target || value === null) return;
    const from = last.current ?? value;
    last.current = value;
    if (reduced || from === value) {
      target.textContent = String(value);
      return;
    }
    const control = animate(from, value, {
      duration: 0.65,
      ease: [0.16, 1, 0.3, 1],
      onUpdate(latest) {
        target.textContent = String(Math.round(latest));
      },
    });
    return () => control.stop();
  }, [value, reduced]);
  return (
    <span ref={element} aria-hidden="true">
      {value ?? "—"}
    </span>
  );
}

export function ReadinessPanel({
  snapshot,
  compact = false,
  titleActions,
  titleStatus,
  agentActivity,
}: {
  snapshot: DashboardSnapshot;
  compact?: boolean;
  titleActions?: ReactNode;
  titleStatus?: ReactNode;
  agentActivity?: "active" | "queued" | "idle";
}) {
  const { room } = snapshot;
  const state = readinessPresentation(room);
  const value = room.readiness?.percentage ?? null;
  const previous =
    room.readiness && room.readiness.delta !== null && !state.historical
      ? room.readiness.percentage - room.readiness.delta
      : null;
  const reduced = useReducedMotion();
  const unresolved = room.findings.filter((f) => f.status !== "resolved");
  const critical = unresolved.filter((f) => f.severity === "critical");
  const nextQuestion = currentQuestion(room);
  const pendingDetails = room.candidates.filter((candidate) => candidate.ownerId === room.viewerId).length;
  return (
    <section
      className={`readiness-panel dashboard-panel tone-${state.tone}${compact ? " is-compact" : ""}${state.historical ? " is-historical" : ""}`}
      aria-labelledby="readiness-title"
      data-testid="readiness-panel"
    >
      {!compact ? (
        <div className="room-panel-title">
          <span>
            {room.eventType === "Mountain hike" ||
            room.eventType === "Outdoor group project" ? (
              <Mountain size={28} aria-hidden="true" />
            ) : (
              <TreePalm size={28} aria-hidden="true" />
            )}
          </span>
          <div>
            <h1>{room.proposal.label}</h1>
            <p>
              {room.eventType} · {room.participants.length} members
            </p>
          </div>
          {titleActions ? <div className="room-title-actions">{titleActions}</div> : null}
        </div>
      ) : null}
      {agentActivity === undefined ? titleStatus : null}
      {agentActivity !== undefined ? (
        <section className="agent-team-panel" aria-label="Shared analysis roles" data-state={agentActivity}>
          <div className="agent-team-heading">
            <span className="agent-team-mark" aria-hidden="true"><Sparkles size={14} /></span>
            <h2>Shared analysis roles</h2>
            {titleStatus}
          </div>
          <ul className="agent-team-roles">
            {["Listener", "Judge", "Negotiator", "Question Strategist", "Speaker"].map((role) => {
              const status = room.analysisRoles.find((entry) => entry.role === role)?.status ?? "idle";
              return <li key={role} data-state={status}><span aria-hidden="true" /><span>{role}<small>{
                status === "running" ? "Working" : status === "complete" ? "Reviewed this cycle" : status === "failed" ? "Needs retry"
                  : status === "not_required" ? "Not needed this cycle" : "Not started"
              }</small></span></li>;
            })}
          </ul>
          <p className="agent-team-goal">Goal: 80%+ readiness, then full validation and participant approval.</p>
          {pendingDetails ? <a className="agent-team-confirm" href="#planning-detail-confirmations">
            Review and confirm {pendingDetails} extracted detail{pendingDetails === 1 ? "" : "s"} to advance readiness. Private details stay private until you confirm and share.
          </a> : null}
          {nextQuestion ? <div className="agent-team-question">
            <strong>Setvia’s next question for you</strong>
            <p>{nextQuestion.text}</p>
            <small>Use the answer options or type your answer in the message box.</small>
          </div> : null}
        </section>
      ) : null}
      <div className="readiness-and-plan">
        <div className="gauge-column">
          <div className="panel-heading">
            <h2 id="readiness-title">Plan readiness</h2>
            <span className="status-label" data-testid="readiness-status">
              {state.tone === "red" ? (
                <ShieldAlert size={14} aria-hidden="true" />
              ) : state.tone === "green" ? (
                <CircleCheck size={14} aria-hidden="true" />
              ) : (
                <span className="status-dot" />
              )}
              {state.label}
            </span>
          </div>
          {state.historical ? (
            <p className="readiness-historical">
              Last validated score · evaluation incomplete
            </p>
          ) : null}
          <div
            className="readiness-gauge"
            data-digits={String(value ?? "—").length}
            role="img"
            aria-label={
              value === null
                ? "Readiness not evaluated"
                : `${state.historical ? "Last validated readiness" : "Plan readiness"}: ${value} percent. ${state.label}.`
            }
          >
            <svg viewBox="0 0 320 320" fill="none" aria-hidden="true">
              <circle className="gauge-outer" cx="160" cy="160" r="151" />
              <circle
                className="gauge-track"
                cx="160"
                cy="160"
                r="137"
                pathLength="100"
              />
              {value !== null ? (
                <motion.circle
                  className="gauge-value"
                  cx="160"
                  cy="160"
                  r="137"
                  pathLength="100"
                  strokeDasharray="100"
                  initial={false}
                  animate={{ strokeDashoffset: 100 - value }}
                  transition={{
                    duration: reduced ? 0 : 0.65,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  transform="rotate(-90 160 160)"
                />
              ) : null}
            </svg>
            <div className="gauge-center">
              <div className="gauge-number">
                <AnimatedScore value={value} previous={previous} />
                {value !== null ? (
                  <span className="gauge-percent" aria-hidden="true">
                    %
                  </span>
                ) : null}
              </div>
              <span className="gauge-caption">
                {value === null
                  ? "A fresh start"
                  : state.historical
                    ? "Last evaluated"
                    : critical.length
                      ? "Critical issue open"
                      : state.tone === "green"
                        ? "Ready for your people"
                        : "Getting there, together"}
              </span>
            </div>
          </div>
        </div>
        <div className="inline-plan">
          <p className="unresolved-count">
            <CircleAlert size={16} aria-hidden="true" />
            {room.analysisCurrent && room.finalEvaluationAvailable
              ? `${unresolved.length} unresolved decision${unresolved.length === 1 ? "" : "s"}`
              : "Awaiting current evaluation"}
          </p>
          <PlanPanel snapshot={snapshot} compact />
        </div>
      </div>
      {room.readiness &&
      room.analysisCurrent &&
      room.finalEvaluationAvailable ? (
        <div className="readiness-breakdown">
          <div>
            <h3>Readiness breakdown</h3>
            <span>{value}% overall</span>
          </div>
          <div className="category-segments" aria-hidden="true">
            {room.readiness.categories.map((category) => (
              <span
                key={category.category}
                className={`segment-${category.status}`}
              >
                <span style={{ width: `${category.percentage}%` }} />
              </span>
            ))}
          </div>
          <ul>
            {room.readiness.categories.map((category) => (
              <li
                key={category.category}
                className={`breakdown-${category.status}`}
              >
                <span>{category.category.replace(" Check", "")}</span>
                <strong>
                  {category.status === "not_applicable" ||
                  category.status === "unknown"
                    ? "—"
                    : `${category.percentage}%`}
                </strong>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="readiness-foot">
        <div className="readiness-change" data-testid="readiness-change">
          {previous !== null ? (
            <>
              <span className="change-score">
                {(room.readiness?.delta ?? 0) > 0 ? (
                  <ArrowUpRight size={16} aria-hidden="true" />
                ) : (
                  <Minus size={16} aria-hidden="true" />
                )}
                {previous}% <span aria-hidden="true">→</span> {value}%
              </span>
              <span>
                {room.readiness?.delta
                  ? `${room.readiness.delta > 0 ? "+" : ""}${room.readiness.delta} points`
                  : "Score unchanged"}
              </span>
            </>
          ) : (
            <>
              <span className="change-score">
                {value === null
                  ? "Awaiting the first check"
                  : state.historical
                    ? "Fresh evaluation needed"
                    : "First evaluation"}
              </span>
            </>
          )}
        </div>
        {critical.length ? (
          <div className="critical-blocker" role="status">
            <ShieldAlert size={18} aria-hidden="true" />
            <div>
              <strong>Resolve {critical[0].category} before proceeding.</strong>
              <p>{critical[0].message}</p>
            </div>
          </div>
        ) : null}
        <details className="readiness-explanation">
          <summary>Why this score?</summary>
          <p>{state.detail}</p>
          <p>{readinessChange(snapshot)}</p>
          {unresolved.length ? (
            <p>
              {unresolved.length} unresolved finding
              {unresolved.length === 1 ? "" : "s"}. Review the Reality Checks
              for required actions.
            </p>
          ) : null}
          <p>
            Readiness checks available information. Approval belongs to the plan
            people reviewed.
          </p>
        </details>
      </div>
    </section>
  );
}
