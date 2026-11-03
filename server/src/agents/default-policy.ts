import { Categories, PolicySchema, type Policy } from "./contracts.js";

const requiredKeys: Record<(typeof Categories)[number], string[]> = {
  "Schedule Check": ["date", "time", "duration", "deadline"],
  "Budget Check": ["budgetAmount", "budgetScope", "totalCost", "perPersonCost"],
  "People Check": ["participants", "decisionMakers", "roles"],
  "Logistics Check": ["location", "transport", "route", "venue"],
  "Preparation Check": ["materials", "equipment", "supplies", "preparationOwner"],
  "Safety Check": ["safetyPlan", "emergencyContact", "routeConditions", "weatherPlan"],
};

/** Six stable category names with event-specific evidence keys supplied at creation. */
export function policyForEvent(eventType: string): Policy {
  const normalized = eventType.toLowerCase();
  const eventKeys = Object.fromEntries(
    Categories.map((category) => {
      const keys = [...requiredKeys[category]];
      if (/trip|hike|outdoor|beach|travel/.test(normalized) && category === "Safety Check")
        keys.push("routeConditions", "weatherPlan", "emergencyCommunications");
      if (/meeting|workshop|kickoff|project/.test(normalized) && category === "Preparation Check")
        keys.push("agenda", "presentationMaterials");
      if (/family|celebration|volunteer|event/.test(normalized) && category === "People Check")
        keys.push("attendance", "accessibilityNeeds");
      return [category, [...new Set(keys)]];
    }),
  ) as Record<(typeof Categories)[number], string[]>;
  return PolicySchema.parse(
    Categories.map((category) => ({
      category,
      enabled: true,
      weight: 1,
      requiredKeys: eventKeys[category],
      requiredPerParticipantKeys: [],
    })),
  );
}
