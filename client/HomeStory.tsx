import {
  ArrowRight,
  ArrowUpRight,
  Backpack,
  CalendarDays,
  CarFront,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Wallet,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Avatar, Mascot } from "./Mascot";
import { ButtonLink } from "./components";
import { scenarios } from "./demoData";
import { Reveal } from "./MotionUI";
import "./home-story.css";

const chatMessages = [
  { name: "Sam", quote: "Saturday’s out. I have class." },
  { name: "Alex", quote: "I’m keeping this under ₱2,500." },
  { name: "Jamie", quote: "I can drive if we leave early." },
  { name: "Drew", quote: "Somewhere close works for me." },
];

const realityChecks = [
  { label: "Schedule Check", icon: CalendarDays },
  { label: "Budget Check", icon: Wallet },
  { label: "People Check", icon: UsersRound },
  { label: "Logistics Check", icon: CarFront },
  { label: "Preparation Check", icon: Backpack },
  { label: "Safety Check", icon: ShieldCheck },
];

function StoryHeading({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="story-heading">
      <div>
        <p className="story-kicker">{label}</p>
        <h2>{title}</h2>
      </div>
      <p className="story-heading-copy">{children}</p>
    </div>
  );
}

function ConversationToPlan() {
  return (
    <Reveal
      section
      id="how-it-works"
      className="home-story-section story-conversation"
    >
      <StoryHeading
        label="From group chat to common ground"
        title="Every “maybe” means something."
      >
        A tight budget. One early driver. Different schedules. Setvia keeps each
        reason visible while the group shapes a plan.
      </StoryHeading>

      <div className="story-translation" data-visual-slot="chat-demo">
        {/* Keep this framed preview independent of the story grid so a future loop can replace or sit beside it without shifting the plan panel. */}
        <div
          className="story-chat-surface"
          aria-label="Fictional group chat preview"
        >
          <div className="story-chat-head">
            <span className="story-chat-icon">
              <MessageCircle size={18} aria-hidden="true" />
            </span>
            <div>
              <strong>The weekend chat</strong>
              <small>4 people · fictional example</small>
            </div>
            <span className="story-chat-live">
              <span /> Illustrative
            </span>
          </div>
          <div className="story-message-stream">
            {chatMessages.map((message, index) => (
              <div className="story-message" key={message.name}>
                <Avatar index={index} />
                <div className="story-message-content">
                  <span>{message.name}</span>
                  <p>{message.quote}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="story-chat-footnote">
            <Sparkles size={16} aria-hidden="true" />
            <span>Four voices. A few things to work out.</span>
          </div>
        </div>

        <div className="story-bridge" aria-hidden="true">
          <span>
            <ArrowRight size={18} />
          </span>
          <small>find the overlap</small>
        </div>

        <div className="story-plan-surface" aria-label="Fictional plan preview">
          <div className="story-plan-topline">
            <span className="story-plan-label">
              <CircleCheck size={15} aria-hidden="true" />
              Plan taking shape
            </span>
            <span>Version 3</span>
          </div>
          <h3>A Sunday that works.</h3>
          <p className="story-plan-summary">
            Keep the day. Cut the cost. Give everyone a clear next step.
          </p>
          <dl className="story-plan-details">
            <div>
              <CalendarDays size={17} aria-hidden="true" />
              <dt>When</dt>
              <dd>Sunday · leave at 7 AM</dd>
            </div>
            <div>
              <Wallet size={17} aria-hidden="true" />
              <dt>Budget</dt>
              <dd>Agree on a per-person limit</dd>
            </div>
            <div>
              <CarFront size={17} aria-hidden="true" />
              <dt>Travel</dt>
              <dd>Jamie drives · split fuel</dd>
            </div>
          </dl>
          <div className="story-open-decision">
            <span className="story-open-dot" />
            <div>
              <small>Still open</small>
              <strong>Budget and who brings food</strong>
            </div>
            <ArrowUpRight size={16} aria-hidden="true" />
          </div>
          <div className="story-plan-approval">
            <div className="story-avatar-stack" aria-hidden="true">
              {[0, 1, 2, 3].map((index) => (
                <Avatar key={index} index={index} />
              ))}
            </div>
            <div>
              <strong>2 of 4 approvals</strong>
              <small>For this version only</small>
            </div>
            <span className="story-approval-meter" aria-hidden="true">
              <span />
            </span>
          </div>
        </div>
      </div>
      <p className="story-caption">
        Setvia surfaces the trade-offs. The group makes the call.
      </p>
    </Reveal>
  );
}

function RealityCheckStory() {
  return (
    <Reveal section className="home-story-section story-reality">
      <StoryHeading
        label="Reality Check"
        title="A good plan shows what’s still a question."
      >
        Conflicts and missing details stay visible, so a suggestion never looks
        like a decision the group hasn’t made.
      </StoryHeading>

      <div className="story-reality-layout">
        <div className="story-checks-list">
          <div className="story-checks-head">
            <span>Six ways to check the plan</span>
            <span>Fictional preview</span>
          </div>
          <div className="story-checks-grid">
            {realityChecks.map(({ label, icon: Icon }) => (
              <div className="story-check-row" key={label}>
                <Icon size={19} aria-hidden="true" />
                <span>{label}</span>
                <ArrowUpRight size={15} aria-hidden="true" />
              </div>
            ))}
          </div>
          <p className="story-checks-note">
            Missing information stays unknown until someone confirms it.
          </p>
        </div>

        <div
          className="story-issue-stage"
          data-visual-slot="reality-check-demo"
        >
          <div className="story-issue-card">
            <div className="story-issue-head">
              <span className="story-issue-icon">
                <CircleAlert size={19} aria-hidden="true" />
              </span>
              <span>Schedule Check</span>
              <span className="story-issue-state">Needs a decision</span>
            </div>
            <h3>When should the group head back?</h3>
            <p>Two prefer Sunday evening. Two need Monday morning.</p>
            <div className="story-time-options">
              <div className="story-time-option">
                <div className="story-mini-avatars" aria-hidden="true">
                  <Avatar index={0} />
                  <Avatar index={2} />
                </div>
                <div>
                  <strong>Sunday · 7 PM</strong>
                  <small>2 people prefer this</small>
                </div>
                <span>Option A</span>
              </div>
              <div className="story-time-option">
                <div className="story-mini-avatars" aria-hidden="true">
                  <Avatar index={1} />
                  <Avatar index={3} />
                </div>
                <div>
                  <strong>Monday · 9 AM</strong>
                  <small>2 people prefer this</small>
                </div>
                <span>Option B</span>
              </div>
            </div>
            <div className="story-issue-footer">
              <Sparkles size={16} aria-hidden="true" />
              <span>The group chooses what works.</span>
            </div>
          </div>
        </div>
      </div>
    </Reveal>
  );
}

function SharedVersionStory() {
  return (
    <Reveal section className="home-story-section story-version">
      <div className="story-version-copy">
        <p className="story-kicker">One shared version</p>
        <h2>Agreement should be clear enough to keep.</h2>
        <p>
          Every yes belongs to a specific plan. When the plan changes, people
          can see what changed and decide again.
        </p>
        <ButtonLink to="/demos?scenario=beach" secondary>
          See a plan come together
          <ArrowRight size={17} aria-hidden="true" />
        </ButtonLink>
      </div>

      <div
        className="story-receipt-stage"
        data-visual-slot="decision-receipt-demo"
      >
        <article className="story-receipt">
          <div className="story-receipt-head">
            <div>
              <span>Fictional plan · La Union</span>
              <h3>Beach weekend</h3>
              <p>Saturday, Nov 14 · Version 3</p>
            </div>
            <span className="story-receipt-mark">v3</span>
          </div>
          <div className="story-receipt-rule" />
          <div className="story-receipt-line">
            <span>Shared plan</span>
            <strong>Leave early · split the ride</strong>
          </div>
          <div className="story-receipt-line">
            <span>Still to decide</span>
            <strong>Per-person budget</strong>
          </div>
          <div className="story-receipt-approval">
            <div className="story-avatar-stack" aria-hidden="true">
              {[0, 1, 2, 3].map((index) => (
                <Avatar key={index} index={index} />
              ))}
            </div>
            <div>
              <strong>2 of 4 approved</strong>
              <small>Two people are still reviewing</small>
            </div>
            <span className="story-receipt-check">
              <Check size={16} aria-hidden="true" />
            </span>
          </div>
          <details className="story-version-details">
            <summary>
              What changed in version 3?
              <ChevronDown size={16} aria-hidden="true" />
            </summary>
            <p>
              The departure moved earlier and a driver was added. The budget
              stays open until the group agrees.
            </p>
          </details>
        </article>
      </div>
    </Reveal>
  );
}

function ScenarioStory() {
  const [featured, ...more] = scenarios;
  return (
    <Reveal
      section
      id="explore-demos"
      className="home-story-section story-scenarios"
    >
      <StoryHeading
        label="Made for real-life plans"
        title="Different groups. Different ways forward."
      >
        Start with a situation you know. Explore a fictional example, then make
        the plan your own.
      </StoryHeading>

      <div className="story-scenario-wall">
        <Link
          to={`/demos?scenario=${featured.id}`}
          className="story-scenario-featured"
        >
          <div className="story-scenario-featured-art">
            <img
              src={`/covers/${featured.id}-2.svg`}
              alt=""
              width={600}
              height={450}
              loading="lazy"
            />
            <span>Featured example</span>
          </div>
          <div className="story-scenario-featured-copy">
            <div>
              <small>{featured.audience} · Fictional demo</small>
              <h3>{featured.title}</h3>
              <p>{featured.question}</p>
            </div>
            <span className="story-scenario-arrow">
              <ArrowUpRight size={18} aria-hidden="true" />
            </span>
          </div>
        </Link>

        <div className="story-scenario-rail">
          {more.map((scenario) => (
            <Link
              to={`/demos?scenario=${scenario.id}`}
              className="story-scenario-link"
              key={scenario.id}
            >
              <img
                src={`/covers/${scenario.id}-1.svg`}
                alt=""
                width={120}
                height={90}
                loading="lazy"
              />
              <span>
                <strong>{scenario.title}</strong>
                <small>{scenario.audience}</small>
              </span>
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
          ))}
        </div>
      </div>
    </Reveal>
  );
}

function ClosingStory() {
  return (
    <Reveal section className="home-story-section story-closing">
      <div className="story-closing-panel">
        <div className="story-closing-copy">
          <p className="story-kicker">Bring the group together</p>
          <h2>Make the next message move things forward.</h2>
          <p>
            Start with what your group knows. Setvia helps you find what still
            needs a conversation.
          </p>
          <div className="story-closing-actions">
            <ButtonLink to="/start">
              Start Planning
              <ArrowRight size={18} aria-hidden="true" />
            </ButtonLink>
            <ButtonLink to="/demos" secondary>
              Explore demos
              <ArrowUpRight size={17} aria-hidden="true" />
            </ButtonLink>
          </div>
          <small>UI preview · Example plans use fictional groups.</small>
        </div>
        <div className="story-closing-mascot" aria-hidden="true">
          <span className="story-mascot-orbit story-mascot-orbit-blue" />
          <span className="story-mascot-orbit story-mascot-orbit-orange" />
          <Mascot />
        </div>
      </div>
    </Reveal>
  );
}

export function HomeStory() {
  return (
    <div className="home-story">
      <ConversationToPlan />
      <RealityCheckStory />
      <SharedVersionStory />
      <ScenarioStory />
      <ClosingStory />
    </div>
  );
}
