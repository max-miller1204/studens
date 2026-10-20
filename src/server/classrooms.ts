import * as fs from "node:fs";
import type * as http from "node:http";
import * as path from "node:path";
import { injectLessonRuntime } from "../lesson-html.ts";
import {
  classroomPage,
  settingsPage,
  reviewHistoryPage,
  reviewLoadErrorPage,
  folderLoadErrorPage,
  landingPage,
} from "../pages.ts";
import {
  classroomDir,
  isFile,
  isValidSlug,
  lessonDir,
  isStoredReview,
  runtimeAssetsDir,
  safeStaticFile,
} from "../paths.ts";
import { authoredQuizzes } from "../quiz-authoring.ts";
import { stageLesson } from "../pretest.ts";
import { reviewSessions } from "../review-session.ts";
import { dailyDue } from "../store/daily-review.ts";
import { isDue, summarize } from "../review.ts";
import * as store from "../store.ts";
import { hooks } from "./hooks.ts";
import { sendFile, sendHtml, sendNotFound } from "./http.ts";
import { handleCourseMap } from "./course-map.ts";

export function handleLanding(res: http.ServerResponse, url: URL): void {
  const classrooms = store.listClassrooms();
  let due: Record<string, number>;
  try {
    due = dailyDue();
  } catch (error) {
    return sendHtml(
      res,
      reviewLoadErrorPage((error as Error).message, url.pathname + url.search),
      500,
    );
  }
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
  const [name] = rest;
  let [, second, ...tail] = rest;
  if (!isValidSlug(name)) return sendNotFound(res, "Unknown classroom");

  // This read-only projection guards files before discovery or metadata reads.
  if (second === "course-map" && !tail.length) return handleCourseMap(res, name);

  const classroom = store.readClassroom(name);
  if (!classroom) return sendNotFound(res, `Unknown classroom: ${name}`);

  // /c/<classroom>
  if (second === undefined) {
    const now = Date.now();
    let items;
    try {
      items = store.reviewItems(name);
    } catch (error) {
      return sendHtml(
        res,
        reviewLoadErrorPage((error as Error).message, `/c/${encodeURIComponent(name)}`),
        500,
      );
    }
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
            .filter((item) => item.needsReteach && item.retiredAt === undefined)
            .map((item) => ({ lesson: item.lesson, prompt: item.prompt })),
          items,
          glossaryTerms: store.readGlossary(name).terms.length,
          now,
        },
      }),
    );
  }

  if (second === "settings" && !tail.length) return sendHtml(res, settingsPage(classroom));

  // Review history is public; its documents and quiz state use the guarded routes below.
  if (second === "reviews") {
    if (!tail.length) {
      const pending = new Set(
        reviewSessions(name)
          .filter((s) => s.status !== "done")
          .map((s) => s.lesson),
      );
      return sendHtml(
        res,
        reviewHistoryPage(
          classroom,
          store
            .listLessons(name)
            .filter((lesson) => lesson.kind === "review" && !pending.has(lesson.name))
            .map((lesson) => ({
              ...lesson,
              answered: store
                .latestQuizStates(name, lesson.name)
                .filter((state) => state.grade)
                .reduce(
                  (sum, state) =>
                    sum + new Set(state.submission.answers.map((answer) => answer.questionId)).size,
                  0,
                ),
              questionCount: authoredQuizzes(fs.readFileSync(lesson.htmlPath, "utf8")).flatMap(
                (quiz) => quiz.questions,
              ).length,
            })),
        ),
      );
    }
    second = tail[0];
    tail = tail.slice(1);
    if (!isStoredReview(second)) return sendNotFound(res, "Unknown review");
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
    if (
      !file ||
      !safeStaticFile(classroomDir(name), path.relative(classroomDir(name), file)) ||
      !isFile(file)
    )
      return sendNotFound(res, "File not found");
    return sendFile(res, file);
  }

  // /c/<classroom>/<lesson>
  const publicLesson = safeStaticFile(
    classroomDir(name),
    path.relative(classroomDir(name), lesson.htmlPath),
  );
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
      reviewScreen: isStoredReview(second),
    }),
  );
}
