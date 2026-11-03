import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useReducedMotion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  Play,
  FlaskConical,
  CircleAlert,
  ClipboardList,
  Users,
  ShieldCheck,
  Activity,
  LockKeyhole,
  ChevronDown,
  Home,
  CalendarDays,
  Layers,
} from "lucide-react";
import { Wordmark } from "../components";
import { Avatar, Mascot } from "../Mascot";
import {
  validateDashboardAction,
  type DashboardAction,
  type DashboardSnapshot,
} from "../../shared/dashboard";
import { ReadinessPanel } from "./ReadinessPanel";
import {
  ActivityPanel,
  DecisionCards,
  ParticipantsPanel,
  PlanPanel,
  ProgressPanel,
  ResponsesPanel,
  LocationPanel,
} from "./PlanningPanels";
import { SpeakerPanel } from "./SpeakerPanel";
import { RealityChecks } from "./RealityChecks";
import { acceptDashboardUpdate } from "./model";
import {
  fetchPreview,
  scenarios,
  viewers,
  type PreviewFrame,
  type ScenarioId,
  type ViewerId,
} from "./api";
import "./dashboard.css";

const sections = [
  { id: "plan", label: "Plan", icon: ClipboardList },
  { id: "people", label: "People", icon: Users },
  { id: "issues", label: "Issues", icon: ShieldCheck },
  { id: "activity", label: "Activity", icon: Activity },
] as const;
type SectionId = (typeof sections)[number]["id"];

function MobileTabs({
  active,
  onChange,
}: {
  active: SectionId;
  onChange: (section: SectionId) => void;
}) {
  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % sections.length
        : event.key === "ArrowLeft"
          ? (index + sections.length - 1) % sections.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? sections.length - 1
              : -1;
    if (next === -1) return;
    event.preventDefault();
    onChange(sections[next].id);
    document.getElementById(`dashboard-tab-${sections[next].id}`)?.focus();
  }
  return (
    <nav className="dashboard-mobile-tabs" aria-label="Planning sections">
      <div role="tablist" aria-label="Dashboard sections">
        {sections.map((section, index) => (
          <button
            id={`dashboard-tab-${section.id}`}
            key={section.id}
            type="button"
            role="tab"
            aria-selected={active === section.id}
            aria-controls={`dashboard-section-${section.id}`}
            tabIndex={active === section.id ? 0 : -1}
            onClick={() => onChange(section.id)}
            onKeyDown={(event) => move(event, index)}
          >
            <section.icon size={17} aria-hidden="true" />
            {section.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

export function PlanningDashboard({
  snapshot,
  onAction,
  busy = false,
  notice = "",
  activeSection,
  onSectionChange,
}: {
  snapshot: DashboardSnapshot;
  onAction?: (action: DashboardAction) => void;
  busy?: boolean;
  notice?: string;
  activeSection: SectionId;
  onSectionChange: (section: SectionId) => void;
}) {
  const reduced = useReducedMotion();
  const review = (findingId: string) => {
    onSectionChange("issues");
    requestAnimationFrame(() => {
      const finding = document.getElementById(`finding-${findingId}`);
      const details = finding?.closest("details");
      if (details) {
        details.open = true;
        details.querySelector("summary")?.focus();
        details.scrollIntoView({
          block: "center",
          behavior: reduced ? "instant" : "smooth",
        });
      }
    });
  };
  return (
    <>
      <div className="dashboard-action-notice" role="status" aria-live="polite">
        {notice}
      </div>
      <div className="dashboard-grid" data-tab={activeSection} aria-busy={busy}>
        <div className="dashboard-column dashboard-left">
          <div
            className="dashboard-part people-section"
            data-section="people"
            id="dashboard-section-people"
            role="tabpanel"
            aria-labelledby="dashboard-tab-people"
          >
            <ParticipantsPanel snapshot={snapshot} />
            <ResponsesPanel snapshot={snapshot} />
          </div>
          <div
            className="dashboard-part"
            data-section="activity"
            id="dashboard-section-activity"
            role="tabpanel"
            aria-labelledby="dashboard-tab-activity"
          >
            <ActivityPanel snapshot={snapshot} />
          </div>
        </div>
        <div className="dashboard-column dashboard-center">
          <ReadinessPanel snapshot={snapshot} />
          <div
            className="dashboard-part plan-section"
            data-section="plan"
            id="dashboard-section-plan"
            role="tabpanel"
            aria-labelledby="dashboard-tab-plan"
          >
            <div className="mobile-plan">
              <PlanPanel snapshot={snapshot} />
            </div>
            <LocationPanel snapshot={snapshot} />
            <DecisionCards
              snapshot={snapshot}
              onAction={onAction}
              busy={busy}
            />
            <ProgressPanel snapshot={snapshot} />
          </div>
        </div>
        <div className="dashboard-column dashboard-right">
          <SpeakerPanel
            key={`${snapshot.room.viewerId}-${snapshot.room.proposalVersion}-${snapshot.room.revision}`}
            snapshot={snapshot}
            onAction={onAction}
            onReview={review}
            busy={busy}
          />
          <div
            className="dashboard-part"
            data-section="issues"
            id="dashboard-section-issues"
            role="tabpanel"
            aria-labelledby="dashboard-tab-issues"
          >
            <RealityChecks room={snapshot.room} />
          </div>
        </div>
        <MobileTabs active={activeSection} onChange={onSectionChange} />
      </div>
    </>
  );
}

function DashboardLoading({ intentional = false }: { intentional?: boolean }) {
  return (
    <div className="dashboard-loading" role="status">
      <Mascot />
      <h2>
        {intentional
          ? "The loading state, previewed."
          : "Opening your planning dashboard…"}
      </h2>
      <p>
        {intentional
          ? "This is an interface preview. No analysis is running."
          : "Loading a synthetic, authorized participant view."}
      </p>
      <div className="dashboard-loading-bars" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      {intentional ? (
        <Link
          className="dashboard-button primary"
          to="/dashboard?scenario=beach"
        >
          Open beach trip preview
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}

function RoomNotConnected() {
  return (
    <div className="room-unavailable">
      <LockKeyhole size={28} aria-hidden="true" />
      <h1>This room needs its secure connection.</h1>
      <p>
        Authenticated room delivery arrives in the collaboration milestone. No
        participant information is loaded here.
      </p>
      <Link to="/dashboard" className="dashboard-button primary">
        Explore the synthetic dashboard
        <ArrowRight size={16} aria-hidden="true" />
      </Link>
    </div>
  );
}

export default function DashboardRoute() {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const rawScenario = params.get("scenario");
  const rawViewer = params.get("viewer");
  const scenario: ScenarioId = scenarios.some((s) => s.id === rawScenario)
    ? (rawScenario as ScenarioId)
    : "hike";
  const viewer: ViewerId = viewers.includes(rawViewer as ViewerId)
    ? (rawViewer as ViewerId)
    : "alex";
  const requestKey = `${scenario}:${viewer}`;
  const [load, setLoad] = useState<{
    key: string;
    snapshot: DashboardSnapshot | null;
    error: string | null;
  }>({ key: "", snapshot: null, error: null });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [frame, setFrame] = useState<PreviewFrame>("initial");
  const [retry, setRetry] = useState(0);
  const [section, setSection] = useState<SectionId>("plan");
  const reduced = useReducedMotion();
  const updateAbort = useRef<AbortController | null>(null);
  const snapshot = load.key === requestKey ? load.snapshot : null;
  const realRoute = location.pathname.startsWith("/rooms/");
  useEffect(() => {
    const controller = new AbortController();
    updateAbort.current?.abort();
    setLoad({ key: requestKey, snapshot: null, error: null });
    setNotice("");
    setFrame("initial");
    setBusy(false);
    setSection("plan");
    if (!realRoute && scenario !== "loading")
      void fetchPreview(scenario, viewer, "initial", controller.signal)
        .then((value) => {
          if (!controller.signal.aborted)
            setLoad({ key: requestKey, snapshot: value, error: null });
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            setLoad({
              key: requestKey,
              snapshot: null,
              error:
                error instanceof Error
                  ? error.message
                  : "The preview could not load.",
            });
        });
    return () => {
      controller.abort();
      updateAbort.current?.abort();
    };
  }, [requestKey, scenario, viewer, retry, realRoute]);
  const change = (nextScenario: ScenarioId, nextViewer: ViewerId) =>
    setParams({ scenario: nextScenario, viewer: nextViewer });
  const advance = async (nextFrame: PreviewFrame) => {
    if (!snapshot || scenario === "loading") return;
    updateAbort.current?.abort();
    const controller = new AbortController();
    updateAbort.current = controller;
    setBusy(true);
    setNotice("");
    try {
      const incoming = await fetchPreview(
        scenario,
        viewer,
        nextFrame,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const accepted = acceptDashboardUpdate(snapshot, incoming);
      if (accepted === snapshot) {
        setNotice("This update is outdated. The current plan was kept.");
        return;
      }
      setLoad({ key: requestKey, snapshot: accepted, error: null });
      setFrame(nextFrame);
      setNotice(
        `Synthetic update loaded. ${accepted.room.readiness?.percentage ?? "Unevaluated"}${accepted.room.readiness ? "% readiness." : "."} Proposal v${accepted.room.proposalVersion}. Earlier approvals were cleared.`,
      );
    } catch {
      if (!controller.signal.aborted)
        setNotice(
          "The update couldn’t load. Your current preview is still here. Try again.",
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  const act = (input: DashboardAction) => {
    if (!snapshot || busy) return;
    try {
      const action = validateDashboardAction(snapshot.room, input);
      if (action.kind === "proposal") {
        void advance(action.optionId === "carpool" ? "carpool" : "revised");
        return;
      }
      setNotice(
        `${action.kind === "information" ? "Answer" : "Choice"} previewed for ${viewer[0].toUpperCase() + viewer.slice(1)} in this page only. Readiness and approvals are unchanged.`,
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "This action is unavailable.",
      );
    }
  };
  const navigateSection = (
    event: MouseEvent<HTMLAnchorElement>,
    target: "plan" | "people",
  ) => {
    event.preventDefault();
    setSection(target);
    requestAnimationFrame(() => {
      const heading = document.getElementById(
        target === "people"
          ? "people-title"
          : window.matchMedia("(min-width: 1101px)").matches
            ? "inline-plan-title"
            : "plan-title",
      );
      if (!heading) return;
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({
        block: "start",
        behavior: reduced ? "instant" : "smooth",
      });
    });
  };
  return (
    <div className="dashboard-shell">
      <header className="dashboard-header">
        <Wordmark />
        <nav aria-label="Workspace">
          <Link to="/">
            <Home size={19} aria-hidden="true" />
            Home
          </Link>
          <Link to="/dashboard" aria-current={!realRoute ? "page" : undefined}>
            <CalendarDays size={19} aria-hidden="true" />
            Planning Rooms
          </Link>
          {!realRoute && snapshot ? (
            <>
              <a
                href="#plan-title"
                onClick={(event) => navigateSection(event, "plan")}
              >
                <Layers size={19} aria-hidden="true" />
                Plan
              </a>
              <a
                href="#people-title"
                onClick={(event) => navigateSection(event, "people")}
              >
                <Users size={19} aria-hidden="true" />
                People
              </a>
            </>
          ) : null}
        </nav>
        <div>
          <Link to="/demos">
            Demos
            <ArrowUpRightIcon />
          </Link>
          <span
            className="dashboard-viewer-avatar"
            aria-label={`${viewer} synthetic viewer`}
          >
            <Avatar index={viewers.indexOf(viewer)} />
          </span>
        </div>
      </header>
      {realRoute ? (
        <RoomNotConnected />
      ) : (
        <>
          <div className="synthetic-banner">
            <FlaskConical size={15} aria-hidden="true" />
            <strong>Synthetic preview</strong>
            <span>Fictional people & events. No live AI or collaboration.</span>
            <Link to="/demos">
              About the demos
              <ArrowRight size={13} aria-hidden="true" />
            </Link>
          </div>
          <div className="dashboard-content">
            {!snapshot ? (
              <div className="dashboard-title-row">
                <div>
                  <Link to="/demos" className="dashboard-back">
                    <ArrowLeft size={14} aria-hidden="true" />
                    All demos
                  </Link>
                  <h1>
                    {scenario === "loading"
                      ? "A plan taking shape."
                      : "Your planning room."}
                  </h1>
                </div>
                <span className="room-preview-marker">
                  <span />
                  Dashboard preview
                </span>
              </div>
            ) : null}
            <div className="preview-toolbar">
              <div className="preview-select">
                <label htmlFor="dashboard-scenario">Scenario</label>
                <div>
                  <select
                    id="dashboard-scenario"
                    value={scenario}
                    onChange={(event) =>
                      change(event.target.value as ScenarioId, viewer)
                    }
                  >
                    {scenarios.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} aria-hidden="true" />
                </div>
              </div>
              <div className="preview-select">
                <label htmlFor="dashboard-viewer">View as</label>
                <div>
                  <select
                    id="dashboard-viewer"
                    value={viewer}
                    onChange={(event) =>
                      change(scenario, event.target.value as ViewerId)
                    }
                  >
                    {viewers.map((v) => (
                      <option key={v} value={v}>
                        {v[0].toUpperCase() + v.slice(1)}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} aria-hidden="true" />
                </div>
              </div>
              <span className="preview-toolbar-spacer" />
              <button
                className="dashboard-button subtle"
                type="button"
                onClick={() => setRetry((value) => value + 1)}
                disabled={busy}
              >
                <RotateCcw size={14} aria-hidden="true" />
                Reset preview
              </button>
              <button
                className="dashboard-button primary"
                type="button"
                disabled={
                  !snapshot ||
                  busy ||
                  (scenario !== "beach" && scenario !== "hike") ||
                  frame === "revised" ||
                  frame === "carpool"
                }
                onClick={() =>
                  void advance(frame === "initial" ? "updated" : "revised")
                }
              >
                <Play size={13} aria-hidden="true" />
                {busy ? "Loading update…" : "Next preview update"}
              </button>
            </div>
            {snapshot ? (
              <PlanningDashboard
                key={requestKey}
                snapshot={snapshot}
                onAction={act}
                busy={busy}
                notice={notice}
                activeSection={section}
                onSectionChange={setSection}
              />
            ) : load.key === requestKey && load.error ? (
              <div className="dashboard-error" role="alert">
                <CircleAlert size={28} aria-hidden="true" />
                <h2>The preview couldn’t load.</h2>
                <p>{load.error}</p>
                <button
                  type="button"
                  className="dashboard-button primary"
                  onClick={() => setRetry((value) => value + 1)}
                >
                  Try again
                  <RotateCcw size={15} aria-hidden="true" />
                </button>
              </div>
            ) : (
              <DashboardLoading intentional={scenario === "loading"} />
            )}
            <footer className="dashboard-footer">
              <span>Made for the way people actually plan.</span>
              <span>Stage A · Synthetic dashboard · No live AI requests</span>
            </footer>
          </div>
        </>
      )}
    </div>
  );
}

function ArrowUpRightIcon() {
  return (
    <ArrowRight
      size={13}
      aria-hidden="true"
      style={{ transform: "rotate(-40deg)" }}
    />
  );
}
