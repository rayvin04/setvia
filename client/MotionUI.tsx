import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
export function Reveal({
  children,
  className,
  id,
  section = false,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
  section?: boolean;
}) {
  const reduced = useReducedMotion();
  const Element = section ? motion.section : motion.div;
  return (
    <Element
      data-reveal
      id={id}
      className={className}
      initial={false}
      whileInView={reduced ? undefined : { y: [6, 0] }}
      viewport={{ once: true, amount: 0.12 }}
      transition={
        reduced
          ? { duration: 0.16 }
          : { duration: 0.42, ease: [0.4, 0, 0.2, 1] }
      }
    >
      {children}
    </Element>
  );
}
export function PageTransition({ children }: { children: ReactNode }) {
  const location = useLocation();
  const reduced = useReducedMotion();
  const previous = useRef(location.pathname);
  useLayoutEffect(() => {
    if (previous.current !== location.pathname) {
      previous.current = location.pathname;
      if (!location.hash) {
        window.scrollTo({ top: 0, behavior: "instant" });
        const heading = document.querySelector<HTMLElement>("main h1");
        heading?.setAttribute("tabindex", "-1");
        heading?.focus({ preventScroll: true });
      }
    }
  }, [location.pathname, location.hash]);
  return (
    <motion.div
      className="route-frame"
      key={location.pathname}
      initial={{ opacity: 0, y: reduced ? 0 : 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        reduced
          ? { duration: 0.12 }
          : {
              opacity: { duration: 0.24, ease: "easeInOut" },
              y: { type: "spring", bounce: 0, visualDuration: 0.32 },
            }
      }
    >
      {children}
    </motion.div>
  );
}
