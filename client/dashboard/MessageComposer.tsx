import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "motion/react";
import {
  Check,
  Info,
  LoaderCircle,
  LockKeyhole,
  MessageCircle,
  Send,
  Users,
  X,
} from "lucide-react";
import { ComposerCat } from "../Mascot";
import type { Question } from "../../server/src/agents/contracts";
import {
  MAX_PLANNING_MESSAGE_LENGTH,
  PlanningMessageSchema,
  planningMessageErrorText,
  type MessageVisibility,
  type SubmitPlanningMessage,
} from "../../shared/planning-message";
import {
  composerInputHeight,
  virtualKeyboardInset,
  type QuickReply,
} from "./composer-model";

export interface MessageComposerHandle {
  focus(): void;
}
export interface MessageComposerProps {
  roomId: string;
  viewer: { id: string; name: string };
  revision: number;
  proposalVersion: number;
  question?: Question;
  replies: QuickReply[];
  allowedVisibilities: readonly MessageVisibility[];
  onSubmit: SubmitPlanningMessage;
  onReview?: (findingId: string) => void;
  onHeightChange?: (height: number) => void;
  onBottomInsetChange?: (inset: number) => void;
  disabled?: boolean;
  disabledReason?: string;
  pending?: boolean;
  error?: string;
  mode: "preview" | "room";
}

export const MessageComposer = forwardRef<
  MessageComposerHandle,
  MessageComposerProps
>(function MessageComposer(
  {
    roomId,
    viewer,
    revision,
    proposalVersion,
    question,
    replies,
    allowedVisibilities,
    onSubmit,
    onReview,
    onHeightChange,
    onBottomInsetChange,
    disabled = false,
    disabledReason,
    pending = false,
    error: externalError = "",
    mode,
  },
  forwardedRef,
) {
  const id = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const growth = useRef<Animation | null>(null);
  const reducedMotion = useReducedMotion();
  const dock = useRef<HTMLElement>(null);
  const active = useRef<AbortController | null>(null);
  const draft = useRef("");
  const retryMessage = useRef<{ id: string; text: string } | null>(null);
  const [text, setText] = useState("");
  const [visibility, setVisibility] = useState<MessageVisibility>(
    mode === "room" && allowedVisibilities.includes("group") ? "group" : "private",
  );
  const [answering, setAnswering] = useState(Boolean(question));
  const [selectedReply, setSelectedReply] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [submissionError, setSubmissionError] = useState("");
  const [acknowledgment, setAcknowledgment] = useState("");
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const idleTimer = useRef<number | null>(null);
  const focusAfterReveal = useRef(false);
  const [viewport, setViewport] = useState({
    inset: 0,
    keyboard: false,
    height: null as number | null,
    width: null as number | null,
  });
  const busy = sending || pending;
  const choices = answering && question
    ? allowedVisibilities.filter((choice) => choice === question.visibility)
    : allowedVisibilities;
  const effectiveVisibility = choices.includes(visibility)
    ? visibility
    : (choices[0] ?? "private");
  const error = validationError || submissionError || externalError;
  const canCollapse = mode === "room" && !question && !focusWithin && !text.trim() && !busy && !privacyOpen && !selectedReply && !error && !viewport.keyboard;
  const canCollapseRef = useRef(canCollapse);
  canCollapseRef.current = canCollapse;
  const scheduleIdleCollapse = useCallback(() => {
    if (mode !== "room") return;
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      if (canCollapseRef.current) setCollapsed(true);
    }, 2_000);
  }, [mode]);
  useEffect(() => {
    onBottomInsetChange?.(viewport.inset);
  }, [onBottomInsetChange, viewport.inset]);

  useImperativeHandle(
    forwardedRef,
    () => ({
      focus() {
        if (mode === "room") {
          focusAfterReveal.current = true;
          setCollapsed(false);
        } else {
          textarea.current?.focus();
        }
      },
    }),
    [mode],
  );
  useLayoutEffect(() => {
    if (mode !== "room" || collapsed || !focusAfterReveal.current) return;
    focusAfterReveal.current = false;
    textarea.current?.focus({ preventScroll: true });
  }, [collapsed, mode]);
  useEffect(
    () => () => {
      active.current?.abort();
      growth.current?.cancel();
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (mode !== "room") return;
    if (!canCollapse) {
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
      setCollapsed(false);
      return;
    }
    scheduleIdleCollapse();
    return () => {
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    };
  }, [canCollapse, mode, scheduleIdleCollapse]);
  useEffect(() => {
    if (mode !== "room") return;
    const revealOnScroll = () => {
      setCollapsed(false);
      scheduleIdleCollapse();
    };
    document.addEventListener("scroll", revealOnScroll, { passive: true, capture: true });
    return () => document.removeEventListener("scroll", revealOnScroll, true);
  }, [mode, scheduleIdleCollapse]);
  useEffect(() => {
    setSelectedReply(null);
    setAnswering(Boolean(question) && !draft.current.trim());
    if (question && !draft.current.trim()) setVisibility(question.visibility);
  }, [question?.id, question?.visibility, proposalVersion]);
  useLayoutEffect(() => {
    const input = textarea.current;
    if (!input) return;
    const previous = input.getBoundingClientRect().height;
    const chrome = Math.max(
      0,
      (dock.current?.getBoundingClientRect().height ?? 160) - previous,
    );
    growth.current?.cancel();
    input.style.height = "0px";
    const contentHeight = input.scrollHeight;
    const desired = composerInputHeight(
      contentHeight,
      chrome,
      viewport.height ?? window.innerHeight,
    );
    const next = mode === "room" && (viewport.width ?? window.innerWidth) <= 700
      ? Math.min(desired, 132)
      : desired;
    input.style.height = next + "px";
    input.style.overflowY = contentHeight > next ? "auto" : "hidden";
    input.dataset.overflow = String(contentHeight > next);
    if (!reducedMotion && Math.abs(previous - next) > 1 && input.animate) {
      growth.current = input.animate(
        [{ height: previous + "px" }, { height: next + "px" }],
        {
          duration: 180,
          easing: "cubic-bezier(0.4, 0, 0.2, 1)",
        },
      );
    }
  }, [
    text,
    viewport.height,
    viewport.width,
    reducedMotion,
    privacyOpen,
    error,
    question?.text,
    answering,
    selectedReply,
    mode,
  ]);
  useLayoutEffect(() => {
    if (!dock.current || !onHeightChange) return;
    const observer = new ResizeObserver(([entry]) =>
      onHeightChange(Math.ceil(entry.target.getBoundingClientRect().height)),
    );
    observer.observe(dock.current);
    return () => observer.disconnect();
  }, [onHeightChange]);
  useEffect(() => {
    const visual = window.visualViewport;
    const update = () => {
      const height = visual?.height ?? window.innerHeight;
      const width = window.innerWidth;
      const inset = virtualKeyboardInset(
        window.innerHeight,
        height,
        visual?.offsetTop ?? 0,
      );
      const keyboard =
        document.activeElement === textarea.current &&
        (inset > 120 || height < 500);
      setViewport((old) =>
        old.inset === inset &&
        old.keyboard === keyboard &&
        old.height === height &&
        old.width === width
          ? old
          : { inset, keyboard, height, width },
      );
    };
    visual?.addEventListener("resize", update);
    visual?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    update();
    return () => {
      visual?.removeEventListener("resize", update);
      visual?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, []);

  async function send(quickOption?: string) {
    if (disabled || busy || !choices.length) return;
    const rawText = quickOption ?? text;
    const messageId = retryMessage.current?.text === rawText
      ? retryMessage.current.id
      : crypto.randomUUID();
    retryMessage.current = { id: messageId, text: rawText };
    const parsed = PlanningMessageSchema.safeParse({
      roomId,
      viewerId: viewer.id,
      messageId,
      expectedRevision: revision,
      proposalVersion,
      questionId:
        (quickOption !== undefined || answering) && question
          ? question.id
          : null,
      replyOption: quickOption ?? (answering ? selectedReply : null),
      // An answer inherits the audience of the question. This ensures a
      // suggested reply to a group question enters the shared cycle, while a
      // private question can never be disclosed through its answer control.
      visibility:
        quickOption !== undefined && question
          ? question.visibility
          : effectiveVisibility,
      text: rawText,
    });
    if (!parsed.success) {
      setValidationError(
        `Write a thought before sending. Keep it within ${MAX_PLANNING_MESSAGE_LENGTH.toLocaleString("en")} characters.`,
      );
      textarea.current?.focus();
      return;
    }
    const controller = new AbortController();
    active.current?.abort();
    active.current = controller;
    setSending(true);
    setValidationError("");
    setSubmissionError("");
    setAcknowledgment("");
    try {
      const receipt = await onSubmit(parsed.data, controller.signal);
      if (controller.signal.aborted) return;
      setText("");
      draft.current = "";
      retryMessage.current = null;
      setSelectedReply(null);
      // A private targeted answer must not silently make all later, unrelated
      // thoughts private. Change only the fresh, now-empty composer.
      if (mode === "room" && parsed.data.questionId && receipt.visibility === "private" && allowedVisibilities.includes("group"))
        setVisibility("group");
      setAcknowledgment(
        receipt.mode === "preview"
          ? `Response recorded in preview · ${receipt.visibility === "private" ? "Private answer" : "Shared with room members"}. No AI analysis ran.`
          : receipt.visibility === "private"
            ? "Private note sent. Review and confirm an extracted suggestion to update the shared plan."
            : "Thought shared. The planning team will review it and ask about the next unresolved detail.",
      );
    } catch (failure) {
      if (!controller.signal.aborted)
        setSubmissionError(planningMessageErrorText(failure));
    } finally {
      if (!controller.signal.aborted) setSending(false);
    }
  }
  function choose(reply: QuickReply) {
    if (
      !question ||
      !question.options.includes(reply.label) ||
      disabled ||
      busy
    )
      return;
    if (reply.intent === "review") {
      onReview?.(question.findingId);
      return;
    }
    setAnswering(true);
    setSelectedReply(reply.label);
    if (reply.intent === "compose") {
      setAcknowledgment("");
      requestAnimationFrame(() => textarea.current?.focus());
    } else void send(reply.label);
  }

  const sendButton = (
    <motion.button
      className="sv-send"
      whileHover={reducedMotion ? undefined : { scale: 1.04 }}
      whileTap={reducedMotion ? { opacity: 0.8 } : { scale: 0.94 }}
      transition={{ type: "spring", bounce: 0, visualDuration: 0.22 }}
      type="submit"
      disabled={disabled || busy || !text.trim() || !choices.length}
      aria-label={busy ? mode === "preview" ? "Recording preview response" : "Sending response" : mode === "preview" ? "Send preview message" : "Send message"}
      title={busy ? "Sending…" : "Send message"}
    >
      {busy ? <LoaderCircle size={20} className="sv-sending-icon" aria-hidden="true" />
        : mode === "room" ? <Send size={21} strokeWidth={1.8} aria-hidden="true" /> : <span>Send</span>}
    </motion.button>
  );

  const content = (
    <section
      ref={dock}
      className="sv-composer-dock"
      data-mode={mode}
      data-has-question={Boolean(question)}
      data-keyboard={viewport.keyboard}
      data-collapsed={mode === "room" && collapsed}
      aria-label="Planning room composer"
      style={{
        bottom: `calc(${viewport.inset}px + max(8px, env(safe-area-inset-bottom)))`,
        maxHeight: viewport.height
          ? `calc(${viewport.height}px - 16px - env(safe-area-inset-bottom))`
          : undefined,
      }}
      onPointerDown={() => scheduleIdleCollapse()}
      onFocusCapture={(event) => {
        if (event.target instanceof Element && event.target.closest(".sv-composer-peek")) return;
        setFocusWithin(true);
        setCollapsed(false);
        if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
      }}
      onBlurCapture={(event) => {
        const next = event.relatedTarget;
        setFocusWithin(next instanceof Node && event.currentTarget.contains(next));
      }}
    >
      <motion.div
        className="sv-composer-content"
        aria-hidden={mode === "room" && collapsed}
        inert={mode === "room" && collapsed}
        animate={{ opacity: mode === "room" && collapsed ? 0 : 1, y: mode === "room" && collapsed ? 12 : 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.2, ease: [0.2, 0.75, 0.25, 1] }}
        style={{ position: mode === "room" && collapsed ? "absolute" : "relative", inset: mode === "room" && collapsed ? 0 : undefined }}
      >
      <form
        id={`${id}-composer`}
        className="sv-composer"
        aria-label="Share your thoughts with Setvia"
        aria-busy={busy}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        {question ? (
          <div className="sv-question-block">
            <div className="sv-question-heading">
              <MessageCircle size={15} aria-hidden="true" />
              <p id={`${id}-question`} tabIndex={mode === "room" ? 0 : undefined}>{question.text}</p>
              <button
                type="button"
                className="sv-thought-toggle"
                onClick={() => {
                  if (answering && question.visibility === "private" && !draft.current.trim() && allowedVisibilities.includes("group"))
                    setVisibility("group");
                  setAnswering((value) => !value);
                  setSelectedReply(null);
                  textarea.current?.focus();
                }}
                disabled={disabled || busy}
              >
                {answering ? question.visibility === "private" && !text.trim() ? "New shared thought" : "New thought" : "Answer this"}
              </button>
            </div>
            <div
              className="sv-quick-replies"
              role="group"
              aria-labelledby={`${id}-question`}
            >
              {replies
                .filter((reply) => question.options.includes(reply.label))
                .map((reply) => (
                  <button
                    type="button"
                    key={reply.id}
                    disabled={disabled || busy}
                    aria-pressed={selectedReply === reply.label}
                    onClick={() => choose(reply)}
                  >
                    {selectedReply === reply.label ? (
                      <Check size={13} aria-hidden="true" />
                    ) : null}
                    {reply.label}
                  </button>
                ))}
            </div>
          </div>
        ) : null}
        <div className="sv-entry-layer">
        {selectedReply && answering ? (
          <div className="sv-reply-context">
            <span>{selectedReply} · add your alternative</span>
            <button
              type="button"
              aria-label="Clear selected reply"
              onClick={() => setSelectedReply(null)}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </div>
        ) : null}
        {question && !answering ? (
          <p className="sv-new-thought">
            Sharing a new thought · the question stays open
          </p>
        ) : null}
        <div className="sv-input-row">
          <label className="sr-only" htmlFor={`${id}-input`}>
            Share your thoughts with Setvia
          </label>
          <textarea
            ref={textarea}
            id={`${id}-input`}
            placeholder={
              selectedReply && answering
                ? "Tell Setvia your alternative..."
                : "Share your thoughts with Setvia..."
            }
            rows={1}
            maxLength={MAX_PLANNING_MESSAGE_LENGTH}
            required
            value={text}
            disabled={disabled || busy}
            aria-invalid={Boolean(validationError) || undefined}
            aria-describedby={`${id}-privacy ${id}-error`}
            onChange={(event) => {
              setText(event.target.value);
              draft.current = event.target.value;
              retryMessage.current = null;
              setValidationError("");
              setSubmissionError("");
              setAcknowledgment("");
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void send();
              }
            }}
          />
          {mode === "room" ? sendButton : null}
        </div>
        <div className="sv-composer-footer">
          <div className="sv-visibility-control">
            {effectiveVisibility === "private" ? (
              <LockKeyhole size={13} aria-hidden="true" />
            ) : (
              <Users size={13} aria-hidden="true" />
            )}
            <label className="sr-only" htmlFor={`${id}-visibility`}>
              Message visibility
            </label>
            <select
              id={`${id}-visibility`}
              value={effectiveVisibility}
              disabled={disabled || busy || choices.length < 2}
              onChange={(event) =>
                setVisibility(event.target.value as MessageVisibility)
              }
            >
              {choices.map((choice) => (
                <option key={choice} value={choice}>
                  {choice === "private" ? "Private answer" : "Share with group"}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="sv-privacy-toggle"
              aria-label="Message privacy details"
              aria-expanded={privacyOpen}
              aria-controls={`${id}-privacy`}
              onClick={() => setPrivacyOpen((open) => !open)}
            >
              <Info size={14} aria-hidden="true" />
            </button>
          </div>
          {mode === "preview" ? (
            <span className="sv-composer-mode">Preview only · no live AI</span>
          ) : <span className="sv-composer-mode">{effectiveVisibility === "group"
            ? "Sending starts a new shared review."
            : "Private note · confirm suggestions to update the shared plan."}</span>}
          {mode === "preview" ? sendButton : null}
        </div>
        <p
          className="sv-privacy-copy"
          id={`${id}-privacy`}
          hidden={!privacyOpen}
        >
          {effectiveVisibility === "private"
            ? mode === "preview"
              ? "Only you can see this response in the preview. No AI processing runs here. In a live room, private answers are still sent to Meta’s Model API for analysis."
              : "Only you can see this response among room members. Setvia sends the text to Meta’s Model API for private analysis. Extracted suggestions stay private until you explicitly confirm and share them."
            : mode === "preview"
              ? "Your message is visible to other room members in this preview. No AI processing runs here."
              : "Your message is shared with room members and sent to Meta’s Model API for analysis."}
          {answering && question?.visibility === "private"
            ? " This targeted question accepts private answers only."
            : ""}
        </p>
        <p className="sv-composer-error" id={`${id}-error`} role="alert">
          {error}
        </p>
        <p className={`sv-composer-status${mode === "room" && acknowledgment && !busy && !disabled ? " sr-only" : ""}`} role="status" aria-live="polite">
          {disabled
            ? disabledReason
            : busy
              ? mode === "preview"
                ? "Recording your response in this preview…"
                : "Sending your response…"
              : acknowledgment}
        </p>
        </div>
      </form>
      </motion.div>
      {mode === "room" ? (
        <motion.button
          type="button"
          className="sv-composer-peek"
          aria-label="Open message composer"
          aria-controls={`${id}-composer`}
          aria-expanded={!collapsed}
          aria-hidden={!collapsed}
          inert={!collapsed}
          onClick={() => {
            focusAfterReveal.current = true;
            setCollapsed(false);
          }}
          animate={{ opacity: collapsed ? 1 : 0, y: collapsed ? 0 : 10, scale: collapsed ? 1 : 0.96 }}
          transition={{ duration: reducedMotion ? 0 : 0.18, ease: [0.2, 0.75, 0.25, 1] }}
        >
          <span className="sv-composer-peek-cat" aria-hidden="true"><ComposerCat /></span>
          <span>Share a thought</span>
          <span className="sr-only">with Setvia</span>
        </motion.button>
      ) : null}
    </section>
  );
  return typeof document === "undefined"
    ? content
    : createPortal(content, document.body);
});
