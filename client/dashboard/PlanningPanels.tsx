import { useId, useState } from "react";
import {
  CalendarDays,
  Clock3,
  MapPin,
  Wallet,
  CarFront,
  Backpack,
  ListChecks,
  Check,
  UserPlus,
  LockKeyhole,
  Users,
  MessageCircle,
  Sparkles,
  CircleCheck,
  ThumbsUp,
  GitBranch,
  Activity,
  ChevronRight,
  CircleAlert,
} from "lucide-react";
import { Avatar } from "../Mascot";
import type {
  DashboardAction,
  DashboardActivity,
  DashboardSnapshot,
} from "../../shared/dashboard";
import { formatTime, responseCount } from "./model";

export function ParticipantsPanel({
  snapshot,
}: {
  snapshot: DashboardSnapshot;
}) {
  const { room } = snapshot;
  const invitationId = useId();
  const [invitationOpen, setInvitationOpen] = useState(false);
  return (
    <section
      className="people-panel dashboard-panel"
      aria-labelledby="people-title"
    >
      <div className="panel-heading">
        <h2 id="people-title">
          Participants <span>({room.participants.length})</span>
        </h2>
        <button
          className="people-invite-link"
          type="button"
          aria-expanded={invitationOpen}
          aria-controls={invitationId}
          onClick={() => setInvitationOpen((open) => !open)}
        >
          <UserPlus size={15} aria-hidden="true" />
          Invite
        </button>
      </div>
      <ul className="participant-list">
        {room.participants.map((person, index) => {
          const response = snapshot.responses.find(
            (r) =>
              r.participantId === person.id &&
              r.proposalVersion === room.proposalVersion,
          );
          return (
            <li key={person.id}>
              <Avatar index={index} />
              <div>
                <span className="participant-name">
                  {person.name}
                  {person.id === room.viewerId ? (
                    <span className="you-label">You</span>
                  ) : null}
                </span>
                <span className="participant-response">
                  {snapshot.responseTracking === "unavailable"
                    ? "Response not recorded"
                    : response?.responded
                      ? "Responded"
                      : "Awaiting response"}
                </span>
              </div>
              <span
                className={
                  person.approved
                    ? "participant-approved"
                    : "participant-waiting"
                }
                aria-label={
                  person.approved
                    ? "Approved the current plan"
                    : "Has not approved the current plan"
                }
              >
                {person.approved ? (
                  <Check size={15} aria-hidden="true" />
                ) : (
                  <span />
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <div
        className="invitation-preview"
        id={invitationId}
        hidden={!invitationOpen}
      >
        <strong>Invitations arrive with real rooms.</strong>
        <p>
          This synthetic room has no shareable invitation or recovery
          credentials.
        </p>
      </div>
    </section>
  );
}

export function ResponsesPanel({ snapshot }: { snapshot: DashboardSnapshot }) {
  const count = responseCount(snapshot);
  const total = snapshot.room.participants.length;
  return (
    <section
      className="responses-panel dashboard-panel"
      aria-labelledby="responses-title"
    >
      <div className="responses-heading">
        <span>
          <Users size={23} aria-hidden="true" />
        </span>
        <div>
          <h2 id="responses-title">
            {count === null
              ? "Responses unavailable"
              : `${count}/${total} Responded`}
          </h2>
        </div>
      </div>
      {count !== null ? (
        <>
          <div className="response-progress-label">
            <span>Response rate</span>
            <span>{Math.round((count / Math.max(total, 1)) * 100)}%</span>
          </div>
          <progress
            max={Math.max(total, 1)}
            value={count}
            aria-label={`${count} of ${total} people responded`}
          />
        </>
      ) : null}
      <div className="response-approval">
        <ThumbsUp size={14} aria-hidden="true" />
        <span>
          {snapshot.room.approvalCount}/{total} approved
        </span>
      </div>
    </section>
  );
}

const eventIcons = {
  participant_joined: Users,
  participant_responded: MessageCircle,
  finding_detected: Sparkles,
  constraint_confirmed: Check,
  proposal_revised: GitBranch,
  question_asked: MessageCircle,
  issue_resolved: CircleCheck,
  readiness_changed: Activity,
  participant_approved: ThumbsUp,
  analysis_started: Activity,
  analysis_completed: Check,
  analysis_blocked: CircleAlert,
};
function ActivityRow({ event }: { event: DashboardActivity }) {
  const Icon = eventIcons[event.kind] ?? Activity;
  return (
    <li>
      <span className={`event-icon event-${event.kind}`}>
        <Icon size={14} aria-hidden="true" />
      </span>
      <div>
        <p>{event.summary}</p>
        <time dateTime={event.occurredAt}>
          {formatTime(event.occurredAt)}
        </time>
      </div>
    </li>
  );
}
export function ActivityPanel({
  snapshot,
  full = false,
}: {
  snapshot: DashboardSnapshot;
  full?: boolean;
}) {
  const events = [...snapshot.activity].reverse();
  return (
    <section
      className="activity-panel dashboard-panel"
      aria-labelledby="activity-title"
    >
      <div className="panel-heading">
        <h2 id="activity-title">The plan in motion</h2>
        <span className="activity-indicator">
          <span />
          {snapshot.source === "synthetic" ? "Preview" : "Recorded"}
        </span>
      </div>
      {!events.length ? (
        <p className="panel-empty">The story starts with your first detail.</p>
      ) : (
        <>
          <ol className="activity-list">
            {events.slice(0, full ? 100 : 3).map((event) => (
              <ActivityRow event={event} key={event.id} />
            ))}
          </ol>
          {!full && events.length > 3 ? (
            <details className="earlier-activity">
              <summary>
                Earlier activity
              </summary>
              <ol className="activity-list">
                {events.slice(3).map((event) => (
                  <ActivityRow event={event} key={event.id} />
                ))}
              </ol>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}

export function PlanPanel({
  snapshot,
  compact = false,
}: {
  snapshot: DashboardSnapshot;
  compact?: boolean;
}) {
  const { room } = snapshot;
  const values = room.proposal.values;
  const budget =
    typeof values.cost === "number"
      ? new Intl.NumberFormat("en-PH", {
          style: "currency",
          currency: values.currency === "PHP" ? "PHP" : "USD",
          maximumFractionDigits: 0,
        }).format(values.cost) + " / person"
      : null;
  const rows = [
    { icon: CalendarDays, label: "When", value: values.date },
    { icon: Clock3, label: "Time", value: values.time },
    { icon: MapPin, label: "Where", value: values.location },
    { icon: Wallet, label: "Budget", value: budget },
    {
      icon: values.agenda ? ListChecks : CarFront,
      label: values.agenda ? "Agenda" : "Travel",
      value: values.agenda ?? values.transport,
    },
    { icon: Backpack, label: "Bring along", value: values.preparation },
  ];
  const expectedAttendees = values.expectedAttendees ?? values.attendeeCount;
  if (typeof expectedAttendees === "number")
    rows.push({
      icon: Users,
      label: "Event attendees",
      value: `${expectedAttendees} expected · separate from room members`,
    });
  const heading = compact ? "inline-plan-title" : "plan-title";
  return (
    <section
      className={`plan-panel dashboard-panel${compact ? " compact-plan" : ""}`}
      aria-labelledby={heading}
    >
      <div className="panel-heading">
        <h2 id={heading}>{compact ? "Evolving plan" : "The plan, so far"}</h2>
      </div>
      {!compact ? <p className="plan-subtitle">{room.proposal.label}</p> : null}
      <dl className="plan-details">
        {rows
          .filter(
            (row) =>
              (row.value || !Object.keys(values).length) &&
              (!compact || row.label !== "Bring along"),
          )
          .map(({ icon: Icon, label, value }) => (
            <div key={label}>
              <dt>
                <Icon size={17} aria-hidden="true" />
                {label}
              </dt>
              <dd>
                {typeof value === "string" || typeof value === "number"
                  ? value
                  : "To be confirmed"}
              </dd>
            </div>
          ))}
      </dl>
      <div className="plan-approval">
        <span
          className={room.approved ? "approval-complete" : "approval-pending"}
        >
          <ThumbsUp size={15} aria-hidden="true" />
          {room.approvalCount} of {room.participants.length} approved
        </span>
        {!compact ? (
          <span>
            {room.approved
              ? "Everyone has approved"
              : "Still open for discussion"}
          </span>
        ) : null}
      </div>
    </section>
  );
}

export function LocationPanel({ snapshot }: { snapshot: DashboardSnapshot }) {
  const location = snapshot.room.proposal.values.location;
  if (
    typeof location !== "string" ||
    snapshot.room.eventType === "Project kickoff"
  )
    return null;
  return (
    <section
      className="location-panel dashboard-panel"
      aria-labelledby="location-title"
    >
      <div className="panel-heading">
        <h2 id="location-title">
          <MapPin size={18} aria-hidden="true" />
          Location
        </h2>
        <span className="location-source">
          {snapshot.source === "synthetic" ? "Synthetic plan" : "Plan detail"}
        </span>
      </div>
      <div className="location-information">
        <span className="location-pin">
          <MapPin size={25} aria-hidden="true" />
        </span>
        <div>
          <strong>{location}</strong>
          <p>
            {location.includes("to confirm")
              ? "Venue details need confirmation."
              : snapshot.source === "synthetic"
                ? "Fictional planning detail · no route or map verification"
                : "Confirm meeting and access details with the group."}
          </p>
        </div>
      </div>
    </section>
  );
}

export function DecisionCards({
  snapshot,
  onAction,
  busy,
}: {
  snapshot: DashboardSnapshot;
  onAction?: (action: DashboardAction) => void;
  busy: boolean;
}) {
  const { room } = snapshot;
  if (!room.options.length) return null;
  return (
    <section
      className="decisions-panel dashboard-panel"
      aria-labelledby="decisions-title"
    >
      <div className="panel-heading">
        <h2 id="decisions-title">A little common ground</h2>
        <span className="suggestion-label">
          <Sparkles size={13} aria-hidden="true" />
          Suggested compromises
        </span>
      </div>
      <p className="panel-description">A different way to make this work.</p>
      <div className="decision-list">
        {room.options.map((option, index) => (
          <details className="decision-option" key={option.id}>
            <summary>
              <span className="decision-number">{index + 1}</span>
              <span>{option.label}</span>
            </summary>
            <div className="decision-body">
              <dl>
                <div>
                  <dt>Budget</dt>
                  <dd>
                    {typeof option.values.cost === "number"
                      ? `₱${option.values.cost.toLocaleString("en-PH")} / person`
                      : "To confirm"}
                  </dd>
                </div>
                <div>
                  <dt>Time</dt>
                  <dd>{String(option.values.time ?? "To confirm")}</dd>
                </div>
                <div>
                  <dt>Transport</dt>
                  <dd>{String(option.values.transport ?? "To confirm")}</dd>
                </div>
              </dl>
              <button
                type="button"
                className="dashboard-button primary"
                disabled={!onAction || busy}
                onClick={() =>
                  onAction?.({
                    kind: "proposal",
                    optionId: option.id,
                    expectedRevision: room.revision,
                    proposalVersion: room.proposalVersion,
                  })
                }
              >
                {snapshot.source === "synthetic"
                  ? "Preview this revision"
                  : "Propose this revision"}
              </button>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

export function ProgressPanel({ snapshot }: { snapshot: DashboardSnapshot }) {
  return (
    <section
      className="progress-panel dashboard-panel"
      aria-labelledby="progress-title"
    >
      <div className="panel-heading">
        <h2 id="progress-title">How we got here</h2>
        <Activity size={17} aria-hidden="true" />
      </div>
      {!snapshot.history.length ? (
        <p className="panel-empty">
          Your first evaluation will start this history.
        </p>
      ) : (
        <ol className="progress-list">
          {[...snapshot.history].reverse().map((entry) => (
            <li key={entry.id}>
              <span
                className={`history-score tone-${entry.readiness.status === "blocked" ? "red" : entry.readiness.status === "ready_for_human_review" ? "green" : "yellow"}`}
              >
                {entry.readiness.percentage}
                <span>%</span>
              </span>
              <div>
                <p>{entry.explanation}</p>
                <time dateTime={entry.occurredAt}>
                  {formatTime(entry.occurredAt)}
                  {entry.readiness.status === "blocked" ? " · Blocked" : ""}
                </time>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
