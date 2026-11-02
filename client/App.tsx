import { useState } from "react";
import type { FormEvent } from "react";
import { Routes, Route, Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  MessageCircle,
  SlidersHorizontal,
  CircleCheck,
  ArrowLeft,
} from "lucide-react";
import { ButtonLink, Header, Footer } from "./components";
import { Waves } from "./Waves";
import { Mascot } from "./Mascot";
import { Demos, ScenarioLinks } from "./Scenarios";

function Home() {
  return (
    <>
      <section className="hero">
        <Waves />
        <div className="hero-content">
          <h1 className="text-balance">
            Make plans that survive
            <br className="desktop-break" /> <span>the group chat.</span>
          </h1>
          <p className="hero-description text-pretty">
            Big ideas. Different opinions. One plan.
            <br /> Bring your people together and turn “we should” into “we’re
            going.”
          </p>
          <div className="hero-actions">
            <div className="mascot-button">
              <Mascot />
              <ButtonLink to="/start">
                Start Planning
                <ArrowRight size={19} aria-hidden="true" />
              </ButtonLink>
            </div>
            <ButtonLink to="/demos" secondary>
              Try Demo
              <ArrowUpRight size={18} aria-hidden="true" />
            </ButtonLink>
          </div>
          <p className="hero-note">No sign-up. Just bring your people.</p>
          <div className="meta-credit">
            <span>Designed for</span>
            <strong>Meta AI</strong>
            <span>Muse models</span>
          </div>
        </div>
        <div className="hero-bottom">
          <span>A little less back-and-forth. A lot more happening.</span>
          <a href="#how-it-works" aria-label="Discover how Setvia works">
            Scroll to discover <span aria-hidden="true">↓</span>
          </a>
        </div>
      </section>
      <section id="how-it-works" className="how-section section-shell">
        <div className="section-heading">
          <h2>
            From “any ideas?”
            <br />
            to “it’s a plan.”
          </h2>
          <p>
            Make room for everyone’s needs.
            <br />
            And leave the endless follow-ups behind.
          </p>
        </div>
        <div className="steps">
          {[
            {
              icon: MessageCircle,
              title: "Bring the messy bits.",
              text: "Start with an idea, a conversation, or a screenshot. Give the plan somewhere to begin.",
            },
            {
              icon: SlidersHorizontal,
              title: "Find your common ground.",
              text: "Gather preferences, compare the trade-offs, and catch the details that slip through.",
            },
            {
              icon: CircleCheck,
              title: "Make the same plan.",
              text: "Review one clear version together. Everyone knows what they’re agreeing to.",
            },
          ].map(({ icon: Icon, title, text }) => (
            <article key={title}>
              <Icon size={25} aria-hidden="true" />
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>
      <ScenarioLinks />
      <section className="closing section-shell">
        <p>
          For the weekend away.
          <br />
          And everything you’re building together.
        </p>
        <ButtonLink to="/demos" secondary>
          Find your kind of plan
          <ArrowRight size={18} aria-hidden="true" />
        </ButtonLink>
      </section>
    </>
  );
}
function FormPage({ join = false }: { join?: boolean }) {
  const [message, setMessage] = useState("");
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(
      join
        ? "This is a local UI prototype. Live room joining arrives in the collaboration phase."
        : "Your idea looks ready. Room creation and AI planning arrive in the next implementation phases.",
    );
  }
  return (
    <section className="form-page section-shell">
      <Link className="back-link" to="/">
        <ArrowLeft size={17} aria-hidden="true" />
        Back to Setvia
      </Link>

      <h1>{join ? "Your people are waiting." : "What are we planning?"}</h1>
      <span className="prototype-label">UI prototype</span>
      <p>
        {join
          ? "Join the conversation with a room link and a name."
          : "A small idea is all it takes to get started."}
      </p>
      <form onSubmit={submit}>
        {join ? (
          <>
            <label htmlFor="room">Room link or code</label>
            <input
              id="room"
              name="room"
              placeholder="Paste your room link…"
              required
              autoComplete="off"
              spellCheck={false}
            />
            <label htmlFor="nickname">Your nickname</label>
            <input
              id="nickname"
              name="nickname"
              placeholder="What should we call you?"
              required
              autoComplete="nickname"
              maxLength={40}
            />
          </>
        ) : (
          <>
            <label htmlFor="title">Give your plan a name</label>
            <input
              id="title"
              name="title"
              placeholder="A weekend by the sea…"
              defaultValue={
                new URLSearchParams(window.location.search).get("title") || ""
              }
              required
              maxLength={120}
              autoComplete="off"
            />
            <label htmlFor="idea">Tell us a little about it</label>
            <textarea
              id="idea"
              name="idea"
              placeholder="The idea, the people, the things to figure out…"
              rows={4}
              required
            />
            <p className="field-note">
              Prototype only. Nothing is uploaded or sent to an AI model.
            </p>
          </>
        )}
        <button className="button button-primary" type="submit">
          {join ? "Preview joining" : "Preview next step"}
          <ArrowRight size={18} aria-hidden="true" />
        </button>
        <p role="status" className="form-feedback">
          {message}
        </p>
      </form>
    </section>
  );
}
function Missing() {
  return (
    <section className="form-page section-shell">
      <h1>This plan took a detour.</h1>
      <p>The page you’re looking for isn’t here.</p>
      <ButtonLink to="/">Back to Setvia</ButtonLink>
    </section>
  );
}
export default function App() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Header />
      <main id="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/start" element={<FormPage />} />
          <Route path="/join" element={<FormPage join />} />
          <Route path="/demos" element={<Demos />} />
          <Route path="*" element={<Missing />} />
        </Routes>
      </main>
      <Footer />
    </>
  );
}
