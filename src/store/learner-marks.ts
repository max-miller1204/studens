import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import type { TextQuoteSelector } from "../../assets/runtime/anchor.mjs";
import { learnerMarksFile, safeStaticFile, classroomDir, lessonDir } from "../paths.ts";
import * as path from "node:path";
import { readJson } from "./json.ts";

export interface LearnerMark {
  id: string;
  kind: "highlight" | "note" | "bookmark";
  anchor: TextQuoteSelector;
  text: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
}
interface MarkState {
  version: 1;
  marks: LearnerMark[];
}
export class MarkError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
const validId = (id: unknown): id is string =>
  typeof id === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id);
const positive = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) > 0;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new MarkError("Expected a learner mark object.");
  return value as Record<string, unknown>;
}
function anchorOf(value: unknown): TextQuoteSelector {
  const a = object(value);
  if (
    typeof a.exact !== "string" ||
    !a.exact.trim() ||
    a.exact.length > 2000 ||
    typeof a.prefix !== "string" ||
    a.prefix.length > 500 ||
    typeof a.suffix !== "string" ||
    a.suffix.length > 500 ||
    !Number.isSafeInteger(a.occurrence) ||
    Number(a.occurrence) < 0
  )
    throw new MarkError(
      "A text quote (1–2000 characters), context (up to 500 each), and nonnegative occurrence are required.",
    );
  return { exact: a.exact, prefix: a.prefix, suffix: a.suffix, occurrence: Number(a.occurrence) };
}
function markContent(
  value: Record<string, unknown>,
): Pick<LearnerMark, "kind" | "text" | "anchor"> {
  const { kind, text } = value;
  if (kind !== "highlight" && kind !== "note" && kind !== "bookmark")
    throw new MarkError("Choose highlight, note, or bookmark.");
  if (typeof text !== "string" || text.length > 4000 || (kind !== "note" && text !== ""))
    throw new MarkError(
      "Notes allow up to 4000 characters; highlights and bookmarks have no note text.",
    );
  return { kind, text, anchor: anchorOf(value.anchor) };
}

/** Missing state is empty; malformed or unsupported state is an explicit error. */
export function readLearnerMarks(classroom: string, lesson: string): LearnerMark[] {
  const file = learnerMarksFile(classroom, lesson);
  const data = readJson<MarkState>(file);
  if (data === null) return [];
  if (data.version !== 1 || !Array.isArray(data.marks) || data.marks.length > 1000)
    throw new Error(`Invalid learner marks version or list in ${file}.`);
  const ids = new Set<string>();
  for (const m of data.marks) {
    try {
      const value = object(m);
      markContent(value);
      if (
        !validId(m.id) ||
        ids.has(m.id) ||
        !positive(m.revision) ||
        !positive(m.createdAt) ||
        !positive(m.updatedAt) ||
        m.updatedAt < m.createdAt
      )
        throw new Error("Invalid identity, revision, or timestamp.");
      ids.add(m.id);
    } catch (error) {
      throw new Error(`Invalid learner mark in ${file}: ${(error as Error).message}`);
    }
  }
  return data.marks;
}

/** Lock/reload/replace prevents lost updates across tabs and service processes. */
export function editLearnerMarks(classroom: string, lesson: string, input: unknown): LearnerMark[] {
  const command = object(input);
  if (!validId(command.id)) throw new MarkError("A valid learner mark ID is required.");
  const file = learnerMarksFile(classroom, lesson);
  const lessonFile = safeStaticFile(
    classroomDir(classroom),
    path.relative(classroomDir(classroom), path.join(lessonDir(classroom, lesson), "lesson.html")),
  );
  if (!lessonFile || !fs.existsSync(lessonFile))
    throw new MarkError("This lesson no longer exists.", 404);
  const lock = `${file}.lock`;
  let descriptor: number;
  try {
    descriptor = fs.openSync(lock, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new MarkError(
        `Learner marks are locked by another save. Retry after it finishes. If interrupted, inspect and remove ${lock} before retrying.`,
        409,
      );
    throw error;
  }
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(descriptor, `${process.pid}\n`);
    const marks = readLearnerMarks(classroom, lesson);
    const index = marks.findIndex((m) => m.id === command.id);
    if (command.action === "create") {
      const content = markContent(command);
      if (index >= 0) {
        const existing = marks[index];
        // Explicitly retrying a lost create response must not duplicate the mark.
        if (
          existing.kind === content.kind &&
          existing.text === content.text &&
          JSON.stringify(existing.anchor) === JSON.stringify(content.anchor)
        )
          return marks;
        throw new MarkError(
          "This mark ID is already saved with different content. Refresh saved marks.",
          409,
        );
      }
      if (marks.length >= 1000)
        throw new MarkError(
          "This lesson already has 1000 marks. Delete a mark before saving another.",
          409,
        );
      const now = Date.now();
      marks.push({ id: command.id, ...content, revision: 1, createdAt: now, updatedAt: now });
    } else if (command.action === "edit" || command.action === "delete") {
      if (!positive(command.revision)) throw new MarkError("A saved mark revision is required.");
      const mark = marks[index];
      if (!mark || mark.revision !== command.revision)
        throw new MarkError(
          "This mark changed or was deleted in another tab. Refresh saved marks before editing again. Your draft is kept.",
          409,
        );
      if (command.action === "delete") marks.splice(index, 1);
      else {
        if (mark.kind !== "note") throw new MarkError("Only a note has editable text.");
        const { text } = markContent({ ...mark, text: command.text });
        marks[index] = {
          ...mark,
          text,
          revision: mark.revision + 1,
          updatedAt: Math.max(Date.now(), mark.updatedAt),
        };
      }
    } else throw new MarkError("Unknown learner mark action.");
    const fd = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify({ version: 1, marks }) + "\n");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, file);
    return marks;
  } finally {
    fs.rmSync(temporary, { force: true });
    fs.closeSync(descriptor);
    fs.unlinkSync(lock);
  }
}
