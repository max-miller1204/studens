/** Read-only navigation from saved author declarations. No inference or learner evidence. */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  classroomsRoot,
  isValidSlug,
  isStoredReview,
  lessonUrl,
  privateStatePath,
} from "../paths.ts";
import { teachingSources } from "../lesson-sources.ts";
import { stageLesson } from "../pretest.ts";
import { escapeHtml } from "../markdown.ts";
import { resolveLessonHtml, titleFromSlug, orderPrefix } from "./classrooms.ts";
import { lessonRequests } from "./lesson-requests.ts";
import { reviewSessions } from "../review-session.ts";
import { latestQuizStates } from "./quiz-history.ts";
import { readCourseMap } from "./course-map.ts";
import type { Glossary, TeachingOrigin } from "../glossary.ts";

export interface PrerequisiteLinks {
  links: { title: string; url: string }[];
  error?: string;
}
const reserved = new Set(["reference", "assets", "learning-records", "notes", "quiz"]);
function read(relative: string, optional = false): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      fs.readFileSync(privateStatePath(relative)),
    );
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(
      `Cannot load teaching sources: ${relative} is missing, unreadable or unsafe. Correct the saved file, then retry.`,
      { cause: error },
    );
  }
}
/** All origin metadata stays private until a unique, visible section is selected. */
export function glossaryWithOrigins(classroom: string, glossary: Glossary): Glossary {
  if (!isValidSlug(classroom)) throw new Error("Invalid classroom for teaching sources.");
  const found = new Map<string, { title: string; url: string }[]>();
  let failure: string | undefined;
  try {
    for (const file of [".lesson-requests.json", ".reviews.json"])
      privateStatePath(`${classroom}/${file}`);
    const pending = new Set([
      ...lessonRequests(classroom)
        .filter((r) => r.status !== "done")
        .map((r) => r.lesson),
      ...reviewSessions(classroom)
        .filter((r) => r.status !== "done")
        .map((r) => r.lesson),
    ]);
    for (const entry of fs.readdirSync(privateStatePath(classroom), { withFileTypes: true })) {
      const name = entry.name;
      if (!isValidSlug(name) || reserved.has(name) || isStoredReview(name) || pending.has(name))
        continue;
      const relative = `${classroom}/${name}`;
      privateStatePath(relative);
      if (!entry.isDirectory()) continue;
      const metaText = read(`${relative}/lesson.json`, true);
      let meta: Record<string, unknown> | null = null;
      if (metaText !== null) {
        try {
          meta = JSON.parse(metaText);
          if (!meta || typeof meta !== "object" || Array.isArray(meta)) throw new Error();
        } catch {
          throw new Error(
            `Cannot load teaching sources: ${relative}/lesson.json needs a JSON object. Correct the saved file, then retry.`,
          );
        }
      }
      if (meta?.kind === "review") continue;
      if (meta?.kind !== undefined && meta.kind !== "lesson")
        throw new Error(
          `Cannot load teaching sources: ${relative}/lesson.json has an unknown page kind.`,
        );
      const file = resolveLessonHtml(privateStatePath(relative));
      if (!file) continue;
      const html = read(path.relative(classroomsRoot(), file))!;
      let declarations;
      try {
        declarations = teachingSources(html);
      } catch {
        throw new Error(
          `Cannot load teaching sources: ${relative}/${path.basename(file)} has an invalid teaching-origin declaration. Correct it, then retry.`,
        );
      }
      if (!declarations.length) continue;
      let staged = stageLesson(html, new Set());
      if (staged.pendingPretests.length) {
        for (const kind of ["submissions", "grades"]) {
          const history = `${relative}/quiz/${kind}`;
          try {
            for (const file of fs.readdirSync(privateStatePath(history)))
              if (file.endsWith(".json")) privateStatePath(`${history}/${file}`);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT")
              throw new Error(
                `Cannot load teaching sources: ${relative} has unsafe pretest history.`,
              );
          }
        }
        staged = stageLesson(
          html,
          new Set(
            latestQuizStates(classroom, name)
              .filter((s) => s.submission.kind === "pretest" && s.grade)
              .map((s) => s.quizId),
          ),
        );
      }
      // An unreleased lesson exposes no association, section, title or source count.
      if (staged.pendingPretests.length) continue;
      const visible = teachingSources(staged.html);
      const title = meta?.title === undefined ? titleFromSlug(name) : meta.title;
      if (typeof title !== "string" || !title.trim())
        throw new Error(`Cannot load teaching sources: ${relative}/lesson.json needs a title.`);
      for (const source of visible) {
        const key = source.term.normalize("NFC").toLowerCase();
        found.set(key, [
          ...(found.get(key) ?? []),
          { title, url: lessonUrl(classroom, name) + "#" + encodeURIComponent(source.anchor) },
        ]);
      }
    }
  } catch (error) {
    failure = (error as Error).message.startsWith("Cannot load teaching sources:")
      ? (error as Error).message
      : "Cannot load teaching sources: saved source or publication state is unreadable. Correct it, then retry.";
  }
  return {
    ...glossary,
    terms: glossary.terms.map((term) => {
      const candidates = found.get(term.term.normalize("NFC").toLowerCase()) ?? [];
      const origin: TeachingOrigin = failure
        ? { status: "error", message: failure }
        : candidates.length === 1
          ? { status: "available", ...candidates[0] }
          : {
              status: "unavailable",
              message:
                candidates.length > 1
                  ? "More than one lesson declares this teaching origin. Ask your teacher to resolve the source."
                  : "No available teaching origin is recorded. Older, removed or unreleased teaching may have no link.",
            };
      return { ...term, origin };
    }),
  };
}
export function originHtml(origin: TeachingOrigin, retryUrl: string): string {
  return origin.status === "available"
    ? `<p class="cl-term-origin">Taught in <a href="${escapeHtml(origin.url)}">${escapeHtml(origin.title)}</a></p>`
    : `<p class="cl-term-origin"${origin.status === "error" ? ' role="alert"' : ""}>${escapeHtml(origin.message)}</p>${origin.status === "error" ? `<p><a href="${escapeHtml(retryUrl)}">Retry loading teaching sources</a></p>` : ""}`;
}
/** Builds-on is a saved course intention, never a claim about retention or term origin. */
export function lessonPrerequisites(classroom: string, lesson: string): PrerequisiteLinks {
  if (!isValidSlug(classroom) || !isValidSlug(lesson) || isStoredReview(lesson))
    return { links: [] };
  try {
    const mission = read(`${classroom}/MISSION.md`, true);
    if (!mission) return { links: [] };
    const map = readCourseMap(classroom);
    if (!map) return { links: [] };
    const owner = map.lessons.find((l) => l.name === lesson);
    if (!owner || owner.gated) return { links: [] };
    const sources = new Set(owner.objectives.map((o) => o.key));
    const targets = new Set(
      map.connections.filter((e) => e.kind === "builds-on" && sources.has(e.from)).map((e) => e.to),
    );
    const order = orderPrefix(lesson);
    return {
      links: map.lessons
        .filter(
          (l) =>
            l.name !== lesson &&
            !l.gated &&
            l.objectives.some((o) => targets.has(o.key)) &&
            (order === null || orderPrefix(l.name) === null || orderPrefix(l.name)! < order),
        )
        .map((l) => {
          const objectives = l.objectives.filter((o) => targets.has(o.key));
          const anchors = new Set(objectives.map((o) => o.teaching));
          const teaching = anchors.size === 1 ? [...anchors][0] : undefined;
          return {
            title: l.title,
            url: l.url + (teaching ? "#" + encodeURIComponent(teaching) : ""),
          };
        }),
    };
  } catch (error) {
    return { links: [], error: (error as Error).message };
  }
}
