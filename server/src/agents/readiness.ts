import type {
  Constraint,
  Finding,
  PlanOption,
  Readiness,
  Room,
} from "./contracts.js";

export function constraintPasses(
  c: Constraint,
  values: PlanOption["values"],
): boolean {
  const actual = values[c.key];
  if (actual === undefined || actual === null) return false;
  if (c.operator === "required")
    return typeof actual !== "string" || actual.trim().length > 0;
  if (c.operator === "eq") return actual === c.expected;
  if (c.operator === "neq") return actual !== c.expected;
  return (
    typeof actual === "number" &&
    typeof c.expected === "number" &&
    (c.operator === "lte" ? actual <= c.expected : actual >= c.expected)
  );
}
export function violations(room: Room, option: PlanOption): Constraint[] {
  return room.constraints.filter(
    (c) => c.hard && !constraintPasses(c, option.values),
  );
}
export function calculateReadiness(room: Room, findings: Finding[]): Readiness {
  // Private and tentative facts never increase the group-wide score. Owner
  // scope prevents unrelated personal budgets and schedules from appearing to
  // contradict a single shared value.
  const visible = room.facts.filter(
    (f) => f.visibility === "group" && f.confirmed,
  );
  const categories = room.policy.map((policy) => {
    if (!policy.enabled)
      return {
        category: policy.category,
        percentage: 0,
        status: "not_applicable" as const,
      };
    const constraints = room.constraints.filter(
      (c) => c.category === policy.category,
    );
    const evidence = policy.requiredKeys.map((key) => {
      const facts = visible.filter((f) => f.key === key && f.value !== null);
      const shared = facts.filter((f) => f.scope === "shared");
      return (shared.length ? shared : facts).length > 0;
    });
    const participantEvidence = policy.requiredPerParticipantKeys.flatMap(
      (key) =>
        room.participants.map((participant) =>
          visible.some(
            (f) =>
              f.scope === "participant" &&
              f.ownerId === participant.id &&
              f.key === key &&
              f.value !== null,
          ),
        ),
    );
    const checks = [
      ...evidence,
      ...participantEvidence,
      ...constraints.map((c) => constraintPasses(c, room.proposal.values)),
    ];
    const open = findings.filter(
      (f) => f.category === policy.category && f.status !== "resolved",
    );
    const hardFailure = constraints.some(
      (c) => c.hard && !constraintPasses(c, room.proposal.values),
    );
    const conflictingFacts = policy.requiredKeys.some((key) => {
      const facts = visible.filter((f) => f.key === key);
      const shared = facts.filter((f) => f.scope === "shared");
      if (new Set(shared.map((f) => JSON.stringify(f.value))).size > 1)
        return true;
      const personal = facts.filter((f) => f.scope === "participant");
      const byOwner = new Map<string, Set<string>>();
      for (const fact of personal) {
        const values = byOwner.get(fact.ownerId) ?? new Set<string>();
        values.add(JSON.stringify(fact.value));
        byOwner.set(fact.ownerId, values);
      }
      return [...byOwner.values()].some((values) => values.size > 1);
    });
    const critical =
      conflictingFacts ||
      open.some((f) => f.severity === "critical") ||
      hardFailure;
    let percentage = checks.length
      ? Math.round((100 * checks.filter(Boolean).length) / checks.length)
      : 0;
    if (open.length) percentage = Math.min(percentage, critical ? 0 : 80);
    return {
      category: policy.category,
      percentage,
      status: critical
        ? ("blocked" as const)
        : !checks.length
          ? ("unknown" as const)
          : percentage === 100
            ? ("checked" as const)
            : ("incomplete" as const),
    };
  });
  const enabled = room.policy.filter((c) => c.enabled);
  const weight = enabled.reduce((n, c) => n + c.weight, 0);
  const percentage = weight
    ? Math.round(
        categories.reduce(
          (n, c, i) =>
            n +
            c.percentage * (room.policy[i].enabled ? room.policy[i].weight : 0),
          0,
        ) / weight,
      )
    : 0;
  const current = new Set(
    findings.filter((f) => f.status !== "resolved").map((f) => f.id),
  );
  const previous = new Set(
    room.lastCycle?.finalEvaluation?.findings
      .filter((f) => f.status !== "resolved")
      .map((f) => f.id) ?? [],
  );
  return {
    percentage,
    categories,
    policyVersion: "readiness-v1",
    status:
      categories.some((c) => c.status === "blocked") ||
      findings.some(
        (f) => f.severity === "critical" && f.status !== "resolved",
      ) ||
      violations(room, room.proposal).length > 0
        ? "blocked"
        : weight > 0 && percentage === 100
          ? "ready_for_human_review"
          : "needs_input",
    delta: room.readiness ? percentage - room.readiness.percentage : null,
    newIssueIds: [...current].filter((id) => !previous.has(id)),
    resolvedIssueIds: [...previous].filter((id) => !current.has(id)),
  };
}
