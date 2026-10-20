/** Derived public read projection. No index files, teacher work or learning-state writes. */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  classroomsRoot,
  isValidSlug,
  isStoredReview,
  lessonUrl,
  privateStatePath,
} from "../paths.ts";
import { parseGlossary } from "../glossary.ts";
import { renderMarkdown, escapeHtml } from "../markdown.ts";
import { searchPassages } from "../search-passages.ts";
import { stageLesson } from "../pretest.ts";
import { lessonRequests } from "./lesson-requests.ts";
import { reviewSessions } from "../review-session.ts";
import { latestQuizStates } from "./quiz-history.ts";
import { resolveLessonHtml, titleFromSlug } from "./classrooms.ts";
import type { Annotation } from "./annotations.ts";

export type SearchKind = "Lesson" | "Question thread" | "Glossary term" | "Learning record";
export interface SearchResult {
  kind: SearchKind;
  classroom: string;
  title: string;
  text: string;
  url: string;
  context?: string;
}
export interface SearchResponse {
  query: string;
  total: number;
  page: number;
  pages: number;
  results: SearchResult[];
  counts: Record<SearchKind, number>;
}
export const SEARCH_PAGE_SIZE = 40;

function failure(relative: string, detail: string): never {
  throw new Error(`Cannot search ${relative}: ${detail}.`);
}
function read(relative: string, optional = false): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      fs.readFileSync(privateStatePath(relative)),
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (optional && code === "ENOENT") return null;
    return failure(
      relative,
      code === "ENOENT"
        ? "file is missing"
        : code === "ERR_ENCODING_INVALID_ENCODED_DATA"
          ? "invalid UTF-8 text"
          : (error as Error).message.includes("symlink")
            ? "symlinks are not allowed"
            : `cannot read file${code ? ` (${code})` : ""}`,
    );
  }
}
function object(relative: string): Record<string, unknown> | null {
  const text = read(relative, true);
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    return failure(relative, "expected a JSON object");
  }
}
function directories(relative: string): string[] {
  try {
    return fs
      .readdirSync(privateStatePath(relative), { withFileTypes: true })
      .filter((e) => {
        if (e.isSymbolicLink() && isValidSlug(e.name))
          failure(`${relative}/${e.name}`, "symlinks are not allowed");
        return e.isDirectory() && isValidSlug(e.name);
      })
      .map((e) => e.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    if ((error as Error).message.startsWith("Cannot search")) throw error;
    return failure(
      relative || "classrooms",
      (error as Error).message.includes("symlink")
        ? "symlinks are not allowed"
        : "cannot list directory",
    );
  }
}
function title(meta: Record<string, unknown> | null, fallback: string, file: string): string {
  if (meta?.title === undefined) return fallback;
  if (typeof meta.title !== "string" || !meta.title.trim())
    return failure(file, "title must be nonempty text");
  return meta.title;
}
/** Only the two flat JSON directories consumed by the existing public pretest projection. */
function guardPretests(relative: string): void {
  for (const kind of ["submissions", "grades"]) {
    const dir = `${relative}/quiz/${kind}`;
    try {
      for (const entry of fs.readdirSync(privateStatePath(dir), { withFileTypes: true })) {
        if (!entry.name.endsWith(".json")) continue;
        privateStatePath(`${dir}/${entry.name}`);
        if (!entry.isFile()) failure(dir, "expected regular JSON files");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        failure(dir, "invalid pretest history or symlink");
    }
  }
}
function stage(classroom: string, lesson: string, html: string): ReturnType<typeof stageLesson> {
  try {
    let staged = stageLesson(html, new Set());
    if (staged.pendingPretests.length) {
      guardPretests(`${classroom}/${lesson}`);
      staged = stageLesson(
        html,
        new Set(
          latestQuizStates(classroom, lesson)
            .filter((s) => s.submission.kind === "pretest" && s.grade)
            .map((s) => s.quizId),
        ),
      );
    }
    return staged;
  } catch {
    return failure(`${classroom}/${lesson}`, "invalid pretest gate or saved history");
  }
}
function threads(relative: string): Annotation[] {
  const file = `${relative}/annotations.json`,
    text = read(file, true);
  if (text === null) return [];
  try {
    const rows: unknown = JSON.parse(text);
    if (!Array.isArray(rows)) throw new Error();
    for (const a of rows) {
      if (
        !a ||
        typeof a !== "object" ||
        typeof a.id !== "string" ||
        !/^[a-f0-9-]{36}$/.test(a.id) ||
        typeof a.question !== "string" ||
        typeof a.selection !== "string" ||
        a.classroom !== relative.split("/")[0] ||
        a.lesson !== relative.split("/").at(-1) ||
        !a.anchor ||
        typeof a.anchor.exact !== "string" ||
        !["pending", "answered", "failed"].includes(a.status) ||
        (a.answerMarkdown !== null && typeof a.answerMarkdown !== "string") ||
        (a.followUps !== undefined &&
          (!Array.isArray(a.followUps) ||
            a.followUps.some((t: unknown) => !t || typeof t !== "object")))
      )
        throw new Error();
    }
    return rows as Annotation[];
  } catch {
    return failure(file, "invalid question thread data");
  }
}
function publicPassages(html: string, file: string) {
  try {
    return searchPassages(html).passages;
  } catch {
    return failure(file, "malformed public content");
  }
}
function projection(): SearchResult[] {
  const results: SearchResult[] = [];
  for (const classroom of directories("")) {
    const cm = `${classroom}/classroom.json`,
      classTitle = title(object(cm), titleFromSlug(classroom), cm);
    let unpublished: Set<string>;
    let publishedReviews: string[];
    try {
      privateStatePath(`${classroom}/.lesson-requests.json`);
      privateStatePath(`${classroom}/.reviews.json`);
      const reviews = reviewSessions(classroom);
      publishedReviews = reviews
        .filter((r) => r.status === "done" && isStoredReview(r.lesson))
        .map((r) => r.lesson)
        .sort();
      unpublished = new Set(
        [...lessonRequests(classroom), ...reviews]
          .filter((r) => r.status !== "done")
          .map((r) => r.lesson),
      );
    } catch {
      return failure(classroom, "invalid lesson or review publication state");
    }
    const reserved = new Set(["reference", "assets", "learning-records", "notes", "quiz"]);
    for (const lesson of [...directories(classroom), ...publishedReviews]) {
      if (reserved.has(lesson) || unpublished.has(lesson)) continue;
      const relative = `${classroom}/${isStoredReview(lesson) ? ".reviews/" : ""}${lesson}`,
        meta = object(`${relative}/lesson.json`);
      if (meta?.kind !== undefined && meta.kind !== "lesson" && meta.kind !== "review")
        failure(`${relative}/lesson.json`, "unknown page kind");
      const htmlFile = resolveLessonHtml(privateStatePath(relative));
      if (!htmlFile) continue;
      const file = path.relative(classroomsRoot(), htmlFile),
        html = read(file)!;
      const staged = stage(classroom, lesson, html),
        passages = publicPassages(staged.html, file);
      const lessonTitle = title(meta, titleFromSlug(lesson), `${relative}/lesson.json`),
        url = lessonUrl(classroom, lesson);
      for (const p of passages)
        results.push({
          kind: "Lesson",
          classroom: classTitle,
          title: lessonTitle,
          text: p.text,
          url: `${url}#${p.id}`,
        });
      // Existing public cards are preserved, including orphaned questions. Withhold all
      // cards while gated: a saved quote/reply may itself contain unreleased teaching.
      if (!staged.pendingPretests.length)
        for (const a of threads(relative)) {
          const turns = [a, ...(a.followUps ?? [])];
          if (
            turns.some(
              (t) =>
                typeof t.question !== "string" ||
                (t.answerMarkdown !== null && typeof t.answerMarkdown !== "string"),
            )
          )
            failure(`${relative}/annotations.json`, "invalid question thread turn");
          const text = turns
            .map((t) =>
              [
                t.question,
                ...publicPassages(
                  renderMarkdown(t.answerMarkdown ?? ""),
                  `${relative}/annotations.json`,
                ).map((p) => p.text),
              ].join(" "),
            )
            .join(" ");
          results.push({
            kind: "Question thread",
            classroom: classTitle,
            title: a.question,
            text,
            url: `${url}#cl-question-${a.id}`,
            context: passages.some((p) => p.text.includes(a.anchor.exact))
              ? undefined
              : "Saved question card; its original passage may have changed or been removed.",
          });
        }
    }
    const glossaryFile = `${classroom}/GLOSSARY.md`,
      glossaryText = read(glossaryFile, true);
    if (glossaryText !== null) {
      const glossary = parseGlossary(glossaryText);
      if (glossary.errors.length)
        failure(
          glossaryFile,
          `invalid glossary format (${glossary.errors.length} errors; correct the term entries)`,
        );
      for (const term of glossary.terms) {
        const text = publicPassages(
          `<p><strong>${escapeHtml(term.term)}</strong>: ${escapeHtml(term.definition)}</p>`,
          glossaryFile,
        )
          .map((p) => p.text)
          .join(" ");
        const anchor = publicPassages(
          `<p><strong>${escapeHtml(term.term)}</strong>: ${escapeHtml(term.definition)}</p>`,
          glossaryFile,
        )[0];
        results.push({
          kind: "Glossary term",
          classroom: classTitle,
          title: term.term,
          text,
          url: `/search/source?classroom=${encodeURIComponent(classroom)}&type=glossary&term=${encodeURIComponent(term.term)}${anchor ? `#${anchor.id}` : ""}`,
        });
      }
    }
    const recordDir = `${classroom}/learning-records`;
    let files: string[];
    try {
      files = fs
        .readdirSync(privateStatePath(recordDir))
        .filter((f) => f.endsWith(".md") && !/[\\/]/.test(f))
        .sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") files = [];
      else
        return failure(
          recordDir,
          (error as Error).message.includes("symlink")
            ? "symlinks are not allowed"
            : "cannot read learning records directory",
        );
    }
    for (const file of files) {
      const relative = `${recordDir}/${file}`,
        md = read(relative)!;
      for (const p of publicPassages(renderMarkdown(md), relative))
        results.push({
          kind: "Learning record",
          classroom: classTitle,
          title: file,
          text: p.text,
          url: `/doc/${encodeURIComponent(classroom)}/learning-records/${encodeURIComponent(file)}#${p.id}`,
        });
    }
  }
  return results;
}
export function searchClassrooms(raw: string, page = 1): SearchResponse {
  const query = raw.trim().normalize("NFC");
  if (query.length > 200) throw new Error("Search query must be 200 characters or fewer.");
  const counts: Record<SearchKind, number> = {
    Lesson: 0,
    "Question thread": 0,
    "Glossary term": 0,
    "Learning record": 0,
  };
  if (!query) return { query, total: 0, page: 1, pages: 0, results: [], counts };
  const needle = query.toLowerCase();
  const matches = projection().filter((r) =>
    (r.text + " " + r.title).normalize("NFC").toLowerCase().includes(needle),
  );
  for (const r of matches) counts[r.kind]++;
  const pages = Math.ceil(matches.length / SEARCH_PAGE_SIZE);
  page = Math.max(1, Math.min(Number.isSafeInteger(page) ? page : 1, pages || 1));
  return {
    query,
    total: matches.length,
    page,
    pages,
    results: matches.slice((page - 1) * SEARCH_PAGE_SIZE, page * SEARCH_PAGE_SIZE),
    counts,
  };
}
/** Public accepted term view uses exactly the parser output searched above. */
export function searchGlossarySource(classroom: string, term: string): string | null {
  if (!isValidSlug(classroom)) return null;
  const file = `${classroom}/GLOSSARY.md`,
    text = read(file, true);
  if (text === null) return null;
  const glossary = parseGlossary(text);
  if (glossary.errors.length) failure(file, "invalid glossary format");
  const entry = glossary.terms.find((t) => t.term === term);
  return entry
    ? `<p><strong>${escapeHtml(entry.term)}</strong>: ${escapeHtml(entry.definition)}</p>`
    : null;
}
