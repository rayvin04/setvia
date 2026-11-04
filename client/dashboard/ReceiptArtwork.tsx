import { useEffect, useRef, useState } from "react";
import type { ParticipantSession } from "../../shared/room-api";
import { getReceiptImage, requestReceiptImage } from "./room-api";

export type ReceiptImageStatus =
  | "idle"
  | "generating"
  | "ready"
  | "failed"
  | "capped";

export function ReceiptArtwork({
  title,
  session,
  expectedRevision,
  proposalVersion,
  status,
  retryAvailable,
}: {
  title: string;
  session: ParticipantSession | null;
  expectedRevision: number;
  proposalVersion: number;
  status: ReceiptImageStatus | null;
  retryAvailable: boolean;
}) {
  const figure = useRef<HTMLElement>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [inView, setInView] = useState(false);
  const [requestPending, setRequestPending] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [imageError, setImageError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [manualRetryConsumed, setManualRetryConsumed] = useState(false);
  const [imageAttempt, setImageAttempt] = useState(0);
  const [confirmedRequestStatus, setConfirmedRequestStatus] = useState<{
    status: ReceiptImageStatus;
    atRevision: number;
  } | null>(null);
  const automaticRequestFor = useRef("");
  const manualRetryRevision = useRef<number | null>(null);

  useEffect(() => {
    const node = figure.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "96px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (
      confirmedRequestStatus &&
      expectedRevision > confirmedRequestStatus.atRevision
    ) {
      setConfirmedRequestStatus(null);
    }
  }, [confirmedRequestStatus, expectedRevision]);

  useEffect(() => {
    if (
      manualRetryConsumed &&
      retryAvailable &&
      manualRetryRevision.current !== null &&
      expectedRevision > manualRetryRevision.current
    ) {
      setManualRetryConsumed(false);
      manualRetryRevision.current = null;
    }
  }, [expectedRevision, manualRetryConsumed, retryAvailable]);

  const displayedStatus = confirmedRequestStatus?.status ?? status;

  useEffect(() => {
    if (displayedStatus !== "idle" || !session || !inView) return;
    const requestKey = session.roomId;
    if (automaticRequestFor.current === requestKey) return;
    automaticRequestFor.current = requestKey;
    setRequestPending(true);
    setRequestError("");
    void requestReceiptImage(session, expectedRevision, proposalVersion)
      .then((result) => {
        setConfirmedRequestStatus({
          status: result.status,
          atRevision: expectedRevision,
        });
      })
      .catch((failure: unknown) => {
        setRequestError(
          failure instanceof Error
            ? failure.message
            : "The illustration request could not be sent.",
        );
      })
      .finally(() => setRequestPending(false));
  }, [displayedStatus, expectedRevision, inView, proposalVersion, session]);

  useEffect(() => {
    if (displayedStatus !== "ready" || !session || !inView) {
      setImageUrl("");
      return;
    }
    const controller = new AbortController();
    let current = true;
    setImageError("");
    void getReceiptImage(session, controller.signal)
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        if (current) setImageUrl(url);
        else URL.revokeObjectURL(url);
      })
      .catch((failure: unknown) => {
        if (current && !controller.signal.aborted) {
          setImageError(
            failure instanceof Error
              ? failure.message
              : "The illustration could not be loaded.",
          );
        }
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [displayedStatus, imageAttempt, inView, session]);

  useEffect(() => {
    if (!imageUrl) return;
    return () => URL.revokeObjectURL(imageUrl);
  }, [imageUrl]);

  async function retry() {
    if (!session || retrying) return;
    setRetrying(true);
    setRequestError("");
    setImageError("");
    try {
      if (displayedStatus === "ready") {
        setImageAttempt((value) => value + 1);
        return;
      }
      if (displayedStatus === "failed") {
        setManualRetryConsumed(true);
        manualRetryRevision.current = expectedRevision;
      }
      const result = await requestReceiptImage(
        session,
        expectedRevision,
        proposalVersion,
        {
          retry: displayedStatus === "failed",
        },
      );
      setConfirmedRequestStatus({
        status: result.status,
        atRevision: expectedRevision,
      });
    } catch (failure) {
      setRequestError(
        failure instanceof Error
          ? failure.message
          : "The illustration request could not be sent.",
      );
    } finally {
      setRetrying(false);
    }
  }

  const available = Boolean(session && displayedStatus !== null);
  const canRetry = retryAvailable && !manualRetryConsumed;
  const creating =
    displayedStatus === "generating" || requestPending || retrying;
  const failureMessage =
    imageError ||
    (displayedStatus === "generating" || displayedStatus === "ready"
      ? ""
      : requestError);

  return (
    <figure
      ref={figure}
      className="receipt-artwork"
      aria-busy={
        creating ||
        (displayedStatus === "ready" && inView && !imageUrl && !imageError) ||
        undefined
      }
      aria-label={`Setvia event illustration for ${title}`}
    >
      {displayedStatus === "ready" && imageUrl ? (
        <img
          className="receipt-artwork-image"
          src={imageUrl}
          alt={`AI-generated event artwork for ${title}`}
          onError={() => {
            setImageUrl("");
            setImageError("The event illustration could not be displayed.");
          }}
        />
      ) : (
        <div
          className="receipt-artwork-placeholder"
          role="status"
          aria-live="polite"
        >
          <span className="receipt-artwork-orbit" aria-hidden="true" />
          <div className="receipt-artwork-copy">
            {displayedStatus === "generating" ? (
              <>
                <span className="receipt-artwork-spinner" aria-hidden="true" />
                <strong>Setvia is illustrating this event</strong>
                <span>Using details shared with the group</span>
              </>
            ) : requestPending || retrying ? (
              <>
                <span className="receipt-artwork-spinner" aria-hidden="true" />
                <strong>Requesting event artwork</strong>
                <span>We’ll show it here when it’s ready</span>
              </>
            ) : displayedStatus === "failed" ? (
              <>
                <strong>Your event illustration isn’t ready</strong>
                {canRetry && (
                  <button
                    type="button"
                    onClick={() => void retry()}
                    disabled={retrying || requestPending}
                  >
                    Try again
                  </button>
                )}
                {!retryAvailable && (
                  <span>You can continue with the plan without it.</span>
                )}
              </>
            ) : displayedStatus === "capped" ? (
              <>
                <strong>Event artwork isn’t available right now</strong>
                <span>You can continue with the plan without it.</span>
              </>
            ) : displayedStatus === "ready" ? (
              inView ? (
                <>
                  <span
                    className="receipt-artwork-spinner"
                    aria-hidden="true"
                  />
                  <strong>Loading your event illustration</strong>
                </>
              ) : (
                <strong>Your event illustration is ready</strong>
              )
            ) : available ? (
              <>
                <strong>Your event illustration will appear here</strong>
                <span>Setvia uses details shared with the group</span>
              </>
            ) : (
              <strong>Event artwork is unavailable right now.</strong>
            )}
            {failureMessage && (
              <>
                <span className="receipt-artwork-error">{failureMessage}</span>
                {displayedStatus !== "ready" &&
                  displayedStatus !== "failed" &&
                  available && (
                    <button
                      type="button"
                      onClick={() => void retry()}
                      disabled={retrying || requestPending}
                    >
                      Try again
                    </button>
                  )}
                {displayedStatus === "ready" && (
                  <button
                    type="button"
                    onClick={() => setImageAttempt((value) => value + 1)}
                  >
                    Reload illustration
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
      <figcaption>
        {displayedStatus === "ready"
          ? "AI-generated event illustration"
          : "Setvia event artwork"}
      </figcaption>
    </figure>
  );
}
