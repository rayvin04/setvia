import { useId } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { Reveal } from "./MotionUI";
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
  CalendarDays,
  ListChecks,
  CircleCheck,
  Image as ImageIcon,
} from "lucide-react";
import { scenarios } from "./demoData";
import { demoDetails } from "./demoDetails";
import { Avatar } from "./Mascot";
import { ButtonLink, cn } from "./components";
const icons = [TreePalm, House, BriefcaseBusiness, GraduationCap, Heart];
function CoverArt({ index, variant = 0 }: { index: number; variant?: number }) {
  const selected = scenarios[index];
  return (
    <div
      aria-hidden="true"
      className={cn(
        "cover-art",
        "cover-world-" + index,
        "cover-variant-" + variant,
      )}
    >
      <AnimatePresence initial={false}>
        <motion.img
          key={selected.id + "-" + variant}
          src={"/covers/" + selected.id + "-" + (variant + 1) + ".svg"}
          width={600}
          height={450}
          alt=""
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        />
      </AnimatePresence>
    </div>
  );
}
const MotionLink = motion.create(Link);
export function ScenarioLinks() {
  const reduced = useReducedMotion();
  return (
    <Reveal section className="scenario-strip section-shell">
      <div className="section-heading">
        <h2>
          Different people.
          <br />
          Good plans.
        </h2>
        <p>
          A weekend away or a big deadline.
          <br />
          Start with a situation you know.
        </p>
      </div>
      <div className="world-links">
        {scenarios.map((s, i) => (
          <MotionLink
            key={s.id}
            to={"/demos?scenario=" + s.id}
            whileHover={reduced ? { opacity: 0.9 } : { y: -4 }}
            whileTap={reduced ? { opacity: 0.8 } : { scale: 0.98 }}
            transition={{ type: "spring", bounce: 0, duration: 0.25 }}
          >
            <CoverArt index={i} />
            <div>
              <span>{s.title}</span>
              <ArrowRight size={18} aria-hidden="true" />
            </div>
            <small>{s.audience}</small>
          </MotionLink>
        ))}
      </div>
    </Reveal>
  );
}
export function Demos() {
  const selectionId = useId();
  const reduced = useReducedMotion();
  const [params, setParams] = useSearchParams();
  const selected =
    scenarios.find((s) => s.id === params.get("scenario")) || scenarios[0];
  const index = scenarios.indexOf(selected);
  const detail = demoDetails[index];
  const raw = Number(params.get("cover") || 0);
  const cover = raw >= 0 && raw < 3 && Number.isInteger(raw) ? raw : 0;
  function choose(value: number) {
    setParams(
      { scenario: selected.id, cover: String(value) },
      { replace: true },
    );
  }
  return (
    <section className="demo-page section-shell">
      <Link className="back-link" to="/">
        <ArrowLeft size={17} aria-hidden="true" />
        Back to Setvia
      </Link>
      <div className="demo-heading">
        <div>
          <h1>Find your starting point.</h1>
          <p>Real-life planning problems. A clearer way through.</p>
        </div>
        <span className="demo-mode">
          <span className="status-dot" />
          Fictional demo · No live AI
        </span>
      </div>
      <nav className="world-tabs" aria-label="Demo scenarios">
        {scenarios.map((s, i) => {
          const Icon = icons[i];
          return (
            <Link
              key={s.id}
              to={"?scenario=" + s.id}
              aria-current={selected.id === s.id ? "page" : undefined}
              className={cn("world-tab", selected.id === s.id && "selected")}
            >
              {selected.id === s.id && (
                <motion.span
                  className="world-tab-indicator"
                  layoutId={selectionId}
                  transition={{
                    type: "spring",
                    bounce: 0,
                    duration: reduced ? 0 : 0.3,
                  }}
                />
              )}
              <Icon size={20} aria-hidden="true" />
              <span>
                {s.title}
                <small>{s.audience}</small>
              </span>
              {selected.id === s.id && <Check size={16} aria-hidden="true" />}
            </Link>
          );
        })}
      </nav>
      <motion.article
        className="demo-workspace"
        key={selected.id}
        initial={{ opacity: 0.35, y: reduced ? 0 : 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", bounce: 0, duration: 0.3 }}
      >
        <div className="demo-overview">
          <div className="demo-cover">
            <CoverArt index={index} variant={cover} />
            <span className="cover-caption">
              Selected cover · Concept {cover + 1}
            </span>
          </div>
          <div className="demo-story">
            <h2>{selected.title}</h2>
            <p>{selected.description}</p>
            <div className="scenario-tags">
              {selected.tags.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
            <div className="quote-pair">
              {detail.quotes.map((q, i) => (
                <blockquote key={q}>
                  <Avatar index={i} />
                  <div>
                    <cite>{selected.people[i]}</cite>
                    <p>{q}</p>
                  </div>
                </blockquote>
              ))}
            </div>
            <div className="resolution">
              <CircleCheck size={20} aria-hidden="true" />
              <div>
                <h3>What Setvia helps resolve</h3>
                <p>{detail.resolution}</p>
              </div>
            </div>
            <ButtonLink
              to={"/start?title=" + encodeURIComponent(selected.idea)}
            >
              Use this starting point
              <ArrowRight size={18} aria-hidden="true" />
            </ButtonLink>
          </div>
        </div>
        <section className="sample-plan">
          <div className="sample-heading">
            <h3>Your plan, coming together.</h3>
            <span>Illustrative output · Version 3</span>
          </div>
          <div className="sample-deliverables">
            <div>
              <CalendarDays size={20} aria-hidden="true" />
              <h4>Schedule</h4>
              <p>{detail.schedule}</p>
            </div>
            <div>
              <ListChecks size={20} aria-hidden="true" />
              <h4>Responsibilities</h4>
              <p>{detail.task}</p>
            </div>
            <div>
              <CircleCheck size={20} aria-hidden="true" />
              <h4>Participant approval</h4>
              <p>2 of 4 approved this version</p>
            </div>
          </div>
          <div className="sample-open">
            <span className="status-dot" />
            <span>{detail.open}</span>
          </div>
        </section>
        <section className="cover-picker">
          <div className="sample-heading">
            <div>
              <h3>Give the plan a look.</h3>
              <p>Choose a cover direction for this fictional plan.</p>
            </div>
            <ImageIcon size={23} aria-hidden="true" />
          </div>
          <fieldset>
            <legend className="sr-only">Choose a cover concept</legend>
            {detail.covers.map((name, i) => (
              <label
                key={name}
                className={cn("cover-choice", cover === i && "selected")}
              >
                <input
                  type="radio"
                  name="cover"
                  value={i}
                  checked={cover === i}
                  onChange={() => choose(i)}
                />
                <CoverArt index={index} variant={i} />
                <span>
                  {name}
                  {cover === i && <Check size={17} aria-hidden="true" />}
                </span>
              </label>
            ))}
          </fieldset>
          <p className="cover-disclosure">
            Muse Image workflow preview · Authored mock designs, not
            AI-generated results. Generation is not connected.
          </p>
        </section>
      </motion.article>
    </section>
  );
}
