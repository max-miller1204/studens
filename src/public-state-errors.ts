/** Public read diagnostics identify the failed boundary, never private parser input. */
export class PublicStateError extends Error {}

function category(error: unknown): string {
  const seen = new Set<unknown>();
  let cause = error;
  while (cause instanceof Error && !seen.has(cause)) {
    seen.add(cause);
    if (cause instanceof SyntaxError) return "invalid JSON";
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return "missing file";
    if (code === "EACCES" || code === "EPERM") return "permission denied";
    cause = cause.cause;
  }
  return "invalid or unreadable saved data";
}

/** Labels must be code-owned descriptions, never private file contents or model output. */
export function readPublicState<T>(label: string, read: () => T): T {
  try {
    return read();
  } catch (cause) {
    throw new PublicStateError(
      `Cannot load ${label}: ${category(cause)}. Restore the original state and retry explicitly.`,
      { cause },
    );
  }
}

export function publicStateError(error: unknown): string {
  return error instanceof PublicStateError
    ? error.message
    : "Cannot load expected answers: invalid or unreadable saved assessment data. Restore the original state and retry explicitly.";
}
