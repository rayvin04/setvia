import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  ArrowLeft,
  TreePalm,
  House,
  BriefcaseBusiness,
  GraduationCap,
  Heart,
  Check,
} from "lucide-react";
import { scenarios } from "./demoData";
import { Avatar } from "./Mascot";
import { ButtonLink, cn } from "./components";
const icons = [TreePalm, House, BriefcaseBusiness, GraduationCap, Heart];
export function ScenarioLinks() {
  return (
    <section className="scenario-strip section-shell">
      <div className="section-heading">
        <h2>
          Whatever brings
          <br />
          you together.
        </h2>
        <p>
          One place for your people.
          <br />
          Five ways to get inspired.
        </p>
      </div>
      <div className="scenario-links">
        {scenarios.map((s, i) => {
          const Icon = icons[i];
          return (
            <Link to={"/demos?scenario=" + s.id} key={s.id}>
              <Icon size={21} aria-hidden="true" />
              <span>
                {s.title}
                <small>{s.audience}</small>
              </span>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          );
        })}
      </div>
    </section>
  );
}
export function Demos() {
  const [params] = useSearchParams();
  const selected =
    scenarios.find((s) => s.id === params.get("scenario")) || scenarios[0];
  const index = scenarios.indexOf(selected);
  const Icon = icons[index];
  return (
    <section className="demo-page section-shell">
      <Link className="back-link" to="/">
        <ArrowLeft size={17} aria-hidden="true" />
        Back to Setvia
      </Link>
      <h1>Every group has a plan.</h1>
      <p className="demo-intro">
        Pick a familiar starting point. Imagine what you could make happen.
      </p>
      <p className="prototype-disclosure">
        Fictional scenarios · UI preview · No live AI or collaboration
      </p>
      <div className="scenario-layout">
        <nav className="scenario-menu" aria-label="Demo scenarios">
          {scenarios.map((s, i) => {
            const ItemIcon = icons[i];
            return (
              <Link
                key={s.id}
                to={"?scenario=" + s.id}
                className={cn(
                  "scenario-option",
                  s.id === selected.id && "selected",
                )}
                aria-current={s.id === selected.id ? "page" : undefined}
              >
                <ItemIcon size={23} aria-hidden="true" />
                <span>
                  {s.title}
                  <small>{s.audience}</small>
                </span>
                {s.id === selected.id ? (
                  <Check size={17} aria-hidden="true" />
                ) : (
                  <ArrowRight size={17} aria-hidden="true" />
                )}
              </Link>
            );
          })}
        </nav>
        <article className="scenario-detail" key={selected.id}>
          <Icon size={38} aria-hidden="true" />

          <h2>{selected.question}</h2>
          <p className="scenario-audience">{selected.audience}</p>
          <p>{selected.detail}</p>
          <div className="scenario-tags">
            {selected.tags.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
          <div className="fictional-people">
            <div className="avatar-row">
              {selected.people.map((p, i) => (
                <span key={p} title={p + " — fictional participant"}>
                  <Avatar index={i} />
                </span>
              ))}
            </div>
            <span>
              Meet {selected.people[0]} & friends
              <br />
              <small>Illustrative participants</small>
            </span>
          </div>
          <ButtonLink to={"/start?title=" + encodeURIComponent(selected.idea)}>
            Use this idea
            <ArrowRight size={18} aria-hidden="true" />
          </ButtonLink>
          <small className="scenario-limit">
            Interactive negotiation and room demos are planned for a later
            batch.
          </small>
        </article>
      </div>
    </section>
  );
}
