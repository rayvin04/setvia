import { dirname, resolve } from "node:path";
import {
  fixture,
  judge,
  finding,
  negotiationSteps,
  addBudget,
  scriptedGateway,
} from "../server/src/agents/fixtures.js";
import { AgentEngine } from "../server/src/agents/engine.js";
import { saveLab, type LabRecord } from "../server/src/agents/lab.js";
import { buildLabRecords } from "../server/src/agents/lab-scenarios.js";
import { runAllScenarioMocks } from "../server/src/agents/scenario-runner.js";
import { fileURLToPath } from "node:url";

// This executable intentionally has no live mode and never reads .env.
globalThis.fetch = async () => {
  throw new Error("Live network is disabled in Setvia Lab.");
};
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const privateRoot = resolve(process.env.SETVIA_PRIVATE_ROOT ?? resolve(appRoot, "..", "setvia-local"));
const records: LabRecord[] = await buildLabRecords();
const foundationOffset = records.length;
const complete = await fixture([{ role: "Judge", output: judge() }], "meeting");
records.push({
  scenario: "Project kickoff — unnecessary agents skipped",
  mode: "MOCK",
  cycle: await complete.engine.run(complete.roomId, complete.auth),
});
const negotiation = await fixture(negotiationSteps(), "trip");
await addBudget(negotiation);
records.push({
  scenario: "Beach trip — invalid compromise and bounded revision",
  mode: "MOCK",
  cycle: await negotiation.engine.run(negotiation.roomId, negotiation.auth),
});
const questions = await fixture([], "gathering");
const q = {
  id: "accessibility_question",
  findingId: "accessibility",
  targetId: questions.auth.participantId,
  visibility: "private",
  kind: "clarification",
  text: "What venue requirements would you authorize sharing?",
  options: [],
};
const needsInput = judge({
  findings: [finding({ id: "accessibility", category: "People Check" })],
  next: "question",
  participantInputRequired: true,
});
const questionGateway = scriptedGateway([
  { role: "Judge", output: needsInput },
  { role: "Question Strategist", output: { questions: [q] } },
  {
    role: "Speaker",
    output: {
      replies: [{ questionId: q.id, findingId: null, text: q.text }],
      mascot: "curious",
    },
  },
  { role: "Judge", output: { ...needsInput, acceptedQuestionIds: [q.id] } },
]);
const questionEngine = new AgentEngine(
  questions.store,
  questionGateway.gateway,
);
records.push({
  scenario: "Family reunion — targeted question, then wait",
  mode: "MOCK",
  cycle: await questionEngine.run(questions.roomId, questions.auth),
});
const safety = await fixture(
  [
    {
      role: "Judge",
      output: judge({
        findings: [
          finding({
            category: "Safety Check",
            severity: "critical",
            message: "Emergency communications have not been confirmed.",
            recommendedAction:
              "Have a responsible person verify the emergency plan and relevant local guidance.",
          }),
        ],
      }),
    },
  ],
  "project",
);
records.push({
  scenario: "Outdoor group project — critical Safety Check blocks readiness",
  mode: "MOCK",
  cycle: await safety.engine.run(safety.roomId, safety.auth),
});
const failure = await fixture(
  [{ role: "Judge", error: new Error("Synthetic upstream failure") }],
  "celebration",
);
records.push({
  scenario: "Celebration — safe failure without a fabricated Judge",
  mode: "MOCK",
  cycle: await failure.engine.run(failure.roomId, failure.auth),
});
const expected = [
  "COMPLETED",
  "COMPLETED",
  "WAIT_FOR_PARTICIPANT",
  "COMPLETED",
  "BLOCKED",
] as const;
const specificChecks = [
  records[foundationOffset].cycle.traces.length === 1,
  records[foundationOffset + 1].cycle.traces.some((trace) =>
    trace.rejectedOptionIds.includes("expensive"),
  ),
  records[foundationOffset + 2].cycle.questions.length === 1 &&
    records[foundationOffset + 2].cycle.traces.at(-1)?.role === "Judge",
  records[foundationOffset + 3].cycle.readiness?.status === "blocked",
  records[foundationOffset + 4].cycle.finalEvaluation === null,
];
records.forEach((record, index) => {
  const regressionIndex = index >= foundationOffset ? index - foundationOffset : index;
  record.expectedOutcome = expected[regressionIndex];
  record.passed =
    record.cycle.outcome === expected[regressionIndex] && specificChecks[regressionIndex];
});
const realistic = await runAllScenarioMocks();
records.push(...realistic.map(({ record }) => record));
const passed = records.filter((record) => record.passed).length;
const paths = await saveLab(
  records,
  resolve(privateRoot, "lab"),
  appRoot,
);
console.log(
  JSON.stringify(
    {
      mode: "MOCK",
      scenarios: records.length,
      realisticScenarios: realistic.length,
      passed,
      failed: records.length - passed,
      participants: realistic.map(({ record }) => ({
        scenario: record.scenarioId,
        count: record.participantCount,
      })),
      mockRequests: records.reduce(
        (sum, record) => sum + record.cycle.attempts,
        0,
      ),
      liveRequests: 0,
      ...paths,
    },
    null,
    2,
  ),
);
if (passed !== records.length) process.exitCode = 1;
