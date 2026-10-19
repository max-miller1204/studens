/**
 * Discovery is filesystem-first: a directory holding lesson HTML is a lesson,
 * including material authored with plain file writes without lesson.json.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  classroomDir,
  classroomsRoot,
  isDir,
  isFile,
  isValidSlug,
  lessonDir,
  isStoredReview,
} from "../paths.ts";
import { mtime, readJson, writeJson } from "./json.ts";

export interface ClassroomMeta {
  title: string;
  emoji: string;
  createdAt: number;
}

export interface Classroom {
  /** Directory name — also the URL segment. */
  name: string;
  title: string;
  emoji: string;
  createdAt: number;
  updatedAt: number;
  mission: string | null;
  lessonCount: number;
}

/** A normal lesson, or a review session that `scaffold_review` created. */
export type LessonKind = "lesson" | "review";

export interface LessonMeta {
  title: string;
  summary: string;
  createdAt: number;
  /** Absent on lessons written before review sessions existed. */
  kind?: LessonKind;
  assessmentContract?: 1;
  criterionContract?: 1;
  instructionalContract?: 1;
  reviewVariantContract?: 1;
}

export interface Lesson {
  /** Directory name — also the URL segment. */
  name: string;
  classroom: string;
  title: string;
  summary: string;
  /** Absolute path to the lesson's HTML document. */
  htmlPath: string;
  createdAt: number;
  updatedAt: number;
  /** Numeric ordering prefix on the directory name, if any. */
  order: number | null;
  kind: LessonKind;
  assessmentContract?: 1;
  criterionContract?: 1;
  instructionalContract?: 1;
  reviewVariantContract?: 1;
  annotationCount: number;
  /** Grade of the most recent graded submission that is not a pretest, when one exists. */
  latestScore: number | null;
  hasUngradedSubmission: boolean;
}

/**
 * Pick the lesson document inside a lesson directory.
 *
 * `lesson.html` wins; otherwise the lexicographically first `lesson-*.html` (so a
 * literal `lesson-001.html` works); otherwise the first `.html` file present.
 */
export function resolveLessonHtml(dir: string): string | null {
  if (isFile(path.join(dir, "lesson.html"))) return path.join(dir, "lesson.html");

  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const html = entries.filter((e) => e.toLowerCase().endsWith(".html")).sort();
  const numbered = html.filter((e) => /^lesson[-_]/i.test(e));
  const chosen = numbered[0] ?? html[0];
  return chosen ? path.join(dir, chosen) : null;
}

/** Leading numeric prefix on a directory name (`003-closures` → 3). */
export function orderPrefix(name: string): number | null {
  const m = /^(\d+)[-_]/.exec(name);
  return m ? Number(m[1]) : null;
}

// ── Classrooms ────────────────────────────────────────────────────────────────

export function listClassrooms(): Classroom[] {
  const root = classroomsRoot();
  if (!isDir(root)) return [];

  const out: Classroom[] = [];
  for (const name of fs.readdirSync(root)) {
    if (!isValidSlug(name) || !isDir(path.join(root, name))) continue;
    const classroom = readClassroom(name);
    if (classroom) out.push(classroom);
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function readClassroom(name: string): Classroom | null {
  if (!isValidSlug(name)) return null;
  const dir = classroomDir(name);
  if (!isDir(dir)) return null;

  const meta = readJson<ClassroomMeta>(path.join(dir, "classroom.json"));
  const missionPath = path.join(dir, "MISSION.md");
  const lessons = listLessonDirs(name);

  return {
    name,
    title: meta?.title ?? titleFromSlug(name),
    emoji: meta?.emoji ?? "📚",
    createdAt: meta?.createdAt ?? mtime(dir),
    updatedAt: Math.max(mtime(dir), ...lessons.map((l) => mtime(lessonDir(name, l))), 0),
    mission: isFile(missionPath) ? fs.readFileSync(missionPath, "utf8") : null,
    lessonCount: lessons.filter(
      (l) =>
        !isStoredReview(l) &&
        readJson<LessonMeta>(path.join(lessonDir(name, l), "lesson.json"))?.kind !== "review",
    ).length,
  };
}

export function writeClassroomMeta(name: string, meta: ClassroomMeta): void {
  writeJson(path.join(classroomDir(name), "classroom.json"), meta);
}

/** `rust-ownership` → `Rust Ownership`. Used when classroom.json is absent. */
export function titleFromSlug(slug: string): string {
  return slug
    .replace(/^\d+[-_]/, "")
    .split(/[-_.]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ── Lessons ───────────────────────────────────────────────────────────────────

/**
 * Directory names inside a classroom that actually hold a lesson document.
 *
 * Exported because the by-id lookups below scan every lesson and must not pay for
 * the full `readLesson` (which reads annotations, submissions, and grades per lesson).
 */
export function listLessonDirs(classroom: string): string[] {
  const dir = classroomDir(classroom);
  if (!isDir(dir)) return [];
  // Reason: these are classroom-level, never lessons — skip them before the (more
  // expensive) HTML lookup.
  const reserved = new Set(["reference", "assets", "learning-records", "notes", "quiz"]);
  const reviews = path.join(dir, ".reviews");
  const names = [
    ...fs.readdirSync(dir).filter((name) => !isStoredReview(name)),
    ...(isDir(reviews) ? fs.readdirSync(reviews).filter(isStoredReview) : []),
  ];
  return names.filter(
    (name) =>
      isValidSlug(name) &&
      !reserved.has(name) &&
      isDir(lessonDir(classroom, name)) &&
      resolveLessonHtml(lessonDir(classroom, name)) !== null,
  );
}

/** Every (classroom, lesson) pair on disk, without reading lesson contents. */
export function allLessonRefs(): Array<{ classroom: string; lesson: string }> {
  const refs: Array<{ classroom: string; lesson: string }> = [];
  const root = classroomsRoot();
  if (!isDir(root)) return refs;
  for (const classroom of fs.readdirSync(root)) {
    if (!isValidSlug(classroom) || !isDir(classroomDir(classroom))) continue;
    for (const lesson of listLessonDirs(classroom)) refs.push({ classroom, lesson });
  }
  return refs;
}
