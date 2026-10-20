# Answer quizzes

The learner submits typed answers and reads grades on the lesson page.

## Sub-features

- Submit and restore all nine question types.
- Check inline ungraded practice locally, revise an answer, and start fresh on reload.
- Grade closed answers immediately without a teacher turn. Keep saved machine allocations through recovery.
- Preserve drafts and optional assistance reports.
- Lock a graded quiz. Display partial credit and saved criterion allocations.
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

The criterion fixture submits a partially correct calculation against definitions
saved before submission. It checks met and missed rows (2/2 and 0/2), the 2/4 total,
private snapshots, locked controls, reload, and an explicit explanation revision
that retains the original grade file. Inspect `criteria/partial.json`,
`criteria/history.json`, and matching desktop/375px screenshots. Invalid rubric
points refuse submission without saving an attempt. An incomplete teacher allocation
keeps a specific error after reload and requires `Retry request`; the corrected plan
saves one grade. Inspect `criteria/rejected-plan.json` and `criteria/retried-plan.json`.
The component fixture also saves 1/2 on a partly met criterion and 0/2 on a missed
criterion, then reloads the unchanged 1/4 total. Inspect `criteria/partly-met.json`
and `criteria/partly-met-mobile.png`. These are fixture teachers, not real model adherence checks.

The real Pi, Claude, and Codex drives also append a criterion calculation after
their existing lifecycle checks. Inspect `criteria/stored-criteria.json`,
`criteria/criteria-reloaded.json`, and the desktop/mobile captures. The teacher
must save 2/2 for the squared sum and 0/2 for the missing average, keep the form
locked after reload, and post the follow-up on the lesson page. Inspect the actual
teacher message for the retrieval task; it may use an imperative sentence. These
runs do not establish human retention.

The math quiz stores its prompt, stimulus, and choice label as TeX. Its grade feedback draws as MathML after reload. Inspect `stored-math.json` for the saved submission, grade, and review prompt.

Invalid option values must show contract errors and block submission. A grade that arrives before the submit response must keep the quiz graded. A pretest grade must release teaching through one reload and preserve a reflection draft.

The closed pretest fixture uses real controls for all eight exact-capable types. It checks an incorrect choice and correct set, text alternatives, numeric tolerance and unit, blanks, order, pairs, and segments. Submission immediately reaches `data-state="graded"`, releases gated teaching, and remains locked after reload with no teacher calls. Private allocations and keys stay off learner routes. Inspect `closed/closed-graded.png` and `closed/closed-result.json`. Mixed-quiz point merging, rejected teacher overrides, malformed keys, and recovery are covered by the HTTP and host contract tests.

The practice fixture drives `form.cl-practice` between teaching sections with all
eight exact-capable controls. `Check answer` gives immediate explanations while
keeping inputs editable. Blank input and invalid numbers show specific errors.
Changing an answer clears feedback; keyboard submission checks the correction.
Reload starts fresh. A malformed key disables practice with a contract error.
Numeric keys that require a unit need a control that can supply it; missing controls,
unavailable select values, and unusable unit elements are disabled explicitly.
Scalar-only, text-unit, fixed-unit, and matching select controls stay answerable.
Inspect `practice/numeric-result.json` for wrong-unit feedback, strict number input,
keyboard retry, reset, and unchanged classroom files. The packaged practice driver
also checks all five supported numeric arrangements without editing fixed units or
requiring a second select option.
Inspect `practice/practice-feedback.png` and `practice/practice-result.json`: no
practice HTTP writes, saved drafts, submissions, grades, review items, or teacher
calls. A neighboring graded check still submits and scores normally, preserving its
private predeclared criterion and code-owned allocation. Public practice
feedback never reads the private graded rubric, and its static route stays blocked.

For an authored lesson, run `node scripts/check-lesson.ts <classroom> <lesson>`
with its classrooms root in `PI_CLASSROOMS_DIR`. The command preflights saved
metadata, private rubric, teaching plan, criteria, and declared review variants
through the production contracts before opening its disposable HTML preview.
Missing promised files, unsupported versions, malformed JSON/UTF-8, symlinks,
unknown identities, and invalid machine keys must exit nonzero without a receipt.
An unchanged valid authored lesson and an HTML-only legacy lesson must still pass
the initial/released controls check. Compare `preflight.inputHashes` with the source
HTML, metadata, key, and plan bytes (null records an absent optional file).
The authoring harness matches these hashes to the saved inputs; editing a private
file invalidates the receipt. Keep a before/after hash inventory of the original
classroom: the preview must leave it unchanged. Private inputs stay outside
the preview. Its disposable pretest grades only release controls and prove no
model grading or learning outcome. Contract and receipt regressions also run in
`test/lesson-inputs.test.ts` and `test/harness.test.ts`.

## Gotchas

The fixture grading tool proves page and storage behavior. It does not prove model grading quality. API attempts from older clients are checked separately from the learner's locked quiz controls. The `feedback claude` and `feedback codex` targets combine a saved closed answer with judgment questions. They require the model to omit the closed question and verify the final score from merged point allocations. Immediate correct answers do not prove retention.

Practice feedback is public teaching content, not a graded key. Open reasoning is
not machine checked; use a reflection or local solution reveal. Practice has no
saved history and supplies no evidence of retention.
