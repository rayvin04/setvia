export const previewPeople = [
  "Hu Tao",
  "Selena",
  "Furina",
  "Manta Ray",
] as const;
export type PreviewPerson = (typeof previewPeople)[number];
export type PlanDetail = "when" | "budget" | "travel" | "open";
export interface PreviewState {
  approvals: PreviewPerson[];
  detail: PlanDetail | null;
}
export type PreviewAction =
  | { type: "toggle-approval"; person: PreviewPerson }
  | { type: "inspect"; detail: PlanDetail }
  | { type: "reset" };
export function initialPreview(): PreviewState {
  return { approvals: ["Hu Tao", "Furina"], detail: null };
}
export function previewReducer(
  state: PreviewState,
  action: PreviewAction,
): PreviewState {
  switch (action.type) {
    case "reset":
      return initialPreview();
    case "inspect":
      return {
        ...state,
        detail: state.detail === action.detail ? null : action.detail,
      };
    case "toggle-approval":
      return {
        ...state,
        approvals: state.approvals.includes(action.person)
          ? state.approvals.filter((person) => person !== action.person)
          : [...state.approvals, action.person],
      };
  }
}
export interface VersionPreview {
  version: 3 | 4;
  approvals: PreviewPerson[];
}
export function initialVersion(): VersionPreview {
  return { version: 3, approvals: ["Hu Tao", "Furina"] };
}
export function revisePreview(state: VersionPreview): VersionPreview {
  return state.version === 3 ? { version: 4, approvals: [] } : state;
}
export function approveVersion(
  state: VersionPreview,
  person: PreviewPerson,
): VersionPreview {
  return state.approvals.includes(person)
    ? state
    : { ...state, approvals: [...state.approvals, person] };
}
