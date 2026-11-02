import assert from "node:assert/strict";
import { test } from "node:test";
import type { PlanExtraction } from "../shared/plan-schema.js";
import { extractPlanFromImage, extractPlanFromText, PlanApiError } from "./plan-api.js";

const emptyPlan: PlanExtraction = {
  title: null,
  titleEvidence: null,
  eventType: null,
  eventTypeEvidence: null,
  description: null,
  descriptionEvidence: null,
  estimatedParticipants: { value: null, isApproximate: false, attendanceStatus: "unknown", evidence: null },
  dateOrDateRange: { value: null, isRelative: false, isAmbiguous: false, evidence: null },
  time: { value: null, isAmbiguous: false, evidence: null },
  duration: { value: null, isApproximate: false, evidence: null },
  location: { value: null, isConfirmed: false, evidence: null },
  budget: { amount: null, currency: null, isPerPerson: null, isApproximate: false, evidence: null },
  objective: { value: null, evidence: null },
  constraints: [],
  preferences: [],
  importantNotes: [],
  uncertainties: [],
  missingInformation: [],
  suggestedQuestions: [],
};

test("text client sends only the description to the same-origin route and validates its response", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const result = await extractPlanFromText("Fictional project planning", async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return Response.json({ plan: emptyPlan });
  });
  assert.equal(result.title, null);
  assert.equal(requestUrl, "/api/ai/extract/text");
  assert.equal(requestInit?.headers && (requestInit.headers as Record<string, string>)["Content-Type"], "application/json");
  assert.equal(JSON.parse(String(requestInit?.body)).description, "Fictional project planning");
});

test("image client sends the binary blob and its media type", async () => {
  let requestInit: RequestInit | undefined;
  const image = new Blob(["synthetic"], { type: "image/png" });
  await extractPlanFromImage(image, async (_input, init) => {
    requestInit = init;
    return Response.json({ plan: emptyPlan });
  });
  assert.equal(requestInit?.headers && (requestInit.headers as Record<string, string>)["Content-Type"], "image/png");
  assert.equal(requestInit?.body, image);
});

test("client rejects invalid plans and hides server response contents", async () => {
  await assert.rejects(
    extractPlanFromText("example", async () => Response.json({ plan: { apiKey: "private" } })),
    (error: unknown) => error instanceof PlanApiError && !error.message.includes("private"),
  );
  await assert.rejects(
    extractPlanFromText("example", async () => new Response("secret upstream body", { status: 502 })),
    (error: unknown) => error instanceof PlanApiError && !error.message.includes("secret"),
  );
});

test("client presents a useful local-server error when the network fails", async () => {
  await assert.rejects(
    extractPlanFromText("example", async () => { throw new TypeError("offline"); }),
    /Make sure the local server is running/,
  );
});
