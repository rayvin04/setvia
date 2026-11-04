import {
  fixture,
  judge,
  finding,
  negotiationSteps,
  addBudget,
  scriptedGateway,
} from "./fixtures.js";
import { AgentEngine } from "./engine.js";
import type { LabRecord } from "./lab.js";

export function labSemanticsMatch(record: LabRecord): boolean {
  const findings = record.cycle.finalEvaluation?.findings ?? [];
  if (record.scenario.startsWith("Family reunion"))
    return findings.some(
      (f) =>
        f.category === "People Check" &&
        /access|attendance|venue|responsibilit/i.test(f.message) &&
        /access|step-free|venue/i.test(f.recommendedAction) &&
        !/budget|spending|cost/i.test(f.message + f.recommendedAction),
    );
  if (record.scenario.startsWith("Outdoor group project"))
    return findings.some(
      (f) =>
        f.category === "Safety Check" &&
        f.severity === "critical" &&
        /emergency|communications/i.test(f.message) &&
        /verify|emergency|guidance/i.test(f.recommendedAction),
    );
  if (record.scenario.startsWith("Beach trip"))
    return findings.every(
      (f) =>
        f.category === "Budget Check" &&
        /budget|spend|cost|requirement/i.test(f.message),
    );
  return findings.length === 0;
}

export async function buildLabRecords(): Promise<LabRecord[]> {
  const records: LabRecord[] = [];
  const complete = await fixture(
    [{ role: "Judge", output: judge() }],
    "meeting",
  );
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
  const question = {
    id: "accessibility_question",
    findingId: "accessibility",
    targetId: questions.auth.participantId,
    visibility: "private" as const,
    kind: "clarification" as const,
    text: "What venue access requirements would you authorize sharing for the reunion?",
    options: [],
  };
  const needsInput = judge({
    findings: [
      finding({
        id: "accessibility",
        category: "People Check",
        message:
          "The reunion venue details still need confirmation.",
        recommendedAction:
          "Ask the participant which venue details they authorize sharing.",
      }),
    ],
    next: "question",
    participantInputRequired: true,
  });
  const questionGateway = scriptedGateway([
    { role: "Judge", output: needsInput },
    { role: "Question Strategist", output: { questions: [question] } },
    {
      role: "Speaker",
      output: {
        replies: [
          { questionId: question.id, findingId: null, text: question.text },
        ],
        mascot: "curious",
      },
    },
    {
      role: "Judge",
      output: { ...needsInput, acceptedQuestionIds: [question.id] },
    },
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
              id: "emergency_communications",
              category: "Safety Check",
              severity: "critical",
              message:
                "Emergency communications have not been confirmed for the fieldwork.",
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
  const checks = [
    records[0].cycle.traces.length === 1,
    records[1].cycle.traces.some((t) =>
      t.rejectedOptionIds.includes("expensive"),
    ),
    records[2].cycle.questions.length === 1 &&
      records[2].cycle.traces.at(-1)?.role === "Judge",
    records[3].cycle.readiness?.status === "blocked",
    records[4].cycle.finalEvaluation === null,
  ];
  records.forEach((record, index) => {
    record.expectedOutcome = expected[index];
    record.passed =
      record.cycle.outcome === expected[index] &&
      checks[index] &&
      labSemanticsMatch(record);
  });
  return records;
}
