/** Read-only projection of the original key, after server-owned eligibility checks. */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { reviewKey } from "../assets/runtime/quiz.mjs";
import { questionCredit } from "../assets/runtime/grade.mjs";
import { machineGraded } from "./closed-grading.ts";
import { validateCriteria } from "./criteria.ts";
import { classroomDir, lessonDir, lessonUrl, safeStaticFile } from "./paths.ts";
import { authoredQuizzes } from "./quiz-authoring.ts";
import { kindOf } from "./quiz.ts";
import { answerReviewKey, findReviewItem } from "./review.ts";
import { readTeacherState } from "./service-state.ts";
import type { TeacherState } from "./service-state.ts";
import type { RubricQuestion } from "./rubric.ts";
import * as store from "./store.ts";
import { PublicStateError, readPublicState, publicStateError } from "./public-state-errors.ts";

export type ExpectedValue =
  | string
  | string[]
  | Record<string, string | string[]>
  | {
      value: number;
      unit?: string;
      tolerance?: number;
    };
export type ExpectedAnswer =
  | {
      status: "available";
      type: string;
      expected: ExpectedValue;
      full: string;
      partial: string;
      points: number;
      criteria?: { id: string; description: string; points: number }[];
    }
  | { status: "waiting" | "unavailable" | "error"; message: string; panelUrl: string };
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const fullCredit = (question: store.QuizQuestionGrade) => {
  const credit = questionCredit(question);
  return question.correct && credit.earned === credit.possible;
};

/** Follow only durable task identities, never message wording or timestamp proximity. */
function taskAttempt(
  state: TeacherState,
  lesson: string,
  replyTo: string | undefined,
): string | null {
  const seen = new Set<string>();
  while (replyTo && !seen.has(replyTo)) {
    seen.add(replyTo);
    const message = state.messages.find(
      (m) => m.id === replyTo && m.role === "teacher" && m.lesson === lesson,
    );
    const request = state.requests.find(
      (r) => r.id === replyTo && r.lesson === lesson && r.status === "done",
    );
    if (!message || !request) return null;
    if (request.kind === "quiz" || request.kind === "resume") return request.target;
    if (request.kind !== "chat" || request.target.startsWith("reteach:")) return null;
    replyTo = state.messages.find(
      (m) => m.id === request.id && m.role === "learner" && m.lesson === lesson,
    )?.replyTo;
  }
  return null;
}

function corrected(
  submission: store.QuizSubmission,
  questionId: string,
  original: store.QuizGrade,
): boolean {
  const state = readPublicState("teacher task state (.teacher.json)", () =>
    readTeacherState(submission.classroom),
  );
  if (!state) return false;
  const checks = readPublicState("corrective retrieval checks (quiz/retrieval-checks)", () =>
    store.listRetrievalChecks(submission.classroom),
  );
  const items = readPublicState(
    "corrective review evidence and controls (.reviews.json, quiz history, .review-controls.json)",
    () => store.lessonReviewItems(submission.classroom, submission.lesson),
  );
  const missed = submission.answers.filter((a) =>
    original.questions.some((q) => q.questionId === a.questionId && !fullCredit(q)),
  );
  return state.requests.some((request) => {
    if (
      request.kind !== "chat" ||
      request.classroom !== submission.classroom ||
      request.lesson !== submission.lesson ||
      request.status !== "done" ||
      !request.planValidated ||
      !request.recordFile ||
      !request.plan
    )
      return false;
    const reply = state.messages.find(
      (m) => m.id === request.id && m.role === "learner" && m.lesson === submission.lesson,
    );
    if (!reply || taskAttempt(state, submission.lesson, reply.replyTo) !== submission.id)
      return false;
    const record = readPublicState("corrective learning record (learning-records)", () => {
      const file = safeStaticFile(
        classroomDir(submission.classroom),
        `learning-records/${request.recordFile}`,
      );
      if (!file)
        throw new PublicStateError("The original corrective learning record is missing or unsafe.");
      return fs.readFileSync(file, "utf8");
    });
    if (record !== request.plan.learning_record)
      throw new PublicStateError(
        "The corrective learning record changed after validation. Restore the original record and retry explicitly.",
      );
    return request.plan.calls.some((call) => {
      if (call.name !== "record_retrieval_check") return false;
      let args;
      try {
        args = JSON.parse(call.arguments_json);
      } catch {
        throw new PublicStateError(
          "The saved corrective check has corrupt arguments. Its answer cannot be released safely.",
        );
      }
      if (args.classroom !== submission.classroom || args.answer !== reply.text) return false;
      const item = findReviewItem(items, args.review_key);
      if (!item) return false;
      // An objective shared by several missed questions cannot identify which answer was checked.
      const exact = missed.filter(
        (a) =>
          (a.reviewOf ?? reviewKey(submission.lesson, submission.quizId, a.questionId)) ===
          args.review_key,
      );
      const targets = exact.length
        ? exact
        : missed.filter(
            (a) =>
              findReviewItem(
                [item],
                a.reviewOf ?? reviewKey(submission.lesson, submission.quizId, a.questionId),
              ) || findReviewItem([item], answerReviewKey(submission.lesson, submission.quizId, a)),
          );
      if (targets.length !== 1 || targets[0].questionId !== questionId) return false;
      return checks.some(
        (check) =>
          check.key === args.review_key &&
          check.learningRecord === request.recordFile &&
          check.answer === reply.text &&
          check.evidence === args.evidence &&
          check.answeredAt === reply.at,
      );
    });
  });
}

function expectedValue(type: string, entry: RubricQuestion, machine: boolean): ExpectedValue {
  if (machine) machineGraded(type as Parameters<typeof machineGraded>[0], entry);
  const value = entry.expected;
  if (typeof value === "string" && value.trim()) return value;
  if (Array.isArray(value) && value.length && value.every((v) => typeof v === "string" && v.trim()))
    return [...value];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const source = value as Record<string, unknown>;
    if (
      type === "numeric" &&
      typeof source.value === "number" &&
      Number.isFinite(source.value) &&
      (source.unit === undefined || typeof source.unit === "string") &&
      (source.tolerance === undefined ||
        (typeof source.tolerance === "number" &&
          Number.isFinite(source.tolerance) &&
          source.tolerance >= 0))
    ) {
      return {
        value: source.value,
        ...(source.unit === undefined ? {} : { unit: source.unit as string }),
        ...(source.tolerance === undefined ? {} : { tolerance: source.tolerance as number }),
      };
    }
    if (
      ["match", "cloze"].includes(type) &&
      Object.keys(source).length &&
      Object.values(source).every(
        (v) =>
          typeof v === "string" ||
          (Array.isArray(v) && v.length && v.every((a) => typeof a === "string")),
      )
    )
      return Object.fromEntries(
        Object.entries(source).map(([id, v]) => [id, Array.isArray(v) ? [...v] : v]),
      ) as Record<string, string | string[]>;
  }
  throw new PublicStateError(`The original ${type} expected answer has an unsupported format.`);
}

/** Caller must select the current saved attempt. No writes, inference, or schedule effects. */
export function expectedAnswers(submission: store.QuizSubmission): Record<string, ExpectedAnswer> {
  const current = readPublicState("saved quiz attempts and grades", () =>
    store
      .latestQuizStates(submission.classroom, submission.lesson)
      .find((s) => s.quizId === submission.quizId),
  );
  if (current?.submission.id !== submission.id)
    throw new PublicStateError("This saved attempt is stale. Reload the lesson.");
  const panelUrl = `${lessonUrl(submission.classroom, submission.lesson)}#cl-teacher`;
  const history = readPublicState("original quiz grade history", () =>
    store
      .listGrades(submission.classroom, submission.lesson)
      .filter((g) => g.submissionId === submission.id),
  );
  const original = history[0];
  const complete =
    original &&
    original.questions.length === new Set(submission.answers.map((a) => a.questionId)).size &&
    new Set(original.questions.map((q) => q.questionId)).size ===
      new Set(submission.answers.map((a) => a.questionId)).size &&
    submission.answers.every((a) => original.questions.some((q) => q.questionId === a.questionId));
  return Object.fromEntries(
    [...new Map(submission.answers.map((a) => [a.questionId, a])).values()].map((answer) => {
      const unavailable = (
        status: "waiting" | "unavailable" | "error",
        message: string,
      ): [string, ExpectedAnswer] => [answer.questionId, { status, message, panelUrl }];
      if (!complete)
        return unavailable(
          "waiting",
          "The complete grade has not been saved. Expected answers remain private.",
        );
      if (!submission.rubricDigest || !submission.answerSourceDigest)
        return unavailable(
          "unavailable",
          "This historical attempt has no fixed original answer source. Its expected answer cannot be shown safely.",
        );
      try {
        const source = safeStaticFile(
          lessonDir(submission.classroom, submission.lesson),
          "lesson.html",
        );
        if (!source)
          throw new PublicStateError(
            "The original lesson source is missing or unsafe. Restore it and retry explicitly.",
          );
        const html = fs.readFileSync(source, "utf8");
        if (digest(html) !== submission.answerSourceDigest)
          throw new PublicStateError(
            "The lesson source changed after submission. Restore the original source and retry explicitly.",
          );
        const rubric = safeStaticFile(
          lessonDir(submission.classroom, submission.lesson),
          "quiz/key.json",
        );
        if (!rubric)
          throw new PublicStateError(
            "The original private rubric is missing or unsafe. Restore it and retry explicitly.",
          );
        const text = fs.readFileSync(rubric, "utf8");
        if (digest(text) !== submission.rubricDigest)
          throw new PublicStateError(
            "The private rubric changed after submission. Restore the original rubric and retry explicitly.",
          );
        const quizzes = authoredQuizzes(html).filter((q) => q.id === submission.quizId);
        const questions = quizzes[0]?.questions.filter((q) => q.id === answer.questionId);
        if (
          quizzes.length !== 1 ||
          questions?.length !== 1 ||
          questions[0].type !== answer.type ||
          quizzes[0].kind !== kindOf(submission)
        )
          throw new PublicStateError(
            "The original quiz/question identity does not match this attempt.",
          );
        let entry: RubricQuestion;
        try {
          entry = JSON.parse(text)?.[submission.quizId]?.[answer.questionId];
        } catch {
          throw new PublicStateError(
            "The original private rubric is corrupt. Restore it and retry explicitly.",
          );
        }
        if (
          !entry ||
          typeof entry.full !== "string" ||
          typeof entry.partial !== "string" ||
          !entry.full.trim() ||
          !entry.partial.trim() ||
          !Number.isFinite(entry.points) ||
          entry.points <= 0
        )
          throw new PublicStateError("The original private rubric entry is missing or corrupt.");
        if (entry.criteria !== undefined)
          validateCriteria(
            entry.criteria,
            entry.points,
            `${submission.quizId}/${answer.questionId}`,
          );
        const verdict = original.questions.find((q) => q.questionId === answer.questionId)!;
        if (
          kindOf(submission) !== "pretest" &&
          !fullCredit(verdict) &&
          !corrected(submission, answer.questionId, original)
        )
          return unavailable(
            "waiting",
            "A verified corrective reply tied to this attempt and question is not yet saved. Continue with the new question in this lesson’s teacher panel.",
          );
        const expected = expectedValue(answer.type!, entry, submission.assessmentContract === 1);
        return [
          answer.questionId,
          {
            status: "available",
            type: answer.type!,
            expected,
            full: entry.full,
            partial: entry.partial,
            points: entry.points,
            ...(entry.criteria
              ? {
                  criteria: entry.criteria.map(({ id, description, points }) => ({
                    id,
                    description,
                    points,
                  })),
                }
              : {}),
          } satisfies ExpectedAnswer,
        ];
      } catch (error) {
        return unavailable("error", publicStateError(error));
      }
    }),
  );
}
