/** Read the Codex turn error already retained by the teacher, without changing it. */
export function settingsError(message) {
  const match = /^(.*): Codex turn (failed|interrupted): (\{.*\})$/s.exec(message);
  if (!match) return null;
  try {
    const error = JSON.parse(match[3]);
    if (typeof error?.message !== "string" || !error.message.trim()) return null;
    let reason = error.message;
    // An upstream rejection may itself be encoded in TurnError.message.
    try {
      const upstream = JSON.parse(reason);
      if (upstream?.type === "error" && typeof upstream.error?.message === "string")
        reason = upstream.error.message || reason;
    } catch {
      // Plain-text TurnError.message is also part of the host protocol.
    }
    return { reason, context: `${match[1]}: Codex turn ${match[2]}` };
  } catch {
    // Keep unfamiliar or incomplete errors visible verbatim.
    return null;
  }
}
