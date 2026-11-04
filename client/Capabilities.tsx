import {
  MessagesSquare,
  ScanEye,
  Palette,
  Files,
  ArrowRight,
  Check,
} from "lucide-react";
import { Reveal } from "./MotionUI";
export function Capabilities() {
  return (
    <Reveal section className="capability-section section-shell">
      <div className="section-heading">
        <h2>
          From everyone’s reasons
          <br />
          to a plan worth keeping.
        </h2>
        <p>
          Gather the details. Explore the trade-offs.
          <br />
          Keep the decisions in one place.
        </p>
      </div>
      <p className="capability-context">
        Product preview · Illustrative workflow
      </p>
      <div className="capability-grid">
        {[
          {
            icon: MessagesSquare,
            title: "The reasons become requirements.",
            text: "Availability, budgets, screenshots, and suggestions become structured details. Compare what fits—and what each option gives up.",
            items: ["Availability", "Budget limits", "Shared priorities"],
          },
          {
            icon: ScanEye,
            title: "See what’s still missing.",
            text: "Reality Check surfaces conflicting dates, unclaimed responsibilities, and unanswered questions. A compromise stays a suggestion until you confirm it.",
            items: ["Conflicts", "Missing roles", "Open questions"],
          },
          {
            icon: Palette,
            title: "Picture the plan. Prepare for it.",
            text: "Choose a cover direction, then add cartoon-style preparation cards and illustrations of things to bring—all in the same visual family.",
            items: ["Plan covers", "Preparation cards", "Things to bring"],
          },
          {
            icon: Files,
            title: "Leave with one shared plan.",
            text: "Review the exact proposal together. The final dashboard, Decision Receipt, checklist, and download bundle give the agreement somewhere to live.",
            items: ["Plan approvals", "Decision Receipt", "PDF + ZIP"],
          },
        ].map(({ icon: Icon, title, text, items }) => (
          <article key={title}>
            <Icon size={27} aria-hidden="true" />
            <h3>{title}</h3>
            <p>{text}</p>
            <ul>
              {items.map((item) => (
                <li key={item}>
                  <Check size={13} aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      <div className="workflow-line" aria-label="Planning workflow">
        {[
          "Gather preferences",
          "Compare trade-offs",
          "Run Reality Check",
          "Review the plan",
        ].map((s, i) => (
          <span key={s}>
            {s}
            {i < 3 && <ArrowRight size={17} aria-hidden="true" />}
          </span>
        ))}
      </div>
    </Reveal>
  );
}
