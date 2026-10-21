import { icons } from "./vendor/lucide/icons.mjs";

/** Inline only the trusted bundled subset. Icons use the control's accessible name. */
export function icon(name) {
  if (typeof name !== "string" || !Object.hasOwn(icons, name)) {
    throw new Error(`Unknown bundled icon: ${String(name)}`);
  }
  return icons[name];
}
