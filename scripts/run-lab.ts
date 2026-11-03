import { resolve } from "node:path";
import { saveLab } from "../server/src/agents/lab.js";
import { buildLabRecords } from "../server/src/agents/lab-scenarios.js";
import { runAllScenarioMocks } from "../server/src/agents/scenario-runner.js";

// This executable intentionally has no live mode and never reads .env.
globalThis.fetch = async () => {
  throw new Error("Live network is disabled in Setvia Lab.");
};
const records = await buildLabRecords();
const realistic = await runAllScenarioMocks();
records.push(...realistic.map(({ record }) => record));
const passed = records.filter((record) => record.passed).length;
const paths = await saveLab(
  records,
  resolve(process.cwd(), "../setvia-local/lab"),
  process.cwd(),
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
