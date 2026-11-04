import {
  Categories,
  type AgentGateway,
  type Auth,
  type Cycle,
  type Fact,
  type Finding,
  type JudgeEvaluation,
  type PlanOption,
  type Question,
  type Room,
  type Role,
} from "./contracts.js";
import { AgentEngine, MOCK_LIMITS, type Limits } from "./engine.js";
import { MemoryPersistence, RoomStore } from "./store.js";
import { calculateReadiness, violations } from "./readiness.js";
import { RoomService } from "./rooms.js";
import { judge, scriptedGateway, type Step } from "./fixtures.js";
import {
  getScenario,
  RUBRIC_DIMENSIONS,
  SCENARIO_IDS,
  validateScenarioFixture,
  type RubricDimension,
  type ScenarioFixture,
  type ScenarioId,
} from "./scenarios.js";
import type { LabRecord, ScenarioAssertion, ScenarioInputRecord, ScenarioTimelineEvent } from "./lab.js";

type RoomView = Awaited<ReturnType<RoomService["view"]>>;
export interface ScenarioDashboardView {
  simulation: true;
  scenarioId: ScenarioId;
  participantCount: number;
  viewerId: string;
  view: RoomView;
}
export interface PreparedScenario {
  scenario: ScenarioFixture;
  engine: AgentEngine;
  store: RoomStore;
  roomId: string;
  authByParticipant: Map<string, Auth>;
  organizerAuth: Auth;
  statementFactIds: Map<string, string[]>;
  sharedFactIds: string[];
  factOwnerById: Map<string, string>;
  calls: { role: Role; input: unknown }[];
  gateway: AgentGateway;
}
export interface ScenarioExecutionOptions {
  gateway?: AgentGateway;
  limits?: Limits;
}

const finding = (
  id: string,
  category: Finding["category"],
  severity: Finding["severity"],
  message: string,
  recommendedAction: string,
  evidenceIds: string[] = [],
  uncertainty: Finding["uncertainty"] = "missing",
): Finding => ({
  id,
  category,
  severity,
  status: "open",
  evidenceIds,
  uncertainty,
  message,
  recommendedAction,
});

const question = (
  id: string,
  findingId: string,
  text: string,
  targetId: string | null = null,
  visibility: Question["visibility"] = "group",
  options: string[] = [],
): Question => ({
  id,
  findingId,
  targetId,
  visibility,
  kind: options.length ? "choice" : "clarification",
  text,
  options,
});

const actionable = (overrides: Partial<JudgeEvaluation>): JudgeEvaluation =>
  judge({
    ...overrides,
    canStop: overrides.canStop ?? false,
    anotherPassUseful: overrides.anotherPassUseful ?? true,
  });

const finalWithQuestions = (
  findings: Finding[],
  questions: Question[],
  verdicts: JudgeEvaluation["verdicts"] = [],
) =>
  judge({
    findings,
    verdicts,
    next: "stop",
    acceptedQuestionIds: questions.map((q) => q.id),
    anotherPassUseful: false,
    participantInputRequired: true,
    canStop: true,
    readinessAssessment: {
      readyForReview: false,
      explanation: "Synthetic Judge output: wait for the missing participant information.",
    },
  });

function evidence(prepared: PreparedScenario, statementId: string) {
  return prepared.statementFactIds.get(statementId)?.[0] ?? "";
}
function evidenceList(prepared: PreparedScenario, ids: string[]) {
  return ids.map((id) => evidence(prepared, id)).filter(Boolean);
}
function expectedFindings(
  prepared: PreparedScenario,
  ids: string[],
): Finding[] {
  const { expectedFindings } = prepared.scenario.groundTruth;
  return ids.map((id) => {
    const spec = expectedFindings.find((candidate) => candidate.id === id);
    if (!spec) throw new Error("MISSING_GROUND_TRUTH_FINDING:" + id);
    return finding(
      spec.id,
      spec.category,
      spec.severity,
      spec.criterion,
      "Confirm the evidence or ask the relevant participants before treating this as resolved.",
      evidenceList(prepared, spec.evidenceStatementIds),
      spec.severity === "critical" ? "missing" : "estimated",
    );
  });
}

function beachSteps(p: PreparedScenario): Step[] {
  const initial = expectedFindings(p, [
    "beach_budget_range",
    "beach_destination_unknown",
    "beach_ride_capacity",
    "beach_food_amount",
  ]);
  const firstInvalid: PlanOption = {
    id: "beach_saturday",
    label: "Saturday outing draft",
    values: { tripDay: "Saturday", alexPassengers: 4, kenReturnByMinutes: 1080, transportForChris: true },
  };
  const secondInvalid: PlanOption = {
    id: "beach_over_capacity",
    label: "Sunday with five passengers in Alex's car",
    values: { tripDay: "Sunday", alexPassengers: 5, kenReturnByMinutes: 1080, transportForChris: true },
  };
  const revised: PlanOption = {
    id: "beach_sunday_split_transport",
    label: "Sunday draft; second transport to confirm",
    values: {
      tripDay: "Sunday",
      alexPassengers: 4,
      kenReturnByMinutes: 1080,
      transportForChris: true,
      secondVehicle: "ask for another driver or transport option",
      destination: null,
      travelDuration: null,
      totalCost: null,
    },
  };
  const questions = [
    question("beach_q_destination", "beach_destination_unknown", "Which destination should we compare, and what maximum drive would work for you?"),
    question("beach_q_transport", "beach_ride_capacity", "Who can confirm a second vehicle or another seat plan for the remaining passengers?"),
    question("beach_q_costs", "beach_budget_range", "Which costs should be shared, and which should stay individual? Please include food quantities separately."),
  ];
  return [
    { role: "Judge", output: actionable({ findings: initial, taskFindingIds: ["beach_destination_unknown"], next: "negotiate" }) },
    { role: "Negotiator", output: { options: [firstInvalid] } },
    { role: "Judge", output: actionable({ findings: initial, verdicts: [{ optionId: firstInvalid.id, accepted: true }], taskFindingIds: ["beach_destination_unknown"], next: "negotiate" }) },
    { role: "Negotiator", output: { options: [secondInvalid] } },
    { role: "Judge", output: actionable({ findings: initial, verdicts: [{ optionId: secondInvalid.id, accepted: true }], taskFindingIds: ["beach_destination_unknown"], next: "negotiate" }) },
    { role: "Negotiator", output: { options: [revised] } },
    { role: "Judge", output: actionable({ findings: initial, verdicts: [{ optionId: revised.id, accepted: true }], taskFindingIds: ["beach_destination_unknown"], next: "question", participantInputRequired: true }) },
    { role: "Question Strategist", output: { questions } },
    { role: "Speaker", output: { questionIds: questions.map((q) => q.id), findingIds: [], mascot: "curious" } },
    { role: "Judge", output: finalWithQuestions(initial, questions, [{ optionId: revised.id, accepted: true }]) },
  ];
}

function hikingSteps(p: PreparedScenario): Step[] {
  const findings = expectedFindings(p, [
    "hike_route_missing",
    "hike_conditions_unknown",
    "hike_emergency_gap",
    "hike_prep_gap",
  ]);
  const questions = [
    question("hike_q_route", "hike_route_missing", "Which route and pickup point are under consideration, and where will current official conditions be checked?"),
    question("hike_q_emergency", "hike_emergency_gap", "Who will confirm navigation, emergency communication, and first-aid ownership before a route is chosen?"),
  ];
  const first = actionable({ findings, next: "question", participantInputRequired: true, taskFindingIds: ["hike_route_missing", "hike_emergency_gap"] });
  return [
    { role: "Judge", output: first },
    { role: "Question Strategist", output: { questions } },
    { role: "Speaker", output: { questionIds: questions.map((q) => q.id), findingIds: [], mascot: "concerned" } },
    { role: "Judge", output: finalWithQuestions(findings, questions) },
  ];
}

function kickoffSteps(p: PreparedScenario): Step[] {
  const findings = expectedFindings(p, ["kickoff_no_feasible_slot", "kickoff_async_option"]);
  const first: PlanOption = {
    id: "kickoff_new_york_window",
    label: "Use the client's 8–9 AM New York window",
    values: { startUtcHour: 13, durationMinutes: 45, meetingFormat: "online" },
  };
  const second: PlanOption = {
    id: "kickoff_manila_window",
    label: "Use the technical lead's last available hour",
    values: { startUtcHour: 8, durationMinutes: 30, meetingFormat: "online" },
  };
  return [
    { role: "Judge", output: actionable({ findings, taskFindingIds: ["kickoff_no_feasible_slot"], next: "negotiate" }) },
    { role: "Negotiator", output: { options: [first] } },
    { role: "Judge", output: actionable({ findings, verdicts: [{ optionId: first.id, accepted: true }], taskFindingIds: ["kickoff_no_feasible_slot"], next: "negotiate" }) },
    { role: "Negotiator", output: { options: [second] } },
    // The Judge explicitly stops after the application rejects this second
    // invalid slot and returns the decision to a human.
    { role: "Judge", output: judge({ findings, verdicts: [{ optionId: second.id, accepted: true }], next: "stop", taskFindingIds: [], canStop: true, anotherPassUseful: false, participantInputRequired: false, readinessAssessment: { readyForReview: false, explanation: "No shared meeting time satisfies the required attendee and duration constraints; a human must choose whether to split or review the scope asynchronously." } }) },
  ];
}

function familySteps(p: PreparedScenario): Step[] {
  const findings = expectedFindings(p, ["family_access_unknown", "family_budget_range", "family_travel_plan"]);
  const privateStatements = p.scenario.participants.flatMap((person) => person.statements.filter((s) => s.audience === "listener_only"));
  const listeners: Step[] = privateStatements.map((entry, index) => ({
    role: "Listener",
    output: { candidates: [{ key: index === 0 ? "private_weekend_preference" : "private_contribution_candidate", value: index === 0 ? "weekend only; owner confirmation required" : "private amount withheld; owner confirmation required" }] },
  }));
  const ren = p.authByParticipant.get("ren")!.participantId;
  const niko = p.authByParticipant.get("niko")!.participantId;
  const questions = [
    question("family_q_access", "family_access_unknown", "Which venue access details would you like us to verify, and what may be shared with the group?", ren, "private"),
    question("family_q_cost", "family_budget_range", "What contribution range may we include in the group cost comparison?", niko, "private"),
    question("family_q_attendance", "family_travel_plan", "Please confirm whether you expect to attend and whether you need a weekend travel or transit option.", null, "group"),
  ];
  const first = actionable({ findings, next: "question", participantInputRequired: true, taskFindingIds: ["family_access_unknown", "family_budget_range"] });
  return [
    ...listeners,
    { role: "Judge", output: first },
    { role: "Question Strategist", output: { questions } },
    { role: "Speaker", output: { questionIds: questions.map((q) => q.id), findingIds: [], mascot: "curious" } },
    { role: "Judge", output: finalWithQuestions(findings, questions) },
  ];
}

function volunteerSteps(p: PreparedScenario): Step[] {
  const findings = expectedFindings(p, [
    "volunteer_cost_conflict",
    "volunteer_access_conflict",
    "volunteer_shift_conflict",
    "volunteer_lead_gaps",
  ]);
  const access = p.authByParticipant.get("student_03")!.participantId;
  const questions = [
    question("volunteer_q_access", "volunteer_access_conflict", "Could the venue confirm the step-free route and washroom access before we publish the location?", access, "private"),
    question("volunteer_q_attendance", "volunteer_shift_conflict", "If you have not confirmed attendance, please select a status and preferred shift.", null, "group", ["Available morning", "Available afternoon", "Unavailable", "Not sure yet"]),
    question("volunteer_q_budget", "volunteer_cost_conflict", "Can the organizers confirm one per-person budget and state whether lunch is included?", null, "group"),
    question("volunteer_q_leads", "volunteer_lead_gaps", "Who can own the afternoon shift and safety plan? Bringing supplies alone does not assign either role.", null, "group"),
  ];
  const first = actionable({ findings, next: "question", participantInputRequired: true, taskFindingIds: ["volunteer_access_conflict", "volunteer_cost_conflict", "volunteer_lead_gaps"] });
  return [
    { role: "Judge", output: first },
    { role: "Question Strategist", output: { questions } },
    { role: "Speaker", output: { questionIds: questions.map((q) => q.id), findingIds: [], mascot: "concerned" } },
    { role: "Judge", output: finalWithQuestions(findings, questions) },
  ];
}

export async function prepareScenario(
  scenario: ScenarioFixture,
  options: ScenarioExecutionOptions = {},
): Promise<PreparedScenario> {
  validateScenarioFixture(scenario);
  const store = new RoomStore(new MemoryPersistence());
  const rooms = new RoomService(store);
  const authByParticipant = new Map<string, Auth>();
  const created = await rooms.create(
    scenario.eventType,
    scenario.policy,
    scenario.proposal,
    {
      estimatedAttendeeCount: scenario.estimatedAttendeeCount,
      confirmedAttendeeCount: scenario.confirmedAttendeeCount,
    },
  );
  for (const person of scenario.participants) {
    const joined = await rooms.join(created.roomId, created.invitation, person.name);
    authByParticipant.set(person.id, {
      participantId: joined.participantId,
      token: joined.token,
    });
    if (person.publicTargetingConsent) {
      const room = await store.read(created.roomId);
      await rooms.setPublicTargeting(
        created.roomId,
        authByParticipant.get(person.id)!,
        room.revision,
        true,
      );
    }
  }
  const statementFactIds = new Map<string, string[]>();
  const sharedFactIds: string[] = [];
  const factOwnerById = new Map<string, string>();
  await store.transaction(created.roomId, (room) => {
    if (!room) throw new Error("SCENARIO_ROOM_MISSING");
    const facts: Fact[] = [];
    for (const person of scenario.participants) {
      for (const authored of person.statements) {
        if (authored.audience !== "group") continue;
        const auth = authByParticipant.get(person.id);
        if (!auth) throw new Error("SCENARIO_AUTH_MISSING");
        const ids: string[] = [];
        for (const [index, claim] of authored.facts.entries()) {
          const id = `fact_${authored.id}_${index}`;
          ids.push(id);
          facts.push({
            id,
            key: claim.key,
            value: claim.value,
            ownerId: auth.participantId,
            visibility: "group",
            scope: claim.scope ?? "participant",
            confirmed: claim.confirmed ?? authored.confirmed,
          });
          factOwnerById.set(id, person.id);
        }
        statementFactIds.set(authored.id, ids);
      }
      if (person.statements.some((entry) => entry.audience === "group")) {
        const auth = authByParticipant.get(person.id)!;
        const attendanceId = `fact_attendance_${person.id}`;
        facts.push({
          id: attendanceId,
          key: "attendanceStatus",
          value: person.responseStatus,
          ownerId: auth.participantId,
          visibility: "group",
          scope: "participant",
          confirmed: person.responseStatus === "confirmed",
        });
        factOwnerById.set(attendanceId, person.id);
      }
    }
    room.facts = facts;
    sharedFactIds.push(...facts.map((f) => f.id));
    room.constraints = scenario.constraints.map(({ owner, ...constraint }) => {
      const auth = authByParticipant.get(owner);
      if (!auth) throw new Error("SCENARIO_CONSTRAINT_OWNER_MISSING");
      return { ...constraint, ownerId: auth.participantId };
    });
    room.revision++;
  });
  // Private statements use the real authenticated input queue. Their text is
  // supplied only to Listener and is redacted in Cycle traces and Lab records.
  for (const person of scenario.participants) {
    const auth = authByParticipant.get(person.id)!;
    for (const authored of person.statements) {
      if (authored.audience !== "listener_only") continue;
      const room = await store.read(created.roomId);
      await rooms.submit(
        created.roomId,
        auth,
        room.revision,
        authored.text,
      );
    }
  }
  const provisional = {
    scenario,
    engine: null as unknown as AgentEngine,
    store,
    roomId: created.roomId,
    authByParticipant,
    organizerAuth: authByParticipant.get(scenario.participants[0]!.id)!,
    statementFactIds,
    sharedFactIds,
    factOwnerById,
    calls: [] as { role: Role; input: unknown }[],
    gateway: null as unknown as AgentGateway,
  } satisfies PreparedScenario;
  const scripted = options.gateway
    ? { gateway: options.gateway, calls: [] as { role: Role; input: unknown }[] }
    : scriptedGateway(scenarioSteps(provisional));
  const gateway: AgentGateway = options.gateway
    ? {
        mode: options.gateway.mode,
        promptHashes: options.gateway.promptHashes,
        promptVersion: options.gateway.promptVersion,
        async call(role, input, context) {
          scripted.calls.push({ role, input: structuredClone(input) });
          return options.gateway!.call(role, input, context);
        },
      }
    : scripted.gateway;
  const mockLimits: Limits = {
    ...MOCK_LIMITS,
    callTokens: 12_000,
    callCostMicros: 30_000,
  };
  const engine = new AgentEngine(
    store,
    gateway,
    options.limits ?? mockLimits,
  );
  return {
    ...provisional,
    engine,
    factOwnerById,
    calls: scripted.calls,
    gateway,
  };
}

function safeInputRecords(scenario: ScenarioFixture): ScenarioInputRecord[] {
  return scenario.participants.flatMap((person) => {
    if (!person.statements.length) {
      return [{ participantId: person.id, participantLabel: person.name, role: person.role, responseStatus: person.responseStatus, roomResponseStatus: person.roomResponseStatus, statements: [] }];
    }
    return [{
      participantId: person.id,
      participantLabel: person.name,
      role: person.role,
      responseStatus: person.responseStatus,
      roomResponseStatus: person.roomResponseStatus,
      ...(person.timeZone ? { timeZone: person.timeZone } : {}),
      statements: person.statements.map((entry) => ({
        statementId: entry.id,
        text: entry.audience === "group" ? entry.text : "[PRIVATE LISTENER-ONLY RESPONSE REDACTED]",
        audience: entry.audience,
        consent: entry.consent,
        confirmed: entry.confirmed,
      })),
    }];
  });
}

function expectedRolePath(scenario: ScenarioFixture) {
  if (scenario.id === "A") return ["Judge", "Negotiator", "Judge", "Negotiator", "Judge", "Negotiator", "Judge", "Question Strategist", "Speaker", "Judge"];
  if (scenario.id === "B") return ["Judge", "Question Strategist", "Speaker", "Judge"];
  if (scenario.id === "C") return ["Judge", "Negotiator", "Judge", "Negotiator", "Judge"];
  if (scenario.id === "D") return ["Listener", "Listener", "Judge", "Question Strategist", "Speaker", "Judge"];
  return ["Judge", "Question Strategist", "Speaker", "Judge"];
}

function expectedOutcome(scenario: ScenarioFixture): Cycle["outcome"] {
  if (scenario.id === "A" || scenario.id === "B" || scenario.id === "D" || scenario.id === "E" || scenario.id === "E_STRESS") return "WAIT_FOR_PARTICIPANT";
  return "COMPLETED";
}

function traceOutputFindings(cycle: Cycle): Finding[] {
  return cycle.traces.flatMap((trace) => {
    if (trace.role !== "Judge" || !trace.output || typeof trace.output !== "object") return [];
    const output = trace.output as { findings?: unknown };
    return Array.isArray(output.findings) ? (output.findings as Finding[]) : [];
  });
}

async function assertionsFor(
  prepared: PreparedScenario,
  cycle: Cycle,
  recordSafeJson: string,
): Promise<ScenarioAssertion[]> {
  const scenario = prepared.scenario;
  const path = cycle.traces.map((trace) => trace.role);
  const assertions: ScenarioAssertion[] = [
    { id: "expected_outcome", label: "Execution stops in the ground-truth state", passed: cycle.outcome === expectedOutcome(scenario), detail: `expected ${expectedOutcome(scenario)}, got ${cycle.outcome}` },
    { id: "conditional_agent_path", label: "Only the scenario-appropriate agents ran", passed: JSON.stringify(path) === JSON.stringify(expectedRolePath(scenario)), detail: path.join(" → ") },
    { id: "accounted_calls", label: "Every model attempt is represented in the execution record", passed: cycle.attempts === cycle.traces.reduce((total, trace) => total + trace.attempts, 0), detail: `${cycle.attempts} attempts; ${cycle.traces.length} invocations; no application quota` },
    { id: "all_categories_configured", label: "All six Reality Check categories remain configurable", passed: scenario.policy.length === 6 && scenario.policy.every((p, index) => p.category === Categories[index]), detail: scenario.policy.map((p) => p.category).join(", ") },
  ];
  const allJudgeFindings = traceOutputFindings(cycle);
  const expected = scenario.groundTruth.expectedFindings;
  assertions.push({
    id: "expected_findings_in_trace",
    label: "Mock Judge outputs include the authored ground-truth finding categories",
    passed: expected.every((spec) => allJudgeFindings.some((item) => item.id === spec.id && item.category === spec.category && item.severity === spec.severity)),
    detail: `${expected.length} authored finding expectations checked across visible Judge outputs (scripted mock, not model-quality evidence)`,
  });
  if (scenario.id === "A") {
    const rejectionTraces = cycle.traces.filter((trace) => trace.role === "Judge");
    const firstRejected = rejectionTraces[1];
    const secondRejected = rejectionTraces[2];
    const finalNegotiator = [...cycle.traces].reverse().find((trace) => trace.role === "Negotiator");
    const finalValues = (finalNegotiator?.output as { options?: PlanOption[] } | null)?.options?.[0]?.values;
    const noInventedEstimates = finalValues?.destination === null && finalValues?.travelDuration === null && finalValues?.totalCost === null;
    const finalReadiness = cycle.readiness;
    assertions.push(
      { id: "sam_schedule_enforced", label: "Saturday proposal is rejected against Sam's hard availability", passed: !!firstRejected?.rejectedOptionIds.includes("beach_saturday") && !!firstRejected.output && (firstRejected.output as JudgeEvaluation).findings.some((item) => item.category === "Schedule Check" && item.id.startsWith("hard_")), detail: "Backend constraint validation rejects the Saturday candidate." },
      { id: "alex_capacity_enforced", label: "Five passengers are rejected against Alex's stated limit", passed: !!secondRejected?.rejectedOptionIds.includes("beach_over_capacity") && !!secondRejected.output && (secondRejected.output as JudgeEvaluation).findings.some((item) => item.category === "Logistics Check" && item.id.startsWith("hard_")), detail: "Backend constraint validation rejects the over-capacity candidate." },
      { id: "no_invented_estimates", label: "Negotiator leaves venue, duration, and total cost unknown", passed: !!noInventedEstimates, detail: `destination=${String(finalValues?.destination)}, travelDuration=${String(finalValues?.travelDuration)}, totalCost=${String(finalValues?.totalCost)}` },
      { id: "readiness_not_green", label: "Open planning questions do not produce a ready status", passed: finalReadiness?.status !== "ready_for_human_review", detail: `${finalReadiness?.percentage}% · ${finalReadiness?.status}` },
    );
  }
  if (scenario.id === "B") {
    const safety = cycle.finalEvaluation?.findings.filter((item) => item.category === "Safety Check" && item.severity === "critical" && item.status !== "resolved") ?? [];
    assertions.push(
      { id: "critical_safety_retained", label: "Critical unknown safety requirements remain unresolved", passed: safety.length >= 2, detail: `${safety.length} open critical Safety Check findings` },
      { id: "safety_blocks_readiness", label: "Critical safety gaps prevent a green readiness state", passed: cycle.readiness?.status === "blocked" && cycle.readiness.categories.some((category) => category.category === "Safety Check" && category.status === "blocked"), detail: `${cycle.readiness?.percentage}% · ${cycle.readiness?.status}` },
      { id: "no_safety_guarantee", label: "No AI safety guarantee is emitted", passed: !!cycle.finalEvaluation && !cycle.finalEvaluation.readinessAssessment.readyForReview, detail: cycle.finalEvaluation?.readinessAssessment.explanation ?? "No final Judge" },
    );
  }
  if (scenario.id === "C") {
    const firstInvalid = cycle.traces.find((trace) => trace.role === "Judge" && trace.rejectedOptionIds.includes("kickoff_new_york_window"));
    const secondInvalid = cycle.traces.find((trace) => trace.role === "Judge" && trace.rejectedOptionIds.includes("kickoff_manila_window"));
    assertions.push(
      { id: "client_window_enforced", label: "A New York client slot violating required attendee constraints is rejected", passed: !!firstInvalid, detail: firstInvalid?.rejectedOptionIds.join(", ") ?? "No rejection recorded" },
      { id: "scope_duration_enforced", label: "A 30-minute slot cannot satisfy the 45-minute scope requirement", passed: !!secondInvalid, detail: secondInvalid?.rejectedOptionIds.join(", ") ?? "No rejection recorded" },
      { id: "human_decision_stop", label: "Judge stops with the impossibility and leaves it to a human", passed: cycle.outcome === "COMPLETED" && !!cycle.finalEvaluation?.findings.some((item) => item.id === "kickoff_no_feasible_slot") && cycle.readiness?.status === "blocked", detail: `${cycle.outcome} · ${cycle.readiness?.status}` },
      { id: "no_accepted_infeasible_slot", label: "No invalid meeting option is accepted", passed: cycle.traces.filter((trace) => trace.role === "Judge").every((trace) => trace.acceptedOptionIds.every((id) => !["kickoff_new_york_window", "kickoff_manila_window"].includes(id))), detail: "Both infeasible candidates are present in rejectedOptionIds." },
    );
  }
  if (scenario.id === "D") {
    const markers = scenario.participants.flatMap((person) => person.statements.filter((entry) => entry.audience === "listener_only").map((entry) => entry.text));
    const nonListenerInputs = prepared.calls.filter((call) => call.role !== "Listener").map((call) => JSON.stringify(call.input));
    const privateOnlyInListener = markers.every((marker) => prepared.calls.filter((call) => call.role === "Listener").some((call) => JSON.stringify(call.input).includes(marker))) && nonListenerInputs.every((input) => markers.every((marker) => !input.includes(marker)));
    const tracesRedacted = cycle.traces.filter((trace) => trace.role === "Listener").every((trace) => JSON.stringify({ input: trace.input, output: trace.output }).includes("redacted") && markers.every((marker) => !JSON.stringify(trace).includes(marker)));
    const accessQuestion = cycle.questions.find((q) => q.id === "family_q_access");
    const accessViewer = await prepared.engine.rooms.view(prepared.roomId, prepared.authByParticipant.get("ren")!);
    const bystander = await prepared.engine.rooms.view(prepared.roomId, prepared.authByParticipant.get("mara")!);
    assertions.push(
      { id: "private_input_listener_only", label: "Listener receives private text; shared agents do not", passed: privateOnlyInListener, detail: "Inspected in-memory gateway handoffs for both private fixture statements." },
      { id: "listener_trace_redacted", label: "Private Listener request and result are redacted from Lab traces", passed: tracesRedacted, detail: "Trace input/output retain only redaction markers." },
      { id: "targeted_private_question", label: "Accessibility follow-up is private and addressed only to the relevant participant", passed: !!accessQuestion && accessQuestion.visibility === "private" && accessQuestion.targetId === prepared.authByParticipant.get("ren")!.participantId && accessViewer.questions.some((q) => q.id === "family_q_access") && !bystander.questions.some((q) => q.id === "family_q_access"), detail: "Ren sees the question; the organizer projection does not." },
      { id: "lab_private_content_redacted", label: "Saved evaluation material contains no listener-only statement text", passed: markers.every((marker) => !recordSafeJson.includes(marker)), detail: "Private statement text is replaced with a redaction placeholder in the saved inputs." },
      { id: "no_indirect_private_summary", label: "No shared Judge finding or question is derived from private-only details", passed: !!cycle.finalEvaluation && cycle.finalEvaluation.findings.every((item) => !/private|reason|₱1,500|weekend only/i.test(item.message + " " + item.recommendedAction)) && cycle.questions.every((q) => !/private response|different arrangement|₱1,500|weekend only/i.test(q.text)), detail: "Shared material is based on group-authorized facts only." },
    );
  }
  if (scenario.id === "E" || scenario.id === "E_STRESS") {
    const stress = scenario.id === "E_STRESS";
    const expectedRoomCount = stress ? 58 : 7;
    const judgeCalls = prepared.calls.filter((call) => call.role === "Judge");
    const fullGroupContext = judgeCalls.length > 0 && judgeCalls.every((call) => {
      const context = call.input as { participants?: unknown[]; facts?: Fact[]; attendance?: { estimatedAttendeeCount?: number | null; confirmedAttendeeCount?: number | null; roomParticipantCount?: number; requiredApproverIds?: unknown[] } };
      return context.participants?.length === expectedRoomCount &&
        context.attendance?.estimatedAttendeeCount === 58 &&
        context.attendance?.confirmedAttendeeCount === 47 &&
        context.attendance?.roomParticipantCount === expectedRoomCount &&
        context.attendance.requiredApproverIds?.length === expectedRoomCount &&
        prepared.sharedFactIds.every((id) => context.facts?.some((fact) => fact.id === id));
    });
    const roomFacts = (await prepared.store.read(prepared.roomId)).facts;
    const ownersAttributed = prepared.sharedFactIds.every((id) => {
      const fact = roomFacts.find((candidate) => candidate.id === id);
      const stableOwner = prepared.factOwnerById.get(id);
      return !!fact && !!stableOwner && fact.ownerId === prepared.authByParticipant.get(stableOwner)?.participantId;
    });
    const distinctPeople = new Set(scenario.participants.map((person) => person.id)).size === expectedRoomCount;
    const noPerParticipantCalls = cycle.traces.filter((trace) => trace.role === "Listener").length === 0;
    const questionsUnique = new Set(cycle.questions.map((q) => `${q.findingId}:${q.targetId}:${q.kind}`)).size === cycle.questions.length;
    const access = cycle.finalEvaluation?.findings.find((item) => item.id === "volunteer_access_conflict");
    const accessEvidence = new Set(access?.evidenceIds ?? []);
    const expectedAccessIds = evidenceList(prepared, ["volunteer_03", "volunteer_04", "volunteer_05"]);
    if (stress) {
      assertions.push(
        { id: "58_distinct_active_planners", label: "The separate stress fixture has 58 distinct active planners", passed: distinctPeople && scenario.participants.length === 58, detail: `${scenario.participants.length} active room members; 52 authored responses; six actual room nonresponses; fixed seed ${scenario.seed}` },
        { id: "stress_context_not_truncated", label: "All 58 active planners and authorized facts reach every Judge context", passed: fullGroupContext, detail: `${prepared.sharedFactIds.length} authorized facts in each Judge handoff; no slicing or per-person Listener call.` },
        { id: "stress_accessibility_evidence", label: "Accessibility remains unresolved using the affected participant and disputed venue claims", passed: !!access && expectedAccessIds.every((id) => accessEvidence.has(id)) && cycle.readiness?.status === "blocked", detail: `${access?.evidenceIds.length ?? 0} evidence references; status ${cycle.readiness?.status}` },
        { id: "stress_call_efficiency", label: "Stress analysis does not make one model call per planner", passed: noPerParticipantCalls && cycle.attempts < scenario.participants.length, detail: `${cycle.attempts} attempts for ${scenario.participants.length} active planners` },
        { id: "stress_questions_deduplicated", label: "Generated follow-up questions are distinct", passed: questionsUnique && cycle.questions.length === 4, detail: `${cycle.questions.length} questions; ${new Set(cycle.questions.map((q) => `${q.findingId}:${q.targetId}:${q.kind}`)).size} unique issue/recipient/type keys` },
        { id: "stress_attribution_retained", label: "All response facts retain their owner and consent metadata", passed: ownersAttributed && prepared.sharedFactIds.length === roomFacts.length, detail: `${prepared.sharedFactIds.length} scoped facts map to their authenticated synthetic planner.` },
      );
    } else {
      const roomNonresponseCount = scenario.participants.filter((person) => person.roomResponseStatus === "no_response").length;
      assertions.push(
        { id: "attendees_separate_from_planners", label: "58 expected event attendees remain distinct from seven room planners and approvers", passed: scenario.estimatedAttendeeCount === 58 && scenario.confirmedAttendeeCount === 47 && scenario.roomParticipantCount === 7 && scenario.requiredApproverIds.length === 7 && roomNonresponseCount === 1 && fullGroupContext, detail: `58 estimated attendees, 47 confirmed attendees, seven room planners, seven required approvers, and ${roomNonresponseCount} actual room nonresponse.` },
        { id: "planner_context_complete", label: "Every actual room planner and authorized fact reaches Judge", passed: fullGroupContext, detail: `${prepared.sharedFactIds.length} authorized facts in each Judge handoff.` },
        { id: "committee_accessibility_evidence", label: "Accessibility remains unresolved using the affected participant and disputed venue claims", passed: !!access && expectedAccessIds.every((id) => accessEvidence.has(id)) && cycle.readiness?.status === "blocked", detail: `${access?.evidenceIds.length ?? 0} evidence references; status ${cycle.readiness?.status}` },
        { id: "committee_call_efficiency", label: "The seven-planner analysis does not make one model call per planner", passed: noPerParticipantCalls && cycle.attempts < scenario.participants.length, detail: `${cycle.attempts} attempts for ${scenario.participants.length} actual room planners.` },
      );
    }
  }
  return assertions;
}

function expectedOutputFor(scenario: ScenarioFixture) {
  return {
    outcome: expectedOutcome(scenario),
    findings: scenario.groundTruth.expectedFindings.map(({ id, category, severity, criterion }) => ({ id, category, severity, criterion })),
    stoppingConditions: scenario.groundTruth.stoppingConditions,
    qualitativeReviewRequired: true as const,
  };
}

function timelineFor(room: Room, cycle: Cycle): ScenarioTimelineEvent[] {
  const before = structuredClone(room);
  before.facts = [];
  before.constraints = [];
  before.lastCycle = null;
  before.readiness = null;
  const noInputs = calculateReadiness(before, []);
  const responses = calculateReadiness(room, []);
  const reviewed = cycle.readiness ?? responses;
  return [
    { stage: "Invitation opened", event: "group_created", simulation: true, readiness: noInputs, note: "Deterministic score before group-authorized responses." },
    { stage: "Participants responded", event: "responses_received", simulation: true, readiness: responses, note: "Derived from confirmed group facts and participant response coverage." },
    { stage: "Reality Check findings", event: "findings_added", simulation: true, readiness: reviewed, note: "Deterministic score after the mocked Judge findings; the status remains authoritative over the percentage." },
  ];
}

function reviewerTemplate(): Record<RubricDimension, number | null> {
  return Object.fromEntries(RUBRIC_DIMENSIONS.map((key) => [key, null])) as Record<RubricDimension, number | null>;
}

export async function createScenarioDashboardView(
  prepared: PreparedScenario,
  participantId: string,
): Promise<ScenarioDashboardView> {
  const auth = prepared.authByParticipant.get(participantId);
  if (!auth) throw new Error("UNKNOWN_SCENARIO_VIEWER");
  return {
    simulation: true,
    scenarioId: prepared.scenario.id,
    participantCount: prepared.scenario.participants.length,
    viewerId: participantId,
    view: await prepared.engine.rooms.view(prepared.roomId, auth),
  };
}

function scenarioSteps(prepared: PreparedScenario) {
  const scenario = prepared.scenario;
  return scenario.id === "A" ? beachSteps(prepared) : scenario.id === "B" ? hikingSteps(prepared) : scenario.id === "C" ? kickoffSteps(prepared) : scenario.id === "D" ? familySteps(prepared) : volunteerSteps(prepared);
}

export async function runScenarioMock(
  id: ScenarioId,
): Promise<{ record: LabRecord; prepared: PreparedScenario }> {
  return runScenario(id, "MOCK");
}

export async function runScenarioWithGateway(
  id: ScenarioId,
  gateway: AgentGateway,
  limits: Limits,
): Promise<{ record: LabRecord; prepared: PreparedScenario }> {
  if (gateway.mode !== "META") throw new Error("LIVE_GATEWAY_REQUIRED");
  return runScenario(id, "LIVE", { gateway, limits });
}

async function runScenario(
  id: ScenarioId,
  mode: "MOCK" | "LIVE",
  options: ScenarioExecutionOptions = {},
): Promise<{ record: LabRecord; prepared: PreparedScenario }> {
  const scenario = getScenario(id);
  validateScenarioFixture(scenario);
  if (!scenario.synthetic) throw new Error("SYNTHETIC_FIXTURE_REQUIRED");
  const prepared = await prepareScenario(scenario, options);
  const start = performance.now();
  const cycle = await prepared.engine.run(prepared.roomId, prepared.organizerAuth);
  const durationMs = Math.round(performance.now() - start);
  const finalRoom = await prepared.store.read(prepared.roomId);
  const inputStatements = safeInputRecords(scenario);
  const timeline = timelineFor(finalRoom, cycle);
  const rubric = {
    dimensions: [...RUBRIC_DIMENSIONS],
    ratings: reviewerTemplate(),
    comments: "",
    criteria: scenario.groundTruth.reviewCriteria,
  };
  const record: LabRecord = {
    scenario: `${scenario.id} — ${scenario.title}`,
    scenarioId: scenario.id,
    mode,
    simulation: true,
    participantCount: scenario.participants.length,
    model: mode === "LIVE" ? "muse-spark-1.3" : null,
    promptVersion: cycle.traces[0]?.promptVersion ?? options.gateway?.promptVersion ?? "agents-v1",
    eventAttendance: {
      estimatedAttendeeCount: scenario.estimatedAttendeeCount,
      confirmedAttendeeCount: scenario.confirmedAttendeeCount,
      roomParticipantCount: scenario.roomParticipantCount,
      requiredApproverIds: [...scenario.requiredApproverIds],
      respondedRoomParticipants: scenario.participants.filter((person) => person.roomResponseStatus === "responded").length,
      nonrespondingRoomParticipants: scenario.participants.filter((person) => person.roomResponseStatus === "no_response").length,
    },
    fixtureSeed: scenario.seed,
    inputStatements,
    groundTruth: scenario.groundTruth,
    expected: expectedOutputFor(scenario),
    assertions: [],
    rubric,
    timeline,
    durationMs,
    dashboardCounts: {
      responding: scenario.participants.filter((person) => person.roomResponseStatus === "responded").length,
      confirmed: scenario.participants.filter((person) => person.responseStatus === "confirmed").length,
      unconfirmed: scenario.participants.filter((person) => person.responseStatus === "unconfirmed").length,
      noResponse: scenario.participants.filter((person) => person.roomResponseStatus === "no_response").length,
    },
    cycle,
  };
  const safeJson = JSON.stringify(record);
  record.assertions = mode === "MOCK"
    ? await assertionsFor(prepared, cycle, safeJson)
    : await liveAssertionsFor(prepared, cycle, safeJson);
  if (mode === "MOCK")
    record.passed = cycle.outcome === expectedOutcome(scenario) && record.assertions.every((assertion) => assertion.passed);
  return { record, prepared };
}

async function liveAssertionsFor(
  prepared: PreparedScenario,
  cycle: Cycle,
  recordSafeJson: string,
): Promise<ScenarioAssertion[]> {
  const room = await prepared.store.read(prepared.roomId);
  const acceptedIds = cycle.traces.flatMap((trace) => trace.acceptedOptionIds);
  const optionsById = new Map<string, PlanOption>([[room.proposal.id, room.proposal]]);
  for (const trace of cycle.traces) {
    const input = trace.input as { proposedOptions?: PlanOption[] } | null;
    for (const option of input?.proposedOptions ?? []) optionsById.set(option.id, option);
  }
  const acceptedOptionsValid = acceptedIds.every((id) => {
    const option = optionsById.get(id);
    return !!option && violations(room, option).length === 0;
  });
  const assertions: ScenarioAssertion[] = [
    {
      id: "live_request_accounting",
      label: "Live calls and reservations are recorded without application quotas",
      passed: cycle.attempts === cycle.traces.reduce((total, trace) => total + trace.attempts, 0) &&
        cycle.reservedTokens >= 0 &&
        cycle.reservedCostMicros >= 0,
      detail: `${cycle.attempts} HTTP attempts; ${cycle.traces.length} invocations; ${cycle.reservedTokens} reserved tokens; $${(cycle.reservedCostMicros / 1e6).toFixed(4)} recorded.`,
    },
    {
      id: "reality_check_categories",
      label: "All six approved Reality Check categories are configured",
      passed: prepared.scenario.policy.length === Categories.length &&
        prepared.scenario.policy.every((policy, index) => policy.category === Categories[index]),
      detail: prepared.scenario.policy.map((policy) => policy.category).join(", "),
    },
    {
      id: "accepted_constraints",
      label: "No model-accepted option violates a deterministic hard constraint",
      passed: acceptedOptionsValid,
      detail: acceptedIds.length
        ? `${acceptedIds.length} accepted option verdicts were checked against the room's hard constraints.`
        : "No option was accepted; this check does not assess whether the model found every issue.",
    },
    {
      id: "no_critical_green",
      label: "Unresolved critical findings cannot produce a ready status",
      passed: !(cycle.finalEvaluation?.findings.some((finding) =>
        finding.severity === "critical" && finding.status !== "resolved") &&
        cycle.readiness?.status === "ready_for_human_review"),
      detail: `${cycle.readiness?.status ?? "readiness unavailable"}; deterministic status check only.`,
    },
  ];
  if (prepared.scenario.id === "D") {
    const markers = prepared.scenario.participants.flatMap((person) =>
      person.statements.filter((entry) => entry.audience === "listener_only").map((entry) => entry.text),
    );
    const listenerCalls = prepared.calls.filter((call) => call.role === "Listener");
    const sharedCalls = prepared.calls.filter((call) => call.role !== "Listener");
    const isolated = markers.every((marker) => listenerCalls.some((call) => JSON.stringify(call.input).includes(marker))) &&
      sharedCalls.every((call) => markers.every((marker) => !JSON.stringify(call.input).includes(marker)));
    const redacted = cycle.traces.filter((trace) => trace.role === "Listener").every((trace) =>
      JSON.stringify(trace).includes("redacted") && markers.every((marker) => !JSON.stringify(trace).includes(marker)),
    ) && markers.every((marker) => !recordSafeJson.includes(marker));
    assertions.push(
      {
        id: "private_input_isolation",
        label: "Listener-only input is isolated from other model roles",
        passed: isolated,
        detail: `${markers.length} private synthetic responses checked across model handoffs.`,
      },
      {
        id: "private_trace_redaction",
        label: "Listener-only input and output are redacted from saved Lab records",
        passed: redacted,
        detail: "Checks the persisted record serialization and Listener traces for private sentinel text.",
      },
    );
  }
  if (prepared.scenario.id === "E") {
    const roomNonresponses = prepared.scenario.participants.filter((person) => person.roomResponseStatus === "no_response").length;
    const judgeTraces = cycle.traces.filter((trace) => trace.role === "Judge");
    const countsSeparated = judgeTraces.length > 0 && judgeTraces.every((trace) => {
      const input = trace.input as { participants?: unknown[]; attendance?: { estimatedAttendeeCount?: number | null; confirmedAttendeeCount?: number | null; roomParticipantCount?: number; requiredApproverIds?: unknown[] } } | null;
      return input?.participants?.length === 7 && input.attendance?.estimatedAttendeeCount === 58 &&
        input.attendance.confirmedAttendeeCount === 47 && input.attendance.roomParticipantCount === 7 &&
        input.attendance.requiredApproverIds?.length === 7;
    });
    assertions.push(
      {
        id: "event_attendance_not_room_membership",
        label: "58 event attendees and 47 confirmations remain separate from seven actual room planners",
        passed: countsSeparated && prepared.scenario.requiredApproverIds.length === 7,
        detail: `${prepared.scenario.estimatedAttendeeCount} estimated event attendees · ${prepared.scenario.confirmedAttendeeCount} confirmed · ${prepared.scenario.roomParticipantCount} room planners.`,
      },
      {
        id: "room_nonresponse_count",
        label: "Only an actual nonresponding room planner is counted as a room nonresponse",
        passed: roomNonresponses === 1 && prepared.scenario.participants.length === 7,
        detail: `${roomNonresponses} nonresponse among the seven active room planners.`,
      },
    );
  }
  if (prepared.scenario.id === "E_STRESS") {
    const judgeTraces = cycle.traces.filter((trace) => trace.role === "Judge");
    const completeContext = judgeTraces.length > 0 && judgeTraces.every((trace) => {
      const input = trace.input as { participants?: unknown[]; facts?: Fact[]; attendance?: { roomParticipantCount?: number; requiredApproverIds?: unknown[] } } | null;
      return input?.participants?.length === 58 && input.attendance?.roomParticipantCount === 58 && input.attendance.requiredApproverIds?.length === 58 &&
        prepared.sharedFactIds.every((id) => input?.facts?.some((fact) => fact.id === id));
    });
    assertions.push({
      id: "stress_context_complete",
      label: "The separate 58-planner stress fixture retains all members and authorized facts",
      passed: completeContext,
      detail: `${judgeTraces.length} Judge inputs checked against ${prepared.sharedFactIds.length} authorized facts; this is a context-presence check, not a quality score.`,
    });
  }
  return assertions;
}

export async function runAllScenarioMocks() {
  const results: Awaited<ReturnType<typeof runScenarioMock>>[] = [];
  for (const id of SCENARIO_IDS) results.push(await runScenarioMock(id));
  results.push(await runScenarioMock("E_STRESS"));
  return results;
}

export function getExpectedOutcome(id: ScenarioId) {
  return expectedOutcome(getScenario(id));
}
