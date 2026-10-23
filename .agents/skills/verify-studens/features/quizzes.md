# Answer quizzes

The learner submits typed answers and reads grades on the lesson page.

## Sub-features

- Submit and restore all ten question types, including runnable JavaScript.
- Check inline ungraded practice locally, revise an answer, and start fresh on reload.
- Study a faded worked example, attempt one more step per new case, and compare reasoning locally.
- Grade closed answers immediately without a teacher turn. Keep saved machine allocations through recovery.
- Preserve drafts and optional assistance reports.
- Lock a graded quiz. Show the score meter, correct count, feedback and static verdict icons.
- Reveal a newly completed attempt once; restore results immediately on reload.
- Expand criterion, dispute and expected-answer rows beside each question.
- Keep the newest attempt and grade revision across reload and two tabs.
- Dispute a graded answer with a saved reason, teacher response and immutable grade history.
- Release gated teaching after a pretest grade.

## How to get to it (user POV)

1. Open a lesson.
2. Answer its quiz.
3. Select `Submit for grading`.
4. Read the score block and per-question feedback.
5. Open `Criterion breakdown`, `I think this deserves credit` or
   `Expected answer and criteria` for supporting details.

For practice between sections, answer the short check and select `Check answer`.
Read the explanation, revise if needed, and continue to the next section.

## Driving it with playwright-cli

Run `npm run verify -- browser --artifacts /tmp/studens-quizzes`.

The suite drives `form.cl-quiz` and checks `data-state`. It submits all contract examples, reloads, and compares stored answers with the page. It checks `Graded` is disabled, partial verdicts remain visible, and a stale grade cannot replace the active attempt. A newly completed attempt reveals its score, summary and question feedback with 100ms staggering and 300ms reveals. The meter uses a 600ms fill; reduced motion uses opacity only. Reload restores the result without replaying the reveal. Inspect `all-types-new-result.png` and `partial-credit-and-all-types.png`.

Open `Criterion breakdown` to read saved allocations; it starts collapsed.
The criterion fixture submits a partially correct calculation against definitions
saved before submission. It checks met and missed rows (2/2 and 0/2), the 2/4 total,
private snapshots, locked controls, reload, and an explicit explanation revision
that retains the original grade file. Inspect `criteria/partial.json`,
`criteria/history.json`, and matching desktop/375px screenshots. Invalid rubric
points refuse submission without saving an attempt. An incomplete teacher allocation
shows `Grading your quiz` while running, then keeps its specific failure beside
the saved answers after reload. It requires `Retry request`; the corrected plan
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

For a procedural teaching block, the `.cl-faded` widget starts with all worked steps
and principle questions. Write one explanation, select `Try the next case`, then
attempt the omitted steps. `Check my work` checks declared public term/numeric
keys; open reasoning requires `Compare with solution`, which discloses assistance
without claiming correctness. `Hand over one more step` removes one more worked
step on a different case. The last case begins with every step omitted. Wrong exact
answers can continue after feedback; finishing is practice, never a grade.

The browser suite drives the copyable `assets/templates/faded.html` contract through
real lesson startup, including two instances after a real closed pretest releases
teaching. Inspect `faded/result.json`: all classroom file hashes stay unchanged during
widget actions, no HTTP writes or teacher turns occur, and only the pretest and
neighboring assessment have submissions/grades. It checks right/wrong term/numeric
feedback, open comparison, finite number parsing and separately labeled exact units,
keyboard focus, light/dark at 1280px and 390px, reduced motion, reset/revisit,
reload/navigation, visible malformed JSON/version errors, and authored text safety.
Editing a compared answer clears its verdict and retains assistance. Revisit/reset
clear responses and retain exposure warnings during the page visit; reload returns
to study, with no restored answers or credit. The neighboring private key remains
immutable and its static route stays blocked.

For a focused drive, run
`node --input-type=module -e 'import {verifyFadedBrowser} from "./scripts/e2e-faded-browser.ts"; await verifyFadedBrowser("/tmp/studens-faded")'`.
The packaged page checker and authoring harness use `checkFaded` to attempt and
compare each omitted step, progress through all cases, and reset, while checking
for HTTP writes. Those arbitrary reasoning responses prove controls, not correctness
or learning efficacy. Public practice solutions must use cases distinct from every
graded question. Exact terms normalize only case and whitespace; use authored
alternatives or comparison for mathematically equivalent expressions.

Verify multiline authored situations/solutions keep their line breaks, including
comments on separate code lines. The browser probe also goes Back from the
classroom after beginning a completion case: it must return to study with blank
responses. A saved-output rendering replay must retain the original model bytes
and publication HTML hash; distinguish that replay from new model inference.

The typed publication probe runs the actual `lessonModelPlan` serializer and
`completeLessonRequest` checker before publishing all four files:
`node --input-type=module -e 'import {verifyFadedPublication} from "./scripts/e2e-faded-publication.ts"; await verifyFadedPublication("/tmp/studens-faded-publication")'`.
Inspect `publication.json`: the initial receipt has zero widgets, the released receipt
has one, all four hashes match published bytes, and no learner attempts/grades or
records are created. A malformed public widget version fails the real page checker
and stays unpublished with its specific error and rejected output retained. This
uses typed fixture output, not model inference. The service's explicit Next lesson
prompt includes the complete widget template inline through `authoringSteps`; no
filesystem tools or new top-level provider schema fields are needed.

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

For retained automated authoring evidence, invoke the checker as a separate simple
command, optionally after `cd ... &&` or with `--experimental-strip-types`.
Receipts must match that invocation's classroom/lesson and all saved input hashes.
The receipt reader conservatively rejects multiline commands, heredocs, control
flow and unrelated command prefixes. Keep any resulting missing-receipt failure;
a separate checker replay is not another authoring generation.

## Run JavaScript before submitting

A `data-type="code"` question has a labelled `textarea.cl-code-source`, public
function-call tests in `data-code`, and `Run code` / `Stop` controls. The supported
language is synchronous JavaScript in the vendored QuickJS interpreter. Edit the
starter, Run, read test results and console/errors, revise, then explicitly Submit.
Run is debugging feedback: it creates no attempt, grade, teacher request or learning
evidence. Submit saves exact source/tests and the current contextual run; normal
private judgment criteria determine points. Grading and reload lock the editor.
Client pass flags cannot grant points; disputes assess the original saved source.
All tests shipped to the browser are public. Code is not an ungraded practice type.

`node scripts/e2e-code-browser.ts /tmp/studens-code` drives actual browser WASM
execution with correct/incorrect source, syntax/runtime/invalid JSON results,
timeout, Stop/restart, bounded console/memory, editing during execution and stale
or spoofed messages. It checks denied browser/origin/network/storage/import/worker
escapes, no engine load on unrelated pages or before Run, and no Internet requests.
Inspect `smoke.json`, `submission.json`, desktop/mobile light/dark captures and
`execution.webm`. Submission checks include active-run refusal, duplicate/second-tab
conflicts, immutable source/run hashes, criteria, reload, locks, private routes and
a neighboring machine-scored quiz. The grader here is a fixture tool.

`node scripts/e2e-code-review.ts /tmp/studens-code-review` uses a prepared private
code variant through Start review, Run and Submit. A fixture incomplete criterion
plan fails durably; reload does not retry. Explicit Retry saves one grade against
the unchanged source/run snapshot. The default browser suite includes both drives.

`node scripts/e2e-code-host.ts pi /tmp/studens-code-pi` (also `claude`, then `codex`)
uses the actual initiating host and persistent fixed-model teacher. Correct source
gets rubric credit. Constant source still receives zero when its client run snapshot
claims passes; a dispute cannot replace the source or override machine neighbors.
Inspect `report.json`, saved classroom teacher plans and model identities, hashes,
and captures. A failed model plan remains a failure, with explicit recovery required;
do not rerun unchanged to obtain a passing model response. This is model adherence,
not a human retention measurement.

For authoring and persistence contracts run
`npx vitest run test/code.test.ts test/code-producer.test.ts test/code-grading-input.test.ts`. They trace typed
service/Pi serialization, private variant assembly, unsupported or malformed
contracts, immutable submissions, and exact-grading refusal. The packaged checker
also runs disposable code and syntax-error feedback, restores starter source, and
binds private inputs to its receipt without running learner source on the host.

Code grading requests supply exact saved quiz/question citation reference forms,
including on explicit Retry. These forms grant no eligibility: optional learning
records still require fully credited supported questions, and null is valid.
Missing, wrong and uncredited citations must continue to reject the whole plan
before writes. To investigate a retained Pi code-grade failure, use
`node scripts/replay-code-retry.ts /absolute/path/to/retained/pi /tmp/studens-code-retry`.
The retained directory must include its classroom and native `pi-sessions/`.
This clones both before opening the failed lesson and selecting Retry request.
Inspect original/new plan, exact input, session-prefix and attempt/publication
hashes, one grade, locked reload and repeated-retry refusal. This is one new real
grading inference, not a rerun of the full host target or authoring generation.

For a retained Claude directed finite-sum publication with no submitted attempt,
`node scripts/replay-code-authoring.ts /absolute/path/to/retained/claude /tmp/studens-code-author-replay`
clones its four checked files, runs the finite-number solution, then submits for
the first actual grade in the saved teacher conversation. Inspect the provenance,
unchanged original files, exact source, criteria and grade. Preserve the original
failed target and distinguish a corrected learner action from lesson regeneration.

## Dispute a grade

On a graded answer, open `I think this deserves credit`. Explain why the original
answer meets the criteria, then select `Send grade dispute` or use Ctrl/Command +
Enter. The answer remains locked. Open `Dispute history` to read the linked response beside it, or read it in the
teacher panel. Activity links open the matching dispute row before scrolling. `Grade history` shows original and revised point allocations and
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

### Expected answers after grading

`node scripts/e2e-expected-answers.ts /tmp/studens-expected-answers` drives the
actual lesson shell through saved grading, a new corrective panel task, the learner's
reply, and a validated retrieval check. Open `Expected answer and criteria` on a graded question. Correct original answers
show the expected answer, full/partial credit guidance and declared criteria.
Availability refreshes preserve an opened disclosure; reload starts collapsed.
Open an error row before using `Retry expected answer`. Original misses wait
for an exact corrective check; disputes cannot bypass that wait. Graded pretests
release without a corrective check. All ten supported response types render with
readable option/item/pair/blank labels and numeric units/tolerance; code keys are
explanations or source text and never execute.

Inspect `initial.json`, `corrective-before.json`, `corrective-after.json`,
`reload-probes.json`, `formats.json`, `result.json`, retained `classroom/`, and the
matching desktop/mobile light/dark captures. The drive includes failed grading,
reload without automatic retry, explicit Retry request, a restored original rubric
with keyboard `Retry expected answer`, locked second-tab answers, malformed and
neighboring HTTP targets, private static routes and ungraded sibling keys. Reads
must preserve grades, checks and review events. Its teacher plans are fixtures.

The real Pi/Claude/Codex host targets retain `expected-before.json` and
`expected-after.json` around their actual corrective task and reply. Inspect the
saved task for a new answerable example: neither punctuation nor a grade alone
establishes a retrieval task. Legacy attempts without original source identity,
ambiguous shared-objective checks, and unrelated replies must remain unavailable;
changed/missing original sources show a specific error and require explicit retry.

The drive holds the expected-answer response before panel arrival and compares the
canonical text index afterward and after error retry. Expected panels stay outside
anchors while authored question prose still supports mouse highlighting and the
Ask control. Inspect `anchor-arrival.json` and `anchor-retry.json`.

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
