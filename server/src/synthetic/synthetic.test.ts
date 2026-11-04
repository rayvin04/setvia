import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import {
  META_API_BASE_URL,
  META_SPARK_MODEL,
  type MetaConfig,
  type MetaApiClient,
} from "../ai/meta-client.js";
import { createApp } from "../http/app.js";
import { ScenarioDraftSchema, ScenarioRecordSchema, scenarioJsonSchema, type ScenarioDraft } from "./scenario-schema.js";
import { createScenarioGenerationClient, generateScenario, GenerateScenarioRequestSchema, ScenarioGenerationError } from "./generate.js";
import { createScenarioGenerationRouter } from "./generation-router.js";
import { SyntheticScenarioStore } from "./store.js";
import { SyntheticSimulationService } from "./simulator.js";
import { SyntheticRoomApiClient, type SyntheticRoomApiClient as SyntheticRoomApiClientType } from "./room-client.js";

const validScenario: ScenarioDraft = {
  category: "beach_outing",
  difficulty: "medium",
  event: {
    name: "Sunday shore cleanup",
    type: "beach_outing",
    description: "A fictional afternoon cleanup followed by a shared meal.",
    objectives: ["Choose a date", "Plan transport and supplies"],
    expectedAttendeeCount: 42,
    confirmedAttendeeCount: 36,
    dateLocal: null,
    timeZone: "Asia/Manila",
    initialPlan: "The group is considering a Sunday beach cleanup.",
    unverifiedAssumptions: [],
  },
  activePlannerCount: 2,
  participants: [
    {
      id: "lila",
      name: "Lila",
      role: "organizer",
      personality: "Organized and calm, but often commits before checking transport.",
      speakingStyle: "Short, practical messages with occasional follow-up detail.",
      availability: ["Sunday afternoon"],
      budget: { amount: 1200, currency: "PHP" },
      preferences: ["Sunday", "a shared meal"],
      responsePattern: "responsive",
    },
    {
      id: "ben",
      name: "Ben",
      role: "transport coordinator",
      personality: "Helpful, slightly hesitant to raise personal limits in front of the group.",
      speakingStyle: "Conversational and sometimes uncertain.",
      availability: ["Sunday"],
      budget: { amount: 500, currency: "PHP" },
      preferences: ["a closer beach", "low-cost transport"],
      responsePattern: "delayed",
    },
  ],
  messages: [
    { id: "msg-lila", ownerId: "lila", text: "I can do Sunday. Saturday is definitely out for me.", visibility: "group", delaySeconds: 0, questionRefId: null, replyOption: null },
    { id: "msg-ben", ownerId: "ben", text: "Private note: I can only put in about ₱500 this week.", visibility: "private", delaySeconds: 3, questionRefId: null, replyOption: null },
  ],
  timeline: [
    { id: "join-lila", order: 0, kind: "join", participantId: "lila", messageId: null, delaySeconds: 0 },
    { id: "join-ben", order: 1, kind: "join", participantId: "ben", messageId: null, delaySeconds: 0 },
    { id: "event-lila", order: 2, kind: "message", participantId: "lila", messageId: "msg-lila", delaySeconds: 0 },
    { id: "event-ben", order: 3, kind: "message", participantId: "ben", messageId: "msg-ben", delaySeconds: 3 },
  ],
  anticipatedQuestions: [{ id: "q-budget", topicTags: ["budget"], intent: "Ask what each room planner can contribute." }],
  questionResponses: [],
  groundTruth: {
    constraints: [
      { id: "constraint-date", ownerId: "lila", description: "Saturday is unavailable.", hardness: "hard", visibility: "group", sourceMessageIds: ["msg-lila"] },
      { id: "constraint-budget", ownerId: "ben", description: "Ben's maximum available contribution is PHP 500.", hardness: "hard", visibility: "private", sourceMessageIds: ["msg-ben"] },
    ],
    hiddenComplications: [{ id: "blindspot-equipment", category: "Preparation Check", description: "No participant has claimed the cleanup bags.", severity: "warning", evidenceMessageIds: ["msg-lila"] }],
    expectedProblems: [{ id: "problem-budget", category: "Budget Check", description: "The initial shared meal may exceed one planner's contribution limit.", severity: "warning", evidenceMessageIds: ["msg-ben"] }],
    evaluationNotes: ["Attendees are not room members.", "Private budget input must stay private."],
  },
};

const metaConfig: MetaConfig = {
  apiKey: "synthetic-test-key",
  baseUrl: META_API_BASE_URL,
  model: META_SPARK_MODEL,
};

function scenarioRecord(scenario = validScenario) {
  return ScenarioRecordSchema.parse({
    formatVersion: "setvia-synthetic-scenario-v1",
    datasetId: "test-shore-cleanup",
    datasetVersion: 1,
    createdAt: "2026-11-03T00:00:00.000Z",
    scenario,
    provenance: {
      source: "Meta Muse Spark",
      model: "muse-spark-1.3",
      promptVersion: "scenario-generator-v1",
      generationRequestId: "response-private-test",
      generatedAt: "2026-11-03T00:00:00.000Z",
      inputTokens: 1000,
      outputTokens: 1000,
      estimatedCostMicros: 5500,
      humanEdits: [],
      validation: [],
    },
    review: { approvedForPlayback: true, approvedAt: "2026-11-03T00:00:00.000Z" },
  });
}

async function withServer<T>(app: ReturnType<typeof createApp>, action: (baseUrl: string) => Promise<T>) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  try {
    return await action(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("scenario contract keeps attendee counts, private evidence, and message order consistent", () => {
  assert.equal(ScenarioDraftSchema.parse(validScenario).activePlannerCount, 2);
  assert.equal(validScenario.event.expectedAttendeeCount, 42);
  assert.equal(scenarioJsonSchema().type, "object");
  assert.equal((scenarioJsonSchema().properties as Record<string, unknown>).groundTruth !== undefined, true);

  const invalidOwner = structuredClone(validScenario);
  invalidOwner.messages[1]!.ownerId = "not-a-planner";
  assert.equal(ScenarioDraftSchema.safeParse(invalidOwner).success, false);

  const invalidCurrency = structuredClone(validScenario);
  invalidCurrency.participants[0]!.budget.currency = "ZZZ";
  assert.equal(ScenarioDraftSchema.safeParse(invalidCurrency).success, false);

  const mismatchedVisibility = structuredClone(validScenario);
  mismatchedVisibility.groundTruth.constraints[1]!.visibility = "group";
  assert.equal(ScenarioDraftSchema.safeParse(mismatchedVisibility).success, false);

  const excessiveDelay = structuredClone(validScenario);
  excessiveDelay.messages[1]!.delaySeconds = 901;
  assert.equal(ScenarioDraftSchema.safeParse(excessiveDelay).success, false);
});

test("generation records its accounting estimate and journals redacted attempt metadata", async () => {
  const events: unknown[] = [];
  const reservations: Array<{ tokens: number; costMicros: number }> = [];
  const sentRequests: Array<Record<string, unknown>> = [];
  const mockFetch: typeof fetch = async (_input, init) => {
    sentRequests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({
      id: "resp_synthetic_test",
      model: META_SPARK_MODEL,
      output_text: JSON.stringify(validScenario),
      usage: { input_tokens: 1234, output_tokens: 567, total_tokens: 1801 },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const input = GenerateScenarioRequestSchema.parse({
    category: "beach_outing",
    difficulty: "medium",
    expectedAttendeeCount: 42,
    activePlannerCount: 2,
    messageCount: 2,
    timeZone: "Asia/Manila",
    dateLocal: null,
  });
  const client = createScenarioGenerationClient({
    input,
    client: { config: metaConfig, fetchImpl: mockFetch },
    hooks: {
      reserveAttempt: async (allowance) => { reservations.push(allowance); },
      recordHttpEvent: async (event) => { events.push({ ...event }); },
    },
  });
  const body = await generateScenario(input, client);
  assert.equal(body.scenario.event.expectedAttendeeCount, 42);
  assert.equal(body.scenario.activePlannerCount, 2);
  assert.equal(body.attempts, 1);
  assert.equal(body.responseId, "resp_synthetic_test");
  assert.equal(body.estimatedCostMicros, 3953);

  assert.deepEqual(reservations, [{ tokens: 32_000, costMicros: 64_000 }]);
  const eventRecords = events as Array<{ phase: string; role: string; promptVersion: string; requestHash: string }>;
  assert.deepEqual(eventRecords.map((event) => event.phase), ["started", "response", "usage"]);
  assert.ok(eventRecords.every((event) => event.role === "Scenario Generator" && event.promptVersion === "scenario-generator-v1"));
  assert.ok(eventRecords.every((event) => /^[a-f0-9]{64}$/.test(event.requestHash)));
  const userInput = sentRequests[0] as { input: string; model: string; text: { format: { type: string; strict?: boolean } } };
  assert.equal(userInput.model, META_SPARK_MODEL);
  assert.equal(userInput.text.format.type, "json_schema");
  assert.equal(userInput.text.format.strict, true);
  assert.match(userInput.input, /Ground truth is a separate evaluation annotation/);
  assert.equal(userInput.input.includes("No participant has claimed the cleanup bags."), false);
  assert.equal(userInput.input.includes("Ben's maximum available contribution is PHP 500."), false);
});

test("failed request accounting prevents an unjournaled HTTP attempt", async () => {
  let networkCalls = 0;
  const input = GenerateScenarioRequestSchema.parse({ category: "beach_outing", difficulty: "easy", expectedAttendeeCount: 8, activePlannerCount: 2, messageCount: 2, timeZone: "Asia/Manila", dateLocal: null });
  const client = createScenarioGenerationClient({
    input,
    client: { config: metaConfig, fetchImpl: async () => { networkCalls += 1; return new Response("{}"); } },
    hooks: {
      reserveAttempt: async () => { throw new Error("private journal unavailable"); },
      recordHttpEvent: async () => { assert.fail("A failed accounting step must not be journaled as an HTTP attempt."); },
    },
  });
  await assert.rejects(generateScenario(input, client), (error: unknown) => {
    assert.ok(error instanceof ScenarioGenerationError);
    assert.equal(error.attempts, 0);
    assert.equal(error.accountingFailed, true);
    return true;
  });
  assert.equal(networkCalls, 0);
});

test("Studio generation route requires service authentication and uses room runtime accounting hooks", async () => {
  const token = "S".repeat(43);
  const events: Array<{ phase: string; role?: string }> = [];
  const reservations: Array<{ tokens: number; costMicros: number }> = [];
  let networkCalls = 0;
  const runtimeClient: MetaApiClient = {
    baseUrl: META_API_BASE_URL,
    model: META_SPARK_MODEL,
    getRequestCount: () => 0,
    async createResponse() { throw new Error("The generator test must use its mocked HTTP transport."); },
  };
  const router = createScenarioGenerationRouter({
    internalToken: token,
    hooks: {
      reserveAttempt: async (allowance) => { reservations.push(allowance); },
      recordHttpEvent: async (event) => { events.push({ phase: event.phase, role: event.role }); },
    },
    client: {
      config: metaConfig,
      fetchImpl: async () => {
        networkCalls += 1;
        return new Response(JSON.stringify({
          id: "resp_route_test",
          model: META_SPARK_MODEL,
          output_text: JSON.stringify(validScenario),
          usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    },
  });
  const app = createApp({ client: runtimeClient, demoScenarioRouter: router });

  await withServer(app, async (baseUrl) => {
    const missingAuth = await fetch(`${baseUrl}/api/demo/scenarios/health`);
    assert.equal(missingAuth.status, 401);

    const browserRequest = await fetch(`${baseUrl}/api/demo/scenarios/health`, {
      headers: { Authorization: `Bearer ${token}`, Origin: "https://setvia.r4yv.tech" },
    });
    assert.equal(browserRequest.status, 403);

    const badToken = await fetch(`${baseUrl}/api/demo/scenarios/health`, {
      headers: { Authorization: `Bearer ${"T".repeat(43)}` },
    });
    assert.equal(badToken.status, 401);

    const health = await fetch(`${baseUrl}/api/demo/scenarios/health`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(health.status, 200);
    assert.equal((await health.json() as { available: boolean }).available, true);

    const generated = await fetch(`${baseUrl}/api/demo/scenarios`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ category: "beach_outing", difficulty: "medium", expectedAttendeeCount: 42, activePlannerCount: 2, messageCount: 2, timeZone: "Asia/Manila", dateLocal: null }),
    });
    assert.equal(generated.status, 201);
    assert.equal((await generated.json() as { playbackStarted: boolean }).playbackStarted, false);
  });

  assert.equal(networkCalls, 1);
  assert.deepEqual(reservations, [{ tokens: 32_000, costMicros: 64_000 }]);
  assert.deepEqual(events.map((event) => event.phase), ["started", "response", "usage"]);
  assert.ok(events.every((event) => event.role === "Scenario Generator"));
});

test("simulator room client permits HTTPS and submits using the authenticated room message route", async () => {
  assert.equal(new SyntheticRoomApiClient("https://api.setvia.r4yv.tech").baseUrl, "https://api.setvia.r4yv.tech");
  assert.throws(() => new SyntheticRoomApiClient("http://api.setvia.r4yv.tech"), /HTTPS origin/);
  assert.throws(() => new SyntheticRoomApiClient("https://api.setvia.r4yv.tech/path"), /HTTPS origin/);

  const session = { roomId: "room-123", participantId: "planner-1", token: "a".repeat(64) };
  let capturedUrl = "";
  let capturedHeaders: HeadersInit | undefined;
  const client = new SyntheticRoomApiClient("https://api.setvia.r4yv.tech", async (input, init) => {
    capturedUrl = String(input);
    capturedHeaders = init?.headers;
    return new Response(JSON.stringify({
      receipt: { id: "receipt-1", ownerId: session.participantId, proposalVersion: 1, occurredAt: "2026-11-04T00:00:00.000Z" },
      duplicate: false,
      snapshot: {
        schemaVersion: "dashboard-v1", source: "room", sequence: 4,
        room: { roomId: session.roomId, viewerId: session.participantId, revision: 3, proposalVersion: 1, analysisStatus: "queued", privateAnalysisStatus: "idle", participants: [], questions: [], readiness: null },
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  });

  await client.submitMessage(session, {
    messageId: "message-1", expectedRevision: 2, proposalVersion: 1,
    text: "Sunday works for me.", visibility: "group", questionId: null, replyOption: null,
  });

  assert.equal(capturedUrl, "https://api.setvia.r4yv.tech/api/rooms/room-123/messages");
  const headers = new Headers(capturedHeaders);
  assert.equal(headers.get("authorization"), `Bearer ${session.token}`);
  assert.equal(headers.get("x-setvia-participant"), session.participantId);
});

test("private scenario store versions edits and approvals outside the public workspace", async (context) => {
  const privateRoot = await mkdtemp(join(process.cwd(), "..", "setvia-synthetic-test-"));
  context.after(async () => rm(privateRoot, { recursive: true, force: true }));
  const store = new SyntheticScenarioStore(privateRoot, process.cwd());
  const generation = { generationRequestId: "response_synthetic_test", generatedAt: "2026-11-03T00:00:00.000Z", inputTokens: 1000, outputTokens: 500, estimatedCostMicros: 3375 };
  const created = await store.save({ scenario: validScenario, generation, editedPaths: ["event.initialPlan"] });
  assert.equal(created.datasetVersion, 1);
  assert.equal(created.review.approvedForPlayback, false);
  const approved = await store.approve(created.datasetId, created.datasetVersion);
  assert.equal(approved.datasetVersion, 2);
  assert.equal(approved.review.approvedForPlayback, true);
  assert.equal(approved.provenance.humanEdits[0]?.editedPaths[0], "event.initialPlan");
  assert.equal((await store.list()).length, 1);
  assert.equal((await store.get(created.datasetId, 1))?.datasetVersion, 1);
});

test("live simulator uses participant actions and does not send ground truth to Setvia", async () => {
  const record = scenarioRecord();
  const writes: unknown[] = [];
  const store = {
    get: async () => record,
    saveRun: async (_runId: string, value: unknown) => { writes.push(value); },
    listRuns: async () => [],
    readRun: async () => null,
  } as unknown as SyntheticScenarioStore;
  const calls: Array<{ kind: string; payload: unknown }> = [];
  const sessions = new Map<string, { roomId: string; participantId: string; token: string }>();
  let sequence = 0;
  let revision = 0;
  const roomId = "synthetic-room-1";
  const snapshot = (session: { roomId: string; participantId: string; token: string }) => ({
    schemaVersion: "dashboard-v1" as const,
    source: "room" as const,
    sequence,
    room: {
      roomId,
      viewerId: session.participantId,
      revision,
      proposalVersion: 1,
      analysisStatus: "complete" as const,
      privateAnalysisStatus: "complete" as const,
      participants: [],
      questions: [],
      readiness: null,
    },
  });
  const creatorSession = { roomId, participantId: "room-member-0", token: "b".repeat(64) };
  sessions.set(creatorSession.participantId, creatorSession);
  const fakeRooms = {
    async health() {
      return { enabled: true, mode: "synthetic-live-demo" as const, budget: { attempts: 0, remainingAttempts: 8, reservedTokens: 0, remainingTokens: 640_000, reservedCostMicros: 0, remainingCostMicros: 2_000_000 } };
    },
    async createRoom(input: Record<string, unknown>) {
      calls.push({ kind: "create", payload: input });
      return { roomId, invitation: "a".repeat(64), session: creatorSession, snapshot: snapshot(creatorSession) };
    },
    async joinRoom(joinedRoomId: string, invitation: string, name: string) {
      const participantId = `room-member-${sessions.size}`;
      const session = { roomId: joinedRoomId, participantId, token: String(sessions.size).padStart(64, "c") };
      sessions.set(participantId, session);
      calls.push({ kind: "join", payload: { roomId: joinedRoomId, invitation, name } });
      sequence += 1;
      return { session, snapshot: snapshot(session) };
    },
    async getSnapshot(session: { roomId: string; participantId: string; token: string }) { return snapshot(session); },
    async submitMessage(session: { roomId: string; participantId: string; token: string }, payload: unknown) {
      calls.push({ kind: "message", payload });
      revision += 1;
      sequence += 1;
      return { receipt: { ownerId: session.participantId }, duplicate: false, snapshot: snapshot(session) };
    },
  } as unknown as SyntheticRoomApiClientType;

  const service = new SyntheticSimulationService(store, fakeRooms);
  const started = await service.startLive(record.datasetId, record.datasetVersion);
  assert.equal(started.dashboardSession?.participantId, creatorSession.participantId);
  assert.equal(started.dashboardInvitation, "a".repeat(64));
  assert.equal((calls[0]?.payload as Record<string, unknown>).attendeeCount, 42);
  assert.equal("groundTruth" in (calls[0]?.payload as Record<string, unknown>), false);
  assert.equal("participants" in (calls[0]?.payload as Record<string, unknown>), false);

  for (let index = 1; index < validScenario.timeline.length; index += 1) await service.next(started.run.runId);
  const sent = calls.filter((call) => call.kind === "message").map((call) => call.payload as Record<string, unknown>);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent.map((call) => call.visibility), ["group", "private"]);
  assert.equal(sent[1]?.text, validScenario.messages[1]?.text);
  const serializedRuns = JSON.stringify(writes);
  assert.equal(serializedRuns.includes("No participant has claimed the cleanup bags."), false);
  assert.equal(serializedRuns.includes(creatorSession.token), false);
  assert.equal(serializedRuns.includes("a".repeat(64)), false);
});
