import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useReducedMotion } from "motion/react";
import {
  Activity,
  ArrowRight,
  CalendarDays,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  ClipboardList,
  FlaskConical,
  Home,
  LayoutDashboard,
  Layers,
  LockKeyhole,
  Play,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Wordmark } from "../components";
import { Avatar, Mascot } from "../Mascot";
import {
  validateDashboardAction,
  type DashboardAction,
  type DashboardSnapshot,
} from "../../shared/dashboard";
import type { SubmitPlanningMessage } from "../../shared/planning-message";
import { ReadinessPanel } from "./ReadinessPanel";
import {
  ActivityPanel,
  DecisionCards,
  LocationPanel,
  ParticipantsPanel,
  PlanPanel,
  ProgressPanel,
  ResponsesPanel,
} from "./PlanningPanels";
import { SpeakerPanel } from "./SpeakerPanel";
import { RealityChecks } from "./RealityChecks";
import { MessageComposer, type MessageComposerHandle } from "./MessageComposer";
import { PreviewContributions } from "./PreviewContributions";
import {
  createPreviewInteractions,
  type ContributionView,
} from "./preview-interactions";
import { currentQuestion, questionQuickReplies } from "./composer-model";
import {
  categoryPresentation,
  responseCount,
} from "./model";
import { Categories } from "../../server/src/agents/contracts";
import {
  fetchPreview,
  previewFrames,
  publicDemoScenarios,
  scenarios,
  technicalScenarios,
  viewers,
  type PreviewFrame,
  type ScenarioId,
  type ViewerId,
} from "./api";
import "./dashboard.css";
import "./dashboard-refinement.css";

const sections = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "plan", label: "Plan", icon: ClipboardList },
  { id: "people", label: "People", icon: Users },
  { id: "issues", label: "Issues", icon: ShieldCheck },
  { id: "activity", label: "Activity", icon: Activity },
] as const;
export type SectionId = (typeof sections)[number]["id"];
const compactQuery = "(max-width: 1149px)";
function subscribeViewport(callback: () => void) {
  const query = window.matchMedia(compactQuery);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
function compactViewport() {
  return (
    typeof window !== "undefined" && window.matchMedia(compactQuery).matches
  );
}

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
    if (next < 0) return;
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
            <span>{section.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

function MobileIdentity({ snapshot, live = false, titleActions, titleStatus }: {
  snapshot: DashboardSnapshot;
  live?: boolean;
  titleActions?: ReactNode;
  titleStatus?: ReactNode;
}) {
  const responses = responseCount(snapshot);
  return (
    <div className="mobile-room-identity">
      {live ? <div className="mobile-event-heading"><h1>{snapshot.room.proposal.label}</h1>{titleActions}</div> : <h1>{snapshot.room.proposal.label}</h1>}
      {!live ? titleStatus : null}
      <div className="mobile-member-strip">
        <span className="identity-avatars" aria-hidden="true">
          {snapshot.room.participants.slice(0, 3).map((person, index) => (
            <Avatar key={person.id} index={index} />
          ))}
        </span>
        <span>{snapshot.room.participants.length} room members</span>
        {!live ? <><span>·</span>
        <span>
          {responses === null
            ? "Responses unknown"
            : `${responses}/${snapshot.room.participants.length} responded`}
        </span></> : null}
        <span className="identity-approvals">
          {snapshot.room.approvalCount} approved
        </span>
      </div>
    </div>
  );
}

function RealityOverview({
  snapshot,
  onOpen,
}: {
  snapshot: DashboardSnapshot;
  onOpen: () => void;
}) {
  const states = Categories.map((category) => ({
    category,
    ...categoryPresentation(snapshot.room, category),
  }));
  const blocked = states.filter((state) => state.label === "Blocked").length;
  const attention = states.filter(
    (state) => state.label === "Needs attention",
  ).length;
  return (
    <button
      type="button"
      className="reality-overview dashboard-panel"
      onClick={onOpen}
    >
      <span>
        <ShieldCheck size={17} aria-hidden="true" />
        <strong>Reality Check</strong>
        <span>
          {blocked
            ? `${blocked} blocked`
            : attention
              ? `${attention} need attention`
              : snapshot.room.readiness
                ? "Review the six checks"
                : "Not evaluated"}
        </span>
      </span>
      <span className="reality-overview-categories">
        {states.map((state) => (
          <span key={state.category} className={`tone-${state.tone}`}>
            <i aria-hidden="true" />
            {state.category.replace(" Check", "")}
          </span>
        ))}
      </span>
    </button>
  );
}

function PlanningDetails({
  snapshot,
  onAction,
  busy,
}: {
  snapshot: DashboardSnapshot;
  onAction?: (action: DashboardAction) => void;
  busy: boolean;
}) {
  return (
    <div className="plan-detail-content">
      <LocationPanel snapshot={snapshot} />
      <DecisionCards snapshot={snapshot} onAction={onAction} busy={busy} />
      <ProgressPanel snapshot={snapshot} />
    </div>
  );
}

export function PlanningDashboard({
  snapshot,
  onAction,
  busy = false,
  notice = "",
  activeSection,
  onSectionChange,
  onFocusComposer,
  contributions,
  contributionMode = "preview",
  speakerResponseKey = "",
  titleActions,
  titleStatus,
  agentActivity = "idle",
  recorded = false,
}: {
  snapshot: DashboardSnapshot;
  onAction?: (action: DashboardAction) => void;
  busy?: boolean;
  notice?: string;
  activeSection: SectionId;
  onSectionChange: (section: SectionId) => void;
  onFocusComposer: () => void;
  contributions: ContributionView[];
  contributionMode?: "preview" | "room";
  speakerResponseKey?: string;
  titleActions?: ReactNode;
  titleStatus?: ReactNode;
  agentActivity?: "active" | "queued" | "idle";
  recorded?: boolean;
}) {
  const compact = useSyncExternalStore(
    subscribeViewport,
    compactViewport,
    () => false,
  );
  const ownLatest = contributions
    .filter((entry) => entry.participantId === snapshot.room.viewerId)
    .at(-1);
  return (
    <>
      <div className="dashboard-action-notice" role="status" aria-live="polite">
        {notice}
      </div>
      {compact ? (
        <>
          <MobileIdentity snapshot={snapshot} live={contributionMode === "room"} titleActions={titleActions} titleStatus={titleStatus} />
          <MobileTabs active={activeSection} onChange={onSectionChange} />
          <div
            className="mobile-dashboard-panel"
            id={`dashboard-section-${activeSection}`}
            role="tabpanel"
            aria-labelledby={`dashboard-tab-${activeSection}`}
          >
            {activeSection === "overview" ? (
              <div className="mobile-overview">
                <ReadinessPanel snapshot={snapshot} compact titleStatus={contributionMode === "room" || recorded ? titleStatus : undefined} agentActivity={contributionMode === "room" || recorded ? agentActivity : undefined} />
                <div className="overview-companion">
                  <SpeakerPanel
                    snapshot={snapshot}
                    onRespond={onFocusComposer}
                    reactionKey={contributionMode === "room" ? "" : ownLatest?.id}
                    speakerResponseKey={speakerResponseKey}
                  />
                  <RealityOverview
                    snapshot={snapshot}
                    onOpen={() => onSectionChange("issues")}
                  />
                  <PreviewContributions contributions={contributions} latest mode={contributionMode} />
                </div>
              </div>
            ) : null}
            {activeSection === "plan" ? (
              <div className="mobile-plan-content">
                <PlanPanel snapshot={snapshot} />
                <PlanningDetails
                  snapshot={snapshot}
                  onAction={onAction}
                  busy={busy}
                />
              </div>
            ) : null}
            {activeSection === "people" ? (
              <div className="people-section">
                <ParticipantsPanel snapshot={snapshot} compact={contributionMode === "room"} />
                {contributionMode === "room" ? null : <ResponsesPanel snapshot={snapshot} />}
              </div>
            ) : null}
            {activeSection === "issues" ? (
              <RealityChecks room={snapshot.room} />
            ) : null}
            {activeSection === "activity" ? (
              <>
                <PreviewContributions contributions={contributions} mode={contributionMode} />
                <ActivityPanel snapshot={snapshot} full />
                <ProgressPanel snapshot={snapshot} />
              </>
            ) : null}
          </div>
        </>
      ) : (
        <div className="dashboard-grid" aria-busy={busy}>
          <div className="dashboard-column dashboard-left">
            <div className="people-section">
              <ParticipantsPanel snapshot={snapshot} compact={contributionMode === "room"} />
              {contributionMode === "room" ? null : <ResponsesPanel snapshot={snapshot} />}
            </div>
            <div className="desktop-activity">
              <PreviewContributions contributions={contributions} mode={contributionMode} />
              <ActivityPanel snapshot={snapshot} />
            </div>
          </div>
          <div className="dashboard-column dashboard-center">
            <ReadinessPanel snapshot={snapshot} titleActions={titleActions} titleStatus={titleStatus} agentActivity={contributionMode === "room" || recorded ? agentActivity : undefined} />
            <details className="advanced-plan dashboard-panel">
              <summary>
                <Layers size={16} aria-hidden="true" />
                <span>Plan details & decisions</span>
                <span>
                  {snapshot.room.options.length
                    ? `${snapshot.room.options.length} options`
                    : "History"}
                </span>
              </summary>
              <PlanningDetails
                snapshot={snapshot}
                onAction={onAction}
                busy={busy}
              />
            </details>
          </div>
          <div className="dashboard-column dashboard-right">
            <SpeakerPanel
              snapshot={snapshot}
              onRespond={onFocusComposer}
              reactionKey={contributionMode === "room" ? "" : ownLatest?.id}
              speakerResponseKey={speakerResponseKey}
            />
            <RealityChecks room={snapshot.room} />
          </div>
        </div>
      )}
    </>
  );
}

function DashboardLoading({ intentional = false }: { intentional?: boolean }) {
  return (
    <div className="dashboard-loading" role="status">
      <Mascot />
      <h1>
        {intentional
          ? "The loading state, previewed."
          : "Opening the planning preview…"}
      </h1>
      <p>
        {intentional
          ? "This is an interface preview. No analysis is running."
          : "Loading this fictional participant’s offline view."}
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
          Open beach preview
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
      </Link>
    </div>
  );
}

export default function DashboardRoute() {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const scenario = (
    scenarios.some((item) => item.id === params.get("scenario"))
      ? params.get("scenario")
      : "beach"
  ) as ScenarioId;
  const viewer = (
    viewers.includes(params.get("viewer") as ViewerId)
      ? params.get("viewer")
      : "alex"
  ) as ViewerId;
  const rawFrame = params.get("frame") as PreviewFrame | null;
  const frame: PreviewFrame = previewFrames.includes(rawFrame as PreviewFrame)
    ? (rawFrame as PreviewFrame)
    : "initial";
  const requestKey = scenario + ":" + viewer + ":" + frame;
  const [load, setLoad] = useState<{
    key: string;
    snapshot: DashboardSnapshot | null;
    error: string | null;
  }>({ key: "", snapshot: null, error: null });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  const [section, setSection] = useState<SectionId>("overview");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [composerHeight, setComposerHeight] = useState(162);
  const [composerInset, setComposerInset] = useState(0);
  const [interactionsVersion, setInteractionsVersion] = useState(0);
  const [interactions] = useState(() => createPreviewInteractions());
  const composer = useRef<MessageComposerHandle>(null);
  const currentView = useRef<DashboardSnapshot | null>(null);
  const updateAbort = useRef<AbortController | null>(null);
  const reduced = useReducedMotion();
  const baseSnapshot = load.key === requestKey ? load.snapshot : null;
  const projected = useMemo(
    () => (baseSnapshot ? interactions.project(baseSnapshot) : null),
    [baseSnapshot, interactions, interactionsVersion],
  );
  const snapshot = projected?.snapshot ?? null;
  const realRoute = location.pathname.startsWith("/rooms/");
  const question = snapshot ? currentQuestion(snapshot.room) : undefined;
  const replies = useMemo(() => questionQuickReplies(question), [question]);
  useLayoutEffect(() => {
    currentView.current = snapshot;
  }, [snapshot]);
  useEffect(() => {
    const controller = new AbortController();
    updateAbort.current?.abort();
    updateAbort.current = controller;
    setLoad({ key: requestKey, snapshot: null, error: null });
    setNotice("");
    setBusy(true);
    setSection("overview");
    if (!realRoute && scenario !== "loading")
      void fetchPreview(scenario, viewer, frame, controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) {
            setLoad({ key: requestKey, snapshot: value, error: null });
            setNotice(
              value.room.readiness?.status === "ready_for_human_review"
                ? "This fictional proposal is ready for human review. Participant approvals remain separate."
                : "This is a fictional, schema-validated preview. No live AI ran.",
            );
          }
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setLoad({
              key: requestKey,
              snapshot: null,
              error: "The dashboard preview couldn’t load. Try again.",
            });
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    else setBusy(false);
    return () => {
      controller.abort();
      updateAbort.current?.abort();
    };
  }, [requestKey, scenario, viewer, frame, retry, realRoute]);
  const submit = useCallback<SubmitPlanningMessage>(
    async (input, signal) => {
      const receipt = await interactions.submit(
        input,
        () => currentView.current,
        signal,
      );
      if (!signal.aborted) {
        setInteractionsVersion((version) => version + 1);
        setNotice(
          "Simulated response recorded for this participant. The preview does not run another analysis or change readiness.",
        );
      }
      return receipt;
    },
    [interactions],
  );
  const reset = () => {
    if (baseSnapshot) interactions.reset(baseSnapshot.room.roomId);
    setInteractionsVersion((version) => version + 1);
    setNotice("The fictional scenario was reset to its starting point.");
    if (frame === "initial") setRetry((value) => value + 1);
    else setParams({ scenario, viewer, frame: "initial" }, { replace: true });
  };
  function advance(nextFrame: PreviewFrame) {
    if (!snapshot || scenario === "loading") return;
    updateAbort.current?.abort();
    setBusy(true);
    setNotice("");
    setParams({ scenario, viewer, frame: nextFrame });
  }
  function approveCurrent() {
    if (!snapshot || !activeViewer) return;
    try {
      interactions.approve(snapshot);
      setInteractionsVersion((version) => version + 1);
      setNotice(
        "Simulated approval recorded for " + activeViewer.name +
          " on proposal v" + snapshot.room.proposalVersion +
          ". No live room state changed.",
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "This preview approval could not be recorded.");
    }
  }
  function act(input: DashboardAction) {
    if (!snapshot || busy) return;
    try {
      const action = validateDashboardAction(snapshot.room, input);
      if (action.kind === "proposal") {
        const choiceIndex = snapshot.room.options.findIndex(
          (option) => option.id === action.optionId,
        );
        advance(choiceIndex === 1 ? "carpool" : "revised");
      }
    } catch {
      setNotice(
        "This decision changed. Review the current proposal before responding.",
      );
    }
  }
  function navigate(event: MouseEvent<HTMLAnchorElement>, target: SectionId) {
    event.preventDefault();
    setSection(target);
    requestAnimationFrame(() => {
      const heading = document.getElementById(
        target === "people"
          ? "people-title"
          : target === "plan"
            ? compactViewport()
              ? "plan-title"
              : "inline-plan-title"
            : "readiness-title",
      );
      if (!heading) return;
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({
        block: "start",
        behavior: reduced ? "instant" : "smooth",
      });
    });
  }
  function reviewFinding(findingId: string) {
    setSection("issues");
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
  }
  const activeViewer = snapshot?.room.participants.find(
    (person) => person.id === snapshot.room.viewerId,
  );
  const activeViewerName = activeViewer?.name ?? viewer;
  const frameTitles: Record<PreviewFrame, string> = {
    initial: "Initial discussion · conflicts identified",
    updated: "Questions answered · checks recalculated",
    revised: "Revised proposal · ready for review",
    review: "Participant review · approvals are explicit",
    carpool: "Alternative proposal · one follow-up remains",
  };
  const canApprove = Boolean(
    snapshot &&
      frame === "review" &&
      snapshot.room.analysisCurrent &&
      snapshot.room.finalEvaluationAvailable &&
      snapshot.room.loopState === "COMPLETED" &&
      snapshot.room.readiness?.status === "ready_for_human_review" &&
      activeViewer &&
      !activeViewer.approved,
  );
  return (
    <div
      className="dashboard-shell dashboard-refined"
      style={
        {
          "--composer-height": `${composerHeight}px`,
          "--composer-inset": `${composerInset}px`,
        } as CSSProperties
      }
    >
      <header className="dashboard-header">
        <Wordmark />
        <nav aria-label="Workspace">
          <Link to="/">
            <Home size={18} aria-hidden="true" />
            Home
          </Link>
          <Link to="/dashboard" aria-current={!realRoute ? "page" : undefined}>
            <CalendarDays size={18} aria-hidden="true" />
            Planning Rooms
          </Link>
          {snapshot && !realRoute ? (
            <>
              <a
                href="#plan-title"
                onClick={(event) => navigate(event, "plan")}
              >
                <Layers size={18} aria-hidden="true" />
                Plan
              </a>
              <a
                href="#people-title"
                onClick={(event) => navigate(event, "people")}
              >
                <Users size={18} aria-hidden="true" />
                People
              </a>
            </>
          ) : null}
        </nav>
        <div>
          <Link to="/demos">
            Demos
          </Link>
          <span
            className="dashboard-viewer-avatar"
            aria-label={activeViewerName + " synthetic viewer"}
          >
            <Avatar index={viewers.indexOf(viewer)} />
          </span>
        </div>
      </header>
      {realRoute ? (
        <RoomNotConnected />
      ) : (
        <div className="dashboard-content">
          <div
            className="preview-toolbar compact-preview-toolbar"
            data-expanded={settingsOpen}
          >
            <span className="synthetic-preview-label">
              <FlaskConical size={14} aria-hidden="true" />
              <strong>Synthetic preview</strong>
              <span>No live AI</span>
            </span>
            <button
              type="button"
              className="preview-settings-toggle"
              aria-label="Preview controls"
              aria-expanded={settingsOpen}
              aria-controls="preview-control-fields"
              onClick={() => setSettingsOpen((open) => !open)}
            >
              <Settings2 size={16} aria-hidden="true" />
              {activeViewerName}
              <ChevronDown size={13} aria-hidden="true" />
            </button>
            <div className="preview-control-fields" id="preview-control-fields">
              <div className="preview-select">
                <label htmlFor="dashboard-scenario">Scenario</label>
                <div>
                  <select
                    id="dashboard-scenario"
                    value={scenario}
                    onChange={(event) =>
                      setParams({ scenario: event.target.value, viewer, frame: "initial" })
                    }
                  >
                    <optgroup label="Planning demos">
                      {publicDemoScenarios.map((item) => (
                        <option key={item.id} value={item.id}>{item.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Technical fixtures">
                      {technicalScenarios.map((item) => (
                        <option key={item.id} value={item.id}>{item.label}</option>
                      ))}
                    </optgroup>
                  </select>
                  <ChevronDown size={13} aria-hidden="true" />
                </div>
              </div>
              <div className="preview-select">
                <label htmlFor="dashboard-viewer">View as</label>
                <div>
                  <select
                    id="dashboard-viewer"
                    value={viewer}
                    onChange={(event) =>
                      setParams({ scenario, viewer: event.target.value, frame })
                    }
                  >
                    {viewers.map((id) => (
                      <option key={id} value={id}>
                        {snapshot?.room.participants.find((person) => person.id === id)?.name ?? id}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={13} aria-hidden="true" />
                </div>
              </div>
              <span className="preview-toolbar-spacer" />
              <button
                type="button"
                className="dashboard-button subtle"
                onClick={reset}
                disabled={busy}
                aria-label="Reset preview"
              >
                <RotateCcw size={14} aria-hidden="true" />
                <span>Reset demo</span>
              </button>
              {frame === "review" ? (
                <button
                  type="button"
                  className="dashboard-button primary"
                  onClick={approveCurrent}
                  disabled={!canApprove || busy}
                  title={
                    canApprove
                      ? "Record a simulated approval for this participant and proposal version."
                      : activeViewer?.approved
                        ? "This participant has approved this proposal version."
                        : "Approval opens when this proposal reaches participant review and passes the checks."
                  }
                >
                  <CircleCheck size={14} aria-hidden="true" />
                  {activeViewer?.approved ? "Approved in preview" : "Approve as " + activeViewerName}
                </button>
              ) : null}
              {frame === "initial" || frame === "updated" || frame === "revised" ? (
                <button
                  type="button"
                  className="dashboard-button primary"
                  disabled={!snapshot || busy || scenario === "loading"}
                  onClick={() =>
                    advance(frame === "initial" ? "updated" : frame === "updated" ? "revised" : "review")
                  }
                >
                  <Play size={12} aria-hidden="true" />
                  {busy
                    ? "Loading fixture…"
                    : frame === "initial"
                      ? "Continue to answered questions"
                      : frame === "updated"
                        ? "Continue to revised proposal"
                        : "Continue to participant review"}
                </button>
              ) : frame === "review" ? (
                <button
                  type="button"
                  className="dashboard-button subtle"
                  disabled={!snapshot || busy}
                  onClick={() => advance("carpool")}
                >
                  Compare an alternative
                  <ArrowRight size={14} aria-hidden="true" />
                </button>
              ) : (
                <span className="preview-alternative-note">Alternative selected · reset to replay the journey</span>
              )}
            </div>
          </div>
          <div className="preview-stage-summary" aria-live="polite">
            <span><strong>{frameTitles[frame]}</strong></span>
            <span>Authored offline fixture · No login, API key, or model request</span>
          </div>
          {snapshot ? (
            <PlanningDashboard
              snapshot={snapshot}
              onAction={act}
              busy={busy}
              notice={notice}
              activeSection={section}
              onSectionChange={setSection}
              onFocusComposer={() => composer.current?.focus()}
              contributions={projected?.contributions ?? []}
            />
          ) : load.key === requestKey && load.error ? (
            <div className="dashboard-error" role="alert">
              <CircleAlert size={28} aria-hidden="true" />
              <h1>The preview couldn’t load.</h1>
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
          {snapshot && activeViewer ? (
            <MessageComposer
              key={`${snapshot.room.roomId}-${snapshot.room.viewerId}`}
              ref={composer}
              roomId={snapshot.room.roomId}
              viewer={activeViewer}
              revision={snapshot.room.revision}
              proposalVersion={snapshot.room.proposalVersion}
              question={question}
              replies={replies}
              allowedVisibilities={["private", "group"]}
              onSubmit={submit}
              onReview={reviewFinding}
              onHeightChange={setComposerHeight}
              onBottomInsetChange={setComposerInset}
              disabled={busy}
              disabledReason="Wait for the preview update to finish before sending."
              mode="preview"
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
