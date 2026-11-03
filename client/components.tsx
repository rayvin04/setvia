import { useEffect, useRef, useState } from "react";
import {
  motion,
  useScroll,
  useMotionValueEvent,
  useReducedMotion,
} from "motion/react";
import { Attribution } from "./Attribution";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { initialHeaderState, nextHeaderState } from "./header-state";
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
  const [view, setView] = useState({ compact: false, hidden: false });
  const [focused, setFocused] = useState(false);
  const tracker = useRef(initialHeaderState);
  const location = useLocation();
  const { scrollY } = useScroll();
  const reduced = useReducedMotion();
  useEffect(() => {
    tracker.current = initialHeaderState;
    setView({ compact: false, hidden: false });
  }, [location.pathname]);
  useMotionValueEvent(scrollY, "change", (y) => {
    tracker.current = nextHeaderState(tracker.current, y);
    const { compact, hidden } = tracker.current;
    setView((old) =>
      old.compact === compact && old.hidden === hidden
        ? old
        : { compact, hidden },
    );
  });
  return (
    <motion.header
      className={cn("header", "site-header", view.compact && "is-scrolled")}
      data-hidden={view.hidden && !focused}
      animate={{
        y: reduced ? 0 : view.hidden && !focused ? -100 : 0,
        opacity: view.hidden && !focused ? 0 : 1,
      }}
      transition={{ duration: reduced ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false);
      }}
    >
      <motion.div className="header-inner">
        <Wordmark />
        <nav aria-label="Main navigation">
          <a href="/#how-it-works">How it works</a>
          <Link to="/demos">
            <span className="nav-explore-prefix">Explore&nbsp;</span>demos
          </Link>
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
    </motion.header>
  );
}
export function Footer() {
  const { pathname } = useLocation();
  const status =
    pathname === "/start"
      ? "Local planning draft"
      : pathname === "/join"
        ? "Room joining preview"
        : "Fictional demo data";
  return (
    <footer className="footer">
      <Wordmark />
      <Attribution />
      <span>{status}</span>
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
