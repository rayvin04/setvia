import type {
  AgentGateway,
  AgentResult,
  Finding,
  JudgeEvaluation,
  Role,
} from "./contracts.js";
import { Categories } from "./contracts.js";
import { AgentEngine } from "./engine.js";
import { MemoryPersistence, RoomStore } from "./store.js";

export const finding = (overrides: Partial<Finding> = {}): Finding => ({
  id: "budget_gap",
  category: "Budget Check",
  severity: "warning",
  status: "open",
  evidenceIds: [],
  uncertainty: "missing",
  message: "Confirm the shared budget.",
  recommendedAction: "Ask the participant for a shareable spending limit.",
  ...overrides,
});
export const judge = (
  overrides: Partial<JudgeEvaluation> = {},
): JudgeEvaluation => ({
  findings: [],
  verdicts: [],
  next: "stop",
  taskFindingIds: [],
  acceptedQuestionIds: [],
  anotherPassUseful: false,
  participantInputRequired: false,
  canStop: true,
  readinessAssessment: {
    readyForReview: true,
    explanation: "Synthetic assessment; humans still decide.",
  },
  ...overrides,
});
export interface Step {
  role: Role;
  output?: unknown;
  error?: Error;
  wait?: () => Promise<void>;
  attempts?: number;
}
export function scriptedGateway(steps: Step[]) {
  const calls: { role: Role; input: unknown }[] = [];
  const gateway: AgentGateway = {
    mode: "MOCK",
    async call(role, input, context): Promise<AgentResult> {
      const step = steps[calls.length];
      calls.push({ role, input: structuredClone(input) });
      if (!step || step.role !== role)
        throw new Error("Unexpected synthetic role");
      for (let i = 0; i < (step.attempts ?? 1); i++)
        await context.reserveAttempt();
      if (step.wait) await step.wait();
      if (step.error) throw step.error;
      return {
        output: step.output,
        usage: { inputTokens: 20, outputTokens: 30, estimatedCostMicros: 100 },
      };
    },
  };
  return { gateway, calls };
}
export async function fixture(steps: Step[], eventType = "trip") {
  const scripted = scriptedGateway(steps);
  const store = new RoomStore(new MemoryPersistence());
  const engine = new AgentEngine(store, scripted.gateway);
  const policy = Categories.map((category, i) => ({
    category,
    enabled: true,
    weight: 1,
    requiredKeys: ["check_" + i],
  }));
  const created = await engine.rooms.create(eventType, policy, {
    id: "proposal",
    label: "Synthetic plan",
    values: { cost: 100 },
  });
  const auth = await engine.rooms.join(
    created.roomId,
    created.invitation,
    "Alex",
  );
  const other = await engine.rooms.join(
    created.roomId,
    created.invitation,
    "Sam",
  );
  for (let i = 0; i < 6; i++) {
    const room = await store.read(created.roomId);
    await engine.rooms.confirmFact(created.roomId, auth, room.revision, {
      id: "fact_" + i,
      key: "check_" + i,
      value: true,
      confirmed: true,
      visibility: "group",
      ownerId: auth.participantId,
    });
  }
  return { ...scripted, ...created, auth, other, engine, store };
}
export const negotiationSteps = (): Step[] => [
  {
    role: "Judge",
    output: judge({
      findings: [finding()],
      next: "negotiate",
      taskFindingIds: ["budget_gap"],
      anotherPassUseful: true,
      canStop: false,
    }),
  },
  {
    role: "Negotiator",
    output: {
      options: [
        { id: "expensive", label: "Over budget", values: { cost: 500 } },
      ],
    },
  },
  {
    role: "Judge",
    output: judge({ verdicts: [{ optionId: "expensive", accepted: true }] }),
  },
  {
    role: "Negotiator",
    output: {
      options: [
        { id: "affordable", label: "Within budget", values: { cost: 150 } },
      ],
    },
  },
  {
    role: "Judge",
    output: judge({ verdicts: [{ optionId: "affordable", accepted: true }] }),
  },
];
export async function addBudget(f: Awaited<ReturnType<typeof fixture>>) {
  await f.engine.rooms.setConstraints(
    f.roomId,
    f.auth,
    (await f.store.read(f.roomId)).revision,
    [
      {
        id: "max_budget",
        ownerId: f.auth.participantId,
        category: "Budget Check",
        key: "cost",
        operator: "lte",
        expected: 200,
        hard: true,
      },
    ],
  );
}

