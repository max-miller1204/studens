# Authored lesson markup evidence

Before: main at `78f2bc96dd5762affafe1d1c846a9a28ee94fb72`.
After: this branch's v2 markup, shared controls and validator. Both use the same
fixture data and explicit interaction states through public lesson/reference routes.

Run the shared doctor, then `node scripts/e2e-lesson-markup.ts <new-directory>`.
For a matched baseline, copy that capture script to the selected base checkout and
run it there with `before` as the second argument. The script is verification
scaffolding, not a production page or another teacher backend. Owned browsers,
servers and temporary classrooms close in `finally`.

The matrix uses 1280×900 and 390×900 in both light/dark with the default indigo
accent. The repository keeps selected inspected pairs; `before-result.json` and
`after-result.json` retain every matrix case and viewport check. The full local
capture sets remain in `/tmp/studens-142-main-evidence` and
`/tmp/studens-142-final-evidence` for this run.

| Pair prefix            | State                                               |
| ---------------------- | --------------------------------------------------- |
| `lesson-1280-dark`     | Initial pretest with later teaching withheld        |
| `assessment-390-light` | Fresh standalone assessment                         |
| `review-390-dark`      | Fresh authored review shell                         |
| `reference-1280-light` | Reference table; marker-only change, same rendering |
| `question-390-light`   | First canonical choice question                     |
| `practice-390-dark`    | Correct local answer with explanation               |
| `stepper-390-dark`     | Prefix sum after one Next action                    |
| `faded-390-light`      | Worked-example study, before explanation            |
| `ask-390-dark`         | Selected prose with typed question                  |
| `card-390-light`       | Fixture teacher answer with unsent follow-up        |

Focused question/widget screenshots temporarily hide the sticky header to prevent
it covering the capture. Full-page screenshots preserve the shell. Placeholder
shell questions receive the same fixture textarea on both sides; no synthetic
assessment submissions release the teaching in these captures. Ask uses the
existing fixture teacher boundary, not model inference. The card is deleted
through its confirmation between matrix cases.

`missing-hook.png` and `missing-hook.json` show a v2 document missing
`.cl-q-prompt`: the specific error disables editing and sends zero POSTs. Correcting
the source and explicitly reloading restores `fresh`; a distinct native range
control then responds to the keyboard (50 → 51). No fallback or saved-file
migration is performed. Full grading, gates, recovery and private-route behavior
are checked separately by the standard browser and real-host targets.

## Repeated authoring comparison

`authoring-comparison.json` summarizes two preplanned generations per host on both
main and v2, including every failure and evaluator error. Raw transcripts, saved
classrooms, semantic reports and source hashes remain in the listed local artifact
directories. Read scores only over the judgments that actually completed; they do
not establish a quality improvement or human learning.

| Source | Claude 1   | Claude 2    | Codex 1     | Codex 2    |
| ------ | ---------- | ----------- | ----------- | ---------- |
| Main   | FAIL; 8/22 | PASS; 5/14  | PASS; 11/14 | PASS; 5/12 |
| V2     | PASS; 6/14 | PASS; 11/16 | FAIL; 5/6   | PASS; 2/7  |

The main Claude failure was a missing `main[data-cl-content]` in generated output.
The v2 Codex failure was a missing accepted standalone checker receipt for the pipe
lesson: the author combined edits and checks in multiline commands. Its pages
validated, submitted, graded and reloaded, but that does not erase the failed
receipt requirement. The receipt parser and original failed verdict remain intact.
The later Codex generation was the second planned comparison, not a replacement
for the first result.

Quality reports on both sides still identify incorrect or ambiguous generated
keys/stimuli, answer cues, weak transfer and missing faded support. Several
judgments have unavailable reports due to quotation/schema errors; one main
Claude evaluation process also exited unsuccessfully. These are reported as
coverage limits. No generated content was repaired to raise a quality score.

## Receipt-failure recovery

The original v2 Codex run remains FAIL. Its raw `codex-authoring.jsonl` shows
`item_48` successfully checking the final pipe page inside a multiline Python
edit/check command; no standalone pipe check followed. Earlier attempts rejected
an authored script accessing a gated element (`null.addEventListener`). The agent
removed that script, but omitted the required standalone final receipt. This is an
agent instruction failure; rejecting that combined command is expected harness
behavior, not an environment outage or a validator defect.

The teach skill now spells out the separate post-repair checker call. The Codex
verification prompt also asks the author to reconcile every final page with its
four-file receipt before ending. Receipt parsing and mechanical expectations are
unchanged. Recovery authoring runs are directed verification after that correction,
not replacements for either preplanned quality-comparison generation. Original
transcripts, failed artifacts, saved classrooms and verdicts remain untouched.

Diagnosis and extracted original checker executions are retained in
`/tmp/studens-142-recovery-diagnosis`. New checks use
`/tmp/studens-142-recovery-authoring-claude`,
`/tmp/studens-142-recovery-authoring-codex`, and
`/tmp/studens-142-recovery-final`.

Both directed recovery authoring runs passed the v2 page, standalone four-file
receipt, submission, grading and reload checks. See
[recovery-verification.json](recovery-verification.json). Claude judged 13/22
applicable quality criteria as passing; findings include answer cues, weak
transfer, missing faded support and rubric limitations. All three Codex semantic
reports failed exact-source quotation validation (0 judgments); none is a quality
pass. Background refill status is recorded separately and is not a refill-suite
verdict. These results do not change the original comparison or prove learning.

Final full `npm run verify` passed: version agreement, formatting, types, 1,413
tests in 101 files, and the complete browser suite, including the previously
interrupted code-review phase. Implementation and harness bytes match the launch
snapshot; recipe/evidence documentation completed afterward passed Prettier.
