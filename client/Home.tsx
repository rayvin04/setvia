import { HomeStory } from "./HomeStory";
import { Reveal } from "./MotionUI";
import { ButtonLink } from "./components";
import { Waves } from "./Waves";
import { Mascot } from "./Mascot";

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
              </ButtonLink>
            </div>
            <ButtonLink to="/demos" secondary>
              Try Demo
            </ButtonLink>
          </div>
        </Reveal>
      </section>
      <HomeStory />
    </>
  );
}
