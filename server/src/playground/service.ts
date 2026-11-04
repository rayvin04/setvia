import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  RoleSchemas,
  type AgentGateway,
  type Role,
} from "../agents/contracts.js";
import { validateJudge, validateSpeaker } from "../agents/engine.js";
import { sharedContext } from "../agents/rooms.js";
import { StateError } from "../agents/store.js";
import { assertPlanningScope } from "../ai/planning-scope.js";
import { InvalidModelOutputError, MetaApiError } from "../ai/errors.js";
import {
  PlaygroundResultSchema,
  playgroundScenarios,
  type PlaygroundRequest,
  type PlaygroundResult,
  type PlaygroundFailureCode,
} from "../../../shared/playground.js";
import { demoContext } from "./scenarios.js";

export class PlaygroundError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfter?: number,
    readonly code: PlaygroundFailureCode = "unavailable",
  ) {
    super(message);
  }
}

export function playgroundFailureCode(error: unknown): PlaygroundFailureCode {
  if (error instanceof PlaygroundError) return error.code;
  if (error instanceof MetaApiError) {
    switch (error.code) {
      case "authentication":
      case "forbidden":
        return "authentication";
      case "timeout":
      case "connection":
      case "rate_limit":
      case "accounting":
      case "request_limit":
        return error.code;
      case "invalid_response":
        return "validation";
      case "request":
      case "not_found":
      case "unexpected_model":
        return "provider_request";
      case "server":
        return "provider_unavailable";
    }
  }
  if (error instanceof StateError)
    return error.code === "CALL_ALLOWANCE_REQUIRED"
      ? "accounting"
      : "validation";
  if (
    error instanceof InvalidModelOutputError ||
    (error instanceof Error && error.name === "ZodError")
  )
    return "validation";
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  return "unavailable";
}

export interface PlaygroundOptions {
  gateway: AgentGateway;
  reserveAttempt(allowance: {
    tokens: number;
    costMicros: number;
  }): Promise<void>;
  inferenceEnabled(): boolean;
  cacheRoot?: string;
  now?: () => number;
}

export function createPlaygroundService(options: PlaygroundOptions) {
  if (options.gateway.mode !== "META")
    throw new StateError("REAL_PLAYGROUND_GATEWAY_REQUIRED");
  const now = options.now ?? Date.now;
  const cache = new Map<string, PlaygroundResult>();
  const inflight = new Map<string, Promise<PlaygroundResult>>();
  const windows = new Map<string, { count: number; until: number }>();
  const signature = createHash("sha256")
    .update(
      JSON.stringify({
        contract: 1,
        prompts: options.gateway.promptHashes,
        scenarios: playgroundScenarios,
      }),
    )
    .digest("hex")
    .slice(0, 24);
  let active = 0;

  function limit(key: string, maximum: number, duration: number) {
    const current = now();
    if (windows.size > 10_000)
      for (const [id, window] of windows)
        if (window.until <= current) windows.delete(id);
    const window = windows.get(key) ?? { count: 0, until: current + duration };
    if (window.until <= current) {
      window.count = 0;
      window.until = current + duration;
    }
    if (
      window.count >= maximum ||
      (!windows.has(key) && windows.size >= 20_000)
    )
      throw new PlaygroundError(
        429,
        "A few too many tries. Give the playground a minute, then try again.",
        Math.max(1, Math.ceil((window.until - current) / 1000)),
        "rate_limit",
      );
    window.count++;
    windows.set(key, window);
  }

  async function execute(
    request: PlaygroundRequest,
  ): Promise<PlaygroundResult> {
    const roles: Role[] = [];
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 65_000);
    async function call(role: Role, input: unknown) {
      if (!options.inferenceEnabled())
        throw new PlaygroundError(
          503,
          "The AI playground is resting. Please try again later.",
          undefined,
          "inference_disabled",
        );
      const result = await options.gateway.call(role, input, {
        signal: controller.signal,
        reserveAttempt: async (allowance) => {
          if (!allowance) throw new StateError("CALL_ALLOWANCE_REQUIRED");
          if (!options.inferenceEnabled())
            throw new PlaygroundError(
              503,
              "The AI playground is resting. Please try again later.",
              undefined,
              "inference_disabled",
            );
          await options.reserveAttempt(allowance);
        },
      });
      RoleSchemas[role].parse(result.output);
      roles.push(role);
      return result.output;
    }
    try {
      const { room, finding, scenario } = demoContext(request);
      const sections: PlaygroundResult["sections"] = [];
      if (request.agent === "listener") {
        const output = RoleSchemas.Listener.parse(
          await call("Listener", {
            privateInput: { text: request.text ?? scenario.text },
            privateFacts: [],
          }),
        );
        const known = output.candidates.filter((item) => item.value !== null);
        const uncertain = output.candidates.filter(
          (item) => item.value === null,
        );
        sections.push(
          {
            label: "What I heard",
            text: known.length
              ? known
                  .slice(0, 5)
                  .map((item) => `${humanize(item.key)}: ${String(item.value)}`)
                  .join(" · ")
              : "No clear planning constraint was extracted. Try a more specific thought.",
          },
          {
            label: "Still uncertain",
            text: uncertain.length
              ? uncertain
                  .slice(0, 4)
                  .map((item) => humanize(item.key))
                  .join(" · ")
              : "These are extracted suggestions. Costs, travel details, and the final plan still need confirmation.",
          },
          {
            label: "Visibility · owner only",
            text: request.text
              ? "Returned only to this request. Your thought and result aren’t saved or put in the public cache."
              : "A personal concern stays private until its owner chooses to share it. This scenario is fictional.",
          },
        );
      } else if (request.agent === "judge") {
        const context = sharedContext(room);
        const output = validateJudge(
          room,
          await call("Judge", {
            ...context,
            proposedOptions: [],
            previousFindings: [],
            draftQuestions: [],
            draftFindingReplies: [],
            draftMascot: null,
            task: "review",
          }),
          [],
          [],
        );
        const blocker = output.findings.find(
          (item) =>
            item.status !== "resolved" && item.category === finding.category,
        );
        if (!blocker || !blocker.evidenceIds.length)
          throw new StateError("DEMO_BLOCKER_NOT_GROUNDED");
        sections.push(
          { label: "Planning blocker", text: blocker.message },
          {
            label: "Evidence",
            text:
              blocker.evidenceIds
                .map((id) => room.facts.find((fact) => fact.id === id))
                .filter((fact) => fact && fact.value !== null)
                .map((fact) => `${humanize(fact!.key)}: ${String(fact!.value)}`)
                .join(" · ") ||
              "The supplied facts leave this detail unconfirmed.",
          },
          { label: "Next step", text: blocker.recommendedAction },
          {
            label: "Still missing",
            text:
              request.scenarioId === "judge-seats"
                ? "Transport for everyone has not been confirmed."
                : request.scenarioId === "judge-budget"
                  ? "A meal within the limit, or explicit agreement to a changed budget."
                  : "Confirm whether a later departure is possible after class.",
          },
        );
      } else if (request.agent === "negotiator") {
        const output = RoleSchemas.Negotiator.parse(
          await call("Negotiator", {
            ...sharedContext(room),
            findings: [finding],
            previousOptions: [],
            previousVerdicts: [],
            taskFindingIds: [finding.id],
            demonstrationTask:
              "Return one proposed overlapping availability window. In option.values use exactly day (string), startHour (number, 24-hour clock), endHour (number), and travelTime (null). The window must be inside both supplied availability ranges. Do not claim agreement or include travel in that window; it is unknown.",
          }),
        );
        const option = output.options[0];
        const overlap =
          request.scenarioId === "negotiator-sunday"
            ? { day: "Sunday", earliestStart: 10, latestEnd: 12 }
            : request.scenarioId === "negotiator-saturday"
              ? { day: "Saturday", earliestStart: 15, latestEnd: 17 }
              : { day: "Friday", earliestStart: 17, latestEnd: 19 };
        const values = option.values;
        if (
          values.day !== overlap.day ||
          typeof values.startHour !== "number" ||
          typeof values.endHour !== "number" ||
          values.startHour < overlap.earliestStart ||
          values.endHour > overlap.latestEnd ||
          values.endHour <= values.startHour ||
          values.travelTime !== null ||
          Object.keys(values).some(
            (key) =>
              !["day", "startHour", "endHour", "travelTime"].includes(key),
          )
        )
          throw new StateError("DEMO_OVERLAP_NOT_FEASIBLE");
        sections.push(
          {
            label: "Availability overlap",
            text: `${values.day} · ${hour(values.startHour)}–${hour(values.endHour)}`,
          },
          { label: "Proposed compromise", text: option.label },
          {
            label: "Still needs a yes",
            text: "This is a proposal. Travel time is unknown; Ana and Ben still need to confirm the timing and whether travel fits.",
          },
        );
      } else {
        const output = RoleSchemas["Question Strategist"].parse(
          await call("Question Strategist", {
            ...sharedContext(room),
            findings: [finding],
            existingQuestions: [],
            feasibleOptions: [],
          }),
        );
        const question = output.questions[0];
        if (
          question.findingId !== finding.id ||
          question.visibility !== "group" ||
          question.targetId !== null
        )
          throw new StateError("INVALID_PUBLIC_DEMO_QUESTION");
        const speaker = validateSpeaker(
          await call("Speaker", {
            ...sharedContext(room),
            findings: [finding],
            questions: [question],
          }),
          [question],
          [],
        );
        const reply = speaker.replies.find(
          (item) => item.questionId === question.id,
        );
        if (!reply) throw new StateError("DEMO_REPLY_MISSING");
        sections.push(
          { label: "Ask this first", text: question.text },
          { label: "Setvia says", text: reply.text },
          { label: "Why this question", text: finding.message },
        );
      }
      return PlaygroundResultSchema.parse({
        agent: request.agent,
        scenarioId: request.scenarioId,
        source: "live",
        model: "muse-spark-1.3",
        generatedAt: new Date(now()).toISOString(),
        roles,
        sections,
        personal: Boolean(request.text),
      });
    } finally {
      clearTimeout(deadline);
    }
  }

  return {
    status() {
      return { inferenceEnabled: options.inferenceEnabled() };
    },
    async run(
      request: PlaygroundRequest,
      ip: string,
    ): Promise<PlaygroundResult> {
      const ipHash = createHash("sha256").update(ip).digest("hex");
      limit("requests-ip:" + ipHash, 24, 60_000);
      limit("requests-session:" + request.sessionId, 16, 60_000);
      limit("requests-global", 180, 60_000);
      if (request.text) {
        assertPlanningScope(request.text);
        if (
          !/\b(plan|budget|spend|cost|afford|available|sunday|saturday|monday|tuesday|wednesday|thursday|friday|trip|travel|ride|transport|picnic|party|meeting|food|bring|join|attend|home|leave|return|allerg|vegetarian|venue|event|schedule|seat|drive|beach)\b|[₱]|\b(?:oras|gastos|biyahe|plano|sama)\b/i.test(
            request.text,
          ) ||
          /(?:ignore|instructions?|prompt|system|developer|pretend|act as|api key)/i.test(
            request.text,
          )
        )
          throw new PlaygroundError(
            422,
            "Try a short thought about a plan: your budget, availability, transport, or something to bring.",
          );
      }
      const key = signature + "-" + request.scenarioId;
      const memory = cache.get(key);
      if (memory && now() - Date.parse(memory.generatedAt) > 7 * 24 * 3_600_000)
        cache.delete(key);
      if (!request.text && inflight.has(key)) return inflight.get(key)!;
      if (!options.inferenceEnabled())
        return fallback(
          request,
          key,
          new PlaygroundError(
            503,
            "Live AI is temporarily paused. Please try again later.",
            undefined,
            "inference_disabled",
          ),
        );
      if (active >= 2)
        return fallback(
          request,
          key,
          new PlaygroundError(
            429,
            "Two minds are working right now. Try again in a few seconds.",
            10,
            "busy",
          ),
        );
      active++;
      const promise = (async () => {
        try {
          const result = await execute(request);
          if (!request.text) {
            cache.set(key, result);
            if (options.cacheRoot) {
              try {
                await mkdir(options.cacheRoot, {
                  recursive: true,
                  mode: 0o700,
                });
                const target = resolve(options.cacheRoot, key + ".json");
                await writeFile(target + ".tmp", JSON.stringify(result), {
                  mode: 0o600,
                });
                await rename(target + ".tmp", target);
              } catch {
                console.warn(
                  "The public playground response could not be saved for fallback.",
                );
              }
            }
          }
          return result;
        } catch (error) {
          return await fallback(request, key, error);
        } finally {
          active--;
          if (!request.text) inflight.delete(key);
        }
      })();
      if (!request.text) inflight.set(key, promise);
      return promise;
    },
  };

  async function fallback(
    request: PlaygroundRequest,
    key: string,
    error: unknown,
  ): Promise<PlaygroundResult> {
    const saved = !request.text && (cache.get(key) ?? (await readCache(key)));
    if (
      saved &&
      saved.agent === request.agent &&
      saved.scenarioId === request.scenarioId &&
      now() - Date.parse(saved.generatedAt) <= 7 * 24 * 3_600_000
    )
      return {
        ...saved,
        source: "cached",
        fallbackCode: playgroundFailureCode(error),
      };
    throw error;
  }

  async function readCache(key: string) {
    if (!options.cacheRoot) return undefined;
    try {
      const result = PlaygroundResultSchema.parse(
        JSON.parse(
          await readFile(resolve(options.cacheRoot, key + ".json"), "utf8"),
        ),
      );
      if (
        result.personal ||
        now() - Date.parse(result.generatedAt) > 7 * 24 * 3_600_000
      )
        return undefined;
      cache.set(key, result);
      return result;
    } catch {
      return undefined;
    }
  }
}

function humanize(key: string) {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ");
}

function hour(value: number) {
  const hours = Math.floor(value);
  const minutes = Math.round((value - hours) * 60);
  return `${hours % 12 || 12}${minutes ? ":" + String(minutes).padStart(2, "0") : ""} ${hours >= 12 ? "PM" : "AM"}`;
}
