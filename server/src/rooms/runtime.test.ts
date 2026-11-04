import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { AgentEngine, MOCK_LIMITS } from "../agents/engine.js";
import { Roles, type AgentGateway, type Role } from "../agents/contracts.js";
import { createMetaGateway } from "../agents/meta-gateway.js";
import { META_API_BASE_URL, META_SPARK_MODEL } from "../ai/meta-client.js";
import { MemoryPersistence, RoomStore } from "../agents/store.js";
import { CreateRoomRequestSchema } from "../../../shared/room-api.js";
import { RoomRuntime } from "./runtime.js";
import { finding, judge, scriptedGateway } from "../agents/fixtures.js";
import { SubmitRoomMessageSchema } from "../../../shared/room-api.js";
import type { Response as ExpressResponse } from "express";
import { DashboardSnapshotSchema, type DashboardSnapshot } from "../../../shared/dashboard.js";
import { SubmitRoomMessageResultSchema } from "../../../shared/room-api.js";
import { createApp } from "../http/app.js";

test("creating a room automatically starts analysis without an unrelated message", async () => {
  const directory = await mkdtemp(resolve(process.cwd(), `.setvia-room-runtime-${randomUUID()}-`));
  let calls = 0;
  const gateway: AgentGateway = {
    mode: "MOCK",
    promptVersion: "agents-v5",
    async call(_role, _input, context) {
      await context.reserveAttempt();
      calls++;
      return { output: judge(), usage: null };
    },
  };
  const engine = new AgentEngine(new RoomStore(new MemoryPersistence()), gateway);
  const journal = {
    runId: randomUUID(),
    attemptsFor: async () => [],
    snapshot: async () => ({ runId: "test", attempts: 0, runAttempts: 0, estimatedCostMicros: 0 }),
    release: async () => {},
  };
  const runtime = new RoomRuntime({
    engine,
    journal: journal as never,
    persistenceLock: async () => {},
    privateRoot: directory,
    publicRoot: resolve(directory, "public"),
    syntheticDemo: false,
  });
  try {
    const input = CreateRoomRequestSchema.parse({
      creatorName: "Alex",
      eventType: "Weekend hike",
      proposal: { id: "hike-plan", label: "Saturday trail walk", values: { startTime: "08:00" } },
      estimatedAttendeeCount: 6,
      confirmedAttendeeCount: 2,
    });
    const created = await runtime.create(input, input.creatorName);
    const joined = await runtime.join(created.roomId, created.invitation, "Joy");
    assert.equal(created.snapshot.source, "room");
    assert.equal(joined.snapshot.room.participants.length, 2);
    assert.notEqual(created.session.token, joined.session.token);
    assert.equal(calls, 0);
    for (let i = 0; i < 50 && !(await engine.store.read(created.roomId)).lastCycle?.finalEvaluation; i++)
      await new Promise((done) => setTimeout(done, 25));
    assert.equal(calls, 1);
    assert.equal((await runtime.snapshot(created.roomId, created.session)).room.loopState, "COMPLETED");
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("room submissions enforce scope and per-participant cooldown while allowing idempotent receipt retries", async () => {
  const directory = await mkdtemp(resolve(process.cwd(), `.setvia-room-cooldown-${randomUUID()}-`));
  const engine = new AgentEngine(new RoomStore(new MemoryPersistence()), scriptedGateway([]).gateway);
  const journal = {
    runId: randomUUID(),
    attemptsFor: async () => [],
    snapshot: async () => ({ runId: "test", attempts: 0, runAttempts: 0, estimatedCostMicros: 0 }),
    release: async () => {},
  };
  const runtime = new RoomRuntime({
    engine,
    journal: journal as never,
    persistenceLock: async () => {},
    privateRoot: directory,
    publicRoot: join(directory, "public"),
    syntheticDemo: false,
    participantCooldownMs: 60_000,
  });
  try {
    const created = await runtime.create(
      CreateRoomRequestSchema.parse({
        creatorName: "Alex",
        eventType: "Weekend hike",
        proposal: { id: "hike-plan", label: "Saturday trail walk", values: { startTime: "08:00" } },
      }),
      "Alex",
    );
    const auth = { participantId: created.session.participantId, token: created.session.token };
    const snapshot = await runtime.snapshot(created.roomId, auth);
    const request = (messageId: string, text: string) => SubmitRoomMessageSchema.parse({
      messageId,
      expectedRevision: snapshot.room.revision,
      proposalVersion: snapshot.room.proposalVersion,
      text,
      visibility: "private",
      questionId: null,
      replyOption: null,
    });
    await assert.rejects(
      runtime.submit(created.roomId, auth, request("off_topic", "Write me an unrelated essay.")),
      /Setvia is here to help your group make plans/,
    );
    const first = await runtime.submit(created.roomId, auth, request("first_private", "I need shade near the picnic area."));
    const retry = await runtime.submit(created.roomId, auth, request("first_private", "I need shade near the picnic area."));
    assert.equal(first.duplicate, false);
    assert.equal(retry.duplicate, true);
    await assert.rejects(
      runtime.submit(created.roomId, auth, request("second_private", "I can bring water.")),
      (error: unknown) => (error as { code?: string }).code === "PARTICIPANT_COOLDOWN",
    );
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("HTTP message receipts match the browser contract and idempotent retries do not queue another inference", async () => {
  const directory = await mkdtemp(resolve(process.cwd(), `.setvia-room-http-${randomUUID()}-`));
  const scripted = scriptedGateway([
    { role: "Listener", output: { candidates: [] } },
    { role: "Judge", output: judge() },
  ]);
  const engine = new AgentEngine(new RoomStore(new MemoryPersistence()), scripted.gateway);
  const runtime = new RoomRuntime({ engine, privateRoot: directory, publicRoot: join(directory, "public"),
    syntheticDemo: false, persistenceLock: async () => {}, journal: { release: async () => {} } as never });
  const server = createApp({ rooms: runtime, client: {
    baseUrl: META_API_BASE_URL, model: META_SPARK_MODEL, getRequestCount: () => 0,
    createResponse: async () => { throw new Error("No live extraction in room HTTP tests"); },
  } }).listen(0, "127.0.0.1");
  await new Promise<void>((done) => server.once("listening", done));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/rooms`;
  try {
    const created = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      creatorName: "Alex", eventType: "Meeting", proposal: { id: "meeting", label: "Synthetic meeting", values: { time: "09:00" } },
    }) }).then((response) => response.json()) as Awaited<ReturnType<RoomRuntime["create"]>>;
    const joined = await runtime.join(created.roomId, created.invitation, "Sam");
    const headers = { "Content-Type": "application/json", Authorization: "Bearer " + created.session.token,
      "X-Setvia-Participant": created.session.participantId };
    const body = JSON.stringify({ messageId: "http_receipt_regression", expectedRevision: joined.snapshot.room.revision,
      proposalVersion: joined.snapshot.room.proposalVersion, visibility: "group", text: "A shared meeting thought", questionId: null, replyOption: null });
    const send = () => fetch(`${base}/${created.roomId}/messages`, { method: "POST", headers, body });
    const initial = await send();
    assert.equal(initial.status, 201);
    const receipt = SubmitRoomMessageResultSchema.parse(await initial.json());
    assert.equal(receipt.duplicate, false);
    assert.equal(receipt.receipt.id, "http_receipt_regression");
    assert.equal("text" in receipt.receipt, false, "receipt serialization is explicitly whitelisted");
    const retried = await send();
    assert.equal(retried.status, 201);
    const duplicate = SubmitRoomMessageResultSchema.parse(await retried.json());
    assert.equal(duplicate.duplicate, true);
    assert.deepEqual(duplicate.receipt, receipt.receipt);
    for (let i = 0; i < 50 && !(await engine.store.read(created.roomId)).lastCycle?.finalEvaluation; i++)
      await new Promise((done) => setTimeout(done, 25));
    assert.equal(scripted.calls.length, 2);
    assert.equal((await engine.store.read(created.roomId)).responses.length, 1);
  } finally {
    await runtime.close();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("joining after completed analysis schedules a fresh cycle without changing proposal version", async () => {
  const directory = await mkdtemp(resolve(process.cwd(), `.setvia-room-runtime-join-${randomUUID()}-`));
  const scripted = scriptedGateway([
    { role: "Judge", output: judge() },
    { role: "Judge", output: judge() },
  ]);
  const engine = new AgentEngine(new RoomStore(new MemoryPersistence()), scripted.gateway);
  const journal = {
    runId: randomUUID(),
    attemptsFor: async () => [],
    snapshot: async () => ({ runId: "test", attempts: 0, runAttempts: 0, estimatedCostMicros: 0 }),
    release: async () => {},
  };
  const runtime = new RoomRuntime({
    engine,
    journal: journal as never,
    persistenceLock: async () => {},
    privateRoot: directory,
    publicRoot: join(directory, "public"),
    syntheticDemo: false,
  });
  const waitForCurrentCycle = async (roomId: string, auth: { participantId: string; token: string }) => {
    for (let attempt = 0; attempt < 60; attempt++) {
      const snapshot = await runtime.snapshot(roomId, auth);
      if (snapshot.room.analysisCurrent && snapshot.room.loopState !== null) return snapshot;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
    throw new Error("Room analysis did not settle within the test window.");
  };
  try {
    const created = await runtime.create(
      CreateRoomRequestSchema.parse({
        creatorName: "Synthetic Alex",
        eventType: "Planning meeting",
        proposal: { id: "meeting_plan", label: "Team meeting", values: { startTime: "10:00" } },
      }),
      "Synthetic Alex",
    );
    const auth = { participantId: created.session.participantId, token: created.session.token };
    let room = await engine.store.read(created.roomId);
    await runtime.revise(created.roomId, auth, room.revision, {
      id: "meeting_plan_v2",
      label: "Team meeting, revised",
      values: { startTime: "10:30" },
    });
    const first = await waitForCurrentCycle(created.roomId, auth);
    const proposalVersion = first.room.proposalVersion;
    assert.equal(scripted.calls.length, 1);

    const joined = await runtime.join(created.roomId, created.invitation, "Jordan");
    const newAuth = { participantId: joined.session.participantId, token: joined.session.token };
    assert.equal(joined.snapshot.room.proposalVersion, proposalVersion);
    assert.equal(joined.snapshot.room.analysisCurrent, false);
    const afterJoin = await waitForCurrentCycle(created.roomId, newAuth);
    room = await engine.store.read(created.roomId);
    assert.equal(scripted.calls.length, 2);
    assert.equal(afterJoin.room.analysisCurrent, true);
    assert.equal(afterJoin.room.participants.length, 2);
    assert.equal(afterJoin.room.approvalCount, 0);
    assert.equal(room.proposalVersion, proposalVersion);
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("synthetic room Lab records redact every Listener trace before saving", async () => {
  const directory = await mkdtemp(resolve(process.cwd(), `.setvia-room-runtime-lab-${randomUUID()}-`));
  const scripted = scriptedGateway([
    { role: "Listener", output: { candidates: [{ key: "availability", value: "08:00" }] } },
    { role: "Judge", output: judge() },
    { role: "Listener", output: { candidates: [{ key: "private_note", value: "PRIVATE_INPUT_CANARY" }] } },
  ]);
  const engine = new AgentEngine(new RoomStore(new MemoryPersistence()), scripted.gateway);
  const journal = {
    runId: randomUUID(),
    attemptsFor: async () => [],
    snapshot: async () => ({ runId: "test", attempts: 0, runAttempts: 0, estimatedCostMicros: 0 }),
    release: async () => {},
  };
  const runtime = new RoomRuntime({
    engine,
    journal: journal as never,
    persistenceLock: async () => {},
    privateRoot: directory,
    publicRoot: join(directory, "public"),
    syntheticDemo: true,
  });
  try {
    const created = await runtime.create(
      CreateRoomRequestSchema.parse({
        creatorName: "Synthetic Alex",
        eventType: "Weekend hike",
        proposal: { id: "hike_plan", label: "Morning trail walk", values: { startTime: "08:00" } },
        estimatedAttendeeCount: 4,
        confirmedAttendeeCount: 2,
      }),
      "Synthetic Alex",
    );
    const auth = { participantId: created.session.participantId, token: created.session.token };
    const room = await engine.store.read(created.roomId);
    await runtime.submit(created.roomId, auth, SubmitRoomMessageSchema.parse({
      messageId: "group_trace_canary",
      expectedRevision: room.revision,
      proposalVersion: room.proposalVersion,
      text: "GROUP_TRACE_CANARY: I can leave at 08:00.",
      visibility: "group",
      questionId: null,
      replyOption: null,
    }));

    const labRoot = join(directory, "lab", "live");
    let reportPath: string | undefined;
    for (let attempt = 0; attempt < 50 && !reportPath; attempt++) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
      reportPath = (await readdir(labRoot).catch(() => []))
        .find((name) => /^run-.*\.json$/.test(name));
    }
    assert.ok(reportPath, "synthetic room cycle should be saved to the private Lab history");
    const report = JSON.parse(await readFile(join(labRoot, reportPath), "utf8")) as {
      records: Array<{ cycle: { traces: Array<{ role: string; input: unknown; output: unknown }> } }>;
    };
    const listener = report.records[0]?.cycle.traces.find((trace) => trace.role === "Listener");
    assert.deepEqual(listener?.input, { redacted: true, context: "group-response" });
    assert.deepEqual(listener?.output, { redacted: true, validated: true });
    assert.equal(JSON.stringify(listener).includes("GROUP_TRACE_CANARY"), false);

    const currentRoom = await engine.store.read(created.roomId);
    await runtime.submit(created.roomId, auth, SubmitRoomMessageSchema.parse({
      messageId: "private_trace_canary",
      expectedRevision: currentRoom.revision,
      proposalVersion: currentRoom.proposalVersion,
      text: "PRIVATE_INPUT_CANARY: please keep this thought private.",
      visibility: "private",
      questionId: null,
      replyOption: null,
    }));
    let reportPaths: string[] = [];
    for (let attempt = 0; attempt < 50 && reportPaths.length < 2; attempt++) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
      reportPaths = (await readdir(labRoot)).filter((name) => /^run-.*\.json$/.test(name));
    }
    assert.equal(reportPaths.length, 2, "group and private analyses should each have a Lab record");
    await runtime.close();

    for (const name of reportPaths) {
      const text = await readFile(join(labRoot, name), "utf8");
      assert.equal(text.includes("PRIVATE_INPUT_CANARY"), false, "private thought and extracted value must not enter Lab history");
      const parsed = JSON.parse(text) as {
        records: Array<{ cycle: { traces: Array<{ role: string; input: unknown; output: unknown }> } }>;
      };
      const privateListener = parsed.records[0]?.cycle.traces.find((trace) => trace.role === "Listener");
      if (name !== reportPath) {
        assert.deepEqual(privateListener?.input, { redacted: true, context: "owner-private" });
        assert.deepEqual(privateListener?.output, { redacted: true, validated: true });
      }
    }
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("mock Meta HTTP responses drive the actual two-participant runtime, SSE, quick replies and fail-closed publication", async () => {
  const directory = await mkdtemp(resolve(process.cwd(), `.setvia-room-full-cycle-${randomUUID()}-`));
  const issue = finding({ id: "departure_gap", category: "Schedule Check", severity: "critical" });
  const groupQuestion = { id: "departure_choice", findingId: issue.id, targetId: null,
    visibility: "group", kind: "choice", text: "Choose a time", options: ["08:00", "09:00"] } as const;
  let ownerId = "";
  const calls: Array<{ role: Role; input: unknown }> = [];
  const waiting = () => judge({ findings: [issue], next: "question", participantInputRequired: true,
    readinessAssessment: { readyForReview: false, explanation: "Departure still requires participant confirmation." } });
  const steps: Array<{ role: Role; output: () => unknown }> = [
    { role: "Listener", output: () => ({ candidates: [{ key: "private_note", value: "owner_only" }] }) },
    { role: "Listener", output: () => ({ candidates: [{ key: "departure", value: "08:00 or 09:00" }] }) },
    { role: "Judge", output: () => judge({ findings: [issue], next: "negotiate", taskFindingIds: [issue.id], anotherPassUseful: true, canStop: false }) },
    { role: "Negotiator", output: () => ({ options: [{ id: "later_departure", label: "Later departure", values: { time: "09:00" } }] }) },
    { role: "Judge", output: () => ({ ...waiting(), verdicts: [{ optionId: "later_departure", accepted: true }] }) },
    { role: "Question Strategist", output: () => ({ questions: [groupQuestion, {
      ...groupQuestion, id: "owner_availability", targetId: ownerId, visibility: "private", options: [],
    }] }) },
    { role: "Speaker", output: () => ({ mascot: "curious", replies: [
      { questionId: groupQuestion.id, findingId: null, text: "Which shared departure time works for everyone?" },
      { questionId: "owner_availability", findingId: null, text: "Would you like to share an availability window?" },
      { questionId: null, findingId: issue.id, text: "We still need to confirm the departure time." },
    ] }) },
    { role: "Judge", output: () => ({ ...waiting(), acceptedQuestionIds: [groupQuestion.id, "owner_availability"] }) },
    { role: "Listener", output: () => ({ candidates: [{ key: "departure", value: "09:00" }] }) },
    { role: "Judge", output: () => judge({ findings: [issue] }) },
    { role: "Listener", output: () => ({ candidates: [] }) },
    { role: "Judge", output: () => judge({ findings: [finding({ evidenceIds: ["fabricated_final_evidence"] })] }) },
  ];
  const base = createMetaGateway({
    prompts: Object.fromEntries(Roles.map((role) => [role, "Synthetic offline test prompt."])) as Record<Role, string>,
    promptVersion: "agents-v6", maxRequestBytes: 50_000, maxOutputTokens: 3_000,
    inputTokenAllowance: 55_000, callTokenAllowance: 64_000, callCostMicros: 104_000,
    inputPriceMicrosPerMillion: 1_250_000, outputPriceMicrosPerMillion: 4_250_000,
    client: {
      config: { apiKey: "offline-test-key", baseUrl: META_API_BASE_URL, model: META_SPARK_MODEL },
      fetchImpl: async (url, init) => {
        assert.equal(String(url), META_API_BASE_URL + "/responses");
        const request = JSON.parse(String(init?.body));
        const step = steps[calls.length];
        assert.ok(step, "no unplanned model calls or retries");
        assert.equal(request.text.format.name, "setvia_" + step.role.toLowerCase().replaceAll(" ", "_"));
        calls.push({ role: step.role, input: JSON.parse(request.input) });
        if (step.role === "Speaker") assert.equal(request.text.format.schema.properties.replies.items.anyOf.length, 2);
        return Response.json({ model: META_SPARK_MODEL, output_text: JSON.stringify(step.output()),
          usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } });
      },
    },
  });
  let runtime!: RoomRuntime;
  const engine = new AgentEngine(new RoomStore(new MemoryPersistence()), { ...base, mode: "MOCK" }, {
    ...MOCK_LIMITS, callTokens: 64_000,
    callCostMicros: 104_000,
  }, (id) => { void runtime.events.publishGroup(id); }, (id, owner) => { void runtime.events.publishPrivate(id, owner); });
  runtime = new RoomRuntime({ engine, privateRoot: directory, publicRoot: join(directory, "public"),
    syntheticDemo: true, persistenceLock: async () => {}, journal: {
      runId: randomUUID(), attemptsFor: async () => [], snapshot: async () => ({ attempts: 0 }), release: async () => {},
    } as never });
  const waitFor = async (condition: () => Promise<boolean>) => {
    for (let i = 0; i < 120; i++) {
      if (await condition()) return;
      await new Promise((done) => setTimeout(done, 25));
    }
    throw new Error("Offline room workflow did not settle.");
  };
  const stream = () => {
    const snapshots: DashboardSnapshot[] = [];
    const response = { writableEnded: false, status: () => response, setHeader: () => {}, flushHeaders: () => {},
      once: () => {}, end: () => { response.writableEnded = true; },
      write: (frame: string) => {
        const data = /^data: (.+)$/m.exec(frame)?.[1];
        if (data) snapshots.push(DashboardSnapshotSchema.parse(JSON.parse(data)));
        return true;
      },
    };
    return { response: response as unknown as ExpressResponse, snapshots };
  };
  try {
    const created = await runtime.create(CreateRoomRequestSchema.parse({ creatorName: "Alex", eventType: "Weekend trip",
      proposal: { id: "trip", label: "Two-person trip", values: { time: "08:00" } } }), "Alex");
    const auth = created.session;
    ownerId = auth.participantId;
    const other = (await runtime.join(created.roomId, created.invitation, "Sam")).session;
    const alexStream = stream();
    const samStream = stream();
    await runtime.events.subscribe(created.roomId, auth, alexStream.response);
    await runtime.events.subscribe(created.roomId, other, samStream.response);
    const submit = async (actor: typeof auth, messageId: string, text: string, visibility: "private" | "group", questionId: string | null = null) => {
      const snapshot = await runtime.snapshot(created.roomId, actor);
      return runtime.submit(created.roomId, actor, { messageId, text, visibility, questionId,
        replyOption: questionId ? text : null, expectedRevision: snapshot.room.revision,
        proposalVersion: snapshot.room.proposalVersion });
    };
    await submit(auth, "private_initial", "PRIVATE_RUNTIME_CANARY", "private");
    await waitFor(async () => (await runtime.snapshot(created.roomId, auth)).room.privateAnalysisStatus === "complete");
    assert.equal((await runtime.snapshot(created.roomId, auth)).room.candidates.length, 1);
    const sharedSuggestions = (await runtime.snapshot(created.roomId, other)).room.candidates;
    assert.equal(sharedSuggestions.length, 0);
    assert.equal((await runtime.snapshot(created.roomId, auth)).room.candidates[0]?.visibility, "private");
    assert.equal((await runtime.snapshot(created.roomId, other)).room.readiness, null);
    await submit(other, "group_initial", "Could we leave at 08:00 or 09:00?", "group");
    await waitFor(async () => (await runtime.snapshot(created.roomId, auth)).room.loopState === "WAIT_FOR_PARTICIPANT");
    const alex = await runtime.snapshot(created.roomId, auth);
    const sam = await runtime.snapshot(created.roomId, other);
    assert.equal(alex.room.questions.length, 2);
    assert.equal(sam.room.questions.length, 1);
    assert.deepEqual(sam.room.questions[0]?.options, ["08:00", "09:00"]);
    assert.equal(sam.room.messages.some((message) => message.text === "We still need to confirm the departure time."), true);
    assert.equal(sam.room.questions[0]?.text, "Which shared departure time works for everyone?");
    assert.equal(sam.room.readiness?.status, "blocked");
    assert.equal(sam.room.approved, false);
    assert.equal(JSON.stringify(sam).includes("PRIVATE_RUNTIME_CANARY"), false);
    assert.equal(JSON.stringify(samStream.snapshots).includes("owner_availability"), false);
    assert.equal(JSON.stringify(samStream.snapshots).includes("PRIVATE_RUNTIME_CANARY"), false);
    assert.equal(JSON.stringify(calls.filter((call) => call.role !== "Listener")).includes("PRIVATE_RUNTIME_CANARY"), false);
    await assert.rejects(submit(other, "unauthorized_reply", "09:00", "private", "owner_availability"), /UNAUTHORIZED_ANSWER/);
    await submit(other, "quick_reply", "09:00", "group", groupQuestion.id);
    await waitFor(async () => (await runtime.snapshot(created.roomId, other)).room.loopState === "COMPLETED");
    const completed = await runtime.snapshot(created.roomId, other);
    assert.equal(completed.contributions.some((entry) => entry.text === "09:00" && entry.questionId === groupQuestion.id), true);
    assert.equal(completed.room.readiness?.status, "blocked", "an interpreted answer cannot confirm facts or clear a critical issue");
    const historyCount = completed.history.length;
    await submit(auth, "blocked_input", "Review this new detail.", "group");
    await waitFor(async () => (await runtime.snapshot(created.roomId, auth)).room.loopState === "BLOCKED");
    const blocked = await runtime.snapshot(created.roomId, auth);
    assert.equal(blocked.room.finalEvaluationAvailable, false);
    assert.deepEqual(blocked.room.messages, []);
    assert.deepEqual(blocked.room.questions, []);
    assert.deepEqual(blocked.room.findings, []);
    assert.equal(blocked.history.length, historyCount);
    assert.equal(calls.length, steps.length);
    assert.deepEqual((calls[7]!.input as { draftFindingReplies: unknown[] }).draftFindingReplies, [
      { findingId: issue.id, text: "We still need to confirm the departure time." },
    ]);
    assert.deepEqual(calls.slice(1, 8).map((call) => call.role), ["Listener", "Judge", "Negotiator", "Judge", "Question Strategist", "Speaker", "Judge"]);
    await waitFor(async () => (await readdir(join(directory, "lab", "live"))).filter((name) => name.endsWith(".json")).length === 4);
    for (const name of await readdir(join(directory, "lab", "live"))) {
      if (!name.endsWith(".json")) continue;
      const report = JSON.parse(await readFile(join(directory, "lab", "live", name), "utf8"));
      assert.equal(report.records[0].mode, "MOCK", "mock HTTP must never be reported as live Meta");
    }
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});
