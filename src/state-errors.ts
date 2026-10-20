/** Public state diagnostics never quote private JSON bytes; causes remain private. */
export class StateReadError extends Error {}

export function stateReadError(context: string, cause: unknown): StateReadError {
  if (cause instanceof StateReadError) return cause;
  let category = "invalid saved state";
  const seen = new Set<unknown>();
  for (let error: unknown = cause; error && !seen.has(error);) {
    seen.add(error);
    if (error instanceof SyntaxError) {
      category = "malformed JSON";
      break;
    }
    if (typeof error !== "object") break;
    const code = (error as NodeJS.ErrnoException).code;
    if (
      code &&
      [
        "ENOENT",
        "EACCES",
        "EPERM",
        "EISDIR",
        "ENOTDIR",
        "ELOOP",
        "EIO",
        "EMFILE",
        "ENFILE",
      ].includes(code)
    )
      category = `filesystem error ${code}`;
    error = (error as { cause?: unknown }).cause;
  }
  return new StateReadError(
    `Cannot read ${context}: ${category}. Restore the saved state, then retry explicitly.`,
    { cause },
  );
}
