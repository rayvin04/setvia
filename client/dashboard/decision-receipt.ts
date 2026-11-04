import type { DashboardSnapshot } from "../../shared/dashboard";
import type { EventCardDetails } from "./event-card";

const decisionFields = [
  ["date", "Date"],
  ["time", "Time"],
  ["location", "Location"],
  ["cost", "Budget per person"],
  ["transport", "Transportation"],
  ["agenda", "Schedule"],
  ["preparation", "Preparation"],
] as const;

type ReceiptSnapshot = Pick<DashboardSnapshot, "source"> & {
  room: DashboardSnapshot["room"] & {
    eventAttendance?: { estimatedAttendeeCount: number | null };
  };
};

export function projectDecisionReceipt(snapshot: ReceiptSnapshot) {
  const { room } = snapshot;
  const { values } = room.proposal;
  const blocked =
    room.loopState === "BLOCKED" ||
    room.readiness?.status === "blocked" ||
    room.findings.some(
      (finding) =>
        finding.severity === "critical" && finding.status !== "resolved",
    );
  const finalized =
    !blocked &&
    room.approved &&
    room.participants.length > 0 &&
    room.participants.every((participant) => participant.approved) &&
    room.analysisCurrent &&
    room.finalEvaluationAvailable &&
    !room.analysisIncomplete &&
    room.loopState === "COMPLETED" &&
    room.readiness?.status === "ready_for_human_review";

  const decisions = decisionFields.flatMap<{
    key: string;
    label: string;
    value: string;
  }>(([key, label]) => {
    const value = values[key];
    if (key === "cost" && typeof value === "number") {
      const currency = values.currency;
      return [
        {
          key,
          label,
          value:
            typeof currency === "string" && /^[A-Z]{3}$/.test(currency)
              ? new Intl.NumberFormat(undefined, {
                  style: "currency",
                  currency,
                }).format(value)
              : String(value),
        },
      ];
    }
    if (
      key === "cost" &&
      typeof values.budgetAmount === "string" &&
      values.budgetAmount.trim()
    ) {
      const scope =
        values.budgetScope === "per-person"
          ? "Budget per person"
          : values.budgetScope === "total"
            ? "Total budget"
            : "Budget";
      return [
        {
          key,
          label: scope,
          value: [values.budgetCurrency, values.budgetAmount]
            .filter(Boolean)
            .join(" "),
        },
      ];
    }
    return typeof value === "string" && value.trim()
      ? [{ key, label, value }]
      : [];
  });

  function text(key: string) {
    const value = values[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }

  const attendeeCount =
    room.eventAttendance?.estimatedAttendeeCount ??
    values.expectedAttendees ??
    values.attendeeCount;
  const eventCard: EventCardDetails = {
    title: room.proposal.label,
    status: blocked ? "Blocked" : finalized ? "Final" : "Draft",
    date: text("date"),
    time: text("time"),
    location: text("location"),
    description: text("description"),
    expectedAttendees:
      typeof attendeeCount === "number" ? attendeeCount : undefined,
  };

  return {
    title: room.proposal.label,
    eventType: room.eventType,
    source: snapshot.source,
    proposalVersion: room.proposalVersion,
    status: blocked ? "Blocked" : finalized ? "Final" : "Draft",
    readiness: room.analysisCurrent ? room.readiness : null,
    decisions,
    eventCard,
    participants: room.participants,
    findings:
      room.analysisCurrent && room.finalEvaluationAvailable
        ? room.findings
        : [],
    approvalCount: room.approvalCount,
    participantCount: room.participants.length,
  } as const;
}
