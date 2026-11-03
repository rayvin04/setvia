import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { request } from "node:http";
import { RUBRIC_DIMENSIONS } from "../server/src/agents/scenarios.js";
import { runScenarioMock } from "../server/src/agents/scenario-runner.js";
import { saveLab } from "../server/src/agents/lab.js";

test("local Lab API only serves redacted synthetic runs and stores explicit manual reviews privately", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "setvia-lab-ui-test-"));
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    delete process.env.SETVIA_PRIVATE_ROOT;
  });
  const privateRoot = join(root, "setvia-local");
  const publicRoot = join(root, "repo");
  await mkdir(publicRoot, { recursive: true });
  process.env.SETVIA_PRIVATE_ROOT = privateRoot;
  const { record } = await runScenarioMock("D");
  await saveLab([record], join(privateRoot, "lab"), publicRoot);

  const { createLabUiApp } = await import("./server.js");
  const server = createLabUiApp().listen(0, "127.0.0.1");
  t.after(() => new Promise<void>((resolvePromise) => server.close(() => resolvePromise())));
  await new Promise<void>((resolvePromise) => server.once("listening", () => resolvePromise()));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;

  const listResponse = await fetch(`${origin}/api/runs`);
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json() as { runs: Array<{ id: string; scenarios: string[] }> };
  assert.equal(list.runs.length, 1);
  assert.equal(list.runs[0]?.scenarios[0], "D");

  const detailResponse = await fetch(`${origin}/api/runs/${list.runs[0]!.id}`);
  const detailText = await detailResponse.text();
  assert.equal(detailResponse.status, 200);
  assert.equal(detailText.includes("PRIVATE_FAMILY_REASON_A"), false);
  assert.equal(detailText.includes("PRIVATE_FAMILY_BUDGET_B"), false);
  assert.ok(detailText.includes("[PRIVATE LISTENER-ONLY RESPONSE REDACTED]"));

  const ratings = Object.fromEntries(RUBRIC_DIMENSIONS.map((dimension) => [dimension, 4]));
  const saveResponse = await fetch(`${origin}/api/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ reportId: list.runs[0]!.id, scenarioId: "D", ratings, comments: "Synthetic privacy fixture reviewed." }),
  });
  assert.equal(saveResponse.status, 201);
  const reviewFiles = await import("node:fs/promises").then(({ readdir }) => readdir(join(privateRoot, "lab", "reviews")));
  assert.equal(reviewFiles.length, 1);
  assert.ok(reviewFiles[0]?.startsWith(`review-${list.runs[0]!.id}-D-`));
  assert.ok(JSON.parse(await readFile(join(privateRoot, "lab", "reviews", reviewFiles[0]!), "utf8")).ratings);

  const crossOrigin = await fetch(`${origin}/api/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://attacker.test" },
    body: JSON.stringify({ reportId: list.runs[0]!.id, scenarioId: "D", ratings, comments: "x" }),
  });
  assert.equal(crossOrigin.status, 403);

  const spoofedHostStatus = await new Promise<number>((resolveStatus, reject) => {
    const spoofedHost = request({
      hostname: "127.0.0.1",
      port: address.port,
      path: "/api/runs",
      method: "GET",
      headers: { host: `attacker.test:${address.port}` },
    }, (response) => {
      response.resume();
      resolveStatus(response.statusCode ?? 0);
    });
    spoofedHost.on("error", reject);
    spoofedHost.end();
  });
  assert.equal(spoofedHostStatus, 421);
});
