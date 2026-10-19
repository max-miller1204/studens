import * as fs from "node:fs";
import type * as http from "node:http";
import * as path from "node:path";
import { isContractId, isQuizKind } from "../../assets/runtime/quiz.mjs";
import { isValidSlug, lessonDir, isStoredReview } from "../paths.ts";
import { stageLesson } from "../pretest.ts";
import { authoredQuizzes } from "../quiz-authoring.ts";
import { completeClosedSubmission } from "../quiz-grading.ts";
import { AnswerError, parseAnswers } from "../quiz.ts";
import { reviewSessions } from "../review-session.ts";
import { parseRubric } from "../rubric.ts";
import * as store from "../store.ts";
import { parseTeachingPlan } from "../teaching-plan.ts";
import { hooks } from "./hooks.ts";
import { readJsonBody, sendJson } from "./http.ts";

export async function handleQuizSubmit(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = (await readJsonBody(req)) as Record<string, unknown>;
  } catch (err) {
    return sendJson(res, { error: (err as Error).message }, 400);
  }

  const classroom = String(body["classroom"] ?? "");
  const lesson = String(body["lesson"] ?? "");
  if (!isValidSlug(classroom) || !isValidSlug(lesson)) {
    return sendJson(res, { error: "Unknown classroom or lesson" }, 400);
  }
  if (!store.readLesson(classroom, lesson)) return sendJson(res, { error: "Unknown lesson" }, 404);

  const quizId = body["quizId"];
  if (!isContractId(quizId)) return sendJson(res, { error: "A valid quizId is required" }, 400);
  const page = store.readLesson(classroom, lesson)!;
  const staged = stageLesson(
    fs.readFileSync(page.htmlPath, "utf8"),
    new Set(
      store
        .latestQuizStates(classroom, lesson)
        .filter((s) => s.submission.kind === "pretest" && s.grade)
        .map((s) => s.quizId),
    ),
  );
  if (staged.lockedQuizIds.includes(quizId))
    return sendJson(res, { error: "Complete the pretest before submitting this quiz" }, 409);
  const kind = body["kind"];
  if (!isQuizKind(kind)) {
    return sendJson(res, { error: `Unknown quiz kind: ${JSON.stringify(kind)}` }, 400);
  }

  let answers: store.QuizAnswer[];
  try {
    answers = parseAnswers(body["answers"], kind);
  } catch (err) {
    if (err instanceof AnswerError) return sendJson(res, { error: err.message }, 400);
    throw err;
  }

  if (page.assessmentContract === 1) {
    try {
      const html = fs.readFileSync(page.htmlPath, "utf8");
      const quizzes = authoredQuizzes(html).filter((q) => q.id === quizId);
      if (quizzes.length !== 1) throw new Error("Submit an authored quiz id exactly once.");
      const authored = quizzes[0];
      if (kind !== authored.kind)
        throw new Error("Quiz kind does not match the authored assessment.");
      if (
        answers.length !== authored.questions.length ||
        new Set(authored.questions.map((q) => q.id)).size !== authored.questions.length
      )
        throw new Error("Answer every authored question exactly once.");
      for (const question of authored.questions) {
        const answer = answers.find((a) => a.questionId === question.id);
        if (!answer || answer.type !== question.type)
          throw new Error(`Answer type or id does not match authored question ${question.id}.`);
        if (kind === "review" && answer.reviewOf !== question.reviewOf)
          throw new Error(`Review identity does not match authored question ${question.id}.`);
      }
      if (page.instructionalContract === 1)
        parseTeachingPlan(
          fs.readFileSync(path.join(lessonDir(classroom, lesson), "quiz", "plan.json"), "utf8"),
          html,
        );
      parseRubric(
        fs.readFileSync(path.join(lessonDir(classroom, lesson), "quiz", "key.json"), "utf8"),
        html,
        "machine",
        page.criterionContract === 1,
      );
    } catch (err) {
      return sendJson(
        res,
        { error: `Invalid assessment contract: ${(err as Error).message}` },
        400,
      );
    }
  }

  if (isStoredReview(lesson)) {
    const quizzes = authoredQuizzes(fs.readFileSync(page.htmlPath, "utf8"));
    const index = quizzes.findIndex((quiz) => quiz.id === quizId);
    const states = store.latestQuizStates(classroom, lesson);
    if (
      quizzes
        .slice(0, index)
        .some((quiz) => !states.some((state) => state.quizId === quiz.id && state.grade))
    )
      return sendJson(res, { error: "Grade the previous review card first." }, 409);
  }

  // A review question must name an item the learner was graded on before. Otherwise
  // its grade would start a schedule for an item that does not exist.
  if (kind === "review") {
    const known = new Set(
      store.reviewItems(classroom).flatMap((item) => [item.key, ...(item.questionKeys ?? [])]),
    );
    const unknown = answers.filter((a) => !known.has(a.reviewOf!)).map((a) => a.reviewOf);
    if (unknown.length > 0) {
      return sendJson(
        res,
        {
          error: `data-review-of names no graded question: ${unknown.join(", ")}`,
        },
        400,
      );
    }
  }

  // Reason: a retake is a new attempt at a graded quiz. While the last attempt waits on
  // the teacher, a second one would only reach them as a duplicate.
  const latest = store.latestQuizStates(classroom, lesson).find((q) => q.quizId === quizId);
  if (latest?.grade && isStoredReview(lesson))
    return sendJson(res, { error: "This review card is already graded." }, 409);
  if (latest && !latest.grade) {
    return sendJson(res, { error: "The last attempt at this quiz is not graded yet" }, 409);
  }

  hooks?.canAccept?.(classroom);
  if (reviewSessions(classroom).some((s) => s.lesson === lesson && s.status !== "done"))
    return sendJson(res, { error: "This review is not ready." }, 409);
  let submission: store.QuizSubmission;
  try {
    submission = store.createSubmission({
      classroom,
      lesson,
      quizId,
      quizTitle: String(body["quizTitle"] ?? "Check on learning").slice(0, 200),
      kind,
      answers,
    });
  } catch (err) {
    return sendJson(res, { error: `Invalid assessment contract: ${(err as Error).message}` }, 400);
  }
  store.clearDraft(classroom, lesson, `quiz:${quizId}`);

  if (!completeClosedSubmission(submission)) hooks?.onQuizSubmit(submission);
  sendJson(res, store.publicSubmission(submission), 201);
}
