import * as fs from "node:fs";
import * as path from "node:path";
import { validateLessonContractVersions } from "../lesson-contracts.ts";
import { isValidSlug, lessonDir } from "../paths.ts";
import { kindOf } from "../quiz.ts";
import { listAnnotations } from "./annotations.ts";
import type { Lesson, LessonMeta } from "./classrooms.ts";
import { listLessonDirs, orderPrefix, resolveLessonHtml, titleFromSlug } from "./classrooms.ts";
import { mtime, readJson, writeJson } from "./json.ts";
import { latestGrades, listSubmissions } from "./quiz-history.ts";

export function listLessons(classroom: string): Lesson[] {
  if (!isValidSlug(classroom)) return [];
  const lessons = listLessonDirs(classroom)
    .map((name) => readLesson(classroom, name))
    .filter((l): l is Lesson => l !== null);

  return lessons.sort((a, b) => {
    // Numbered lessons lead, in order; unnumbered fall to the back by creation time.
    if (a.order !== null && b.order !== null && a.order !== b.order) return a.order - b.order;
    if (a.order !== null && b.order === null) return -1;
    if (a.order === null && b.order !== null) return 1;
    return a.createdAt - b.createdAt;
  });
}

export function readLesson(classroom: string, lesson: string): Lesson | null {
  if (!isValidSlug(classroom) || !isValidSlug(lesson)) return null;
  const dir = lessonDir(classroom, lesson);
  const htmlPath = resolveLessonHtml(dir);
  if (!htmlPath) return null;

  const meta = readJson<LessonMeta>(path.join(dir, "lesson.json"));
  validateLessonContractVersions(meta, classroom, lesson);
  const grades = latestGrades(classroom, lesson);
  const submissions = listSubmissions(classroom, lesson);
  const gradedIds = new Set(grades.map((g) => g.submissionId));

  // The score shown is the one for the most recent *graded* attempt — not simply the
  // most recent grade file, which could belong to an older submission. A pretest is
  // diagnostic, so it never sets the lesson's score.
  const lastGraded = [...submissions]
    .reverse()
    .find((s) => gradedIds.has(s.id) && kindOf(s) !== "pretest");
  const latestScore = lastGraded
    ? (grades.find((g) => g.submissionId === lastGraded.id)?.score ?? null)
    : null;

  return {
    name: lesson,
    classroom,
    title: meta?.title ?? titleFromHtml(htmlPath) ?? titleFromSlug(lesson),
    summary: meta?.summary ?? "",
    assessmentContract: meta?.assessmentContract,
    criterionContract: meta?.criterionContract,
    instructionalContract: meta?.instructionalContract,
    reviewVariantContract: meta?.reviewVariantContract,
    htmlPath,
    createdAt: meta?.createdAt ?? mtime(htmlPath),
    updatedAt: mtime(htmlPath),
    order: orderPrefix(lesson),
    kind: meta?.kind ?? "lesson",
    annotationCount: listAnnotations(classroom, lesson).length,
    latestScore,
    hasUngradedSubmission: submissions.some((s) => !gradedIds.has(s.id)),
  };
}

export function writeLessonMeta(classroom: string, lesson: string, meta: LessonMeta): void {
  writeJson(path.join(lessonDir(classroom, lesson), "lesson.json"), meta);
}

/** Read a `<title>` out of the lesson document, for lessons with no lesson.json. */
function titleFromHtml(htmlPath: string): string | null {
  const head = fs.readFileSync(htmlPath, "utf8").slice(0, 4096);
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  const title = m?.[1]?.trim();
  return title ? title.replace(/\s+/g, " ") : null;
}
