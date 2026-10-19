# Answer quizzes

The learner submits typed answers and reads grades on the lesson page.

## Sub-features

- Submit and restore all nine question types.
- Check inline ungraded practice locally, revise an answer, and start fresh on reload.
- Grade closed answers immediately without a teacher turn. Keep saved machine allocations through recovery.
- Preserve drafts and optional assistance reports.
- Lock a graded quiz. Display partial credit.
- Keep the newest attempt and grade revision across reload and two tabs.
- Release gated teaching after a pretest grade.

## How to get to it (user POV)

1. Open a lesson.
2. Answer its quiz.
3. Select `Submit for grading`.
4. Read the grade and feedback.

For practice between sections, answer the short check and select `Check answer`.
Read the explanation, revise if needed, and continue to the next section.

## Driving it with playwright-cli

Run `npm run verify -- browser --artifacts /tmp/studens-quizzes`.

The suite drives `form.cl-quiz` and checks `data-state`. It submits all contract examples, reloads, and compares stored answers with the page. It checks `Graded` is disabled, partial verdicts remain visible, and a stale grade cannot replace the active attempt.

The math quiz stores its prompt, stimulus, and choice label as TeX. Its grade feedback draws as MathML after reload. Inspect `stored-math.json` for the saved submission, grade, and review prompt.

Invalid option values must show contract errors and block submission. A grade that arrives before the submit response must keep the quiz graded. A pretest grade must release teaching through one reload and preserve a reflection draft.

The closed pretest fixture uses real controls for all eight exact-capable types. It checks an incorrect choice and correct set, text alternatives, numeric tolerance and unit, blanks, order, pairs, and segments. Submission immediately reaches `data-state="graded"`, releases gated teaching, and remains locked after reload with no teacher calls. Private allocations and keys stay off learner routes. Inspect `closed/closed-graded.png` and `closed/closed-result.json`. Mixed-quiz point merging, rejected teacher overrides, malformed keys, and recovery are covered by the HTTP and host contract tests.

The practice fixture drives `form.cl-practice` between teaching sections with all
eight exact-capable controls. `Check answer` gives immediate explanations while
keeping inputs editable. Blank input and invalid numbers show specific errors.
Changing an answer clears feedback; keyboard submission checks the correction.
Reload starts fresh. A malformed key disables practice with a contract error.
Inspect `practice/practice-feedback.png` and `practice/practice-result.json`: no
practice HTTP writes, saved drafts, submissions, grades, review items, or teacher
calls. A neighboring graded check still submits and scores normally. Public practice
feedback never reads the private graded rubric, and its static route stays blocked.

## Gotchas

The fixture grading tool proves page and storage behavior. It does not prove model grading quality. API attempts from older clients are checked separately from the learner's locked quiz controls. The `feedback claude` and `feedback codex` targets combine a saved closed answer with judgment questions. They require the model to omit the closed question and verify the final score from merged point allocations. Immediate correct answers do not prove retention.

Practice feedback is public teaching content, not a graded key. Open reasoning is
not machine checked; use a reflection or local solution reveal. Practice has no
saved history and supplies no evidence of retention.
