import {
  CalendarDays,
  Wallet,
  Users,
  Route,
  Backpack,
  ShieldCheck,
  ChevronRight,
  Check,
  AlertTriangle,
  Clock3,
} from "lucide-react";
import { Categories } from "../../server/src/agents/contracts";
import type { Category } from "../../server/src/agents/contracts";
import type { DashboardRoom } from "../../shared/dashboard";
import { categoryPresentation } from "./model";

const icons = [CalendarDays, Wallet, Users, Route, Backpack, ShieldCheck];
function noFindingExplanation(
  room: DashboardRoom,
  category: Category,
  status: string,
): string {
  if (!room.analysisCurrent || !room.finalEvaluationAvailable)
    return "A current evaluation is needed before these details can be shown.";
  if (status === "Not applicable")
    return "This category is not included in the current event policy.";
  if (status !== "Resolved")
    return "Some required information is still missing. Confirm the details with your group.";
  if (category === "Safety Check")
    return "Required safety information is recorded. This is not a safety guarantee; people must verify precautions and local guidance.";
  const context = room.eventType.toLowerCase().includes("kickoff")
    ? "kickoff"
    : room.eventType.toLowerCase().includes("reunion")
      ? "reunion"
      : "plan";
  const copy: Record<Category, string> = {
    "Schedule Check": `The required timing and availability information for this ${context} is recorded.`,
    "Budget Check":
      "The current proposal meets the confirmed spending requirements checked by the engine.",
    "People Check": `Required attendance and access information for this ${context} is recorded. Approval is separate.`,
    "Logistics Check":
      "Required location and coordination information is recorded. External routes and availability are not verified here.",
    "Preparation Check": `Required ${context === "kickoff" ? "materials and preparation responsibilities" : "equipment and preparation details"} are recorded.`,
    "Safety Check": "",
  };
  return copy[category];
}
export function RealityChecks({ room }: { room: DashboardRoom }) {
  return (
    <section
      className="reality-panel dashboard-panel"
      aria-labelledby="reality-title"
    >
      <div className="panel-heading">
        <h2 id="reality-title">Reality Check</h2>
        <span className="quiet-count">6</span>
      </div>
      <p className="panel-description">The details that make a plan work.</p>
      <div className="reality-list">
        {Categories.map((category, index) => {
          const state = categoryPresentation(room, category);
          const Icon = icons[index];
          return (
            <details
              className={`reality-category tone-${state.tone}`}
              id={`check-${index}`}
              key={category}
              data-category={category}
            >
              <summary>
                <Icon size={17} aria-hidden="true" />
                <span>
                  <strong>{category}</strong>
                  <span>
                    {state.label}
                    {state.unresolved.length
                      ? ` · ${state.unresolved.length} open`
                      : ""}
                  </span>
                </span>
                <span className="category-score">
                  {!room.analysisCurrent ||
                  !room.finalEvaluationAvailable ||
                  !state.score ||
                  state.score.status === "unknown" ||
                  state.score.status === "not_applicable"
                    ? "—"
                    : `${state.score.percentage}%`}
                </span>
                <ChevronRight
                  size={14}
                  className="detail-chevron"
                  aria-hidden="true"
                />
              </summary>
              <div className="category-details">
                <span className="category-severity">
                  {state.tone === "red" || state.tone === "yellow" ? (
                    <AlertTriangle size={12} aria-hidden="true" />
                  ) : state.label === "Resolved" ? (
                    <Check size={12} aria-hidden="true" />
                  ) : (
                    <Clock3 size={12} aria-hidden="true" />
                  )}
                  {state.severity === "None" ? state.label : state.severity}
                </span>
                {state.findings.length ? (
                  <ul>
                    {state.findings.map((finding) => (
                      <li key={finding.id} id={`finding-${finding.id}`}>
                        <p>{finding.message}</p>
                        <strong>
                          {finding.status === "resolved"
                            ? "Next step"
                            : "Action required"}
                        </strong>
                        <p>{finding.recommendedAction}</p>
                        <span>
                          {finding.status === "resolved"
                            ? "Resolved"
                            : finding.uncertainty === "conflicting"
                              ? "Conflicting information"
                              : finding.uncertainty === "estimated"
                                ? "Estimate · verify with people"
                                : "Information still needed"}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>{noFindingExplanation(room, category, state.label)}</p>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}
