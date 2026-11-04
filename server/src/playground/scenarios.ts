import { RoomSchema, type Fact, type Finding } from "../agents/contracts.js";
import { policyForEvent } from "../agents/default-policy.js";
import {
  playgroundScenarios,
  type PlaygroundRequest,
} from "../../../shared/playground.js";

export function demoContext(request: PlaygroundRequest) {
  const scenario = playgroundScenarios[request.agent].find(
    (item) => item.id === request.scenarioId,
  )!;
  const facts: Fact[] = [];
  const fact = (
    id: string,
    key: string,
    value: Fact["value"],
    ownerId = "ana",
  ) => {
    facts.push({
      id,
      key,
      value,
      ownerId,
      confirmed: value !== null,
      visibility: "group",
      scope: "shared",
    });
  };
  let finding: Finding;
  if (request.scenarioId === "judge-seats") {
    fact("attendees", "participants", 6);
    fact("seats", "carSeatsIncludingDriver", 4);
    fact("transport", "additionalTransport", null);
    finding = issue(
      "transport-gap",
      "Logistics Check",
      "Six attendees need transport; the only confirmed car has four seats in total.",
      "Confirm transport for the two people without seats.",
      ["attendees", "seats", "transport"],
    );
  } else if (request.scenarioId === "judge-budget") {
    fact("price", "perPersonCost", 950);
    fact("limit", "budgetAmount", 800);
    finding = issue(
      "budget-gap",
      "Budget Check",
      "The ₱950 lunch exceeds the confirmed ₱800 per-person limit.",
      "Find a lunch costing at most ₱800 per person, or ask people whether they want to reconsider their limit.",
      ["price", "limit"],
    );
  } else if (request.agent === "negotiator") {
    const sunday = request.scenarioId === "negotiator-sunday";
    fact(
      "ana-window",
      "availability",
      sunday ? "Sunday 08:00–12:00" : "Saturday 13:00–17:00",
    );
    facts.at(-1)!.scope = "participant";
    fact(
      "ben-window",
      "availability",
      sunday ? "Sunday 10:00–15:00" : "Saturday 15:00–19:00",
      "ben",
    );
    facts.at(-1)!.scope = "participant";
    fact("travel-time", "travelTime", null);
    finding = issue(
      "schedule-overlap",
      "Schedule Check",
      "Find an overlapping availability window. Travel time is unknown; nobody has approved a time.",
      "Propose a time entirely within both availability windows. Keep travel and human confirmation open.",
      ["ana-window", "ben-window", "travel-time"],
    );
  } else {
    const food = request.scenarioId === "speaker-food";
    fact("tentative-day", "tentativeDate", "Sunday (tentative)");
    fact("unconfirmed-item", food ? "foodOwner" : "transport", null);
    finding = issue(
      food ? "food-gap" : "transport-gap",
      food ? "Preparation Check" : "Logistics Check",
      food
        ? "No one has confirmed who will bring food to the picnic."
        : "The group has not confirmed transportation for the tentative Sunday outing.",
      food
        ? "Ask who can take care of food."
        : "Ask the group how transportation will be arranged.",
      ["unconfirmed-item"],
    );
  }
  const room = RoomSchema.parse({
    schemaVersion: 1,
    id: "public-playground",
    revision: 0,
    eventType: "A fictional public planning demonstration",
    invitationHash: "0".repeat(64),
    participants: ["ana", "ben"].map((id) => ({
      id,
      name: id === "ana" ? "Ana" : "Ben",
      tokenHash: "0".repeat(64),
      publicTargetingConsent: true,
    })),
    policy: policyForEvent("beach picnic"),
    constraints: [],
    facts,
    candidates: [],
    proposal: { id: "demo-proposal", label: scenario.title, values: {} },
    proposalVersion: 1,
    approvals: {},
    pendingInputs: [],
    questions: [],
    options: [],
    readiness: null,
    lastCycle: null,
    activeCycleId: null,
    lifetimeAttempts: 0,
    lifetimeReservedTokens: 0,
    lifetimeReservedCostMicros: 0,
  });
  return { room, finding, scenario };
}

function issue(
  id: string,
  category: Finding["category"],
  message: string,
  recommendedAction: string,
  evidenceIds: string[],
): Finding {
  return {
    id,
    category,
    message,
    recommendedAction,
    evidenceIds,
    severity: "warning",
    status: "open",
    uncertainty: "missing",
  };
}
