import { useState } from "react";
import type { FormEvent } from "react";
import { Routes, Route, Link } from "react-router-dom";
import { ArrowRight, ArrowLeft } from "lucide-react";
import { ButtonLink, Header, Footer } from "./components";

import { Demos } from "./Scenarios";
import { Home } from "./Home";

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
