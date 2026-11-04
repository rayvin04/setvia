import { useId, useReducer, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  CalendarDays,
  CarFront,
  Check,
  RotateCcw,
  Wallet,
} from "lucide-react";
import { Avatar } from "./Mascot";
import {
  initialPreview,
  previewPeople,
  previewReducer,
  type PlanDetail,
} from "./preview-state";

const details = {
  when: {
    title: "Keep Sunday. Leave early.",
    text: "Hu Tao can make Sunday. A 7 AM departure gives Furina time to drive without changing the day.",
  },
  budget: {
    title: "A limit everyone can work with.",
    text: "Selena’s limit is ₱2,500. The group still needs to agree on a per-person budget before booking anything.",
  },
  travel: {
    title: "Furina drives. Everyone shares fuel.",
    text: "The early departure works for the driver. A nearby destination keeps the journey and the fuel bill manageable.",
  },
  open: {
    title: "Two things still need a yes.",
    text: "Agree on the per-person limit, then decide who brings food. These stay open even if someone likes the current proposal.",
  },
} satisfies Record<PlanDetail, { title: string; text: string }>;

export function InteractivePlanPreview() {
  const [state, dispatch] = useReducer(
    previewReducer,
    undefined,
    initialPreview,
  );
  const reduced = useReducedMotion();
  const panelId = useId();
  const articleRef = useRef<HTMLElement>(null);
  const returnFocus = useRef<PlanDetail | null>(null);
  function inspect(detail: PlanDetail) {
    returnFocus.current = detail;
    dispatch({ type: "inspect", detail });
  }
  function reset() {
    returnFocus.current = null;
    dispatch({ type: "reset" });
  }
  const rows = [
    {
      key: "when",
      label: "When",
      value: "Sunday · leave at 7 AM",
      icon: CalendarDays,
    },
    {
      key: "budget",
      label: "Budget",
      value: "Agree on a per-person limit",
      icon: Wallet,
    },
    {
      key: "travel",
      label: "Travel",
      value: "Furina drives · split fuel",
      icon: CarFront,
    },
  ] as const;
  return (
    <article
      ref={articleRef}
      className="interactive-plan story-demo-frame"
      aria-label="Interactive Sunday plan"
      onKeyDown={(event) => {
        if (event.key === "Escape" && state.detail) {
          event.preventDefault();
          dispatch({ type: "inspect", detail: state.detail });
        }
      }}
    >
      <div className="plan-preview-heading">
        <h3>A Sunday that works.</h3>
        <p>Keep the day. Cut the cost. Give everyone a clear next step.</p>
      </div>
      <div className="plan-preview-body" id={panelId}>
        <AnimatePresence mode="wait" initial={false}>
          {state.detail ? (
            <motion.div
              className="plan-detail-panel"
              key={state.detail}
              initial={{ opacity: 0, x: reduced ? 0 : 6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0 : 0.18, ease: "easeInOut" }}
            >
              <button
                className="preview-back"
                type="button"
                autoFocus
                onClick={() =>
                  dispatch({ type: "inspect", detail: state.detail! })
                }
              >
                Back to plan
              </button>
              <h4>{details[state.detail].title}</h4>
              <p>{details[state.detail].text}</p>
            </motion.div>
          ) : (
            <motion.div
              key="rows"
              className="plan-preview-rows"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0 : 0.16, ease: "easeInOut" }}
              ref={(node) => {
                if (node && returnFocus.current) {
                  node
                    ?.querySelector<HTMLButtonElement>(
                      `[data-detail="${returnFocus.current}"]`,
                    )
                    ?.focus({ preventScroll: true });
                  returnFocus.current = null;
                }
              }}
            >
              {rows.map(({ key, label, value, icon: Icon }) => (
                <button
                  className="plan-preview-row"
                  key={key}
                  type="button"
                  data-detail={key}
                  aria-controls={panelId}
                  onClick={() => inspect(key)}
                >
                  <Icon size={19} aria-hidden="true" />
                  <span>{label}</span>
                  <strong>{value}</strong>
                </button>
              ))}
              <button
                className="plan-open-issue"
                type="button"
                data-detail="open"
                aria-controls={panelId}
                onClick={() => inspect("open")}
              >
                <span className="issue-dot" aria-hidden="true" />
                <span>
                  <small>Still open</small>
                  <strong>Budget and who brings food</strong>
                </span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="plan-preview-approvals">
        <div
          className="preview-avatar-controls"
          role="group"
          aria-label="Fictional approvals"
        >
          {previewPeople.map((person, index) => {
            const approved = state.approvals.includes(person);
            return (
              <motion.button
                key={person}
                type="button"
                aria-label={`${person} sample approval`}
                aria-pressed={approved}
                title={`${person}: ${approved ? "approved" : "not approved"} · click to change example`}
                whileTap={reduced ? undefined : { scale: 0.92 }}
                className={approved ? "is-approved" : ""}
                onClick={() => dispatch({ type: "toggle-approval", person })}
              >
                <Avatar index={index} />
                {approved && (
                  <span>
                    <Check size={9} strokeWidth={3} aria-hidden="true" />
                  </span>
                )}
              </motion.button>
            );
          })}
        </div>
        <span className="preview-approval-count" role="status">
          {state.approvals.length} of 4 approvals
        </span>
        <div
          className="preview-progress"
          role="progressbar"
          aria-label="Sample approvals"
          aria-valuemin={0}
          aria-valuemax={4}
          aria-valuenow={state.approvals.length}
        >
          <motion.span
            animate={{ scaleX: state.approvals.length / 4 }}
            transition={
              reduced
                ? { duration: 0 }
                : { type: "spring", bounce: 0, visualDuration: 0.3 }
            }
          />
        </div>
      </div>
      <div className="preview-footnote">
        <span>Interactive fictional preview</span>
        <button type="button" onClick={reset}>
          <RotateCcw size={12} aria-hidden="true" />
          Reset
        </button>
      </div>
    </article>
  );
}
