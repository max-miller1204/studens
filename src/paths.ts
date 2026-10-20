import { StateReadError } from "./state-errors.ts";
/**
 * paths.ts — canonical on-disk locations for classrooms, plus the slug validation
 * and traversal guards every HTTP route depends on.
 *
 * Canonical root: ~/.pi/agent/classrooms/
 * Override with PI_CLASSROOMS_DIR (tests, and anyone who wants their material elsewhere).
 *
 *   <root>/<classroom>/
 *     classroom.json  MISSION.md  RESOURCES.md  GLOSSARY.md  NOTES.md
 *     learning-records/NNNN-slug.md
 *     reference/*.html
 *     assets/*
 *     <lesson>/
 *       lesson.html  lesson.json  annotations.json
 *       quiz/submissions/<id>.json
 *       quiz/grades/<id>.json
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Mutable so tests can point the whole extension at a temp directory.
let baseDir: string =
  process.env["PI_CLASSROOMS_DIR"] ?? path.join(os.homedir(), ".pi", "agent", "classrooms");

/** Root directory holding every classroom. */
export function classroomsRoot(): string {
  return baseDir;
}

/** Override the classrooms root. Intended for tests. */
export function _overrideClassroomsDir(dir: string): void {
  baseDir = dir;
}

// ── Slugs ─────────────────────────────────────────────────────────────────────

/**
 * Directory names we are willing to touch: lowercase kebab-case, optionally with a
 * numeric ordering prefix (`001-closures`). Deliberately strict — this is the only
 * thing standing between a URL path segment and the filesystem.
 */
const SLUG_RE = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;

export function isValidSlug(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= 128 && SLUG_RE.test(value)
  );
}

/** Turn arbitrary user/model text into a usable directory name. */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    // Drop the combining marks NFKD just split off, so "café" slugs to "cafe"
    // rather than "cafe-".
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return slug || "classroom";
}

// ── Directory helpers ─────────────────────────────────────────────────────────

export function classroomDir(classroom: string): string {
  return path.join(baseDir, classroom);
}

/** New review identities resolve privately; numbered legacy reviews keep their paths. */
export function isStoredReview(lesson: string): boolean {
  return /^review-[a-f0-9-]{36}$/.test(lesson);
}

export function lessonDir(classroom: string, lesson: string): string {
  return isStoredReview(lesson)
    ? path.join(baseDir, classroom, ".reviews", lesson)
    : path.join(baseDir, classroom, lesson);
}

export function lessonUrl(classroom: string, lesson: string): string {
  const root = `/c/${encodeURIComponent(classroom)}`;
  return `${root}/${isStoredReview(lesson) ? "reviews/" : ""}${encodeURIComponent(lesson)}`;
}

export function quizDir(classroom: string, lesson: string): string {
  return path.join(lessonDir(classroom, lesson), "quiz");
}

export function submissionsDir(classroom: string, lesson: string): string {
  return path.join(quizDir(classroom, lesson), "submissions");
}

export function gradesDir(classroom: string, lesson: string): string {
  return path.join(quizDir(classroom, lesson), "grades");
}

export function annotationsFile(classroom: string, lesson: string): string {
  return path.join(lessonDir(classroom, lesson), "annotations.json");
}

/** Learner-owned marks are private and never enter the teacher question inbox. */
export function learnerMarksFile(classroom: string, lesson: string): string {
  if (!isValidSlug(classroom) || !isValidSlug(lesson))
    throw new Error("Invalid learner marks classroom or lesson.");
  return privateStatePath(
    path.relative(classroomsRoot(), path.join(lessonDir(classroom, lesson), ".learner-marks.json")),
  );
}

export function reflectionsFile(classroom: string, lesson: string): string {
  return path.join(lessonDir(classroom, lesson), "reflections.json");
}

export function draftsFile(classroom: string, lesson: string): string {
  return path.join(lessonDir(classroom, lesson), "drafts.json");
}

/** The teacher panel conversation in Pi. The service keeps its own in `.teacher.json`. */
/**
 * Extension-bundled assets (runtime JS/CSS, lesson templates, docs).
 *
 * Resolved from import.meta.url, not cwd — the extension is installed outside the
 * user's project and `pi install` may place it anywhere.
 */
const extensionRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export function packageRoot(): string {
  return extensionRoot;
}

export function assetsDir(): string {
  return path.join(extensionRoot, "assets");
}

export function runtimeAssetsDir(): string {
  return path.join(assetsDir(), "runtime");
}

export function templatesDir(): string {
  return path.join(assetsDir(), "templates");
}

export function docsDir(): string {
  return path.join(extensionRoot, "docs");
}

// ── Traversal guard ───────────────────────────────────────────────────────────

/**
 * Resolve `relative` beneath `root`, returning null when the result escapes.
 *
 * Reason: static file routes take a URL tail straight from the browser. Rejecting
 * on the *resolved* path (rather than string-matching "..") also catches absolute
 * paths, encoded separators, and symlink-free edge cases in one check.
 */
export function safeJoin(root: string, relative: string): string | null {
  if (relative.includes("\0")) return null;
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relative);
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) return null;
  return target;
}

/** Public routes must not follow symlinks into private classroom files. */
export function safeStaticFile(root: string, relative: string): string | null {
  const target = safeJoin(root, relative);
  if (!target) return null;
  let current = path.resolve(root);
  const segments = path.relative(current, target).split(path.sep).filter(Boolean);
  try {
    if (fs.lstatSync(current).isSymbolicLink()) return null;
    for (const segment of segments) {
      current = path.join(current, segment);
      if (fs.lstatSync(current).isSymbolicLink()) return null;
    }
  } catch (err) {
    if (["ENOENT", "ENOTDIR"].includes((err as NodeJS.ErrnoException).code ?? "")) return null;
    throw err;
  }
  return target;
}

/** Whether a path exists and is a directory. */
export function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch (err) {
    if (["ENOENT", "ENOTDIR"].includes((err as NodeJS.ErrnoException).code ?? "")) return false;
    throw err;
  }
}

/** Whether a path exists and is a regular file. */
export function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch (err) {
    if (["ENOENT", "ENOTDIR"].includes((err as NodeJS.ErrnoException).code ?? "")) return false;
    throw err;
  }
}

/** Guard private state reads/writes, including existing symlink ancestors. */
export function privateStatePath(relative: string): string {
  const target = safeJoin(classroomsRoot(), relative);
  if (!target) throw new Error("Private state path leaves the classrooms root.");
  let current = path.parse(target).root;
  for (const segment of target.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink())
        throw new StateReadError(`Private state path cannot be a symlink: ${current}.`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return target;
}
