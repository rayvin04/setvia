import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readMetaConfig } from "../server/src/ai/meta-client.js";
import { Roles, type AgentGateway, type CallContext, type Role } from "../server/src/agents/contracts.js";
import { createMetaGateway } from "../server/src/agents/meta-gateway.js";
import { runScenarioWithGateway } from "../server/src/agents/scenario-runner.js";
import { getScenario, SCENARIO_IDS, type ScenarioId } from "../server/src/agents/scenarios.js";
import { saveLab, type LabRecord } from "../server/src/agents/lab.js";
import { StateError } from "../server/src/agents/store.js";
import type { Limits } from "../server/src/agents/engine.js";
import { LIVE_ATTEMPT_RESERVATION_MICROS, LiveBudgetJournal } from "./live-budget-journal.js";

const INPUT_PRICE_MICROS_PER_MILLION = 1_250_000;
const OUTPUT_PRICE_MICROS_PER_MILLION = 4_250_000;
const MAX_OUTPUT_TOKENS: Record<Role, number> = {
  Listener: 2_048,
  Judge: 8_192,
  Negotiator: 4_096,
  "Question Strategist": 2_048,
  Speaker: 1_024,
};
const INPUT_TOKEN_ALLOWANCE = 55_000;
const CALL_TOKEN_ALLOWANCE = 64_000;
const CALL_COST_MICROS = LIVE_ATTEMPT_RESERVATION_MICROS;
const MAX_REQUEST_BYTES = 50_000;
const MAX_SCENARIO_ATTEMPTS = 10;
const PRICE_SNAPSHOT_DATE = "2026-11-03";
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const privateRoot = resolve(process.env.SETVIA_PRIVATE_ROOT ?? resolve(appRoot, "..", "setvia-local"));
const liveReportRoot = resolve(privateRoot, "lab", "live");

function parseArgs(args: string[]) {
  let scenarioList = "";
  let confirmBillable = false;
  let promptVersion = "agents-v1";
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--scenario") {
      scenarioList = args[++index] ?? "";
    } else if (arg === "--confirm-billable") {
      confirmBillable = true;
    } else if (arg === "--prompt-version") {
      promptVersion = args[++index] ?? "";
    } else {
      throw new Error("Unsupported argument: " + arg);
    }
  }
  if (!scenarioList) throw new Error("Select synthetic scenarios with --scenario A,B,...");
  if (!/^agents-v[0-9]+$/.test(promptVersion)) throw new Error("Prompt version must look like agents-v1.");
  const ids = scenarioList.split(",").map((value) => value.trim());
  if (ids.some((id) => !SCENARIO_IDS.includes(id as ScenarioId)))
    throw new Error("Scenario IDs must be selected from A, B, C, D, E.");
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate scenario IDs are not allowed.");
  if (!confirmBillable) throw new Error("Live calls require the explicit --confirm-billable flag.");
  if (process.env.SETVIA_LAB_BILLING_CHECKED !== "1")
    throw new Error("Review Meta billing, credits, and team limits, then set SETVIA_LAB_BILLING_CHECKED=1 for this command.");
  return { ids: ids as ScenarioId[], promptVersion };
}

function scenarioLimits(): Limits {
  return {
    maxInvocations: MAX_SCENARIO_ATTEMPTS,
    maxRequests: MAX_SCENARIO_ATTEMPTS,
    maxRevisions: 2,
    timeoutMs: 30_000,
    maxTokens: MAX_SCENARIO_ATTEMPTS * CALL_TOKEN_ALLOWANCE,
    maxCostMicros: MAX_SCENARIO_ATTEMPTS * CALL_COST_MICROS,
    callTokens: CALL_TOKEN_ALLOWANCE,
    callCostMicros: CALL_COST_MICROS,
    roomMaxRequests: MAX_SCENARIO_ATTEMPTS,
    roomMaxTokens: MAX_SCENARIO_ATTEMPTS * CALL_TOKEN_ALLOWANCE,
    roomMaxCostMicros: MAX_SCENARIO_ATTEMPTS * CALL_COST_MICROS,
  };
}

function suiteBoundedGateway(
  base: AgentGateway,
  scenarioCount: number,
): { gateway: AgentGateway; usage: { attempts: number; tokens: number; costMicros: number } } {
  const maxAttempts = MAX_SCENARIO_ATTEMPTS * scenarioCount;
  const maxTokens = MAX_SCENARIO_ATTEMPTS * CALL_TOKEN_ALLOWANCE * scenarioCount;
  const maxCostMicros = MAX_SCENARIO_ATTEMPTS * CALL_COST_MICROS * scenarioCount;
  const usage = { attempts: 0, tokens: 0, costMicros: 0 };
  const gateway: AgentGateway = {
    mode: base.mode,
    promptVersion: base.promptVersion,
    promptHashes: base.promptHashes,
    async call(role: Role, input: unknown, context: CallContext) {
      return base.call(role, input, {
        signal: context.signal,
        reserveAttempt: async (allowance) => {
          if (!allowance) throw new StateError("SUITE_ALLOWANCE_REQUIRED");
          if (
            usage.attempts + 1 > maxAttempts ||
            usage.tokens + allowance.tokens > maxTokens ||
            usage.costMicros + allowance.costMicros > maxCostMicros
          ) throw new StateError("SUITE_BUDGET_LIMIT");
          await context.reserveAttempt(allowance);
          usage.attempts++;
          usage.tokens += allowance.tokens;
          usage.costMicros += allowance.costMicros;
        },
      });
    },
  };
  return { gateway, usage };
}

async function loadPrompts(promptVersion: string): Promise<Record<Role, string>> {
  const prompts = {} as Record<Role, string>;
  for (const role of Roles) {
    const file = role === "Question Strategist"
      ? "question-strategist.txt"
      : role.toLowerCase() + ".txt";
    prompts[role] = await readFile(resolve(privateRoot, "prompts", promptVersion, file), "utf8");
  }
  return prompts;
}

const money = (micros: number) => "$" + (micros / 1_000_000).toFixed(2);

async function main() {
  const { ids: selected, promptVersion } = parseArgs(process.argv.slice(2));
  const fixtures = selected.map((id) => getScenario(id));
  if (fixtures.some((scenario) => !scenario.synthetic))
    throw new Error("Only fixed synthetic Setvia Lab fixtures may use this command.");
  const maxAttempts = selected.length * MAX_SCENARIO_ATTEMPTS;
  const maxTokens = selected.length * MAX_SCENARIO_ATTEMPTS * CALL_TOKEN_ALLOWANCE;
  const maxCostMicros = selected.length * MAX_SCENARIO_ATTEMPTS * CALL_COST_MICROS;
  const approvalPhrase = `RUN ${selected.length} LIVE SCENARIO${selected.length === 1 ? "" : "S"} WITH UP TO ${maxAttempts} HTTP ATTEMPTS`;

  console.log("SETVIA LAB LIVE PREFLIGHT — NO REQUEST HAS BEEN SENT");
  console.log("Model: Muse Spark Standard; published pricing snapshot: " + PRICE_SNAPSHOT_DATE);
  console.log("Prompt baseline: " + promptVersion);
  console.log("Selected synthetic scenarios:");
  for (const scenario of fixtures)
    console.log(`  ${scenario.id}: ${scenario.title} (${scenario.participants.length} participants)`);
  console.log(`Maximum HTTP attempts: ${maxAttempts} (${MAX_SCENARIO_ATTEMPTS} per scenario; retries disabled)`);
  console.log(`Maximum reserved tokens: ${maxTokens.toLocaleString()}`);
  console.log(`Maximum reserved cost: ${money(maxCostMicros)} (${CALL_TOKEN_ALLOWANCE.toLocaleString()} token and ${money(CALL_COST_MICROS)} reservation per attempt)`);
  console.log(`Maximum serialized request size: ${MAX_REQUEST_BYTES.toLocaleString()} bytes per attempt.`);
  console.log("Per-role output caps: " + Object.entries(MAX_OUTPUT_TOKENS).map(([role, tokens]) => `${role} ${tokens.toLocaleString()}`).join(" · "));
  console.log("Cost assumptions: up to " + INPUT_TOKEN_ALLOWANCE.toLocaleString() + " input tokens and 8,192 output tokens per request; standard input/output rates; no cached-input discount.");
  console.log("Billing status: not checked by this application. SETVIA_LAB_BILLING_CHECKED=1 is a user attestation only.");
  console.log("All inputs are fixed synthetic fixtures. No participant or production data is accepted.");
  console.log("Live model/schema compatibility and reasoning quality remain unverified until a separately approved run.");
  if (!stdin.isTTY || !stdout.isTTY)
    throw new Error("Interactive approval is required; no live request was sent.");
  const prompt = createInterface({ input: stdin, output: stdout });
  let approval = "";
  try {
    approval = await prompt.question(`Type exactly: ${approvalPhrase}\n> `);
  } finally {
    prompt.close();
  }
  if (approval.trim() !== approvalPhrase)
    throw new Error("Live scenario run cancelled; no request was sent.");

  // Credentials and private prompt files are loaded only after explicit approval.
  const journal = await LiveBudgetJournal.open(privateRoot, appRoot, selected);
  let activeScenario = selected[0]!;
  try {
    const config = readMetaConfig();
    const prompts = await loadPrompts(promptVersion);
    const base = createMetaGateway({
      client: { config, timeoutMs: 30_000, maxRetries: 0, maxTotalRequests: 1 },
      prompts,
      promptVersion,
      maxRequestBytes: MAX_REQUEST_BYTES,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      inputTokenAllowance: INPUT_TOKEN_ALLOWANCE,
      callTokenAllowance: CALL_TOKEN_ALLOWANCE,
      callCostMicros: CALL_COST_MICROS,
      inputPriceMicrosPerMillion: INPUT_PRICE_MICROS_PER_MILLION,
      outputPriceMicrosPerMillion: OUTPUT_PRICE_MICROS_PER_MILLION,
      onHttpEvent: (event) => journal.handle(event, activeScenario),
    });
    const suite = suiteBoundedGateway(base, selected.length);
    const records: LabRecord[] = [];
    const limits = scenarioLimits();
    for (const id of selected) {
      activeScenario = id;
      const { record } = await runScenarioWithGateway(id, suite.gateway, limits);
      record.liveRunId = journal.runId;
      record.liveHttpAttempts = await journal.attemptsFor(id);
      record.liveBudgetSnapshot = await journal.snapshot();
      records.push(record);
      const paths = await saveLab(records, liveReportRoot, appRoot);
      console.log(JSON.stringify({
        savedCheckpoint: paths.jsonPath,
        savedHtml: paths.htmlPath,
        scenario: id,
        promptVersion,
        outcome: record.cycle.outcome,
        reason: record.cycle.reason,
        attempts: record.cycle.attempts,
        invocationCount: record.cycle.traces.length,
        tokens: record.cycle.traces.every((trace) => trace.inputTokens !== null && trace.outputTokens !== null)
          ? record.cycle.traces.reduce((sum, trace) => sum + trace.inputTokens! + trace.outputTokens!, 0)
          : null,
        standardPriceEstimateMicros: record.cycle.traces.every((trace) => trace.estimatedCostMicros !== null)
          ? record.cycle.traces.reduce((sum, trace) => sum + trace.estimatedCostMicros!, 0)
          : null,
        suiteReserved: { ...suite.usage },
        cumulativeLedger: await journal.snapshot(),
      }, null, 2));
      if (record.cycle.outcome === "BLOCKED")
        throw new Error("Scenario blocked; its private Lab checkpoint was saved. Stopping to avoid spending on later scenarios.");
    }
    console.log("Live Lab run complete. Human review is required; no automatic reasoning-quality pass score is assigned.");
  } finally {
    await journal.release();
  }
}

main().catch((error: unknown) => {
  const safeMessage = error instanceof Error ? error.message : "Unknown live Lab error.";
  console.error("Setvia Lab LIVE stopped: " + safeMessage);
  process.exitCode = 1;
});
