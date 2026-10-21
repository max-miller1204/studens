import type { Backend } from "./teacher.ts";

/** A configured adapter cannot override a known opening app. */
export function openingBackend(host: Backend | undefined, requested: unknown): Backend {
  if (
    requested !== undefined &&
    requested !== "pi" &&
    requested !== "claude" &&
    requested !== "codex"
  )
    throw new Error("Invalid teacher_backend. Select pi, claude, or codex.");
  if (host && requested && requested !== host)
    throw new Error(`teacher_backend ${requested} conflicts with opening host ${host}.`);
  const backend = host ?? (requested as Backend | undefined);
  if (!backend)
    throw new Error("Select teacher_backend pi, codex, or claude. The initiating host is unknown.");
  return backend;
}

export function detectOpeningBackend(
  name: string,
  configured: string | undefined,
): Backend | undefined {
  if (
    configured !== undefined &&
    configured !== "pi" &&
    configured !== "claude" &&
    configured !== "codex"
  )
    throw new Error("PI_CLASSROOM_TEACHER must be codex, claude, or pi.");
  const client = name.toLowerCase();
  const detected = client.includes("codex")
    ? "codex"
    : client.includes("claude")
      ? "claude"
      : client === "pi"
        ? "pi"
        : undefined;
  if (detected && configured && detected !== configured)
    throw new Error(`PI_CLASSROOM_TEACHER ${configured} conflicts with opening host ${detected}.`);
  return detected;
}
