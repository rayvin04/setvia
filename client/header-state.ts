export interface HeaderScrollState {
  lastY: number;
  pivot: number;
  direction: -1 | 0 | 1;
  compact: boolean;
  hidden: boolean;
}
export const initialHeaderState: HeaderScrollState = {
  lastY: 0,
  pivot: 0,
  direction: 0,
  compact: false,
  hidden: false,
};
export function nextHeaderState(
  state: HeaderScrollState,
  position: number,
): HeaderScrollState {
  const y = Math.max(0, position);
  const delta = y - state.lastY;
  if (y < 36) return { ...initialHeaderState, lastY: y, pivot: y };
  const compact = state.compact ? y > 36 : y > 72;
  if (Math.abs(delta) < 2) return { ...state, compact };
  const direction = delta > 0 ? 1 : -1;
  const pivot = direction === state.direction ? state.pivot : state.lastY;
  const travel = Math.abs(y - pivot);
  const hidden =
    y < 240
      ? false
      : direction === 1 && travel >= 32
        ? true
        : direction === -1 && travel >= 16
          ? false
          : state.hidden;
  return { lastY: y, pivot, direction, compact, hidden };
}
