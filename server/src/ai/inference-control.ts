import { StateError } from "../agents/store.js";

/** Bounds simultaneous outbound requests across every metered feature in one API process. */
export class InferenceConcurrencyLimiter {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 16)
      throw new StateError("INVALID_INFERENCE_CONCURRENCY_LIMIT");
  }

  async acquire() {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    } else this.active++;

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) next();
      else this.active--;
    };
  }
}

export function readInferenceConcurrency(env: Record<string, string | undefined> = process.env) {
  const raw = env.SETVIA_MAX_CONCURRENT_META_REQUESTS;
  if (raw === undefined || raw.trim() === "") return 4;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 16)
    throw new StateError("INVALID_INFERENCE_CONCURRENCY_LIMIT");
  return value;
}

export function readParticipantCooldownMs(env: Record<string, string | undefined> = process.env) {
  const raw = env.SETVIA_PARTICIPANT_MESSAGE_COOLDOWN_MS;
  if (raw === undefined || raw.trim() === "") return 1_000;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > 60_000)
    throw new StateError("INVALID_PARTICIPANT_COOLDOWN");
  return value;
}

export function inferenceEnabled(env: Record<string, string | undefined> = process.env) {
  return env.SETVIA_INFERENCE_DISABLED !== "1";
}
