import { expect, it } from "vitest";
import { settingsError } from "../assets/runtime/settings-error.mjs";

const context = "codex model unavailable chat request chat:123 in rust/001-ownership";
function savedError(message: string) {
  return `${context}: Codex turn failed: ${JSON.stringify({ message, codexErrorInfo: "other", additionalDetails: null })}`;
}
it("reads the specific upstream rejection while retaining request context", () => {
  const reason = "The 'unavailable' model is not supported with this account.";
  expect(
    settingsError(savedError(JSON.stringify({ type: "error", error: { message: reason } }))),
  ).toEqual({ reason, context: `${context}: Codex turn failed` });
});
it("keeps a plain host reason and does not interpret its markup", () => {
  const reason = '<img src=x onerror="alert(1)">';
  expect(settingsError(savedError(reason))?.reason).toBe(reason);
});
it("leaves unfamiliar or malformed errors intact", () => {
  for (const error of [
    "Claude teacher exited with 1: unrecognized_model",
    `${context}: Codex turn failed: {not json}`,
    `${context}: Codex turn failed: {"message":null}`,
  ])
    expect(settingsError(error)).toBeNull();
});
