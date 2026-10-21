/** Private ownership journal. Resolve it before restoring any classroom queue. */
import * as fs from "node:fs";
import * as path from "node:path";
import { classroomsRoot, classroomDir, isValidSlug, privateStatePath } from "./paths.ts";
import { readTeacherState, saveTeacherState } from "./service-state.ts";
import { lessonRequests, saveLessonRequests } from "./store/lesson-requests.ts";
import type { TeacherIdentity } from "./teacher.ts";

export interface OwnershipChange {
  classroom: string;
  prior: TeacherIdentity | null;
  candidate: TeacherIdentity;
}
export interface OwnershipTransaction {
  version: 1;
  decision: "prepared" | "committed";
  changes: OwnershipChange[];
}
function journal(): string {
  return privateStatePath(".teacher-ownership.json");
}
function syncDirectory(dir: string): void {
  const fd = fs.openSync(dir, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
export function saveOwnershipTransaction(transaction: OwnershipTransaction): void {
  const target = journal();
  const fd = fs.openSync(privateStatePath(".teacher-ownership.json.tmp"), "w", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(transaction, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(`${target}.tmp`, target);
  syncDirectory(classroomsRoot());
}
export function pendingOwnershipTransaction(): OwnershipTransaction | null {
  let value: OwnershipTransaction;
  try {
    value = JSON.parse(fs.readFileSync(journal(), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("Cannot read private teacher ownership transaction.", { cause: error });
  }
  if (
    value.version !== 1 ||
    !["prepared", "committed"].includes(value.decision) ||
    !Array.isArray(value.changes) ||
    value.changes.some(
      (c) => !isValidSlug(c.classroom) || !["pi", "claude", "codex"].includes(c.candidate?.backend),
    )
  )
    throw new Error("Invalid private teacher ownership transaction.");
  return value;
}
export function finishOwnershipTransaction(transaction: OwnershipTransaction): void {
  // Keep all candidate and prior session references for private diagnostics.
  const archive = privateStatePath(".teacher-migrations");
  fs.mkdirSync(archive, { recursive: true, mode: 0o700 });
  const record = path.join(archive, `${Date.now()}-${process.hrtime.bigint()}.json`);
  fs.writeFileSync(record, JSON.stringify(transaction, null, 2), { mode: 0o600 });
  if (transaction.decision === "committed") {
    for (const change of transaction.changes) {
      const state = readTeacherState(change.classroom) ?? {
        version: 1 as const,
        identity: change.candidate,
        requests: [],
        messages: [],
      };
      if (
        change.prior &&
        change.prior.backend !== change.candidate.backend &&
        !state.previousIdentities?.some((i) => JSON.stringify(i) === JSON.stringify(change.prior))
      ) {
        (state.previousIdentities ??= []).push(change.prior);
      }
      state.identity = change.candidate;
      saveTeacherState(change.classroom, state);
      const requests = lessonRequests(change.classroom);
      let changed = false;
      for (const request of requests) {
        if (
          request.delivery === "service" &&
          request.status !== "done" &&
          request.owner !== change.candidate.backend
        ) {
          request.owner = change.candidate.backend;
          changed = true;
        }
      }
      if (changed) saveLessonRequests(change.classroom, requests);
      for (const name of [".teacher.json", ...(changed ? [".lesson-requests.json"] : [])]) {
        const fd = fs.openSync(path.join(classroomDir(change.classroom), name), "r");
        try {
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
      }
      syncDirectory(classroomDir(change.classroom));
    }
  }
  fs.unlinkSync(journal());
  syncDirectory(classroomsRoot());
}
export function recoverOwnershipTransaction(): void {
  const transaction = pendingOwnershipTransaction();
  if (transaction) finishOwnershipTransaction(transaction);
}
