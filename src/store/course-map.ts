/** Read-only, allowlisted course coverage. Private plans never cross this boundary. */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  classroomsRoot,
  isValidSlug,
  isStoredReview,
  lessonUrl,
  privateStatePath,
} from "../paths.ts";
import { stageLesson } from "../pretest.ts";
import { authoredQuizzes } from "../quiz-authoring.ts";
import { reviewSessions } from "../review-session.ts";
import { parseTeachingPlan } from "../teaching-plan.ts";
import type { TeachingPlan } from "../teaching-plan.ts";
import { orderPrefix, resolveLessonHtml, titleFromSlug } from "./classrooms.ts";
import { latestQuizStates } from "./quiz-history.ts";
import {
  parseMissionCoursePlan,
  renderMission,
  validateMissionConnections,
} from "../mission-map.ts";

type Purpose = TeachingPlan["quizzes"][string]["purpose"];
export interface CourseObjective {
  /** Same identity as review objectives; never merge identical ids across lessons. */
  key: string;
  statement: string;
  quizzes: { id: string; purpose: Purpose }[];
}
export interface CourseLesson {
  name: string;
  title: string;
  url: string;
  gated: boolean;
  missingPlan: boolean;
  objectives: CourseObjective[];
}
export interface CourseMap {
  classroom: { name: string; title: string };
  missionHtml: string | null;
  upcoming: { key: string; statement: string }[];
  connections: { from: string; to: string; kind: "builds-on" | "related" }[];
  lessons: CourseLesson[];
}

/** Errors name the file and failure, never JSON snippets or private plan contents. */
function readText(relative: string, optional = false): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      fs.readFileSync(privateStatePath(relative)),
    );
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === "ENOENT") return null;
    const code = (error as NodeJS.ErrnoException).code;
    const detail =
      code === "ENOENT"
        ? "file is missing"
        : code === "EISDIR"
          ? "expected a file, found a directory"
          : code === "ERR_ENCODING_INVALID_ENCODED_DATA"
            ? "invalid UTF-8 text"
            : (error as Error).message.startsWith("Private state path cannot be a symlink")
              ? "symlinks are not allowed"
              : `cannot read file${code ? ` (${code})` : ""}`;
    throw new Error(`Cannot load ${relative}: ${detail}.`, { cause: error });
  }
}

function readObject(relative: string): Record<string, unknown> | null {
  const text = readText(relative, true);
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Cannot load ${relative}: expected a JSON object.`, { cause: error });
  }
}

function title(meta: Record<string, unknown> | null, fallback: string, file: string): string {
  if (meta?.title === undefined) return fallback;
  if (typeof meta.title !== "string" || !meta.title.trim())
    throw new Error(`Cannot load ${file}: title must be nonempty text.`);
  return meta.title;
}

/** Existing quiz history readers are read-only; guard every file they can traverse first. */
function guardHistory(relative: string): void {
  const file = privateStatePath(relative);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (stat.isDirectory())
    for (const entry of fs.readdirSync(file)) guardHistory(`${relative}/${entry}`);
}

export function readCourseMap(classroom: string): CourseMap | null {
  if (!isValidSlug(classroom)) throw new Error("Invalid classroom for course map.");
  const dir = privateStatePath(classroom);
  try {
    if (!fs.statSync(dir).isDirectory()) return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const meta = readObject(`${classroom}/classroom.json`);
  const mission = readText(`${classroom}/MISSION.md`, true);
  let intentions;
  try {
    intentions = mission === null ? null : parseMissionCoursePlan(mission);
  } catch (error) {
    throw new Error(`Cannot load ${classroom}/MISSION.md: ${(error as Error).message}`, {
      cause: error,
    });
  }
  let pending: Set<string>;
  try {
    pending = new Set(
      reviewSessions(classroom)
        .filter((request) => request.status !== "done")
        .map((r) => r.lesson),
    );
  } catch (error) {
    throw new Error(`Cannot load ${classroom}/.reviews.json: invalid review publication state.`, {
      cause: error,
    });
  }
  const reserved = new Set(["reference", "assets", "learning-records", "notes", "quiz"]);
  const lessons: CourseLesson[] = [];
  const knownObjectives = new Set<string>();
  for (const name of fs.readdirSync(dir).sort()) {
    if (!isValidSlug(name) || reserved.has(name) || isStoredReview(name) || pending.has(name))
      continue;
    const relative = `${classroom}/${name}`;
    const lessonDir = privateStatePath(relative);
    if (!fs.statSync(lessonDir).isDirectory()) continue;
    const lessonMeta = readObject(`${relative}/lesson.json`);
    if (lessonMeta?.kind === "review") continue;
    if (lessonMeta?.kind !== undefined && lessonMeta.kind !== "lesson")
      throw new Error(`Cannot load ${relative}/lesson.json: unknown page kind.`);
    if (lessonMeta?.instructionalContract !== undefined && lessonMeta.instructionalContract !== 1)
      throw new Error(`Cannot load ${relative}/lesson.json: unknown instructional contract.`);
    const htmlPath = resolveLessonHtml(lessonDir);
    if (!htmlPath) continue;
    const html = readText(path.relative(classroomsRoot(), htmlPath))!;
    const planFile = `${relative}/quiz/plan.json`;
    const planText = readText(planFile, lessonMeta?.instructionalContract !== 1);
    let plan: TeachingPlan | null = null;
    if (planText !== null) {
      try {
        plan = parseTeachingPlan(planText, html);
      } catch (error) {
        throw new Error(
          `Cannot load ${planFile}: ${error instanceof SyntaxError ? "invalid JSON" : "teaching plan does not match the lesson contract"}.`,
          { cause: error },
        );
      }
      for (const id of Object.keys(plan.objectives))
        knownObjectives.add(`${name}/@objective/${id}`);
    }
    let staged;
    try {
      staged = stageLesson(html, new Set());
      if (staged.pendingPretests.length) {
        guardHistory(`${relative}/quiz/submissions`);
        guardHistory(`${relative}/quiz/grades`);
        staged = stageLesson(
          html,
          new Set(
            latestQuizStates(classroom, name)
              .filter((state) => state.submission.kind === "pretest" && state.grade)
              .map((state) => state.quizId),
          ),
        );
      }
    } catch (error) {
      throw new Error(`Cannot load ${relative}: invalid pretest gate or saved pretest history.`, {
        cause: error,
      });
    }
    // A gated objective can disclose the very idea the pretest is probing. Withhold
    // all objectives on this page until its gates release, including prequestion mappings.
    const objectives: CourseObjective[] = [];
    if (plan && !staged.pendingPretests.length) {
      const visible = new Set(authoredQuizzes(staged.html).map((q) => q.id));
      for (const [id, objective] of Object.entries(plan.objectives)) {
        const quizzes = Object.entries(plan.quizzes)
          .filter(
            ([quizId, quiz]) =>
              visible.has(quizId) && Object.values(quiz.questions).some((q) => q.objective === id),
          )
          .map(([quizId, quiz]) => ({ id: quizId, purpose: quiz.purpose }));
        if (quizzes.length)
          objectives.push({
            key: `${name}/@objective/${id}`,
            statement: objective.statement,
            quizzes,
          });
      }
    }
    lessons.push({
      name,
      title: title(
        lessonMeta,
        /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim().replace(/\s+/g, " ") ||
          titleFromSlug(name),
        `${relative}/lesson.json`,
      ),
      url: lessonUrl(classroom, name),
      gated: staged.pendingPretests.length > 0,
      missingPlan: plan === null,
      objectives,
    });
  }
  // Use authored lesson numbering, never timestamps as a relationship or evidence.
  lessons.sort(
    (a, b) =>
      (orderPrefix(a.name) ?? Infinity) - (orderPrefix(b.name) ?? Infinity) ||
      a.name.localeCompare(b.name),
  );
  if (intentions) {
    try {
      validateMissionConnections(intentions, knownObjectives);
    } catch (error) {
      throw new Error(`Cannot load ${classroom}/MISSION.md: ${(error as Error).message}`, {
        cause: error,
      });
    }
  }
  const upcoming = (intentions?.upcoming ?? []).map((goal) => ({
    key: `@upcoming/${goal.id}`,
    statement: goal.statement,
  }));
  const visible = new Set([
    ...upcoming.map((goal) => goal.key),
    ...lessons.flatMap((lesson) => lesson.objectives.map((objective) => objective.key)),
  ]);
  return {
    classroom: {
      name: classroom,
      title: title(meta, titleFromSlug(classroom), `${classroom}/classroom.json`),
    },
    missionHtml: mission?.trim() ? renderMission(mission, 2) : null,
    upcoming,
    // Omit whole edges to unreleased objectives: no id, type, label, count or stub.
    connections: (intentions?.connections ?? [])
      .filter((edge) => visible.has(edge.from) && visible.has(edge.to))
      .map((edge) => ({ ...edge })),
    lessons,
  };
}
