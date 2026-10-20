/** One root transaction boundary for classroom and daily review reservations. */
import * as fs from "node:fs";
import { privateStatePath } from "./paths.ts";
let editing = false;
export function withReviewEdit<T>(edit: () => T): T {
  // All edits are synchronous. Publication/status updates inside a daily
  // transaction already own this process's lock; other processes still fail.
  if (editing) return edit();
  fs.mkdirSync(privateStatePath("."), { recursive: true });
  // Retain the existing daily lock name so old and new entry points coordinate.
  const lock = privateStatePath(".daily-reviews.lock");
  let descriptor: number;
  try {
    descriptor = fs.openSync(lock, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(
        `Another server has locked daily review edits. Retry after it finishes. If a server stopped during a save, remove ${lock} before retrying.`,
      );
    throw error;
  }
  try {
    fs.writeFileSync(descriptor, `${process.pid}\n`);
    editing = true;
    return edit();
  } finally {
    editing = false;
    fs.closeSync(descriptor);
    fs.unlinkSync(lock);
  }
}
