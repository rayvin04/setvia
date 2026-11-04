export const PLANNING_REDIRECT =
  "Setvia is here to help your group make plans. What would you like to organize?";

/**
 * A conservative local screen for clear requests that are outside group
 * planning or ask for protected internal data. It does not classify ordinary
 * statements or ambiguous questions.
 */
const CLEARLY_OUT_OF_SCOPE: RegExp[] = [
  /^\s*(?:(?:please|can you|could you|help me|i need you to|i want you to)\s+)?(?:do|solve|complete|answer)\s+(?:my\s+)?(?:homework|assignment|exam|quiz)\b/i,
  /^\s*(?:(?:please|can you|could you)\s+)?(?:write|draft|compose|generate)\s+(?:me\s+)?(?:an?\s+)?(?:unrelated\s+)?(?:essay|poem|story|song|fiction|screenplay)\b/i,
  /^\s*(?:(?:please|can you|could you)\s+)?(?:write|generate|debug|explain)\s+(?:me\s+)?(?:some\s+)?(?:arbitrary\s+)?(?:source\s+)?code\b/i,
  /^\s*(?:(?:please|can you|could you)\s+)?(?:tell me|give me|share)\s+(?:a\s+)?(?:random\s+)?trivia\b/i,
  /^\s*(?:(?:please|can you|could you|i want you to)\s+)?(?:reveal|print|show|dump|repeat|quote|tell me)\b.{0,80}\b(?:system|developer|private|hidden)\s+(?:prompt|instructions?)\b/i,
  /^\s*(?:ignore|forget|disregard|override)\b.{0,100}\b(?:system|developer|previous|setvia|your)\s+(?:instructions?|rules?|identity|prompt)\b/i,
  /^\s*you\s+are\s+no\s+longer\s+setvia\b/i,
  /^\s*(?:become|act as|switch to)\s+(?:a\s+)?(?:general\s+)?(?:ai|chatbot|assistant)\b/i,
  /^\s*(?:(?:please|can you|could you)\s+)?(?:call|invoke|query)\s+(?:the\s+)?(?:meta\s+)?(?:model|api|inference)\b.{0,50}\b(?:\d{2,}|many|repeatedly|100\s+times)\b/i,
  /^\s*(?:override|ignore|bypass|remove|increase)\b.{0,50}\b(?:the\s+)?(?:model\s+)?(?:api\s+)?(?:spending\s+)?(?:request\s+)?budget\s+limit\b/i,
  /^\s*(?:mark|set|force|make)\b.{0,50}\b(?:plan|readiness|ready)\b.{0,40}\b(?:100\s*%|ready|approved)\b/i,
  /^\s*(?:approve|accept|confirm)\b.{0,60}\b(?:for\s+)?all\s+participants\b/i,
  /^\s*(?:reveal|show|give me|send me|print|share)\b.{0,70}\b(?:another participant'?s|someone else'?s|other participant'?s)\s+(?:private|hidden)\s+(?:messages?|responses?|answers?)\b/i,
  /^\s*(?:(?:please|can you|could you)\s+)?(?:generate|make|create)\s+(?:me\s+)?(?:an?\s+)?(?:unrelated\s+)?(?:image|picture|artwork|illustration)\b/i,
];

export function isClearlyOutOfScope(text: string) {
  const normalized = text.normalize("NFKC").trim();
  return CLEARLY_OUT_OF_SCOPE.some((pattern) => pattern.test(normalized));
}

export class PlanningScopeError extends Error {
  readonly code = "OUT_OF_SCOPE";
  constructor() {
    super(PLANNING_REDIRECT);
    this.name = "PlanningScopeError";
  }
}

export function assertPlanningScope(text: string) {
  if (isClearlyOutOfScope(text)) throw new PlanningScopeError();
}
