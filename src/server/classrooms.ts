import * as fs from "node:fs";
import type * as http from "node:http";
import * as path from "node:path";
import { injectLessonRuntime } from "../lesson-html.ts";
import { classroomPage, folderLoadErrorPage, landingPage } from "../pages.ts";
import {
  classroomDir,
  isFile,
  isValidSlug,
  lessonDir,
  runtimeAssetsDir,
  safeStaticFile,
} from "../paths.ts";
import { stageLesson } from "../pretest.ts";
import { reviewSessions } from "../review-session.ts";
import { isDue, summarize } from "../review.ts";
import * as store from "../store.ts";
import { hooks } from "./hooks.ts";
import { sendFile, sendHtml, sendNotFound } from "./http.ts";

export function handleLanding(res: http.ServerResponse, url: URL): void {
  const classrooms = store.listClassrooms();
  const now = Date.now();
  const due = Object.fromEntries(
    classrooms.map((c) => [c.name, summarize(store.reviewItems(c.name), now).due]),
  );
  let folders: store.ClassroomFolder[];
  try {
    folders = store.readClassroomFolders();
  } catch (error) {
    console.error("[classroom] folder load failed", error);
    return sendHtml(
      res,
      folderLoadErrorPage((error as Error).message, url.pathname + url.search),
      500,
    );
  }
  const folderId = url.searchParams.get("folder");
  if (folderId !== null && !folders.some((f) => f.id === folderId))
    return sendNotFound(res, "This folder no longer exists. Return to Classrooms.");
  return sendHtml(res, landingPage(classrooms, due, folders, folderId));
}

const FAVICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">📚</text></svg>';

export function sendFavicon(res: http.ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "image/svg+xml",
    "Cache-Control": "no-store",
  });
  res.end(FAVICON);
}

export function handleStatic(res: http.ServerResponse, rest: string[]): void {
  const file = safeStaticFile(runtimeAssetsDir(), rest.join("/"));
  if (!file || !isFile(file)) return sendNotFound(res, "Asset not found");
  sendFile(res, file);
}

export function handleClassroomRoute(
  res: http.ServerResponse,
  rest: string[],
  baseUrl: string | null,
): void {
  const [name, second, ...tail] = rest;
  if (!isValidSlug(name)) return sendNotFound(res, "Unknown classroom");

  const classroom = store.readClassroom(name);
  if (!classroom) return sendNotFound(res, `Unknown classroom: ${name}`);

  // /c/<classroom>
  if (second === undefined) {
    const now = Date.now();
    const items = store.reviewItems(name);
    const dueByLesson: Record<string, number> = {};
    for (const item of items) {
      if (isDue(item, now)) dueByLesson[item.lesson] = (dueByLesson[item.lesson] ?? 0) + 1;
    }
    const pendingReviews = new Set(
      reviewSessions(name)
        .filter((s) => s.status !== "done")
        .map((s) => s.lesson),
    );
    return sendHtml(
      res,
      classroomPage({
        classroom,
        lessons: store.listLessons(name).filter((l) => !pendingReviews.has(l.name)),
        docs: store.listClassroomDocs(name),
        learningRecords: store.listLearningRecords(name),
        referenceDocs: store.listReferenceDocs(name),
        progress: {
          review: summarize(items, now),
          dueByLesson,
          reteach: items
            .filter((item) => item.needsReteach)
            .map((item) => ({ lesson: item.lesson, prompt: item.prompt })),
          glossaryTerms: store.readGlossary(name).terms.length,
          now,
        },
      }),
    );
  }

  // /c/<classroom>/assets/<path>
  if (second === "assets") {
    const file = safeStaticFile(path.join(classroomDir(name), "assets"), tail.join("/"));
    if (!file || !isFile(file)) return sendNotFound(res, "Asset not found");
    return sendFile(res, file);
  }

  if (!isValidSlug(second)) return sendNotFound(res, "Unknown lesson");
  if (reviewSessions(name).some((s) => s.lesson === second && s.status !== "done"))
    return sendNotFound(res, "This review is not ready. Check its status on the classroom page.");
  const lesson = store.readLesson(name, second);
  if (!lesson) return sendNotFound(res, `Unknown lesson: ${second}`);

  // /c/<classroom>/<lesson>/media/<path> — anything else under the lesson directory
  // is deliberately not served: quiz/ holds submissions and any answer key.
  if (tail.length > 0) {
    if (tail[0] !== "media") return sendNotFound(res, "Not found");
    const file = safeStaticFile(
      path.join(lessonDir(name, second), "media"),
      tail.slice(1).join("/"),
    );
    if (!file || !isFile(file)) return sendNotFound(res, "File not found");
    return sendFile(res, file);
  }

  // /c/<classroom>/<lesson>
  const publicLesson = safeStaticFile(lessonDir(name, second), path.basename(lesson.htmlPath));
  if (!publicLesson) return sendNotFound(res, "Lesson document cannot be a symlink");
  let html: string;
  try {
    html = fs.readFileSync(lesson.htmlPath, "utf8");
  } catch {
    return sendNotFound(res, `Could not read lesson: ${second}`);
  }

  const staged = stageLesson(
    html,
    new Set(
      store
        .latestQuizStates(name, second)
        .filter((state) => state.submission.kind === "pretest" && state.grade)
        .map((state) => state.quizId),
    ),
  );
  sendHtml(
    res,
    injectLessonRuntime(staged.html, {
      classroom: name,
      lesson: second,
      classroomTitle: classroom.title,
      lessonTitle: lesson.title,
      baseUrl: baseUrl ?? "",
      delivery: hooks?.delivery ?? "push",
      pendingPretests: staged.pendingPretests,
    }),
  );
}
