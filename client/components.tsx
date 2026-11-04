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
import { Check, ChevronDown, Copy, LogOut, Volume2, VolumeX } from "lucide-react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { initialHeaderState, nextHeaderState } from "./header-state";
import { useSetviaSounds } from "./sound";
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
      transition={{ type: "spring", bounce: 0, visualDuration: 0.24 }}
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
      <span className="brand-name">Setvia</span>
    </Link>
  );
}
export type LiveRoomHeaderProps = {
  title: string;
  serviceLabel: string;
  connectionLabel: string;
  connectionState: string;
  roomCode: string;
  inviteLink?: string;
  copied: boolean;
  onCopyLink?: () => void;
  onCopyCode?: () => void;
  onLeave?: () => void;
  leaving?: boolean;
};

export function Header({
  room,
}: {
  room?: LiveRoomHeaderProps;
} = {}) {
  const [view, setView] = useState({ compact: false, hidden: false });
  const [focused, setFocused] = useState(false);
  const tracker = useRef(initialHeaderState);
  const location = useLocation();
  const sounds = useSetviaSounds();
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
      initial={false}
      className={cn(
        "header",
        "site-header",
        room && "live-room-site-header",
        view.compact && "is-scrolled",
      )}
      data-hidden={view.hidden && !focused && !room}
      animate={{
        scale: reduced ? 1 : view.hidden && !focused && !room ? 0.96 : 1,
        opacity: view.hidden && !focused && !room ? 0 : 1,
      }}
      transition={{
        scale: reduced
          ? { duration: 0 }
          : { type: "spring", bounce: 0, visualDuration: 0.32 },
        opacity: { duration: reduced ? 0.08 : 0.2, ease: "easeInOut" },
      }}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false);
      }}
    >
      <motion.div
        className={cn("header-inner", room && "live-room-header-inner")}
        layout={reduced ? false : true}
        transition={{
          layout: { type: "spring", bounce: 0, visualDuration: 0.4 },
        }}
      >
        <motion.div layout={reduced ? false : "position"}>
          <Wordmark />
        </motion.div>
        {room ? (
          <>
            <div className="live-room-identity" aria-label="Current planning room">
              <div>
                <strong title={room.title}>{room.title}</strong>
                <span>{room.serviceLabel}</span>
              </div>
              <span
                className="live-connection"
                data-status={room.connectionState}
                role="status"
              >
                <i aria-hidden="true" />
                {room.connectionLabel}
              </span>
            </div>
            <motion.nav
              className="live-room-nav"
              layout={reduced ? false : "position"}
              aria-label="Room controls"
            >
              {room.inviteLink ? (
                <details className="room-invite-popover">
                  <summary className="room-header-button room-invite-trigger">
                    <Copy size={15} aria-hidden="true" />
                    <span>Invite</span>
                    <ChevronDown size={13} aria-hidden="true" />
                  </summary>
                  <div className="room-invite-menu" role="group" aria-label="Room invitation">
                    <button type="button" onClick={room.onCopyLink}>
                      {room.copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
                      <span>{room.copied ? "Link copied" : "Copy link"}</span>
                    </button>
                    <div className="room-code-row">
                      <span>Room code</span>
                      <code>{room.roomCode}</code>
                      {room.onCopyCode ? (
                        <button
                          type="button"
                          className="room-code-copy"
                          aria-label="Copy room code"
                          onClick={room.onCopyCode}
                        >
                          <Copy size={14} aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                </details>
              ) : null}
              {room.onLeave ? (
                <button
                  type="button"
                  className="room-header-button room-leave-button"
                  disabled={room.leaving}
                  onClick={room.onLeave}
                >
                  <LogOut size={15} aria-hidden="true" />
                  <span>{room.leaving ? "Leaving…" : "Leave"}</span>
                </button>
              ) : null}
            </motion.nav>
          </>
        ) : (
          <motion.nav
            layout={reduced ? false : "position"}
            aria-label="Main navigation"
          >
            <a href="/#how-it-works">How it works</a>
            <Link to="/demos">
              <span className="nav-explore-prefix">Explore&nbsp;</span>demos
            </Link>
            <button
              type="button"
              className="sound-toggle"
              aria-pressed={sounds.enabled}
              aria-label={
                sounds.enabled
                  ? "Turn interface sounds off"
                  : "Turn interface sounds on"
              }
              onClick={sounds.toggle}
            >
              {sounds.enabled ? (
                <Volume2 size={16} aria-hidden="true" />
              ) : (
                <VolumeX size={16} aria-hidden="true" />
              )}
              <span>{sounds.enabled ? "Sound on" : "Sound off"}</span>
            </button>
            <Link to="/join" className="join-link">
              Join a Room
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
          </motion.nav>
        )}
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
    <footer
      className={cn("footer", pathname === "/start" && "planning-footer")}
    >
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
