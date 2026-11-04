import {
  ArrowRight,
  Backpack,
  CalendarDays,
  CarFront,
  Check,
  RotateCcw,
  ShieldCheck,
  UsersRound,
  Wallet,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Link } from "react-router-dom";
import { Mascot } from "./Mascot";
import { scenarios } from "./demoData";
import { Reveal } from "./MotionUI";
import { InteractivePlanPreview } from "./InteractivePlanPreview";
import { LivingPlayground } from "./LivingPlayground";
import { ClosingInvitation, EventAgreement } from "./LandingClosing";
import "./home-story.css";

function StoryHeading({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="story-heading">
      <h2>{title}</h2>
      <p>{children}</p>
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
      <StoryHeading title="Is this your group chat?">
        Tight budget. Someone needs an early ride home. Everyone is free at a
        different time. Setvia makes those trade-offs visible so your group can
        find a plan people can actually say yes to.
      </StoryHeading>
      <div className="story-translation" data-visual-slot="chat-demo">
        <picture
          className="story-demo-frame story-chat-media"
          data-visual-slot="animated-chat-demo"
        >
          <source
            media="(prefers-reduced-motion: reduce)"
            srcSet="/story-media/setvia-chat-animated-final.png"
            type="image/png"
          />
          <img
            src="/story-media/setvia-chat-animated-4-5s.gif"
            width={681}
            height={495}
            alt="Fictional group chat: Hu Tao cannot make Saturday, Selena has a ₱2,500 budget, Furina can drive early, and Manta Ray wants somewhere nearby."
            decoding="async"
          />
        </picture>
        <span className="story-bridge" aria-hidden="true">
          <ArrowRight size={23} />
        </span>
        <InteractivePlanPreview />
      </div>
    </Reveal>
  );
}

const realityChecks = [
  {
    label: "Schedule",
    icon: CalendarDays,
    finding: "Same trip. Different return times.",
    question: "When could you head back?",
    context: "Two prefer Sunday evening. Two need Monday morning.",
    options: ["Sunday · 7 PM", "Monday · 9 AM", "Either works"],
    answer:
      "Your sample preference is recorded. The other people still need to agree on a return time.",
  },
  {
    label: "Budget",
    icon: Wallet,
    finding: "The amount is set. The scope isn’t.",
    question: "Does ₱2,500 include the ride?",
    context: "A shared number can mean different things to different people.",
    options: ["Include travel", "Food and stay only", "Not sure yet"],
    answer:
      "That makes the sample limit clearer. The group still needs a cost estimate before booking.",
  },
  {
    label: "People",
    icon: UsersRound,
    finding: "Eight expected. Four planning.",
    question: "Are the other guests confirmed?",
    context: "Room participants and event attendees are different counts.",
    options: ["Still checking", "Invited, not confirmed", "Confirmed directly"],
    answer:
      "The sample attendance note is updated. This doesn’t count as anyone’s approval of the plan.",
  },
  {
    label: "Logistics",
    icon: CarFront,
    finding: "A driver helps. Seats still matter.",
    question: "How will the rest get there?",
    context: "Furina can drive, but one car may not fit everyone.",
    options: ["Find a second car", "Meet at the venue", "Ask the group"],
    answer:
      "The example now has a next step for transport. Seat availability remains open until checked.",
  },
  {
    label: "Preparation",
    icon: Backpack,
    finding: "A picnic needs more than a place.",
    question: "Who will take care of food?",
    context: "No one has taken this on yet.",
    options: ["I can bring snacks", "Split a food order", "Decide together"],
    answer:
      "That sample idea is added for discussion. The food plan still needs the group’s agreement.",
  },
  {
    label: "Safety",
    icon: ShieldCheck,
    finding: "Leave room for a safer option.",
    question: "What if the weather turns?",
    context: "The outdoor plan doesn’t have a fallback yet.",
    options: [
      "Pick an indoor backup",
      "Reschedule if needed",
      "Check closer to the day",
    ],
    answer:
      "The example has a fallback to consider. Weather and venue conditions still need checking.",
  },
];

function RealityCheckStory() {
  const [selected, setSelected] = useState(0);
  const [replies, setReplies] = useState<Record<number, string>>({});
  const check = realityChecks[selected];
  const reduced = useReducedMotion();
  return (
    <Reveal section className="home-story-section story-reality">
      <StoryHeading title="A good plan shows what’s still a question.">
        Find the missing piece, ask a useful question, and leave the decision
        with the group.
      </StoryHeading>
      <div className="reality-demo" data-visual-slot="reality-check-demo">
        <div
          className="reality-selector"
          role="group"
          aria-label="Reality Checks"
        >
          {realityChecks.map(({ label, icon: Icon }, index) => (
            <button
              type="button"
              key={label}
              aria-pressed={selected === index}
              aria-controls="reality-finding"
              onClick={() => setSelected(index)}
            >
              <Icon size={19} aria-hidden="true" />
              <span>
                {label}
                <small>Check</small>
              </span>
            </button>
          ))}
        </div>
        <div className="reality-finding" id="reality-finding">
          <div className="reality-finding-top">
            <span>{check.label} Check</span>
            <span className="needs-decision">
              {replies[selected] ? "Sample reply added" : "Needs a decision"}
            </span>
          </div>
          <motion.div
            key={selected}
            initial={{ opacity: reduced ? 1 : 0.7 }}
            animate={{ opacity: 1 }}
            transition={{ duration: reduced ? 0 : 0.22, ease: "easeInOut" }}
          >
            <h3>{check.finding}</h3>
            <p>{check.context}</p>
            <div className="reality-question">
              <Mascot />
              <strong>{check.question}</strong>
            </div>
            <div
              className="reality-replies"
              role="group"
              aria-label="Choose a fictional reply"
            >
              {check.options.map((option) => (
                <motion.button
                  type="button"
                  key={option}
                  aria-pressed={replies[selected] === option}
                  whileTap={reduced ? undefined : { scale: 0.97 }}
                  onClick={() =>
                    setReplies((old) => ({ ...old, [selected]: option }))
                  }
                >
                  {replies[selected] === option && (
                    <Check size={15} aria-hidden="true" />
                  )}
                  {option}
                </motion.button>
              ))}
            </div>
          </motion.div>
          <p className="reality-response" role="status">
            {replies[selected]
              ? check.answer
              : "Choose a reply to explore the example."}
          </p>
          <div className="preview-footnote">
            <span>Fictional example · no AI request</span>
            <button type="button" onClick={() => setReplies({})}>
              <RotateCcw size={12} aria-hidden="true" />
              Reset
            </button>
          </div>
        </div>
      </div>
    </Reveal>
  );
}

function ScenarioStory() {
  const [selected, setSelected] = useState(scenarios[0].id);
  const featured = scenarios.find((scenario) => scenario.id === selected)!;
  const reduced = useReducedMotion();
  return (
    <Reveal
      section
      id="explore-demos"
      className="home-story-section story-scenarios"
    >
      <StoryHeading title="Different groups. Different ways forward.">
        Start with a situation you know. Explore a fictional example, then make
        the plan your own.
      </StoryHeading>
      <div className="story-scenario-wall">
        <div className="story-scenario-featured" id="scenario-preview">
          <motion.div
            className="story-scenario-featured-art"
            key={selected}
            initial={{ opacity: reduced ? 1 : 0.65 }}
            animate={{ opacity: 1 }}
            transition={{ duration: reduced ? 0 : 0.24, ease: "easeInOut" }}
          >
            <img
              src={`/covers/${featured.id}-2.svg`}
              alt={`Setvia cats planning a ${featured.title.toLowerCase()}`}
              width={600}
              height={450}
              loading="lazy"
            />
          </motion.div>
          <div className="story-scenario-featured-copy">
            <div>
              <h3>{featured.title}</h3>
              <p>{featured.question}</p>
            </div>
            <Link
              to={`/demos?scenario=${featured.id}`}
              aria-label={`Explore ${featured.title} demo`}
              className="story-scenario-action"
            >
              Explore
            </Link>
          </div>
        </div>
        <div
          className="story-scenario-rail"
          role="group"
          aria-label="Choose a scenario"
        >
          {scenarios.map((scenario) => (
            <button
              type="button"
              className="story-scenario-link"
              key={scenario.id}
              aria-pressed={selected === scenario.id}
              aria-controls="scenario-preview"
              onClick={() => setSelected(scenario.id)}
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
            </button>
          ))}
        </div>
      </div>
    </Reveal>
  );
}

export function HomeStory() {
  return (
    <div className="home-story">
      <LivingPlayground />
      <ConversationToPlan />
      <RealityCheckStory />
      <EventAgreement />
      <ScenarioStory />
      <ClosingInvitation />
    </div>
  );
}
