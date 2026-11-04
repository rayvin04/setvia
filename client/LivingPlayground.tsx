import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useInView,
  useReducedMotion,
} from "motion/react";
import { useLocation } from "react-router-dom";
import {
  Archive,
  CircleAlert,
  LoaderCircle,
  Play,
  RotateCw,
  Sparkles,
  Zap,
} from "lucide-react";
import {
  playgroundScenarios,
  type PlaygroundAgent,
  type PlaygroundFailureCode,
  type PlaygroundResult,
} from "../shared/playground";
import { AgentCat } from "./AgentCats";
import { Reveal } from "./MotionUI";
import { playgroundSession, runPlayground } from "./playground-api";
import "./living-playground.css";

const agents = [
  {
    id: "listener",
    name: "Listener",
    title: "Hear me out.",
    purpose: "Turns a thought into a constraint.",
    loading: "Listening for what matters…",
  },
  {
    id: "judge",
    name: "Judge",
    title: "Spot the problem.",
    purpose: "Checks a plan against the facts.",
    loading: "Checking the evidence…",
  },
  {
    id: "negotiator",
    name: "Negotiator",
    title: "Find common ground.",
    purpose: "Makes room for different needs.",
    loading: "Looking for a workable overlap…",
  },
  {
    id: "speaker",
    name: "Speaker",
    title: "Ask the right question.",
    purpose: "Gives the next step a voice.",
    loading: "Choosing the next question…",
  },
] as const satisfies readonly {
  id: PlaygroundAgent;
  name: string;
  title: string;
  purpose: string;
  loading: string;
}[];
type AgentInfo = (typeof agents)[number];

const fallbackMessages: Record<PlaygroundFailureCode, string> = {
  inference_disabled: "Live AI is temporarily paused.",
  busy: "Both live slots are busy.",
  authentication: "The live service could not authenticate with Meta.",
  rate_limit: "Meta is busy right now.",
  timeout: "The live request took too long.",
  connection: "The live service could not reach Meta.",
  provider_request: "Meta could not accept this live request.",
  provider_unavailable: "Meta is temporarily unavailable.",
  validation: "The new answer did not pass Setvia’s checks.",
  accounting: "Live request recording is temporarily unavailable.",
  request_limit: "The live request reached its attempt limit.",
  unavailable: "Live AI is temporarily unavailable.",
};

function Source({ result }: { result: PlaygroundResult }) {
  const Icon = result.source === "cached" ? Archive : Zap;
  return (
    <span
      className={`playground-source source-${result.source}`}
      title={`${result.source === "cached" ? "Previously generated" : "Generated"} ${new Date(result.generatedAt).toLocaleString()}`}
    >
      <Icon size={12} aria-hidden="true" />
      {result.source === "cached" ? "Cached fallback" : "Live response"}
    </span>
  );
}

function visibleOutput(agent: PlaygroundAgent, result: PlaygroundResult) {
  return result.sections.slice(
    0,
    agent === "judge" || agent === "negotiator" ? 3 : 2,
  );
}

function AgentCard({
  agent,
  pageVisible,
}: {
  agent: AgentInfo;
  pageVisible: boolean;
}) {
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [result, setResult] = useState<PlaygroundResult>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const card = useRef<HTMLElement>(null);
  const inView = useInView(card, { amount: 0.1 });
  const reduced = useReducedMotion();
  const scenarios = playgroundScenarios[agent.id];
  const scenario = scenarios[scenarioIndex];
  const showingResponse = loading || Boolean(result) || Boolean(error);
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

  function nextExample() {
    setScenarioIndex((index) => (index + 1) % scenarios.length);
    setResult(undefined);
    setError("");
  }

  const swapMotion = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, y: 7 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -5 },
      };

  return (
    <article
      ref={card}
      className={`playground-card playground-${agent.id}${loading ? " is-working" : ""}${inView && pageVisible && !reduced ? " is-animated" : ""}`}
      aria-labelledby={`${agent.id}-role`}
    >
      <span className="playground-role" id={`${agent.id}-role`}>
        {agent.name}
      </span>
      <div
        className={`playground-cat-stage playground-cat-${agent.id}`}
        aria-hidden="true"
      >
        <div className="playground-cat-platform" />
        <div className="playground-cat-wrap">
          <AgentCat agent={agent.id} />
        </div>
      </div>

      <div
        className="playground-card-content"
        aria-busy={loading}
        aria-live="polite"
        aria-atomic="false"
      >
        <AnimatePresence mode="wait" initial={false}>
          {!showingResponse ? (
            <motion.div
              key="preview"
              className="playground-card-preview"
              {...swapMotion}
              transition={{ duration: reduced ? 0.12 : 0.2, ease: "easeOut" }}
            >
              <h3>{agent.title}</h3>
              <p className="playground-purpose">{agent.purpose}</p>
              <div className="playground-scenario">
                <div className="playground-scenario-heading">
                  <span>{scenario.title}</span>
                </div>
                <p>{scenario.text}</p>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="response"
              className="playground-card-conversation"
              {...swapMotion}
              transition={{ duration: reduced ? 0.12 : 0.2, ease: "easeOut" }}
            >
              <div className="playground-input-block">
                <p className="playground-input-copy">{scenario.text}</p>
              </div>

              <div className="playground-output-block">
                <div className="playground-output-heading">
                  <span>Muse Spark response</span>
                  {result && <Source result={result} />}
                </div>
                <span className="playground-output-path">
                  {result
                    ? `Muse Spark 1.3 · ${result.roles.join(" → ")}`
                    : agent.id === "speaker"
                      ? "Muse Spark 1.3 · Question Strategist → Speaker"
                      : `Muse Spark 1.3 · ${agent.name}`}
                </span>
                {result?.source === "cached" && (
                  <p className="playground-fallback-note">
                    {fallbackMessages[result.fallbackCode ?? "unavailable"]}{" "}
                    Showing a saved response.
                    {result.fallbackCode && (
                      <span className="playground-failure-code">
                        {" "}
                        ({result.fallbackCode})
                      </span>
                    )}
                  </p>
                )}

                <AnimatePresence mode="wait" initial={false}>
                  {loading ? (
                    <motion.div
                      key="loading"
                      className="playground-response-waiting"
                      role="status"
                      {...swapMotion}
                      transition={{
                        duration: reduced ? 0.12 : 0.18,
                        ease: "easeOut",
                      }}
                    >
                      <LoaderCircle size={15} aria-hidden="true" />
                      <span>{agent.loading}</span>
                      <span
                        className="playground-thinking-dots"
                        aria-hidden="true"
                      >
                        <i />
                        <i />
                        <i />
                      </span>
                    </motion.div>
                  ) : error ? (
                    <motion.div
                      key="error"
                      className="playground-error"
                      role="alert"
                      {...swapMotion}
                      transition={{
                        duration: reduced ? 0.12 : 0.18,
                        ease: "easeOut",
                      }}
                    >
                      <CircleAlert size={16} aria-hidden="true" />
                      <p>{error}</p>
                    </motion.div>
                  ) : result ? (
                    <motion.div
                      key="result"
                      className="playground-output-copy"
                      {...swapMotion}
                      transition={{
                        duration: reduced ? 0.12 : 0.22,
                        ease: "easeOut",
                      }}
                    >
                      {visibleOutput(agent.id, result).map((section, index) => (
                        <motion.p
                          className="playground-output-line"
                          key={section.label}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{
                            duration: reduced ? 0.12 : 0.2,
                            delay: reduced ? 0 : index * 0.07,
                          }}
                        >
                          <strong>{section.label}:</strong> {section.text}
                        </motion.p>
                      ))}
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
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
          onClick={nextExample}
          aria-label={`Show another ${agent.name} example`}
        >
          <RotateCw size={13} aria-hidden="true" />
          Try another example
        </button>
      </div>
    </article>
  );
}

export function LivingPlayground() {
  const { hash, pathname } = useLocation();
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const changed = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  useLayoutEffect(() => {
    if (pathname !== "/" || hash !== "#meet-the-minds") return;
    document
      .getElementById("meet-the-minds")
      ?.scrollIntoView({ behavior: "instant", block: "start" });
  }, [hash, pathname]);

  return (
    <Reveal
      section
      id="meet-the-minds"
      className="home-story-section living-playground"
    >
      <div className="playground-heading">
        <div>
          <h2>
            Meet the minds behind{" "}
            <span className="brand-name playground-brand">Setvia</span>
            <span className="playground-period">.</span>
          </h2>
          <p>Four little challenges. Real Meta AI. No room required.</p>
        </div>
        <span className="playground-model">
          <Sparkles size={15} aria-hidden="true" />
          Muse Spark 1.3
        </span>
      </div>
      <div className="playground-grid">
        {agents.map((agent) => (
          <AgentCard key={agent.id} agent={agent} pageVisible={pageVisible} />
        ))}
      </div>
    </Reveal>
  );
}
