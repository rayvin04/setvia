import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { JsonPersistence, StateError } from "./store.js";
import { CycleSchema, type Cycle, type Readiness } from "./contracts.js";
import type { GroundTruth, RubricDimension, ScenarioId } from "./scenarios.js";

export interface LiveAttemptRecord {
  id: string;
  runId: string;
  scenarioId: string;
  model: "muse-spark-1.3";
  promptVersion: string;
  role: "Listener" | "Judge" | "Negotiator" | "Question Strategist" | "Speaker";
  requestHash: string;
  status: "reserved" | "response_received" | "transport_error" | "usage_recorded";
  httpStatus: number | null;
  startedAt: string;
  durationMs: number | null;
  reservedCostMicros: number;
  estimatedCostMicros: number | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
  responseId: string | null;
}

export interface ScenarioInputStatementRecord {
  statementId: string;
  text: string;
  audience: "group" | "listener_only";
  consent: "explicit_group" | "listener_only";
  confirmed: boolean;
}
export interface ScenarioInputRecord {
  participantId: string;
  participantLabel: string;
  role: string;
  responseStatus: "confirmed" | "unconfirmed" | "no_response";
  roomResponseStatus?: "responded" | "no_response";
  timeZone?: string;
  statements: ScenarioInputStatementRecord[];
}
export interface ScenarioAssertion {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}
export interface ScenarioTimelineEvent {
  stage: string;
  event: string;
  simulation: true;
  readiness: Readiness;
  note: string;
}
export interface ScenarioRubric {
  dimensions: RubricDimension[];
  ratings: Record<RubricDimension, number | null>;
  comments: string;
  criteria: Record<RubricDimension, string>;
  reviewedAt?: string;
}

export interface LabRecord {
  scenario: string;
  mode: "MOCK" | "LIVE";
  cycle: Cycle;
  expectedOutcome?: Cycle["outcome"];
  passed?: boolean;
  scenarioId?: ScenarioId;
  simulation?: true;
  participantCount?: number;
  model?: string | null;
  promptVersion?: string;
  liveRunId?: string;
  liveHttpAttempts?: LiveAttemptRecord[];
  liveBudgetSnapshot?: {
    runId: string;
    attempts: number;
    runAttempts: number;
    estimatedCostMicros: number;
    budgetMicros: number;
  };
  eventAttendance?: {
    estimatedAttendeeCount: number;
    confirmedAttendeeCount: number | null;
    roomParticipantCount: number;
    requiredApproverIds: string[];
    respondedRoomParticipants: number;
    nonrespondingRoomParticipants: number;
  };
  fixtureSeed?: number | null;
  inputStatements?: ScenarioInputRecord[];
  groundTruth?: GroundTruth;
  expected?: {
    outcome: Cycle["outcome"];
    findings: Array<{ id: string; category: string; severity: string; criterion: string }>;
    stoppingConditions: string[];
    qualitativeReviewRequired: true;
  };
  assertions?: ScenarioAssertion[];
  rubric?: ScenarioRubric;
  timeline?: ScenarioTimelineEvent[];
  durationMs?: number;
  dashboardCounts?: {
    responding: number;
    confirmed: number;
    unconfirmed: number;
    noResponse: number;
  };
}
const escapeHtml = (text: unknown) =>
  String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function renderLab(records: LabRecord[]) {
  const hasLive = records.some((record) => record.mode === "LIVE");
  const hasMock = records.some((record) => record.mode === "MOCK");
  const pageTitle = hasLive && hasMock
    ? "Setvia Lab — mock and live evaluation"
    : hasLive
      ? "Setvia Lab — live model evaluation"
      : "Setvia Lab — mock evaluation";
  const headerCopy = hasLive
    ? "Actual synthetic scenario executions, validated findings, deterministic readiness, bounded request accounting, and manual review. Live model output is not evidence of safety or final approval."
    : "Actual mock execution paths, validated findings, deterministic readiness, and bounded request accounting. This private report contains synthetic fixtures only. No live model requests or participant approvals were made.";
  const content = records
    .map((record) => {
      const c = CycleSchema.parse(record.cycle);
      const path = c.traces
        .map(
          (t) =>
            "<li><strong>" +
            escapeHtml(t.role) +
            "</strong><span>" +
            escapeHtml(t.phase) +
            " · " +
            escapeHtml(t.status) +
            "</span></li>",
        )
        .join("");
      const categories =
        c.readiness?.categories
          .map(
            (category) =>
              "<tr><th scope=row>" +
              escapeHtml(category.category) +
              "</th><td>" +
              category.percentage +
              "%</td><td>" +
              escapeHtml(category.status) +
              "</td></tr>",
          )
          .join("") ?? "";
      const findings =
        c.finalEvaluation?.findings
          .map(
            (f) =>
              "<tr><td>" +
              escapeHtml(f.category) +
              "</td><td>" +
              escapeHtml(f.severity + " / " + f.status) +
              "</td><td>" +
              escapeHtml(f.message) +
              "<br><small>" +
              escapeHtml(f.recommendedAction) +
              "</small></td><td>" +
              escapeHtml(f.evidenceIds.join(", ") || "No evidence") +
              "<br>" +
              escapeHtml(f.uncertainty) +
              "</td></tr>",
          )
          .join("") ?? "";
      const details = c.traces
        .map(
          (t) =>
            "<details><summary>" +
            t.sequence +
            ". " +
            escapeHtml(t.role + " — " + t.phase) +
            "</summary><pre>" +
            escapeHtml(JSON.stringify(t, null, 2)) +
            "</pre></details>",
        )
        .join("");
      const inputDetails = (record.inputStatements ?? [])
        .map((person) => {
          const statements = person.statements.length
            ? person.statements.map((statement) =>
                "<li><p>" + escapeHtml(statement.text) + "</p><small>" +
                escapeHtml(statement.audience + " · " + statement.consent + " · " + (statement.confirmed ? "confirmed" : "unconfirmed")) +
                "</small></li>",
              ).join("")
            : "<li>No authored statement; response not received.</li>";
          return "<details><summary>" + escapeHtml(person.participantLabel + " · " + person.role + " · " + person.responseStatus) +
            "</summary><ul>" + statements + "</ul></details>";
        })
        .join("");
      const assertionRows = (record.assertions ?? []).map((assertion) =>
        "<tr><td>" + (assertion.passed ? "PASS" : "FAIL") + "</td><th scope=row>" +
        escapeHtml(assertion.label) + "</th><td>" + escapeHtml(assertion.detail) + "</td></tr>",
      ).join("");
      const timelineRows = (record.timeline ?? []).map((event) =>
        "<tr><th scope=row>" + escapeHtml(event.stage) + "</th><td>" +
        event.readiness.percentage + "% · " + escapeHtml(event.readiness.status) +
        "</td><td>" + escapeHtml(event.event + " · " + event.note) + "</td></tr>",
      ).join("");
      const rubricSection = record.rubric
        ? "<div class=scroll><table><caption>Manual reasoning-quality review · rate each dimension from 1–5</caption><thead><tr><th>Dimension</th><th>Criteria</th><th>Rating</th></tr></thead><tbody>" +
          record.rubric.dimensions.map((dimension) =>
            "<tr><th scope=row>" + escapeHtml(dimension) + "</th><td>" +
            escapeHtml(record.rubric!.criteria[dimension]) + "</td><td>" +
            (record.rubric!.ratings[dimension] ?? "Not reviewed") + "</td></tr>",
          ).join("") +
          "</tbody></table></div><p><strong>Reviewer comments:</strong> " +
          escapeHtml(record.rubric.comments || "Not reviewed") + "</p>" +
          (record.rubric.reviewedAt ? "<p><strong>Reviewed at:</strong> " + escapeHtml(record.rubric.reviewedAt) + "</p>" : "") +
          "<p>Save ratings with <code>npm run lab:review -- &lt;report.json&gt;</code>.</p>"
        : "";
      const groundTruth = record.groundTruth
        ? "<details><summary>Authored ground truth (written before execution)</summary><pre>" +
          escapeHtml(JSON.stringify(record.groundTruth, null, 2)) + "</pre></details>"
        : "";
      const expectedActual = record.expected
        ? "<h3>Expected versus actual</h3><pre>" +
          escapeHtml(JSON.stringify({
            expected: record.expected,
            actual: {
              outcome: c.outcome,
              findings: c.finalEvaluation?.findings ?? null,
              questions: c.questions,
              readiness: c.readiness,
              agentOrder: c.traces.map((trace) => trace.role),
            },
          }, null, 2)) + "</pre>"
        : "";
      const tokens = c.traces.every((trace) => trace.inputTokens !== null && trace.outputTokens !== null)
        ? c.traces.reduce((sum, trace) => sum + trace.inputTokens! + trace.outputTokens!, 0).toLocaleString()
        : "unknown";
      const actualCost = c.traces.every((trace) => trace.estimatedCostMicros !== null)
        ? "$" + (c.traces.reduce((sum, trace) => sum + trace.estimatedCostMicros!, 0) / 1e6).toFixed(6)
        : "unknown";
      const httpAttemptRows = (record.liveHttpAttempts ?? []).map((attempt) =>
        "<tr><td>" + escapeHtml(attempt.role) + "</td><td>" + escapeHtml(attempt.status) + "</td><td>" +
        escapeHtml(attempt.httpStatus ?? "—") + "</td><td>" + escapeHtml(attempt.inputTokens ?? "—") + " / " +
        escapeHtml(attempt.outputTokens ?? "—") + "</td><td>$" + ((attempt.estimatedCostMicros ?? attempt.reservedCostMicros) / 1e6).toFixed(4) +
        "</td><td><code>" + escapeHtml(attempt.requestHash.slice(0, 12)) + "</code></td></tr>",
      ).join("");
      const httpAttemptSection = record.mode === "LIVE" && record.liveHttpAttempts
        ? "<h3>HTTP attempt journal</h3><p>Request hashes correlate attempts without storing credentials, prompts, or raw API requests. Cost includes reported usage when available; otherwise the full reservation remains counted.</p><div class=scroll><table><caption>Per-attempt Meta request details</caption><thead><tr><th>Role</th><th>Journal status</th><th>HTTP</th><th>Input / output tokens</th><th>Cost counted</th><th>Request hash</th></tr></thead><tbody>" +
          (httpAttemptRows || "<tr><td colspan=6>No HTTP attempt was sent.</td></tr>") + "</tbody></table></div>" : "";
      return (
        "<article><p class=kicker>" + (record.mode === "MOCK" ? "MOCK · Synthetic simulation" : "LIVE · Muse Spark") +
        (record.simulation ? " · Simulation" : "") + "</p><h2>" +
        escapeHtml(record.scenario) +
        "</h2><p class=status>Analysis cycle: " +
        escapeHtml(c.outcome) +
        " · " +
        escapeHtml(c.reason) +
        "</p><dl><div><dt>Participants</dt><dd>" + (record.participantCount ?? "—") +
        "</dd></div><div><dt>" + (record.mode === "MOCK" ? "Mock attempts · no HTTP" : "HTTP attempts") + "</dt><dd>" +
        c.attempts +
        "</dd></div><div><dt>Reserved tokens</dt><dd>" +
        c.reservedTokens +
        "</dd></div><div><dt>Reserved cost allowance</dt><dd>$" +
        (c.reservedCostMicros / 1e6).toFixed(4) +
        "</dd></div><div><dt>Usage tokens</dt><dd>" + tokens +
        "</dd></div><div><dt>Standard-price estimate · no cached-input discount</dt><dd>" + actualCost +
        "</dd></div><div><dt>Scenario duration</dt><dd>" + (record.durationMs ?? "—") + " ms" +
        "</dd></div><div><dt>Readiness</dt><dd>" +
        (c.readiness
          ? (c.readiness.status === "blocked"
              ? "<strong class=readiness-blocked>BLOCKED</strong> "
              : "") +
            c.readiness.percentage +
            "% · " +
            escapeHtml(c.readiness.status) +
            (c.outcome === "BLOCKED"
              ? " (last validated; analysis incomplete)"
              : "")
          : "Not evaluated") +
        "</dd></div></dl><p>Final Judge: " +
        (c.finalEvaluation ? "available" : "unavailable") +
        ". Participant approval: not simulated in this Lab. Analysis completion and readiness do not establish group approval or safety.</p><ol class=path>" +
        path +
        "</ol><div class=scroll><table><caption>Deterministic Reality Checks</caption><thead><tr><th>Category</th><th>Readiness</th><th>Status</th></tr></thead><tbody>" +
        categories +
        "</tbody></table></div><div class=scroll><table><caption>Validated Judge findings</caption><thead><tr><th>Category</th><th>Severity / status</th><th>Finding / action</th><th>Evidence / uncertainty</th></tr></thead><tbody>" +
        findings +
        "</tbody></table></div>" +
        (assertionRows ? "<div class=scroll><table><caption>" + (record.mode === "MOCK" ? "Automatic fixture assertions · not model-quality scores" : "Deterministic safety and bound checks · not a reasoning-quality score") + "</caption><thead><tr><th>Result</th><th>Check</th><th>Evidence</th></tr></thead><tbody>" + assertionRows + "</tbody></table></div>" : "") +
        (record.expectedOutcome ? "<p><strong>Expected outcome:</strong> " + escapeHtml(record.expectedOutcome) + (record.passed === undefined ? " · manual review required" : record.passed ? " · scripted assertions passed" : " · scripted assertions failed") + "</p>" : "") +
        (record.eventAttendance
          ? "<p>Event attendance: " + (record.eventAttendance.confirmedAttendeeCount ?? "unknown") + " confirmed of " + record.eventAttendance.estimatedAttendeeCount + " estimated · Setvia room: " + record.eventAttendance.roomParticipantCount + " planners · required approvals: " + record.eventAttendance.requiredApproverIds.length + " · room responses: " + record.eventAttendance.respondedRoomParticipants + " received, " + record.eventAttendance.nonrespondingRoomParticipants + " not received</p>"
          : record.dashboardCounts
            ? "<p>Legacy fixture counts: " + record.dashboardCounts.responding + " responses · " + record.dashboardCounts.confirmed + " confirmed · " + record.dashboardCounts.unconfirmed + " unconfirmed · " + record.dashboardCounts.noResponse + " not received</p>"
            : "") +
        (record.liveBudgetSnapshot
          ? "<p><strong>Cumulative estimated spend at risk:</strong> $" + (record.liveBudgetSnapshot.estimatedCostMicros / 1e6).toFixed(4) + " of $" + (record.liveBudgetSnapshot.budgetMicros / 1e6).toFixed(2) + " · " + record.liveBudgetSnapshot.runAttempts + " HTTP attempts in this run, " + record.liveBudgetSnapshot.attempts + " total attempts in the private ledger.</p>"
          : "") +
        httpAttemptSection +
        (timelineRows ? "<div class=scroll><table><caption>Simulation readiness timeline · deterministically calculated</caption><thead><tr><th>Stage</th><th>Readiness</th><th>Event</th></tr></thead><tbody>" + timelineRows + "</tbody></table></div>" : "") +
        (inputDetails ? "<h3>Authored synthetic inputs and consent</h3>" + inputDetails : "") +
        groundTruth + rubricSection + expectedActual +
        "<h3>Visible structured execution records</h3>" +
        details +
        "</article>"
      );
    })
    .join("");
  return (
    "<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content=\"width=device-width, initial-scale=1\"><meta http-equiv=Content-Security-Policy content=\"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'\"><title>" + escapeHtml(pageTitle) + "</title><style>:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#02070a;color:#ecf3f5;font:16px/1.6 system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:40px 24px}h1,h2,h3{line-height:1.2;text-wrap:balance}h1{font-size:42px}p{text-wrap:pretty}a{color:#75cafa}article{border:1px solid #344853;border-radius:16px;padding:28px;margin:32px 0;background:#09141b}.kicker{color:#75cafa;font-size:13px}.status{font-weight:700}.readiness-blocked{display:inline-block;color:#ffaba8;background:#451b23;border:1px solid #b95c67;border-radius:6px;padding:3px 8px;font-size:16px;margin-right:5px}dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:16px}dt,small{color:#b5c6d0}dd{margin:4px 0;font-size:23px;font-variant-numeric:tabular-nums}.path{display:flex;gap:10px;flex-wrap:wrap;padding:0;list-style:none}.path li{border:1px solid #344853;padding:10px 14px;border-radius:8px}.path span{display:block;font-size:12px;color:#b5c6d0}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:14px;margin:22px 0}caption{text-align:left;font-weight:700}th,td{text-align:left;padding:10px;border-bottom:1px solid #344853;vertical-align:top}summary{cursor:pointer;padding:10px}summary:focus-visible{outline:2px solid #75cafa;outline-offset:2px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.6 ui-monospace,monospace;background:#02070a;padding:16px}footer{color:#b5c6d0}@media(max-width:600px){main{padding:24px 14px}article{padding:18px}h1{font-size:32px}}</style><main><header><p class=kicker>SETVIA / DEVELOPER EVALUATION</p><h1>The reasoning loop, inspected.</h1><p>" + escapeHtml(headerCopy) + "</p></header>" +
    content +
    "<footer>Prompts, credentials, hidden model reasoning, and Listener-only participant text are excluded. Reserved allowances are conservative bounds, not actual bills. Standard-price estimates do not apply cached-input discounts. Mock outputs test orchestration and validation; live outputs require manual review and do not establish safety or approval.</footer></main></html>"
  );
}
export async function saveLab(
  records: LabRecord[],
  root: string,
  publicRepository: string,
) {
  // Reuse the external-storage boundary check. LIVE history is limited to the
  // fixed synthetic scenarios and is never exposed through participant APIs.
  new JsonPersistence(root, publicRepository);
  if (records.some((r) => r.mode === "LIVE" && (!r.simulation || !r.scenarioId)))
    throw new StateError("SYNTHETIC_LIVE_HISTORY_ONLY");
  for (const r of records) CycleSchema.parse(r.cycle);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const name =
    "run-" +
    new Date().toISOString().replace(/[:.]/g, "-") +
    "-" +
    randomUUID().slice(0, 8);
  const jsonPath = resolve(root, name + ".json");
  const htmlPath = resolve(root, name + ".html");
  await writeFile(
    jsonPath,
    JSON.stringify({ fixtureVersion: "lab-v2", records }, null, 2),
    { mode: 0o600, flag: "wx" },
  );
  await writeFile(htmlPath, renderLab(records), { mode: 0o600, flag: "wx" });
  return { jsonPath, htmlPath };
}
