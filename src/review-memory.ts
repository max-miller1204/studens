/** Studens adaptation of the published FSRS-4.5 equations; see EVIDENCE.md P5.
 * No ratings, fuzz, fitted parameters, or calibrated recall claims. */
export const MEMORY_POLICY = "studens-fsrs45-v1";
export const MAX_STABILITY_DAYS = 3650;
const W = [
  0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072,
  0.0793, 0.3246, 1.587, 0.2272, 2.8755,
] as const;
const bound = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
export interface MemoryState {
  stability: number;
  difficulty: number;
}
export function initialMemory(): MemoryState {
  // Start conservatively at one day even after a first fully correct answer.
  return { stability: 1, difficulty: W[4] };
}
export function recallMemory(state: MemoryState, elapsedDays: number): MemoryState {
  const { stability: s, difficulty: d } = state;
  const r = Math.pow(1 + ((19 / 81) * elapsedDays) / s, -0.5);
  return {
    stability: bound(
      s * (1 + Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * Math.expm1(W[10] * (1 - r))),
      0.25,
      MAX_STABILITY_DAYS,
    ),
    difficulty: bound(W[7] * W[4] + (1 - W[7]) * d, 1, 10),
  };
}
export function incompleteMemory(
  state: MemoryState,
  elapsedDays: number,
  credit: number,
): MemoryState {
  const { stability: s, difficulty: d } = state;
  const r = Math.pow(1 + ((19 / 81) * elapsedDays) / s, -0.5);
  // Partial is not upstream Hard (which represents successful recall). It never
  // increases stability. A 5..15% setback preserves the demonstrated components.
  const stability =
    credit > 0
      ? s * (0.85 + 0.1 * credit)
      : Math.min(
          s,
          W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r)),
        );
  return {
    stability: bound(stability, 0.25, MAX_STABILITY_DAYS),
    difficulty: bound(d + (credit > 0 ? 0.5 * (1 - credit) : 2 * W[6]), 1, 10),
  };
}
