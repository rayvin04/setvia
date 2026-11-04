import {
  PlaygroundResultSchema,
  type PlaygroundRequest,
} from "../shared/playground";

const apiBase = (import.meta.env?.VITE_SETVIA_API_ORIGIN ?? "").replace(
  /\/$/,
  "",
);
let fallbackSession: string | undefined;

export function playgroundSession() {
  try {
    const stored = sessionStorage.getItem("setvia-playground-session");
    if (stored && /^[a-f0-9-]{36}$/i.test(stored)) return stored;
    const session = crypto.randomUUID();
    sessionStorage.setItem("setvia-playground-session", session);
    return session;
  } catch {
    return (fallbackSession ??= crypto.randomUUID());
  }
}

export async function runPlayground(
  request: PlaygroundRequest,
  signal: AbortSignal,
) {
  let response: Response;
  try {
    response = await fetch(`${apiBase}/api/playground/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
  } catch {
    throw new Error(
      signal.aborted
        ? "This try took too long. Please try again."
        : "Couldn’t reach Setvia. Check your connection, then try again.",
    );
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (
      response.status === 400 &&
      !request.text &&
      payload?.error ===
        "Choose one of the playground scenarios. Personal thoughts must be 10–240 characters."
    )
      throw new Error(
        "This example is not supported by the running playground server. Please refresh and try again.",
      );
    const code =
      typeof payload?.code === "string" && /^[a-z_]{1,40}$/.test(payload.code)
        ? ` (${payload.code})`
        : "";
    throw new Error(
      typeof payload?.error === "string"
        ? payload.error + code
        : "The playground couldn’t finish. Please try again.",
    );
  }
  const result = PlaygroundResultSchema.safeParse(payload);
  if (
    !result.success ||
    result.data.agent !== request.agent ||
    result.data.scenarioId !== request.scenarioId
  )
    throw new Error("That answer couldn’t be checked. Please try again.");
  return result.data;
}
