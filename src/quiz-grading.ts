/** Persist grades through one shared path for every host. */
import { gradeScore, validateGrade } from "../assets/runtime/grade.mjs";
import { renderMarkdown } from "./markdown.ts";
import * as server from "./server.ts";
import * as store from "./store.ts";

/** Finish a saved closed submission without a model turn or a second grade revision. */
export function completeClosedSubmission(submission: store.QuizSubmission): boolean {
  const questions = submission.deterministicGrades;
  if (!questions?.length || questions.length !== submission.answers.length) return false;
  if (
    !store
      .latestGrades(submission.classroom, submission.lesson)
      .some((g) => g.submissionId === submission.id)
  )
    applyGrade(submission, {
      score: gradeScore(questions),
      feedbackMarkdown: "Graded against the private answer key.",
      questions,
    });
  return true;
}

/** Persist a grade and push it to any browser watching the lesson. */
export function applyGrade(
  submission: store.QuizSubmission,
  input: {
    score: number;
    feedbackMarkdown: string;
    questions: store.QuizQuestionGrade[];
  },
): store.QuizGrade {
  const score = validateGrade(input.score, input.questions, [
    ...new Set(submission.answers.map((a) => a.questionId)),
  ]);
  const grade: store.QuizGrade = {
    submissionId: submission.id,
    classroom: submission.classroom,
    lesson: submission.lesson,
    quizId: submission.quizId,
    score,
    feedbackMarkdown: input.feedbackMarkdown,
    feedbackHtml: renderMarkdown(input.feedbackMarkdown),
    questions: input.questions.map((q) => ({
      questionId: q.questionId,
      correct: q.correct,
      pointsEarned: q.pointsEarned,
      pointsPossible: q.pointsPossible,
      feedback: q.feedback,
      feedbackHtml: renderMarkdown(q.feedback),
    })),
    gradedAt: Date.now(),
  };

  store.writeGrade(grade);
  server.pushEvent(submission.classroom, submission.lesson, "grade", {
    submission: store.publicSubmission(submission),
    grade,
  });
  server.gradeSaved(submission);
  return grade;
}
