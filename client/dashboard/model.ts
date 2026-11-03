import {
  DashboardSnapshotSchema,
  type DashboardSnapshot,
  type DashboardRoom,
} from "../../shared/dashboard";
import type { Category, Readiness } from "../../shared/room-model";

export type Tone = "red" | "yellow" | "green" | "neutral";
export function readinessPresentation(room: DashboardRoom): {
  tone: Tone;
  label: string;
  detail: string;
  historical: boolean;
} {
  const critical = room.findings.some(
    (f) => f.severity === "critical" && f.status !== "resolved",
  );
  if (room.loopState === "BLOCKED")
    return {
      tone: "red",
      label: "Analysis blocked",
      detail:
        "Analysis did not finish. Any score below is the last validated result.",
      historical: true,
    };
  if (!room.readiness)
    return {
      tone: "neutral",
      label: "Not evaluated",
      detail: "The plan has not had a validated Reality Check yet.",
      historical: false,
    };
  if (!room.analysisCurrent || !room.finalEvaluationAvailable)
    return {
      tone: "neutral",
      label: "Update needed",
      detail: "The plan changed. This score belongs to an earlier evaluation.",
      historical: true,
    };
  if (
    critical ||
    room.readiness.status === "blocked" ||
    room.readiness.categories.some((c) => c.status === "blocked")
  )
    return {
      tone: "red",
      label: "Blocked",
      detail:
        "A critical requirement must be resolved before this plan can move forward.",
      historical: false,
    };
  if (room.readiness.status === "ready_for_human_review")
    return {
      tone: "green",
      label: "Ready for review",
      detail:
        "The checks are complete. Everyone still needs to approve this version.",
      historical: false,
    };
  return {
    tone: room.readiness.percentage < 40 ? "red" : "yellow",
    label: "Coming together",
    detail: "A few details still need your people.",
    historical: false,
  };
}

export function acceptDashboardUpdate(
  current: DashboardSnapshot,
  input: unknown,
): DashboardSnapshot {
  const parsed = DashboardSnapshotSchema.safeParse(input);
  if (!parsed.success) return current;
  const next = parsed.data;
  if (
    next.source !== current.source ||
    next.room.roomId !== current.room.roomId ||
    next.room.viewerId !== current.room.viewerId ||
    next.sequence <= current.sequence ||
    next.room.revision < current.room.revision ||
    next.room.proposalVersion < current.room.proposalVersion
  )
    return current;
  return next;
}

const categoryLabels: Record<
  Readiness["categories"][number]["status"],
  string
> = {
  unknown: "Pending",
  incomplete: "Needs attention",
  checked: "Resolved",
  blocked: "Blocked",
  not_applicable: "Not applicable",
};
export function categoryPresentation(room: DashboardRoom, category: Category) {
  const score = room.readiness?.categories.find((c) => c.category === category);
  const available = room.analysisCurrent && room.finalEvaluationAvailable;
  const findings = available
    ? room.findings.filter((f) => f.category === category)
    : [];
  const unresolved = findings.filter((f) => f.status !== "resolved");
  const critical =
    unresolved.some((f) => f.severity === "critical") ||
    score?.status === "blocked";
  const label = !available
    ? "Pending"
    : critical
      ? "Blocked"
      : unresolved.length
        ? "Needs attention"
        : score
          ? categoryLabels[score.status]
          : "Pending";
  const tone: Tone = !available
    ? "neutral"
    : critical
      ? "red"
      : label === "Resolved"
        ? "green"
        : label === "Needs attention"
          ? "yellow"
          : "neutral";
  return {
    label,
    tone,
    findings,
    unresolved,
    score,
    severity: critical
      ? "Critical"
      : unresolved.some((f) => f.severity === "warning")
        ? "Warning"
        : unresolved.length
          ? "Information"
          : "None",
  };
}

export function responseCount(snapshot: DashboardSnapshot): number | null {
  if (snapshot.responseTracking === "unavailable") return null;
  return snapshot.responses.filter(
    (r) => r.proposalVersion === snapshot.room.proposalVersion && r.responded,
  ).length;
}

export function readinessChange(snapshot: DashboardSnapshot): string {
  if (!snapshot.room.analysisCurrent || !snapshot.room.finalEvaluationAvailable)
    return "A fresh evaluation is needed before changes can be explained.";
  return (
    snapshot.history.at(-1)?.explanation ??
    "This is the first validated evaluation. No previous score is available."
  );
}

export function speakerPresentation(room: DashboardRoom) {
  const question =
    room.questions.find((q) => q.targetId === room.viewerId) ??
    room.questions.find((q) => q.targetId === null);
  const message = question
    ? room.messages.find((m) => m.questionId === question.id)
    : room.messages.find((m) => m.questionId === null);
  if (room.loopState === "BLOCKED")
    return {
      kind: "Analysis blocked",
      text: "The latest analysis couldn’t finish. Your plan is here; it needs a new evaluation before we continue.",
      question: undefined,
      expression: "concerned",
    };
  if (!room.analysisCurrent && room.readiness)
    return {
      kind: "Progress update",
      text: "The proposal changed. New questions will appear after its next validated evaluation.",
      question: undefined,
      expression: "content",
    };
  if (!room.readiness)
    return {
      kind: "Let’s make a plan",
      text: "Bring your people and a few details. The first Reality Check will give us a place to start.",
      question: undefined,
      expression: "content",
    };
  if (question)
    return {
      kind:
        question.kind === "approval"
          ? "Request for approval"
          : question.kind === "clarification"
            ? "A question for you"
            : "Let’s decide together",
      text: message?.text ?? question.text,
      question,
      expression: room.mascot === "concerned" ? "concerned" : "curious",
    };
  if (message)
    return {
      kind: room.readiness.newIssueIds.length
        ? "New finding"
        : "Progress update",
      text: message.text,
      question: undefined,
      expression: room.readiness.status === "blocked" ? "concerned" : "content",
    };
  return {
    kind: "Analysis complete",
    text:
      room.readiness.status === "ready_for_human_review"
        ? "The plan is ready for your people to review. A complete check is the start of agreement."
        : "Your latest checks are in. Review the open details when you’re ready.",
    question: undefined,
    expression: "content",
  };
}

export const formatTime = (value: string) =>
  new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila",
  }).format(new Date(value));
