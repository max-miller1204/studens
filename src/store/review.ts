import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { questionCredit } from "../../assets/runtime/grade.mjs";
import { reviewKey } from "../../assets/runtime/quiz.mjs";
import type { Assistance } from "../evidence.ts";
import { reviewSessions } from "../review-session.ts";
import { isAssistance } from "../evidence.ts";
import { classroomDir, isValidSlug } from "../paths.ts";
import type { QuizAnswer } from "../quiz.ts";
import { answerSummary, answersByQuestion, kindOf } from "../quiz.ts";
import type { ReviewEvent, ReviewItem } from "../review.ts";
import { answerReviewKey, findReviewItem, scheduleItems } from "../review.ts";
import { listLessonDirs } from "./classrooms.ts";
import { listJsonFiles, writeJson } from "./json.ts";
import { latestQuizStates, listGrades, listSubmissions } from "./quiz-history.ts";
import { readLearningRecords } from "./records.ts";

// ── Spaced review ─────────────────────────────────────────────────────────────

/**
 * Every graded answer in a classroom, as review events.
 *
 * Pretests are left out: they come before teaching, so a wrong answer there says
 * nothing about memory.
 */
export function reviewEvents(classroom: string): ReviewEvent[] {
  const events: ReviewEvent[] = [];
  const selections = reviewSessions(classroom);
  for (const lesson of listLessonDirs(classroom)) {
    const history = listGrades(classroom, lesson);
    const firstFeedback = new Map<string, number>();
    for (const grade of history)
      if (!firstFeedback.has(grade.submissionId))
        firstFeedback.set(grade.submissionId, grade.gradedAt);
    const grades = new Map(history.map((g) => [g.submissionId, g]));
    for (const submission of listSubmissions(classroom, lesson)) {
      const grade = grades.get(submission.id);
      if (!grade || kindOf(submission) === "pretest") continue;
      const feedbackAt = firstFeedback.get(submission.id)!;
      for (const [questionId, group] of answersByQuestion(submission.answers)) {
        const verdict = grade.questions.find((q) => q.questionId === questionId);
        if (!verdict) continue;
        const credit = questionCredit(verdict);
        const selected = selections.find((session) => session.lesson === lesson);
        const selectedItem =
          selected &&
          findReviewItem(selected.items, answerReviewKey(lesson, submission.quizId, group[0]));
        const selectedEarly = selectedItem && selectedItem.dueAt > selected!.at;
        events.push({
          key: answerReviewKey(lesson, submission.quizId, group[0]),
          ...(!group[0].reviewOf
            ? {
                questionKey: reviewKey(lesson, submission.quizId, questionId),
                sourceQuestionKey: reviewKey(lesson, submission.quizId, questionId),
              }
            : {}),
          at: submission.submittedAt,
          attemptId: submission.id,
          feedbackAt,
          early:
            selectedEarly ||
            submission.earlyReviewKeys?.includes(
              answerReviewKey(lesson, submission.quizId, group[0]),
            ),
          earlyDueAt: selectedEarly ? selectedItem.dueAt : undefined,
          evidence: group[0].learning,
          correct: verdict.correct,
          credit: credit.earned / credit.possible,
          prompt: group[0].prompt ?? "",
          answer: answerSummary(group),
          feedback: verdict.feedback,
        });
      }
    }
  }
  const aliases = new Map<string, string>();
  for (const event of [...events].sort(
    (a, b) =>
      a.at - b.at ||
      a.key.localeCompare(b.key) ||
      (a.questionKey ?? "").localeCompare(b.questionKey ?? ""),
  ))
    if (event.questionKey && !aliases.has(event.questionKey))
      aliases.set(event.questionKey, event.key);
  const canonical = (key: string) => aliases.get(key) ?? key;
  for (const event of events) {
    if (!event.questionKey) event.key = canonical(event.key);
    else if (canonical(event.questionKey) !== event.key) delete event.questionKey;
    // A review's new plan must not invent context for historical attempts.
    if (event.key.split("/")[1] !== "@objective") event.evidence = undefined;
  }
  const checks = listRetrievalChecks(classroom);
  for (const check of checks) {
    const original = events.find((event) => event.key === canonical(check.key));
    if (!original)
      throw new Error(`Retrieval check ${check.id} refers to an unknown review item: ${check.key}`);
    events.push({
      key: canonical(check.key),
      at: check.answeredAt ?? check.at,
      feedbackAt: check.at,
      attemptId: check.id,
      correct: true,
      credit: 1,
      prompt: original.prompt,
      answer: check.answer,
      feedback: check.evidence,
      source: "chat",
      learningRecord: check.learningRecord,
      evidence: canonical(check.key).split("/")[1] === "@objective" ? check.learning : undefined,
    });
  }
  return events;
}

/** Every review item in a classroom, with its schedule, soonest due first. */
export function reviewItems(classroom: string): ReviewItem[] {
  const items = scheduleItems(reviewEvents(classroom));
  for (const control of readReviewControls(classroom)) {
    const item = findReviewItem(items, control.key);
    if (!item) throw new Error(`Review control refers to an unknown item: ${control.key}`);
    item.controlRevision = control.revision;
    item.retiredAt = control.retiredAt;
  }
  return items;
}

/** A successful chat retrieval check linked to an existing quiz item. */
export interface RetrievalCheck {
  id: string;
  key: string;
  at: number;
  /** Actual panel reply time supplied by the owning host, absent in old checks. */
  answeredAt?: number;
  answer: string;
  evidence: string;
  learningRecord: string;
  assistance?: Assistance;
  task?: "retrieval" | "transfer";
  learning?: QuizAnswer["learning"];
}

export function listRetrievalChecks(classroom: string): RetrievalCheck[] {
  return listJsonFiles<RetrievalCheck>(
    path.join(classroomDir(classroom), "quiz", "retrieval-checks"),
  ).sort((a, b) => a.at - b.at);
}

/** Preserve the quiz attempt and add later evidence of understanding. */
export function recordRetrievalCheck(
  classroom: string,
  input: Omit<RetrievalCheck, "id" | "at" | "answeredAt" | "learning">,
  answeredAt?: number,
): RetrievalCheck {
  const item = findReviewItem(reviewItems(classroom), input.key);
  if (!item) throw new Error(`No graded review item: ${input.key}`);
  const record = readLearningRecords(classroom).find(
    (record) => record.file === input.learningRecord,
  );
  if (!record) throw new Error(`No learning record: ${input.learningRecord}`);
  if (/^status:\s*superseded/im.test(record.markdown))
    throw new Error("Use an active learning record.");
  if (!input.answer.trim() || !input.evidence.trim())
    throw new Error("Include the learner's answer and the evidence of understanding.");
  const previous = listRetrievalChecks(classroom);
  if (
    previous.some(
      (check) => findReviewItem([item], check.key) && check.learningRecord === input.learningRecord,
    )
  ) {
    throw new Error("This learning record already has a retrieval check for this item.");
  }
  if (input.assistance !== undefined && !isAssistance(input.assistance))
    throw new Error("Retrieval check has unknown assistance.");
  if (input.task !== undefined && !["retrieval", "transfer"].includes(input.task))
    throw new Error("Retrieval check task must be retrieval or transfer.");
  if (answeredAt !== undefined && (!Number.isFinite(answeredAt) || answeredAt > Date.now()))
    throw new Error("Retrieval check has an invalid learner reply timestamp.");
  const check: RetrievalCheck = {
    ...input,
    ...(answeredAt === undefined ? {} : { answeredAt }),
    learning:
      item.objective && item.objectiveId
        ? {
            objectiveId: item.objectiveId,
            objective: item.objective,
            task: input.task ?? "retrieval",
            support: "independent",
            assistance: input.assistance ?? "unknown",
          }
        : undefined,
    id: randomUUID(),
    at: Math.max(Date.now(), item.lastAt + 1, ...previous.map((c) => c.at + 1)),
  };
  writeJson(
    path.join(classroomDir(classroom), "quiz", "retrieval-checks", `${check.at}-${check.id}.json`),
    check,
  );
  return check;
}

/** Original review items that a graded lesson can use for panel evidence. */
export function lessonReviewItems(classroom: string, lesson: string): ReviewItem[] {
  const reviewedHere = new Set(
    latestQuizStates(classroom, lesson)
      .filter((state) => state.grade && state.submission.kind === "review")
      .flatMap((state) => state.submission.answers.map((answer) => answer.reviewOf)),
  );
  return reviewItems(classroom).filter(
    (item) =>
      item.lesson === lesson ||
      reviewedHere.has(item.key) ||
      item.questionKeys?.some((key) => reviewedHere.has(key)),
  );
}

interface ReviewControl {
  key: string;
  revision: number;
  retiredAt?: number;
}
function reviewControlsFile(classroom: string): string {
  if (!isValidSlug(classroom)) throw new Error("Invalid classroom.");
  const root = classroomDir(classroom);
  const file = path.join(root, ".review-controls.json");
  for (const target of [root, file]) {
    try {
      if (fs.lstatSync(target).isSymbolicLink())
        throw new Error("Review controls cannot use symlinks.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return file;
}
function readReviewControls(classroom: string): ReviewControl[] {
  const file = reviewControlsFile(classroom);
  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(`Cannot read review controls: ${(error as Error).message}`);
  }
  if (
    saved?.version !== 1 ||
    !Array.isArray(saved.items) ||
    saved.items.some(
      (item: ReviewControl) =>
        !item ||
        typeof item.key !== "string" ||
        !Number.isSafeInteger(item.revision) ||
        item.revision < 1 ||
        (item.retiredAt !== undefined && (!Number.isFinite(item.retiredAt) || item.retiredAt <= 0)),
    ) ||
    new Set(saved.items.map((item: ReviewControl) => item.key)).size !== saved.items.length
  )
    throw new Error("Invalid review controls. Restore the saved file, then explicitly retry.");
  return saved.items;
}
/** Retain all evidence and use revisions to reject stale actions from another tab. */
export function setReviewRetired(
  classroom: string,
  key: string,
  retired: boolean,
  revision: number,
): ReviewItem {
  const lock = `${reviewControlsFile(classroom)}.lock`;
  let descriptor: number;
  try {
    descriptor = fs.openSync(lock, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(
        `Another server has locked review item edits. Retry after it finishes. If a server stopped during a save, remove ${lock} before retrying.`,
      );
    throw error;
  }
  try {
    fs.writeFileSync(descriptor, `${process.pid}\n`);
    return applyReviewRetirement(classroom, key, retired, revision);
  } finally {
    fs.closeSync(descriptor);
    fs.unlinkSync(lock);
  }
}
function applyReviewRetirement(
  classroom: string,
  key: string,
  retired: boolean,
  revision: number,
): ReviewItem {
  const item = findReviewItem(reviewItems(classroom), key);
  if (!item) throw new Error(`No graded review item: ${key}`);
  if ((item.retiredAt !== undefined) === retired) return item;
  if (revision !== (item.controlRevision ?? 0))
    throw new Error("This review item changed in another tab. Reload before retrying.");
  const items = readReviewControls(classroom).filter((control) => control.key !== item.key);
  const control = {
    key: item.key,
    revision: revision + 1,
    ...(retired ? { retiredAt: Date.now() } : {}),
  };
  items.push(control);
  const target = reviewControlsFile(classroom);
  const temp = `${target}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ version: 1, items }, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
  fs.renameSync(temp, target);
  return { ...item, retiredAt: control.retiredAt, controlRevision: control.revision };
}
