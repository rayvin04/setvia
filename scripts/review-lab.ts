import { readFile, realpath, stat } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CycleSchema } from "../server/src/agents/contracts.js";
import { saveLab, type LabRecord } from "../server/src/agents/lab.js";
import { RUBRIC_DIMENSIONS, SCENARIO_IDS } from "../server/src/agents/scenarios.js";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const privateLabRoot = resolve(appRoot, "..", "setvia-local", "lab");

function isInside(parent: string, candidate: string) {
  const rel = relative(parent, candidate);
  return rel.length > 0 && rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
}

function validRating(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 1 && value <= 5;
}

async function loadRecords(fileArg: string): Promise<LabRecord[]> {
  if (!fileArg || extname(fileArg).toLowerCase() !== ".json")
    throw new Error("Provide one private Lab .json report path.");
  const root = await realpath(privateLabRoot);
  const file = await realpath(resolve(fileArg));
  if (!isInside(root, file)) throw new Error("Only reports inside the private setvia-local/lab directory can be reviewed.");
  const fileStat = await stat(file);
  if (!fileStat.isFile() || fileStat.size > 12 * 1024 * 1024)
    throw new Error("Lab report is missing, not a file, or exceeds the 12 MiB review limit.");
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!parsed || typeof parsed !== "object" || !("fixtureVersion" in parsed) || !["lab-v1", "lab-v2"].includes(String(parsed.fixtureVersion)) || !("records" in parsed) || !Array.isArray(parsed.records))
    throw new Error("Unsupported Lab report format.");
  const records = (parsed.records as LabRecord[]).filter((record) =>
    !!record && typeof record === "object" && (record.scenarioId !== undefined || record.rubric !== undefined),
  );
  if (records.length < 1 || records.some((record) =>
    record.mode !== "MOCK" && record.mode !== "LIVE" ||
    !record.scenarioId || !SCENARIO_IDS.includes(record.scenarioId) ||
    !record.rubric || !record.groundTruth || !record.simulation
  )) throw new Error("This review tool accepts only the five authored synthetic scenario records.");
  for (const record of records) {
    CycleSchema.parse(record.cycle);
    if (record.rubric!.dimensions.length !== RUBRIC_DIMENSIONS.length ||
      RUBRIC_DIMENSIONS.some((dimension) => !record.rubric!.dimensions.includes(dimension)) ||
      typeof record.rubric!.comments !== "string")
      throw new Error("A scenario rubric does not match the current review contract.");
    for (const person of record.inputStatements ?? []) {
      for (const statement of person.statements) {
        if (statement.audience === "listener_only" &&
          !statement.text.startsWith("[PRIVATE LISTENER-ONLY RESPONSE REDACTED]"))
          throw new Error("Report contains unredacted Listener-only input; review stopped.");
      }
    }
    for (const trace of record.cycle.traces) {
      if (trace.role === "Listener" &&
        (!JSON.stringify(trace.input).includes("redacted") || !JSON.stringify(trace.output).includes("redacted")))
        throw new Error("Report contains a Listener trace that is not redacted; review stopped.");
    }
  }
  return records;
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args.length !== 1) throw new Error("Usage: npm run lab:review -- <private-lab-report.json>");
  if (!stdin.isTTY || !stdout.isTTY) throw new Error("Manual Lab review requires an interactive terminal.");
  const input = resolve(args[0]!);
  const records = await loadRecords(input);
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    for (const record of records) {
      console.log(`\n${record.scenario} — ${record.cycle.outcome} (${record.mode})`);
      for (const dimension of RUBRIC_DIMENSIONS) {
        const prior = record.rubric!.ratings[dimension];
        const answer = await prompt.question(`${dimension} (1–5${validRating(prior) ? `, current ${prior}` : ""}): `);
        if (!answer.trim() && validRating(prior)) continue;
        const rating = Number(answer.trim());
        if (!validRating(rating)) throw new Error(`A rating for ${dimension} must be an integer from 1 to 5.`);
        record.rubric!.ratings[dimension] = rating;
      }
      const comments = await prompt.question("Reviewer comments (max 4,000 characters; blank keeps prior): ");
      if (comments.trim()) record.rubric!.comments = comments.slice(0, 4_000);
      record.rubric!.reviewedAt = new Date().toISOString();
    }
  } finally {
    prompt.close();
  }
  const output = await saveLab(records, resolve(privateLabRoot, "reviews"), appRoot);
  console.log(JSON.stringify({ reviewedScenarios: records.length, ...output }, null, 2));
}

main().catch((error: unknown) => {
  console.error("Setvia Lab review stopped: " + (error instanceof Error ? error.message : "Unknown review error."));
  process.exitCode = 1;
});
