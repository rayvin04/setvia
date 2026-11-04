// Development-only browser harness. No credentials or network inference.
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { AgentEngine } from "../server/src/agents/engine.js";
import type { AgentGateway, Finding, Question } from "../server/src/agents/contracts.js";
import { MemoryPersistence, RoomStore } from "../server/src/agents/store.js";
import { RoomRuntime } from "../server/src/rooms/runtime.js";
import { createApp } from "../server/src/http/app.js";
import { META_API_BASE_URL, META_SPARK_MODEL } from "../server/src/ai/meta-client.js";

if (!process.env.SETVIA_PRIVATE_ROOT) throw new Error("SETVIA_PRIVATE_ROOT is required for offline Lab records.");
const privateRoot = resolve(process.env.SETVIA_PRIVATE_ROOT);
await mkdir(resolve(privateRoot, "lab"), { recursive: true });
const issue: Finding = { id: "departure_gap", category: "Schedule Check", severity: "critical", status: "open",
  evidenceIds: [], uncertainty: "missing", message: "The departure time needs confirmation.",
  recommendedAction: "Choose a departure time that every participant can confirm." };
const review = (overrides: Record<string, unknown> = {}) => ({ findings: [issue], verdicts: [], next: "stop",
  taskFindingIds: [], acceptedQuestionIds: [], anotherPassUseful: false, participantInputRequired: false,
  canStop: true, readinessAssessment: { readyForReview: false, explanation: "Offline fixture: departure remains unconfirmed." }, ...overrides });
const gateway: AgentGateway = {
  mode: "MOCK", promptVersion: "agents-v6",
  async call(role, raw, context) {
    await context.reserveAttempt();
    const input = raw as { task?: string; draftQuestions?: Question[]; questions?: Question[];
      participants?: Array<{ id: string }>; proposedOptions?: Array<{ id: string }>;
      groupResponses?: Array<{ replyOption: string | null }> };
    let output: unknown;
    if (role === "Listener") output = { candidates: [{ key: "note", value: "Await participant confirmation before sharing." }] };
    else if (role === "Judge") {
      if (input.task === "final") output = review({ next: "question", participantInputRequired: true,
        acceptedQuestionIds: input.draftQuestions?.map((question) => question.id) ?? [] });
      else if (input.groupResponses?.some((response) => response.replyOption)) output = review();
      else if (!input.proposedOptions?.length) output = review({ next: "negotiate", taskFindingIds: [issue.id], anotherPassUseful: true, canStop: false });
      else output = review({ next: "question", participantInputRequired: true,
        verdicts: input.proposedOptions.map((option) => ({ optionId: option.id, accepted: true })) });
    } else if (role === "Negotiator") output = { options: [{ id: "later_departure", label: "Later departure", values: { time: "09:00" } }] };
    else if (role === "Question Strategist") output = { questions: [
      { id: "departure_choice", findingId: issue.id, targetId: null, visibility: "group", kind: "choice",
        text: "Which departure time works for everyone?", options: ["08:00", "09:00"] },
      { id: "owner_availability", findingId: issue.id, targetId: input.participants?.[0]?.id, visibility: "private", kind: "clarification",
        text: "Would you like to share an availability window?", options: [] },
    ] };
    else output = { mascot: "curious", replies: [
      ...(input.questions ?? []).map((question) => ({ questionId: question.id, findingId: null, text: question.text })),
      { questionId: null, findingId: issue.id, text: "We still need to confirm the departure time." },
    ] };
    return { output, usage: null };
  },
};
let runtime!: RoomRuntime;
const engine = new AgentEngine(new RoomStore(new MemoryPersistence()), gateway, undefined,
  (id) => { void runtime.events.publishGroup(id); }, (id, owner) => { void runtime.events.publishPrivate(id, owner); });
runtime = new RoomRuntime({ engine, privateRoot, publicRoot: process.cwd(), syntheticDemo: true,
  persistenceLock: async () => {}, journal: { runId: randomUUID(), attemptsFor: async () => [],
    snapshot: async () => ({ runId: "offline", attempts: 0, runAttempts: 0, estimatedCostMicros: 0, budgetMicros: 0 }),
    release: async () => {} } as never });
const server = createApp({ rooms: runtime, roomOrigins: ["http://127.0.0.1:5175"], client: {
  baseUrl: META_API_BASE_URL, model: META_SPARK_MODEL, getRequestCount: () => 0,
  createResponse: async () => { throw new Error("Inference is disabled in this offline harness."); },
} }).listen(3001, "127.0.0.1", () => console.log("Offline room harness on http://127.0.0.1:3001 — MOCK responses, zero Meta requests."));
let closing = false;
const close = () => {
  if (closing) return;
  closing = true;
  void runtime.close().finally(() => server.close());
};
process.once("SIGINT", close);
process.once("SIGTERM", close);
