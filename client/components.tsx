import { useState } from "react";
import {
  motion,
  useScroll,
  useMotionValueEvent,
  useReducedMotion,
} from "motion/react";
import { Attribution } from "./Attribution";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
export const cn = (...values: Parameters<typeof clsx>) =>
  twMerge(clsx(...values));
const MotionLink = motion.create(Link);
export function ButtonLink({
  to,
  children,
  secondary = false,
  className,
}: {
  to: string;
  children: ReactNode;
  secondary?: boolean;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <MotionLink
      whileTap={reduced ? { opacity: 0.8 } : { scale: 0.96 }}
      whileHover={reduced ? { opacity: 0.9 } : { y: -2 }}
      transition={{ type: "spring", bounce: 0, duration: 0.2 }}
      className={cn(
        "button",
        secondary ? "button-secondary" : "button-primary",
        className,
      )}
      to={to}
    >
      {children}
    </MotionLink>
  );
}
export function Wordmark() {
  return (
    <Link to="/" className="wordmark" aria-label="Setvia home">
      <span className="brand-eyes" aria-hidden="true">
        <i />
        <i />
      </span>
      setvia<span className="brand-period">.</span>
    </Link>
  );
}
export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const { scrollY } = useScroll();
  const reduced = useReducedMotion();
  useMotionValueEvent(scrollY, "change", (y) =>
    setScrolled((old) => (old === y > 28 ? old : y > 28)),
  );
  return (
    <header className={cn("header", scrolled && "is-scrolled")}>
      <motion.div
        className="header-inner"
        animate={{ scale: scrolled && !reduced ? 0.985 : 1 }}
        transition={{ type: "spring", bounce: 0, duration: 0.35 }}
      >
        <Wordmark />
        <nav aria-label="Main navigation">
          <a href="/#how-it-works">How it works</a>
          <Link to="/demos">Explore demos</Link>
          <Link to="/join" className="join-link">
            Join a Room
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
          <a
            className="github-link"
            href="https://github.com/rayvin04/setvia"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Setvia on GitHub (opens in a new tab)"
          >
            <img
              src="/github-mark.svg"
              width="19"
              height="19"
              alt=""
              className="github-mark"
            />
          </a>
        </nav>
      </motion.div>
    </header>
  );
}
export function Footer() {
  return (
    <footer className="footer">
      <Wordmark />
      <Attribution />
      <span>UI prototype · Mocked data</span>
    </footer>
  );
}
export function TextLink({
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a className="text-link" {...props}>
      {children}
    </a>
  );
}
