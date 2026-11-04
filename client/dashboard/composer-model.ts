import type { Question } from "../../server/src/agents/contracts";
import type { DashboardRoom } from "../../shared/dashboard";

export interface QuickReply {
  id: string;
  label: string;
  intent: "submit" | "compose" | "review";
}
export function currentQuestion(room: DashboardRoom): Question | undefined {
  if (
    !room.analysisCurrent ||
    !room.finalEvaluationAvailable ||
    room.analysisIncomplete
  )
    return;
  return (
    room.questions.find((q) => q.targetId === room.viewerId) ??
    room.questions.find((q) => q.targetId === null)
  );
}
export function questionQuickReplies(
  question: Question | undefined,
): QuickReply[] {
  if (!question) return [];
  return question.options.map((label, index) => ({
    id: `${question.id}_reply_${index}`,
    label,
    intent: label.endsWith("[conflicts with a confirmed requirement]")
      ? "compose"
      : /^review details$/i.test(label)
      ? "review"
      : /another|suggest|different|change|more details|something else/i.test(
            label,
          )
        ? "compose"
        : "submit",
  }));
}
export function virtualKeyboardInset(
  layoutHeight: number,
  viewportHeight: number,
  viewportOffsetTop: number,
): number {
  return Math.max(
    0,
    Math.round(layoutHeight - viewportHeight - viewportOffsetTop),
  );
}
