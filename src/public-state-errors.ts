/** Public read diagnostics identify the failed boundary, never private parser input. */
import { StateReadError, stateReadError } from "./state-errors.ts";

export class PublicStateError extends StateReadError {}

/** Labels must be code-owned descriptions, never private file contents or model output. */
export function readPublicState<T>(label: string, read: () => T): T {
  try {
    return read();
  } catch (cause) {
    throw stateReadError(label, cause);
  }
}

export function publicStateError(error: unknown): string {
  return error instanceof StateReadError
    ? error.message
    : "Cannot load expected answers: invalid or unreadable saved assessment data. Restore the original state and retry explicitly.";
}
