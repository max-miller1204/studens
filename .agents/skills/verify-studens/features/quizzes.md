# Answer quizzes

The learner submits typed answers and reads grades on the lesson page.

## Sub-features

- Submit and restore all nine question types.
- Check inline ungraded practice locally, revise an answer, and start fresh on reload.
- Grade closed answers immediately without a teacher turn. Keep saved machine allocations through recovery.
- Preserve drafts and optional assistance reports.
- Lock a graded quiz. Display partial credit and saved criterion allocations.
- Keep the newest attempt and grade revision across reload and two tabs.
- Dispute a graded answer with a saved reason, teacher response and immutable grade history.
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

## Dispute a grade

On a graded answer, open `I think this deserves credit`. Explain why the original
answer meets the criteria, then select `Send grade dispute` or use Ctrl/Command +
Enter. The answer remains locked. Read the linked response beside it and in the
teacher panel. `Grade history` shows original and revised point allocations and
feedback. Machine points stay code-owned: the teacher can explain the result or flag
an authoring defect. A judgment revision uses the original submission and rubric.
Historical submissions without a saved rubric digest show a specific refusal.

`node --input-type=module -e 'import {verifyDisputesBrowser} from "./scripts/e2e-disputes-browser.ts"; await verifyDisputesBrowser("/tmp/studens-disputes")'`
drives the same learner path as the shared real-host probe. It checks a mixed grade
revising 2/4 to 4/4 judgment points while preserving the closed 0/1 allocation,
linked reason/response/history, keyboard submission, blank input, desktop/375px,
light/dark, reload and locks. A failed dispute stays failed on reload; `Retry request`
resolves it once. A second tab sees the same result. Stale, unknown, neighboring and
blank targets are rejected, and private snapshots stay off HTTP. Inspect
`seed.json`, `judgment.json`, `machine.json`, `result.json`, `failed-request.json`
and `retry-and-probes.json`. Original misgrading and teacher responses are fixtures.

The `pi`, `claude` and `codex` targets append `driveDisputeProbe` after their existing
criterion checks. Their initial misallocation is deliberately seeded; the learner's
disputes go through the actual owning teacher and fixed model. Inspect `disputes/`
and the retained `.teacher.json`: read the actual reasoning and criterion allocations,
not only the harness verdict. These checks do not measure first-pass grading quality
or human learning. Contract tests cover fixed definitions, machine-override rejection,
before/after-write recovery, repeated retry, original timestamps, early caps and
retirement without another exposure or learning record.

## Gotchas

The fixture grading tool proves page and storage behavior. It does not prove model grading quality. API attempts from older clients are checked separately from the learner's locked quiz controls. The `feedback claude` and `feedback codex` targets combine a saved closed answer with judgment questions. They require the model to omit the closed question and verify the final score from merged point allocations. The uncertain-answer explanation check reads only that question's visible feedback
and criterion feedback, matching the learner's rendered verdict. It excludes labels,
descriptions and neighboring answers. For a causal checker repair, use
`node scripts/e2e-feedback.ts claude /tmp/studens-feedback-replay /absolute/path/to/retained-plan.json`.
This explicit mode makes no model request, reconstructs a scratch attempt with the
original plan id, and keeps every point, criterion and machine-merge assertion.
Inspect `claude-feedback-report.json` for `kind: saved-model-plan-replay`,
`inference: false`, the exact input hash and both visible criterion explanations.
The desktop/mobile captures prove their rendering. Preserve the original failed run;
a replay is neither fresh inference nor recovery of its deleted fixture.
Immediate correct answers do not prove retention.

Practice feedback is public teaching content, not a graded key. Open reasoning is
not machine checked; use a reflection or local solution reveal. Practice has no
saved history and supplies no evidence of retention.
