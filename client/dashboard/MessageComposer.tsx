import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowUp,
  Check,
  Info,
  LoaderCircle,
  LockKeyhole,
  MessageCircle,
  Users,
  X,
} from "lucide-react";
import type { Question } from "../../server/src/agents/contracts";
import {
  MAX_PLANNING_MESSAGE_LENGTH,
  PlanningMessageSchema,
  planningMessageErrorText,
  type MessageVisibility,
  type SubmitPlanningMessage,
} from "../../shared/planning-message";
import { virtualKeyboardInset, type QuickReply } from "./composer-model";

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
  const dock = useRef<HTMLElement>(null);
  const active = useRef<AbortController | null>(null);
  const draft = useRef("");
  const retryMessage = useRef<{ id: string; text: string } | null>(null);
  const [text, setText] = useState("");
  const [visibility, setVisibility] = useState<MessageVisibility>("private");
  const [answering, setAnswering] = useState(Boolean(question));
  const [selectedReply, setSelectedReply] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [submissionError, setSubmissionError] = useState("");
  const [acknowledgment, setAcknowledgment] = useState("");
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [viewport, setViewport] = useState({
    inset: 0,
    keyboard: false,
    height: null as number | null,
  });
  const busy = sending || pending;
  const privateQuestion = answering && question?.visibility === "private";
  const choices = privateQuestion
    ? allowedVisibilities.filter((choice) => choice === "private")
    : allowedVisibilities;
  const effectiveVisibility = choices.includes(visibility)
    ? visibility
    : (choices[0] ?? "private");
  const error = validationError || submissionError || externalError;
  useEffect(() => {
    onBottomInsetChange?.(viewport.inset);
  }, [onBottomInsetChange, viewport.inset]);

  useImperativeHandle(
    forwardedRef,
    () => ({
      focus() {
        textarea.current?.focus();
      },
    }),
    [],
  );
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    setSelectedReply(null);
    setAnswering(Boolean(question) && !draft.current.trim());
    if (question?.visibility === "private") setVisibility("private");
  }, [question?.id, question?.visibility, proposalVersion]);
  useLayoutEffect(() => {
    const input = textarea.current;
    if (!input) return;
    input.style.height = "0px";
    input.style.height = Math.min(Math.max(input.scrollHeight, 44), 132) + "px";
  }, [text]);
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
        old.height === height
          ? old
          : { inset, keyboard, height },
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
      visibility:
        quickOption !== undefined && question?.visibility === "private"
          ? "private"
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
      setAcknowledgment(
        receipt.mode === "preview"
          ? `Response recorded in preview · ${receipt.visibility === "private" ? "Private answer" : "Shared with room members"}. No AI analysis ran.`
          : receipt.visibility === "private"
            ? "Private response recorded. Only you can see it here; Meta will process it for your private analysis."
            : "Response sent. Setvia is reviewing the shared plan with Meta.",
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

  const content = (
    <section
      ref={dock}
      className="sv-composer-dock"
      data-keyboard={viewport.keyboard}
      aria-label="Planning room composer"
      style={{
        bottom: `calc(${viewport.inset}px + max(8px, env(safe-area-inset-bottom)))`,
        maxHeight: viewport.height
          ? `calc(${viewport.height}px - 16px - env(safe-area-inset-bottom))`
          : undefined,
      }}
    >
      <form
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
              <p id={`${id}-question`}>{question.text}</p>
              <button
                type="button"
                className="sv-thought-toggle"
                onClick={() => {
                  setAnswering((value) => !value);
                  setSelectedReply(null);
                  textarea.current?.focus();
                }}
                disabled={disabled || busy}
              >
                {answering ? "New thought" : "Answer this"}
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
            aria-describedby={`${id}-privacy ${id}-error ${id}-help`}
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
                (event.ctrlKey || event.metaKey) &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <button
            className="sv-send"
            type="submit"
            disabled={disabled || busy || !text.trim() || !choices.length}
            aria-label={
              busy
                ? mode === "preview"
                  ? "Recording preview response"
                  : "Sending response"
                : mode === "preview"
                  ? "Send preview message"
                  : "Send message"
            }
          >
            {busy ? (
              <LoaderCircle
                size={20}
                className="sv-sending-icon"
                aria-hidden="true"
              />
            ) : (
              <ArrowUp size={21} aria-hidden="true" />
            )}
          </button>
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
          <span className="sv-composer-mode">
            {mode === "preview"
              ? "Preview only · no live AI"
              : `Sending as ${viewer.name}`}
          </span>
          <span className="sv-keyboard-hint" id={`${id}-help`}>
            Ctrl / ⌘ Enter to send
          </span>
        </div>
        <p
          className="sv-privacy-copy"
          id={`${id}-privacy`}
          hidden={!privacyOpen}
        >
          {effectiveVisibility === "private"
            ? mode === "preview"
              ? "Only you can see this response in the preview. No AI processing runs here. In a live room, private answers are still sent to Meta’s Model API for analysis."
              : "Only you can see this response among room members. Setvia sends the text to Meta’s Model API for private analysis."
            : mode === "preview"
              ? "Your message is visible to other room members in this preview. No AI processing runs here."
              : "Your message is shared with room members and sent to Meta’s Model API for analysis."}
          {privateQuestion
            ? " This targeted question accepts private answers only."
            : ""}
        </p>
        <p className="sv-composer-error" id={`${id}-error`} role="alert">
          {error}
        </p>
        <p className="sv-composer-status" role="status" aria-live="polite">
          {disabled
            ? disabledReason
            : busy
              ? mode === "preview"
                ? "Recording your response in this preview…"
                : "Sending your response…"
              : acknowledgment}
        </p>
      </form>
    </section>
  );
  return typeof document === "undefined"
    ? content
    : createPortal(content, document.body);
});
