import assert from "node:assert/strict";
import test from "node:test";
import type { DashboardSnapshot } from "../../shared/dashboard";
import { createEventCard } from "./event-card";
import { createReceiptPdf } from "./receipt-pdf";
import {
  projectDecisionReceipt,
  projectReceiptEvidence,
} from "./decision-receipt";

type ReceiptSnapshot = Parameters<typeof projectDecisionReceipt>[0];

function makeSnapshot(
  overrides: {
    loopState?: string;
    approved?: boolean;
    analysisCurrent?: boolean;
    finalEvaluationAvailable?: boolean;
    analysisIncomplete?: boolean;
    readinessStatus?: string | null;
  } = {},
): ReceiptSnapshot {
  return {
    source: "room",
    room: {
      eventType: "Trip or outing",
      eventAttendance: { estimatedAttendeeCount: 3, confirmedAttendeeCount: 1 },
      revision: 4,
      analysisStatus: "complete",
      proposalVersion: 2,
      participants: [{ id: "planner-a", name: "Organizer", approved: overrides.approved ?? false }],
      candidates: [],
      privateAnalysisStatus: "idle",
      proposal: {
        id: "option-a",
        label: "Sunday outing",
        values: {
          date: "Sunday",
          time: "Morning",
          location: "Public park",
          budgetAmount: "300",
          budgetCurrency: "PHP",
          budgetScope: "per-person",
          description: "Shared event details",
        },
      },
      readiness: overrides.readinessStatus
        ? { status: overrides.readinessStatus, percentage: 84 }
        : null,
      analysisCurrent: overrides.analysisCurrent ?? false,
      analysisIncomplete: overrides.analysisIncomplete ?? true,
      finalEvaluationAvailable: overrides.finalEvaluationAvailable ?? false,
      loopState: overrides.loopState ?? null,
      mascot: null,
      findings: [],
      questions: [],
      options: [],
      messages: [],
      approved: overrides.approved ?? false,
      approvalCount: overrides.approved ? 1 : 0,
    },
  } as unknown as ReceiptSnapshot;
}

async function withCanvas<T>(run: () => Promise<T>): Promise<T> {
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const context = {
    font: "",
    fillStyle: "",
    textBaseline: "top",
    measureText: (value: string) => ({ width: value.length * 8 }),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    fillRect: () => undefined,
    fillText: () => undefined,
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toBlob: (callback: BlobCallback, type = "image/png") => {
      callback(new Blob([new Uint8Array([1, 2, 3, 4])], { type }));
    },
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: {
      fonts: { ready: Promise.resolve() },
      createElement: (tag: string) => {
        if (tag !== "canvas") throw new Error("Unexpected element requested.");
        return canvas;
      },
    } as unknown as Document,
  });
  try {
    return await run();
  } finally {
    if (priorDocument) Object.defineProperty(globalThis, "document", priorDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
}

test("receipt labels stay Draft, Blocked, or Final according to validated room state", () => {
  assert.equal(projectDecisionReceipt(makeSnapshot()).status, "Draft");
  assert.equal(
    projectDecisionReceipt(makeSnapshot({ loopState: "BLOCKED" })).status,
    "Blocked",
  );
  assert.equal(
    projectDecisionReceipt(
      makeSnapshot({
        loopState: "COMPLETED",
        approved: true,
        analysisCurrent: true,
        finalEvaluationAvailable: true,
        analysisIncomplete: false,
        readinessStatus: "ready_for_human_review",
      }),
    ).status,
    "Final",
  );
});

test("receipt evidence includes only group-visible entries for the current proposal", () => {
  const snapshot = makeSnapshot() as unknown as DashboardSnapshot;
  const evidence = projectReceiptEvidence({
    room: snapshot.room,
    contributions: [
      {
        id: "current-group",
        visibility: "group",
        proposalVersion: 2,
        text: "Shared detail",
      },
      {
        id: "private-entry",
        visibility: "private",
        targetId: "planner-a",
        proposalVersion: 2,
        text: "Private detail",
      },
      {
        id: "stale-group",
        visibility: "group",
        proposalVersion: 1,
        text: "Old detail",
      },
    ] as DashboardSnapshot["contributions"],
  });
  assert.deepEqual([...evidence], [["current-group", "Shared detail"]]);
});

test("Event Card generation returns a PNG blob", async () => {
  const receipt = projectDecisionReceipt(makeSnapshot());
  const image = await withCanvas(() => createEventCard(receipt.eventCard));
  assert.equal(image.type, "image/png");
  assert.equal(image.size, 4);
});

test("Decision Receipt generation returns a PDF blob", async () => {
  const receipt = projectDecisionReceipt(makeSnapshot());
  const pdf = await withCanvas(() => createReceiptPdf(receipt));
  assert.equal(pdf.type, "application/pdf");
  assert.ok((await pdf.slice(0, 8).text()).startsWith("%PDF-1.4"));
});
