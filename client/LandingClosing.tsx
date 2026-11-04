import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDownRight,
  ArrowRight,
  Check,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { ButtonLink, Wordmark } from "./components";
import { Reveal } from "./MotionUI";
import { initialVersion, revisePreview, approveVersion } from "./preview-state";
import "./landing-closing.css";

const roleCats = [
  {
    name: "Listener",
    image: "/story-media/listener-portrait.webp",
    thought: "Surf in the morning still works for me.",
    side: "left-top",
  },
  {
    name: "Judge",
    image: "/story-media/judge-portrait.webp",
    thought: "7:00 AM is fair. Let’s keep it.",
    side: "right-top",
  },
  {
    name: "Negotiator",
    image: "/story-media/negotiator-portrait.webp",
    thought: "I can drive back if we split fuel.",
    side: "left-bottom",
  },
  {
    name: "Speaker",
    image: "/story-media/speaker-portrait.webp",
    thought: "Great — let’s lock this plan!",
    side: "right-bottom",
  },
] as const;

export function EventAgreement() {
  const [state, setState] = useState(initialVersion);
  const revised = state.version === 4;

  return (
    <Reveal
      section
      id="agreement"
      className="home-story-section coastal-agreement"
    >
      <div className="coastal-copy">
        <h2>Agreement should be clear enough to keep.</h2>
        <p>
          Every yes belongs to a specific plan. Change the proposal and see why
          the group needs to decide again.
        </p>
        <ButtonLink to="/demos?scenario=beach" secondary>
          See a plan come together <ArrowRight size={17} aria-hidden="true" />
        </ButtonLink>
        <span className="coastal-example-note">
          A fictional example · no AI request
        </span>
      </div>

      <div className="coastal-stage" data-visual-slot="decision-receipt-demo">
        <img
          className="coastal-connections"
          src="/story-media/plan-connections.webp"
          alt=""
          width="1000"
          height="560"
          aria-hidden="true"
        />
        <div className="coastal-cast" role="group" aria-label="Four planning roles">
          {roleCats.map((role, index) => (
            <figure className={`coastal-role role-${role.side}`} key={role.name}>
              <img
                src={role.image}
                alt=""
                width="384"
                height="384"
                fetchPriority={index < 2 ? "high" : undefined}
              />
              <figcaption>{role.name}</figcaption>
              <blockquote>{role.thought}</blockquote>
            </figure>
          ))}
        </div>

        <article className="story-receipt coastal-receipt">
          <div className="coastal-fact-label">
            <span>THE PLAN</span>
            <span className="coastal-status-dot" />
            <span>4 roles · 4 people</span>
          </div>
          <div className="story-receipt-head">
            <div>
              <h3>Beach weekend</h3>
              <p>La Union · Saturday, Nov 14, 2026</p>
            </div>
          </div>
          <div className="story-receipt-line">
            <span>Departure</span>
            <strong>{revised ? "8:30 AM" : "7:00 AM"}</strong>
          </div>
          <div className="story-receipt-line">
            <span>Travel</span>
            <strong>Furina drives · split fuel</strong>
          </div>
          <details className="story-version-details">
            <summary>What changed in the plan?</summary>
            <p>
              {revised
                ? "Departure moved from 7:00 AM to 8:30 AM. Earlier approvals no longer apply after a plan change, so everyone needs to decide again."
                : "Furina was added as the driver. The early departure is part of the proposal; the per-person budget is still open."}
            </p>
          </details>
          <div className="story-receipt-approval">
            <div className="story-avatar-stack coastal-votes" aria-hidden="true">
              {roleCats.map((role) => (
                <img key={role.name} src={role.image} alt="" width="42" height="42" />
              ))}
            </div>
            <strong role="status">{state.approvals.length} of 4 approved</strong>
          </div>
          <div className="version-actions">
            <button
              type="button"
              className="receipt-button"
              disabled={revised}
              onClick={() => setState(revisePreview)}
            >
              {revised ? "Departure updated to 8:30 AM" : "Move departure to 8:30 AM"}
              <ArrowDownRight size={16} aria-hidden="true" />
            </button>
            {revised && (
              <button
                type="button"
                className="receipt-button receipt-approve"
                disabled={state.approvals.includes("Selena")}
                onClick={() => setState((old) => approveVersion(old, "Selena"))}
              >
                {state.approvals.includes("Selena")
                  ? "Selena approved this plan"
                  : "Add Selena’s sample approval"}
                <Check size={15} aria-hidden="true" />
              </button>
            )}
          </div>
          <div className="preview-footnote">
            <span>Fictional approvals</span>
            <button type="button" onClick={() => setState(initialVersion())}>
              <RotateCcw size={12} aria-hidden="true" /> Reset
            </button>
          </div>
        </article>
      </div>
    </Reveal>
  );
}

export function ClosingInvitation() {
  return (
    <Reveal section className="home-story-section story-closing closing-invitation">
      <div className="story-closing-panel">
        <div className="story-closing-copy">
          <h2>Make the next message move things forward.</h2>
          <p>
            Start with what your group knows. Find what still needs a
            conversation.
          </p>
          <div className="story-closing-actions">
            <ButtonLink to="/start">Start planning</ButtonLink>
            <ButtonLink to="/demos" secondary>
              Explore demos <ArrowRight size={16} aria-hidden="true" />
            </ButtonLink>
          </div>
        </div>
        <img
          className="closing-team-art"
          src="/story-media/planning-team.webp"
          width="960"
          height="640"
          loading="lazy"
          decoding="async"
          alt="The Setvia mascot meets the Listener, Negotiator, Judge and Speaker cats around a shared plan."
        />
      </div>
    </Reveal>
  );
}

const transparencyNotes = [
  "Muse Spark 1.3 Standard is the shared model behind Setvia’s four visible planning roles.",
  "The homepage playground sends a model request only when someone clicks Run.",
  "The Meta API key stays on Setvia’s server; model output is a suggestion for people to review.",
  "The Standard model choice is not a zero-retention promise. Demo scenarios use fictional data.",
];

export function LandingFooter() {
  return (
    <footer className="landing-footer" aria-label="Setvia project information">
      <div className="landing-footer-intro">
        <h2>
          Make plans that survive <span className="landing-footer-accent">the group chat</span>.
        </h2>
        <Wordmark />
        <p>
          Setvia helps a group turn their ideas, schedules and constraints into
          a plan people can actually agree on.
        </p>
      </div>
      <div className="landing-footer-detail" id="model-data">
        <ul className="model-transparency" aria-label="How Setvia uses AI">
          {transparencyNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
        <nav className="landing-footer-links" aria-label="Project links">
          <Link to="/privacy">Privacy policy</Link>
          <a href="https://github.com/rayvin04/setvia" target="_blank" rel="noopener noreferrer">
            <img className="landing-github-mark" src="/github-mark.svg" width="15" height="15" alt="" /> GitHub
          </a>
          <a href="https://github.com/rayvin04/setvia#readme" target="_blank" rel="noopener noreferrer">README</a>
          <a href="https://github.com/rayvin04/setvia/tree/main/docs" target="_blank" rel="noopener noreferrer">Technical docs</a>
          <Link to="/start">Start planning</Link>
          <Link to="/demos">Explore demos</Link>
        </nav>
        <div className="landing-footer-baseline">
          <span>Built for the Meta Global AI Developer Hackathon 2026</span>
          <a href="https://github.com/rayvin04/setvia/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">Apache 2.0 · Open source</a>
        </div>
      </div>
    </footer>
  );
}

export function PrivacyNotice() {
  return (
    <section className="privacy-notice">
      <Link className="privacy-back" to="/">← Back to Setvia</Link>
      <h1>Privacy &amp; AI data use</h1>
      <p className="privacy-updated">Setvia · Last updated November 5, 2026</p>
      <p>
        Setvia helps groups make a plan together. This page describes what the
        current application sends to its server and Meta’s model API when you
        choose to use an AI feature.
      </p>

      <h2>When an AI request is made</h2>
      <p>
        The homepage playground makes no model request when it loads or when you
        browse scenarios. It sends a request after you press <strong>Run</strong>.
        Setvia sends the scenario and any text you provide to its server, which
        calls Meta’s Responses API using <strong>Muse Spark 1.3 Standard</strong>.
        The four visible roles share this model. The API key stays on the server.
      </p>

      <h2>Live rooms and private replies</h2>
      <p>
        Live room messages and planning details are sent to Setvia’s server to
        operate the room and its AI analysis. Choosing a private reply keeps the
        response private from other room participants in Setvia’s interface;
        content needed for the requested analysis is still sent to Meta for
        processing. Setvia does not silently publish a private reply to the
        group. Room sessions use the current browser tab’s session storage.
      </p>

      <h2>Images and saved data</h2>
      <p>
        If you submit a screenshot for planning detail extraction, its bytes are
        validated in memory and sent to Meta for processing. Setvia does not
        persist the source image, prompt, or extraction request body. Structured
        room state is saved by the room service so participants can use the
        session; this site does not currently promise a deletion schedule. Avoid
        sending information you do not want processed by the service and Meta.
      </p>
      <p>
        Successful responses to the public preset scenarios may be cached for
        up to seven days as a fallback. Optional personal Listener text and its
        response are not saved to that cache.
      </p>

      <h2>Model responses and retention</h2>
      <p>
        Setvia validates model responses and presents them as suggestions for
        people to review. They do not approve a plan or verify real-world facts.
        Selecting Meta’s Standard model does not make a zero-retention promise;
        Meta’s own data practices apply to requests sent to its API.
      </p>

      <h2>More detail</h2>
      <p>
        Read the project’s <a href="https://github.com/rayvin04/setvia/blob/main/docs/meta-api.md" target="_blank" rel="noopener noreferrer">Meta API and data handling notes</a>,
        <a href="https://github.com/rayvin04/setvia/blob/main/docs/architecture.md" target="_blank" rel="noopener noreferrer"> system architecture</a>, and <a href="https://www.facebook.com/privacy/policy/" target="_blank" rel="noopener noreferrer">Meta Privacy Policy</a>.
        The public demo uses fictional planning scenarios.
      </p>
      <div className="privacy-guardrail">
        <ShieldCheck size={19} aria-hidden="true" />
        <span>AI output can be mistaken. People remain in control of what they share and approve.</span>
      </div>
    </section>
  );
}
