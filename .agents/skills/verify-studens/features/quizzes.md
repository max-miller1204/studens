# Answer quizzes

The learner submits typed answers and reads grades on the lesson page.

## Sub-features

- Submit and restore all ten question types, including runnable JavaScript.
- Check inline practice locally, revise, and start fresh on reload.
- Work through faded worked examples locally.
- Grade closed answers immediately without a teacher turn.
- Preserve drafts and optional assistance reports.
- Lock a graded quiz. Show partial credit and saved criterion allocations.
- Keep the newest attempt and grade revision across reload and two tabs.
- Dispute a graded answer with a saved reason, teacher response, and immutable grade history.
- Show expected answers after grading, once the original gate is met.
- Release gated teaching after a pretest grade.

## How to get to it (user POV)

1. Open a lesson and answer its quiz.
2. Select `Submit for grading`.
3. Read the grade and feedback.

For practice between sections, answer the short check and select `Check answer`.

## Driving it with playwright-cli

Run `npm run verify -- browser --artifacts /tmp/studens-quizzes`.

The suite drives `form.cl-quiz` and checks `data-state`. It submits every contract
example, reloads, and compares stored answers with the page. `Graded` stays disabled,
partial verdicts stay visible, and a stale grade cannot replace the active attempt.
Invalid option values show contract errors and block submission. A grade that
arrives before the submit response keeps the quiz graded. A pretest grade releases
teaching through one reload and preserves a reflection draft.

**Math.** TeX prompts and feedback draw as MathML after reload. Inspect `stored-math.json`.

**Criteria.** A partially correct calculation shows 2/2 and 0/2 rows and a 2/4
total that survive reload and an explanation revision. Invalid rubric points refuse
submission. An incomplete teacher allocation keeps its error until `Retry request`.
Inspect `criteria/*.json`. Real host drives append the same calculation; inspect
`criteria/stored-criteria.json` and `criteria/criteria-reloaded.json`.

**Closed grading.** All eight exact-capable types grade on submit with no teacher
call, release gated teaching, and stay locked after reload. Private keys stay off
learner routes. Inspect `closed/closed-result.json`.

**Practice.** `form.cl-practice` gives immediate feedback, keeps inputs editable,
shows specific errors for blank or invalid input, and resets on reload. Numeric
keys that need a unit require a usable unit control. Practice makes no HTTP writes
and never reads the private rubric. Inspect `practice/practice-result.json` and
`practice/numeric-result.json`.

**Faded worked examples.** `.cl-faded` starts with all worked steps. `Try the next
case` hides one more step per case; `Check my work` checks public term/numeric keys;
`Compare with solution` discloses assistance for open reasoning. Inspect
`faded/result.json`: classroom hashes unchanged, no HTTP writes or teacher turns.
Focused drives:

```sh
node --input-type=module -e 'import {verifyFadedBrowser} from "./scripts/e2e-faded-browser.ts"; await verifyFadedBrowser("/tmp/studens-faded")'
node --input-type=module -e 'import {verifyFadedPublication} from "./scripts/e2e-faded-publication.ts"; await verifyFadedPublication("/tmp/studens-faded-publication")'
```

The publication probe runs the real serializer and page checker. Inspect
`publication.json`: zero widgets before release, one after, and four matching hashes.

**Authored lesson check.** `node scripts/check-lesson.ts <classroom> <lesson>` with
`PI_CLASSROOMS_DIR` set preflights metadata, rubric, plan, criteria, and variants,
then checks initial and released controls in a disposable copy. Invalid inputs exit
nonzero without a receipt. The original classroom must stay unchanged. Contract
tests: `test/lesson-inputs.test.ts`, `test/harness.test.ts`.

## Run JavaScript before submitting

A `data-type="code"` question has `textarea.cl-code-source`, public tests in
`data-code`, and `Run code` / `Stop`. Run uses the vendored QuickJS interpreter. It
creates no attempt, grade, or evidence. Submit saves the source and current run;
private criteria decide points. Client pass flags cannot grant points.

| Command                                                                                       | Covers                                                                       |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `node scripts/e2e-code-browser.ts /tmp/studens-code`                                          | WASM execution, errors, timeout, Stop, sandbox escapes, submission conflicts |
| `node scripts/e2e-code-review.ts /tmp/studens-code-review`                                    | Prepared code review, durable failure, one explicit retry                    |
| `node scripts/e2e-code-host.ts <pi\|claude\|codex> /tmp/studens-code-<host>`                  | Real host grading of correct and constant source, dispute refusal            |
| `node scripts/replay-code-retry.ts <retained/pi> /tmp/studens-code-retry`                     | One real retry of a retained Pi code-grade failure                           |
| `node scripts/replay-code-authoring.ts <retained/claude> /tmp/studens-code-replay`            | First real grade of a retained Claude code lesson                            |
| `npx vitest run test/code.test.ts test/code-producer.test.ts test/code-grading-input.test.ts` | Serialization, private variants, immutable submissions, citation forms       |

The default browser suite includes the first two. Replays need a retained directory
with its classroom and native sessions; they are new inference, not reruns.

## Dispute a grade

On a graded answer, open `I think this deserves credit`, explain, and select `Send
grade dispute` (or Ctrl/Command + Enter). `Grade history` shows original and revised
allocations. Machine points stay code-owned.

```sh
node --input-type=module -e 'import {verifyDisputesBrowser} from "./scripts/e2e-disputes-browser.ts"; await verifyDisputesBrowser("/tmp/studens-disputes")'
```

The drive revises 2/4 to 4/4 judgment points while keeping the closed 0/1, checks a
failed dispute until `Retry request`, a second tab, and rejected stale or blank
targets. Real host targets append `driveDisputeProbe`; inspect `disputes/` and the
saved `.teacher.json` reasoning.

## Expected answers after grading

`node scripts/e2e-expected-answers.ts /tmp/studens-expected-answers` drives grading,
a corrective task, the learner's reply, and the retrieval check. Correct answers show
the expected answer at once. Misses wait for an exact corrective check; disputes
cannot bypass it. Graded pretests release without one. Failures need `Retry
request` or `Retry expected answer`. Inspect `result.json`, `formats.json`, and
`anchor-*.json`. Real hosts retain `expected-before.json` and `expected-after.json`.

## Gotchas

- Fixture graders prove page and storage behavior, not grading quality.
- `feedback claude` and `feedback codex` check merged machine and judgment scores.
  To replay a saved plan without inference, run
  `node scripts/e2e-feedback.ts claude <out> <retained-plan.json>`.
- Practice feedback is public teaching content, has no history, and is not evidence.
- Immediate correct answers do not prove retention.
