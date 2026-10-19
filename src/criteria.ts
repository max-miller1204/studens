/** Bind criterion allocations to definitions saved before submission. */
import { isContractId } from "../assets/runtime/quiz.mjs";
import type { QuizQuestionGrade, QuizSubmission } from "./store/quiz-history.ts";

export interface RubricCriterion {
  id: string;
  /** Approved for the learner only after this answer is graded. */
  description: string;
  points: number;
}
export interface CriterionAllocation {
  criterion_id: string;
  points_earned: number;
  feedback: string;
}
export interface CriterionGrade {
  criterionId: string;
  description: string;
  pointsEarned: number;
  pointsPossible: number;
  feedback: string;
  feedbackHtml?: string;
}

const near = (a: number, b: number) =>
  Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9;

export function validateCriteria(value: unknown, points: number, where: string): RubricCriterion[] {
  if (!Array.isArray(value) || !value.length)
    throw new Error(`${where}: declare a non-empty criteria array before submission.`);
  const ids = new Set<string>();
  let total = 0;
  for (const c of value) {
    if (!c || !isContractId(c.id) || ids.has(c.id))
      throw new Error(`${where}: criterion ids must be valid and unique.`);
    if (typeof c.description !== "string" || !c.description.trim())
      throw new Error(`${where}/${c.id}: criterion description is required.`);
    if (!Number.isFinite(c.points) || c.points <= 0)
      throw new Error(`${where}/${c.id}: criterion points must be positive and finite.`);
    ids.add(c.id);
    total += c.points;
  }
  if (!near(total, points)) throw new Error(`${where}: criterion points must sum to ${points}.`);
  return value;
}

/** Teachers supply ids, earned points, and explanations; definitions remain code-owned. */
export function allocateCriteria(
  submission: QuizSubmission,
  questionId: string,
  raw: unknown,
): CriterionGrade[] | undefined {
  const definitions = submission.rubricCriteria?.[questionId];
  if (!definitions) {
    if (raw !== undefined)
      throw new Error(
        `Question ${questionId}: no criterion definitions were saved before submission.`,
      );
    return undefined;
  }
  if (!Array.isArray(raw) || raw.length !== definitions.length)
    throw new Error(`Question ${questionId}: allocate every declared criterion exactly once.`);
  const ids = raw.map((c) => c?.criterion_id);
  if (new Set(ids).size !== ids.length || definitions.some((c) => !ids.includes(c.id)))
    throw new Error(`Question ${questionId}: use only the declared criterion ids, exactly once.`);
  return definitions.map((definition) => {
    const allocation = raw.find((c) => c.criterion_id === definition.id);
    if (
      Object.keys(allocation).some(
        (key) => !["criterion_id", "points_earned", "feedback"].includes(key),
      )
    )
      throw new Error(
        `Question ${questionId}/${definition.id}: criterion definitions and weights cannot be supplied by the teacher.`,
      );
    return {
      criterionId: definition.id,
      description: definition.description,
      pointsPossible: definition.points,
      pointsEarned: allocation.points_earned,
      feedback: allocation.feedback,
    };
  });
}

/** Shared persistence guard also protects direct host callers and saved-plan recovery. */
export function validateCriterionGrade(
  submission: QuizSubmission,
  question: QuizQuestionGrade,
): void {
  const definitions = submission.rubricCriteria?.[question.questionId];
  const where = `Question ${question.questionId}`;
  if (!definitions) {
    if (question.criteria !== undefined)
      throw new Error(`${where}: no saved criterion definitions.`);
    return;
  }
  const criteria = question.criteria;
  if (!Array.isArray(criteria) || criteria.length !== definitions.length)
    throw new Error(`${where}: allocate every declared criterion exactly once.`);
  const ids = criteria.map((c) => c.criterionId);
  if (new Set(ids).size !== ids.length || definitions.some((c) => !ids.includes(c.id)))
    throw new Error(`${where}: use only the declared criterion ids, exactly once.`);
  let earned = 0,
    possible = 0;
  for (const c of criteria) {
    const definition = definitions.find((d) => d.id === c.criterionId)!;
    if (c.description !== definition.description || c.pointsPossible !== definition.points)
      throw new Error(`${where}/${c.criterionId}: use the saved criterion description and weight.`);
    if (!Number.isFinite(c.pointsEarned) || c.pointsEarned < 0 || c.pointsEarned > c.pointsPossible)
      throw new Error(
        `${where}/${c.criterionId}: earned points must be between 0 and ${c.pointsPossible}.`,
      );
    if (typeof c.feedback !== "string" || !c.feedback.trim())
      throw new Error(`${where}/${c.criterionId}: explain the met or missing reasoning.`);
    earned += c.pointsEarned;
    possible += c.pointsPossible;
  }
  if (!near(earned, question.pointsEarned!) || !near(possible, question.pointsPossible!))
    throw new Error(
      `${where}: criterion allocations must sum to the question's earned and possible points.`,
    );
}

/** Preflight all criterion data before a durable teacher plan can write records. */
export function validateAnswerCriteria(
  submission: QuizSubmission,
  questions: Array<{
    question_id: string;
    points_earned?: number;
    points_possible?: number;
    criteria?: CriterionAllocation[];
  }>,
): void {
  if (!Array.isArray(questions)) throw new Error("Grade every submitted question.");
  for (const [id] of Object.entries(submission.rubricCriteria ?? {})) {
    if (submission.deterministicGrades?.some((q) => q.questionId === id)) continue;
    if (!questions.some((q) => q.question_id === id))
      throw new Error(`Question ${id}: allocate every declared criterion exactly once.`);
  }
  for (const q of questions) {
    const criteria = allocateCriteria(submission, q.question_id, q.criteria);
    validateCriterionGrade(submission, {
      questionId: q.question_id,
      correct: false,
      feedback: "",
      pointsEarned: q.points_earned,
      pointsPossible: q.points_possible,
      criteria,
    });
  }
}
