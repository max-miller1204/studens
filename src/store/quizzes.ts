import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { gradeClosed } from "../closed-grading.ts";
import { lessonDir, submissionsDir } from "../paths.ts";
import type { QuizKind } from "../quiz.ts";
import { authoredVariants } from "../review-variants.ts";
import { findReviewItem } from "../review.ts";
import { parseRubric } from "../rubric.ts";
import { parseTeachingPlan } from "../teaching-plan.ts";
import { writeJson } from "./json.ts";
import { readLesson } from "./lessons.ts";
import type { QuizSubmission } from "./quiz-history.ts";
import { listSubmissions } from "./quiz-history.ts";
import { reviewItems } from "./review.ts";

export function createSubmission(
  input: Omit<QuizSubmission, "id" | "submittedAt" | "attempt"> & {
    kind: QuizKind;
  },
): QuizSubmission {
  // Reason: "latest submission" is what the page rehydrates from, so the ordering has
  // to be total. Two submissions in the same millisecond would otherwise tie and
  // resolve by random UUID, so nudge past the previous one.
  const previous = listSubmissions(input.classroom, input.lesson);
  const last = previous.length > 0 ? previous[previous.length - 1].submittedAt : 0;
  const submittedAt = Math.max(Date.now(), last + 1);
  const attempt = previous.filter((s) => s.quizId === input.quizId).length + 1;

  const rubric = path.join(lessonDir(input.classroom, input.lesson), "quiz", "key.json");
  const rubricDigest = fs.existsSync(rubric)
    ? createHash("sha256").update(fs.readFileSync(rubric)).digest("hex")
    : undefined;
  const page = readLesson(input.classroom, input.lesson);
  if (page?.reviewVariantContract === 1)
    authoredVariants(
      fs.readFileSync(rubric, "utf8"),
      fs.readFileSync(
        path.join(lessonDir(input.classroom, input.lesson), "quiz/plan.json"),
        "utf8",
      ),
      fs.readFileSync(page.htmlPath, "utf8"),
      true,
    );
  const privateKey =
    page?.assessmentContract === 1
      ? parseRubric(
          fs.readFileSync(rubric, "utf8"),
          fs.readFileSync(page.htmlPath, "utf8"),
          "machine",
          page.criterionContract === 1,
        )
      : undefined;
  const deterministicGrades = privateKey
    ? input.answers.flatMap((answer) => {
        const entry = privateKey[input.quizId]?.[answer.questionId];
        if (!entry) throw new Error(`No rubric for ${input.quizId}/${answer.questionId}.`);
        const grade = gradeClosed(answer, entry);
        return grade ? [grade] : [];
      })
    : undefined;
  const teachingPlan =
    page?.instructionalContract === 1
      ? parseTeachingPlan(
          fs.readFileSync(
            path.join(lessonDir(input.classroom, input.lesson), "quiz", "plan.json"),
            "utf8",
          ),
          fs.readFileSync(page.htmlPath, "utf8"),
        )
      : undefined;
  const answers = input.answers.map((answer) => {
    const { learning: ignored, ...saved } = answer;
    if (!teachingPlan) return saved;
    const q = teachingPlan.quizzes[input.quizId]?.questions[answer.questionId];
    if (!q) throw new Error(`No teaching mapping for ${input.quizId}/${answer.questionId}.`);
    const original = answer.reviewOf
      ? findReviewItem(reviewItems(input.classroom), answer.reviewOf)
      : undefined;
    return {
      ...saved,
      learning: {
        objectiveId: original?.objectiveId ?? q.objective,
        objective: original?.objective ?? teachingPlan.objectives[q.objective],
        task: q.task,
        support: q.support,
        assistance: answer.assistance ?? "unknown",
      },
    };
  });
  const submission: QuizSubmission = {
    ...input,
    answers,
    teachingPlan,
    deterministicGrades,
    rubricCriteria: privateKey
      ? Object.fromEntries(
          input.answers.flatMap((a) => {
            const criteria = privateKey[input.quizId]?.[a.questionId]?.criteria;
            return criteria
              ? [
                  [
                    a.questionId,
                    criteria.map(({ id, description, points }) => ({ id, description, points })),
                  ],
                ]
              : [];
          }),
        )
      : undefined,
    id: randomUUID(),
    attempt,
    submittedAt,
    rubricDigest,
    assessmentContract: readLesson(input.classroom, input.lesson)?.assessmentContract,
    instructionalContract: readLesson(input.classroom, input.lesson)?.instructionalContract,
  };
  // Timestamp-prefixed so the directory listing is chronological.
  const file = path.join(
    submissionsDir(input.classroom, input.lesson),
    `${submission.submittedAt}-${submission.id}.json`,
  );
  writeJson(file, submission);
  return submission;
}

/** Remove private method labels from learner responses and SSE events. */
export function publicSubmission(submission: QuizSubmission): QuizSubmission {
  const {
    rubricCriteria: privateCriteria,
    teachingPlan: privatePlan,
    deterministicGrades: privateGrades,
    ...publicFields
  } = submission;
  return {
    ...publicFields,
    answers: submission.answers.map((answer) => {
      const { learning: privateEvidence, ...publicAnswer } = answer;
      return publicAnswer;
    }),
  };
}
