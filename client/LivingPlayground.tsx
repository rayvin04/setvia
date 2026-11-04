import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { motion, useReducedMotion } from "motion/react";
import { useLocation } from "react-router-dom";
import {
  Archive,
  ArrowRight,
  Check,
  CircleAlert,
  LoaderCircle,
  Minus,
  Play,
  Plus,
  RotateCw,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import {
  playgroundScenarios,
  type PlaygroundAgent,
  type PlaygroundResult,
} from "../shared/playground";
import { AgentCat } from "./AgentCats";
import { Reveal } from "./MotionUI";
import { ButtonLink } from "./components";
import { playgroundSession, runPlayground } from "./playground-api";
import "./living-playground.css";

const agents = [
  {
    id: "listener",
    name: "Listener",
    title: "Hear me out.",
    purpose: "Turns a thought into a constraint.",
    breed: "The thoughtful Scottish fold",
    idle: "A little context goes a long way.",
    loading: "Listening for what matters…",
  },
  {
    id: "judge",
    name: "Judge",
    title: "Spot the problem.",
    purpose: "Checks a plan against the facts.",
    breed: "The observant silver Persian",
    idle: "Let’s check before we commit.",
    loading: "Checking the evidence…",
  },
  {
    id: "negotiator",
    name: "Negotiator",
    title: "Find common ground.",
    purpose: "Makes room for different needs.",
    breed: "The easygoing ginger tabby",
    idle: "There might be a way for both.",
    loading: "Looking for a workable overlap…",
  },
  {
    id: "speaker",
    name: "Speaker",
    title: "Ask the right question.",
    purpose: "Gives the next step a voice.",
    breed: "Your original Setvia cat",
    idle: "One good question. Less back-and-forth.",
    loading: "Choosing a question & finding the words…",
  },
] as const;
type AgentInfo = (typeof agents)[number];

function Source({ result }: { result: PlaygroundResult }) {
  const Icon = result.source === "cached" ? Archive : Zap;
  return (
    <span className={`playground-source source-${result.source}`}>
      <Icon size={12} aria-hidden="true" />
      {result.source === "cached" ? "Cached response" : "Live response"}
    </span>
  );
}

function AgentCard({
  agent,
  onInspect,
}: {
  agent: AgentInfo;
  onInspect: (result: PlaygroundResult) => void;
}) {
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [result, setResult] = useState<PlaygroundResult>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const reduced = useReducedMotion();
  const scenario = playgroundScenarios[agent.id][scenarioIndex];
  useEffect(() => () => pending.current?.abort(), []);

  async function run() {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setError("");
    setResult(undefined);
    const timeout = setTimeout(() => controller.abort(), 75_000);
    try {
      setResult(
        await runPlayground(
          {
            agent: agent.id,
            scenarioId: scenario.id,
            sessionId: playgroundSession(),
          },
          controller.signal,
        ),
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Please try again in a moment.",
      );
    } finally {
      clearTimeout(timeout);
      pending.current = null;
      setLoading(false);
    }
  }

  return (
    <article
      className={`playground-card playground-${agent.id}${loading ? " is-working" : ""}`}
      aria-labelledby={`${agent.id}-title`}
    >
      <div className="playground-cat-stage">
        <div className="playground-cat-platform" />
        <motion.div
          className="playground-cat-wrap"
          whileHover={
            reduced
              ? undefined
              : { y: -3, rotate: agent.id === "judge" ? -2 : 2 }
          }
          transition={{ type: "spring", bounce: 0, visualDuration: 0.24 }}
        >
          <AgentCat agent={agent.id} />
        </motion.div>
        <span className="playground-role">{agent.name}</span>
      </div>
      <h3 id={`${agent.id}-title`}>{agent.title}</h3>
      <p className="playground-purpose">{agent.purpose}</p>
      <div className="playground-scenario">
        <span>{scenario.title}</span>
        <p>{scenario.text}</p>
      </div>
      <div
        className="playground-answer"
        aria-live="polite"
        aria-atomic="true"
        aria-busy={loading}
      >
        {loading ? (
          <div className="playground-waiting">
            <LoaderCircle size={19} aria-hidden="true" />
            <strong>{agent.loading}</strong>
            <span>
              {agent.id === "speaker"
                ? "Question Strategist → Speaker"
                : `${agent.name} · Muse Spark 1.3`}
            </span>
          </div>
        ) : error ? (
          <div className="playground-error" role="alert">
            <CircleAlert size={18} aria-hidden="true" />
            <p>{error}</p>
          </div>
        ) : result ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: reduced ? 0 : 0.2 }}
          >
            <Source result={result} />
            <dl>
              {result.sections.slice(0, 2).map((section) => (
                <div key={section.label}>
                  <dt>{section.label}</dt>
                  <dd>{section.text}</dd>
                </div>
              ))}
            </dl>
            <button
              className="playground-inspect"
              type="button"
              onClick={() => onInspect(result)}
              aria-controls="playground-inspector"
            >
              Inspect full answer <ArrowRight size={13} aria-hidden="true" />
            </button>
          </motion.div>
        ) : (
          <div className="playground-empty">
            <Sparkles size={17} aria-hidden="true" />
            <p>{agent.idle}</p>
            <span>{scenario.cue}</span>
          </div>
        )}
      </div>
      <div className="playground-card-actions">
        <motion.button
          className="playground-run"
          type="button"
          disabled={loading}
          onClick={run}
          whileTap={reduced ? undefined : { scale: 0.98 }}
          transition={{ type: "spring", bounce: 0, visualDuration: 0.2 }}
        >
          {loading ? (
            <LoaderCircle size={15} aria-hidden="true" />
          ) : (
            <Play size={13} fill="currentColor" aria-hidden="true" />
          )}
          {loading ? "Working…" : error ? "Try again" : `Run ${agent.name}`}
        </motion.button>
        <button
          className="playground-another"
          type="button"
          disabled={loading}
          onClick={() => {
            setScenarioIndex(
              (index) => (index + 1) % playgroundScenarios[agent.id].length,
            );
            setResult(undefined);
            setError("");
          }}
          aria-label={`Try another ${agent.name} scenario`}
        >
          <RotateCw size={13} aria-hidden="true" />
          Try another scenario
        </button>
      </div>
      <span className="playground-breed">{agent.breed}</span>
    </article>
  );
}

function PersonalThought({
  onInspect,
}: {
  onInspect: (result: PlaygroundResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PlaygroundResult>();
  const [length, setLength] = useState(0);
  const form = useRef<HTMLFormElement>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const text = String(
      new FormData(event.currentTarget).get("thought") ?? "",
    ).trim();
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setError("");
    setResult(undefined);
    const timeout = setTimeout(() => controller.abort(), 75_000);
    try {
      const answer = await runPlayground(
        {
          agent: "listener",
          scenarioId: "listener-budget",
          text,
          sessionId: playgroundSession(),
        },
        controller.signal,
      );
      setResult(answer);
      form.current?.reset();
      setLength(0);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Please try again.",
      );
    } finally {
      clearTimeout(timeout);
      pending.current = null;
      setLoading(false);
    }
  }
  return (
    <div className="playground-personal">
      <button
        className="playground-personal-toggle"
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="playground-personal-form"
      >
        <ShieldCheck size={16} aria-hidden="true" />
        <span>
          Something on your mind? <strong>Let Listener hear it.</strong>
        </span>
        {open ? (
          <Minus size={16} aria-hidden="true" />
        ) : (
          <Plus size={16} aria-hidden="true" />
        )}
      </button>
      {open && (
        <form id="playground-personal-form" ref={form} onSubmit={submit}>
          <label htmlFor="playground-thought">
            A small thought about your next plan
          </label>
          <p id="playground-thought-help">
            Try a budget, a time, or a transport concern. Sent to Meta for this
            reply; your text and result aren’t saved. Avoid names or sensitive
            details.
          </p>
          <textarea
            id="playground-thought"
            name="thought"
            rows={2}
            minLength={10}
            maxLength={240}
            required
            autoComplete="off"
            placeholder="I can join the picnic, but I need to be home by 3 PM…"
            aria-describedby={`playground-thought-help${error ? " playground-personal-error" : ""}`}
            onChange={(event) => setLength(event.target.value.length)}
          />
          <div className="playground-personal-actions">
            <span>{length}/240 · Up to 3 personal tries per hour</span>
            <button className="playground-run" disabled={loading} type="submit">
              {loading ? (
                <LoaderCircle size={14} aria-hidden="true" />
              ) : (
                <Play size={12} fill="currentColor" aria-hidden="true" />
              )}
              {loading ? "Listening…" : "Run Listener"}
            </button>
          </div>
          <div aria-live="polite">
            {error && (
              <p
                className="playground-personal-error"
                id="playground-personal-error"
                role="alert"
              >
                {error}
              </p>
            )}
            {result && (
              <div className="playground-personal-result">
                <Check size={16} aria-hidden="true" />
                <p>{result.sections[0].text}</p>
                <button
                  type="button"
                  onClick={() => onInspect(result)}
                  aria-controls="playground-inspector"
                >
                  Inspect answer <ArrowRight size={13} aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

export function LivingPlayground() {
  const { hash, pathname } = useLocation();
  const [inspected, setInspected] = useState<PlaygroundResult>();
  const inspectorHeading = useRef<HTMLHeadingElement>(null);
  const inspectTrigger = useRef<HTMLElement | null>(null);
  const inspect = (result: PlaygroundResult) => {
    inspectTrigger.current = document.activeElement as HTMLElement;
    setInspected(result);
  };
  useLayoutEffect(() => {
    if (pathname !== "/" || hash !== "#meet-the-minds") return;
    document
      .getElementById("meet-the-minds")
      ?.scrollIntoView({ behavior: "instant", block: "start" });
  }, [hash, pathname]);
  useEffect(() => {
    if (inspected) inspectorHeading.current?.focus();
  }, [inspected]);
  return (
    <Reveal
      section
      id="meet-the-minds"
      className="home-story-section living-playground"
    >
      <div className="playground-heading">
        <div>
          <h2>
            Meet the minds
            <br className="playground-heading-break" /> behind Setvia
            <span>.</span>
          </h2>
          <p>Four little challenges. Real Meta AI. No room required.</p>
        </div>
        <span className="playground-model">
          <Sparkles size={15} aria-hidden="true" />
          Muse Spark 1.3<span>Runs only when you ask</span>
        </span>
      </div>
      <div className="playground-grid">
        {agents.map((agent) => (
          <AgentCard key={agent.id} agent={agent} onInspect={inspect} />
        ))}
      </div>
      <div className="playground-afterword">
        <p>
          <ShieldCheck size={14} aria-hidden="true" />
          Fictional situations. Real AI responses. People make the decisions.
        </p>
        <span>Cat characters represent the roles.</span>
      </div>
      <PersonalThought onInspect={inspect} />
      {inspected && (
        <section
          className="playground-inspector"
          id="playground-inspector"
          aria-labelledby="playground-inspector-heading"
        >
          <div className="playground-inspector-heading">
            <div>
              <h3
                id="playground-inspector-heading"
                ref={inspectorHeading}
                tabIndex={-1}
              >
                {agents.find((agent) => agent.id === inspected.agent)!.name}’s
                answer
              </h3>
              <Source result={inspected} />
            </div>
            <button
              type="button"
              aria-label="Close full answer"
              onClick={() => {
                setInspected(undefined);
                inspectTrigger.current?.focus();
              }}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <dl>
            {inspected.sections.map((section) => (
              <div key={section.label}>
                <dt>{section.label}</dt>
                <dd>{section.text}</dd>
              </div>
            ))}
          </dl>
          <p className="playground-provenance">
            {inspected.roles.join(" → ")} · {inspected.model} ·{" "}
            {new Intl.DateTimeFormat(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(inspected.generatedAt))}
            {inspected.source === "cached"
              ? " · Previously generated; no new model request"
              : " · Generated for this request"}
            {inspected.personal ? " · Not saved" : ""}
          </p>
        </section>
      )}
      <div className="playground-next">
        <p>A little clearer? Bring your people into the picture.</p>
        <ButtonLink to="/start" secondary>
          Plan something together <ArrowRight size={15} aria-hidden="true" />
        </ButtonLink>
      </div>
    </Reveal>
  );
}
