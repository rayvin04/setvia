import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { JsonPersistence, StateError } from "./store.js";
import { CycleSchema, type Cycle } from "./contracts.js";

export interface LabRecord {
  scenario: string;
  mode: "MOCK";
  cycle: Cycle;
  expectedOutcome?: Cycle["outcome"];
  passed?: boolean;
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
      return (
        "<article><p class=kicker>MOCK · Synthetic fixture</p><h2>" +
        escapeHtml(record.scenario) +
        "</h2><p class=status>" +
        escapeHtml(c.outcome) +
        " · " +
        escapeHtml(c.reason) +
        "</p><dl><div><dt>HTTP attempts (mock)</dt><dd>" +
        c.attempts +
        "</dd></div><div><dt>Reserved tokens</dt><dd>" +
        c.reservedTokens +
        "</dd></div><div><dt>Reserved cost allowance</dt><dd>$" +
        (c.reservedCostMicros / 1e6).toFixed(4) +
        "</dd></div><div><dt>Readiness</dt><dd>" +
        (c.readiness
          ? c.readiness.percentage +
            "% · " +
            escapeHtml(c.readiness.status) +
            (c.outcome === "BLOCKED"
              ? " (last validated; analysis incomplete)"
              : "")
          : "Not evaluated") +
        "</dd></div></dl><p>Final Judge: " +
        (c.finalEvaluation ? "available" : "unavailable") +
        ". Human approval is separate. No safety guarantee is implied.</p><ol class=path>" +
        path +
        "</ol><div class=scroll><table><caption>Deterministic Reality Checks</caption><thead><tr><th>Category</th><th>Readiness</th><th>Status</th></tr></thead><tbody>" +
        categories +
        "</tbody></table></div><div class=scroll><table><caption>Validated Judge findings</caption><thead><tr><th>Category</th><th>Severity / status</th><th>Finding / action</th><th>Evidence / uncertainty</th></tr></thead><tbody>" +
        findings +
        "</tbody></table></div><h3>Actual execution records</h3>" +
        details +
        "</article>"
      );
    })
    .join("");
  return (
    "<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content=\"width=device-width, initial-scale=1\"><meta http-equiv=Content-Security-Policy content=\"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'\"><title>Setvia Lab — mock evaluation</title><style>:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#02070a;color:#ecf3f5;font:16px/1.6 system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:40px 24px}h1,h2,h3{line-height:1.2;text-wrap:balance}h1{font-size:42px}p{text-wrap:pretty}a{color:#75cafa}article{border:1px solid #344853;border-radius:16px;padding:28px;margin:32px 0;background:#09141b}.kicker{color:#75cafa;font-size:13px}.status{font-weight:700}dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:16px}dt,small{color:#b5c6d0}dd{margin:4px 0;font-size:23px;font-variant-numeric:tabular-nums}.path{display:flex;gap:10px;flex-wrap:wrap;padding:0;list-style:none}.path li{border:1px solid #344853;padding:10px 14px;border-radius:8px}.path span{display:block;font-size:12px;color:#b5c6d0}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:14px;margin:22px 0}caption{text-align:left;font-weight:700}th,td{text-align:left;padding:10px;border-bottom:1px solid #344853;vertical-align:top}summary{cursor:pointer;padding:10px}summary:focus-visible{outline:2px solid #75cafa;outline-offset:2px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.6 ui-monospace,monospace;background:#02070a;padding:16px}footer{color:#b5c6d0}@media(max-width:600px){main{padding:24px 14px}article{padding:18px}h1{font-size:32px}}</style><main><header><p class=kicker>SETVIA / DEVELOPER EVALUATION</p><h1>The reasoning loop, inspected.</h1><p>Actual mock execution paths, validated findings, deterministic readiness, and bounded request accounting. This private report contains synthetic fixtures only. No live model requests or participant approvals were made.</p></header>" +
    content +
    "<footer>Prompts, credentials, hidden model reasoning, and private participant input are excluded. Reserved allowances are conservative bounds, not actual bills. Real model quality is not established by mocked tests.</footer></main></html>"
  );
}
export async function saveLab(
  records: LabRecord[],
  root: string,
  publicRepository: string,
) {
  // Reuse the external-storage boundary check. Only synthetic MOCK records are accepted.
  new JsonPersistence(root, publicRepository);
  if (records.some((r) => r.mode !== "MOCK"))
    throw new StateError("SYNTHETIC_HISTORY_ONLY");
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
    JSON.stringify({ fixtureVersion: "lab-v1", records }, null, 2),
    { mode: 0o600, flag: "wx" },
  );
  await writeFile(htmlPath, renderLab(records), { mode: 0o600, flag: "wx" });
  return { jsonPath, htmlPath };
}
