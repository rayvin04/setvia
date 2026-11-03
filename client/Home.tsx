import { Capabilities } from "./Capabilities";
import { Reveal } from "./MotionUI";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Wallet,
  CarFront,
  CircleCheck,
  MessageCircle,
} from "lucide-react";
import { ButtonLink } from "./components";
import { Waves } from "./Waves";
import { Mascot, Avatar } from "./Mascot";
import { ScenarioLinks } from "./Scenarios";
export function Home() {
  return (
    <>
      <section className="hero">
        <Waves />
        <Reveal className="hero-content">
          <h1>
            Make plans that survive
            <br className="desktop-break" /> <span>the group chat.</span>
          </h1>
          <p className="hero-description">
            <strong>Your group's smartest negotiator.</strong>{" "}
            Setvia analyzes everyone's ideas, finds the blind spots, settles
            conflicting priorities, and turns endless discussions into decisions
            that actually move forward.
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
        </Reveal>
      </section>
      <Reveal
        section
        id="how-it-works"
        className="problem-section section-shell"
      >
        <div className="section-heading">
          <h2>
            Sound like
            <br />
            your group chat?
          </h2>
          <p>
            Everyone has a reason.
            <br />
            Give every reason a place in the plan.
          </p>
        </div>
        <div className="chat-to-plan">
          <div className="chat-example">
            <div className="example-title">
              <MessageCircle size={19} aria-hidden="true" />
              <span>The weekend chat</span>
              <small>Illustrative example</small>
            </div>
            {[
              { name: "Sam", quote: "“I can’t do Saturday. I have school.”" },
              { name: "Alex", quote: "“I’m short on money this month.”" },
              {
                name: "Jamie",
                quote: "“I can drive, but only if we leave early.”",
              },
              {
                name: "Drew",
                quote: "Anywhere is fine, as long as we stay nearby.",
              },
            ].map((q, i) => (
              <div className="chat-message" key={q.name}>
                <Avatar index={i} />
                <div>
                  <span>{q.name}</span>
                  <p>{q.quote}</p>
                </div>
              </div>
            ))}
            <p className="chat-unresolved">
              And nobody’s picked who’s bringing what.
            </p>
          </div>
          <div className="plan-example">
            <div className="example-title">
              <CircleCheck size={19} aria-hidden="true" />
              <span>A plan taking shape</span>
              <small>Proposed · v3</small>
            </div>
            <h3>A Sunday that works.</h3>
            <p className="plan-summary">
              Keep the day. Cut the cost.
              <br />
              Give everyone a clear next step.
            </p>
            <dl>
              {[
                {
                  icon: CalendarDays,
                  label: "When",
                  value: "Sunday · leave at 7 AM",
                },
                {
                  icon: Wallet,
                  label: "Budget",
                  value: "Agree on a per-person limit",
                },
                {
                  icon: CarFront,
                  label: "Travel",
                  value: "Jamie drives · split fuel",
                },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label}>
                  <Icon size={19} aria-hidden="true" />
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <div className="pending-decision">
              <span className="status-dot" />
              <p>Still to decide: the budget and who brings food.</p>
            </div>
            <div className="plan-approval">
              <div className="avatar-row">
                {[0, 1, 2, 3].map((i) => (
                  <Avatar key={i} index={i} />
                ))}
              </div>
              <span>
                2 of 4 approvals<small>Same plan. Same version.</small>
              </span>
            </div>
          </div>
        </div>
        <div className="mechanism-note">
          <p>Setvia suggests the compromise. You make the call.</p>
          <ButtonLink to="/demos" secondary>
            Explore an example
            <ArrowRight size={17} aria-hidden="true" />
          </ButtonLink>
        </div>
      </Reveal>
      <Capabilities />
      <ScenarioLinks />
    </>
  );
}
