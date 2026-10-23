# Migrate saved lessons to UI contract v2

This is an explicit agent-run, offline operation. Unmarked saved lessons continue
using their existing contract until you migrate them. Read this guide and
`assets/templates/quiz.html` before making changes.

**Highlights, threads, drafts, and attempt state may stop resolving after a
migration. There is no preservation guarantee.** Back up the whole classroom,
stop the persistent classroom service and other writers, and close learner tabs
before applying changes. Do not edit a lesson while a teacher request is pending.
Keep the backup until the learner has checked the result.

## Discover without writing

From the installed package root, run:

```bash
node scripts/migrate-ui.ts
node scripts/migrate-ui.ts --classroom biology
node scripts/migrate-ui.ts --classroom biology --lesson 001-cells
```

`PI_CLASSROOMS_DIR` selects the classrooms root; the default is
`~/.pi/agent/classrooms`. Listing creates no directories, journals, service
sessions, or browser state. Each JSON line identifies a legacy lesson, unfinished
migration, or specific discovery failure. Already marked v2 lessons are omitted.
Discovery includes alternative HTML filenames, numbered legacy reviews and private
`.reviews/review-<uuid>` documents. Classroom assets, references and learning
records are excluded. A marker in a comment does not count.

## Apply a mechanical rebuild

```bash
node scripts/migrate-ui.ts --apply --accept-state-loss --classroom biology --lesson 001-cells
```

Omit the lesson or classroom filter only when you intend to process all matching
lessons. Work runs sequentially; a failure reports its classroom, lesson and reason,
then processing continues. Any failure makes the command exit nonzero. Nothing
retries automatically. Unknown or incomplete arguments fail before work starts.
The state-loss warning is printed before any apply operation.

The mechanical path adds the v2 root marker and component hooks from the current
templates, including inert pretest teaching. It patches source tags rather than
serializing the whole document. It keeps the objective, teaching content,
assessment content, scripts, controls and identities. It cannot infer missing
question structure or repair arbitrary authored HTML. Such lessons fail explicitly.
There is no fallback to an agent, teacher, another backend or a replacement rubric.

## Agent rebuild for structural failures

1. Read the original HTML, lesson metadata, objective mappings and private rubric.
   Read `assets/templates/lesson.html`, `assessment.html`, `review.html` as appropriate,
   and the complete `quiz.html` contract. Keep private answers out of public HTML.
2. Write a candidate HTML file **outside the live classroom**. Preserve the learning
   objective and teaching content. Rebuild the shell and presentation using exactly
   one `main.cl-lesson-shell[data-cl-content][data-cl-ui="2"]` and the current
   component hooks. Remove obsolete visual overrides only after reviewing their
   teaching purpose. Do not replace an interactive explanation with static text.
3. Preserve graded quiz DOM, text, scripts, options, data attributes, IDs and controls;
   only additive v2 component classes and the question-list structure may change.
   Legacy `div.cl-q` questions can become `li.cl-q` inside a direct
   `ol.cl-questions`; preserve their attributes and children exactly. Preserve pretest gates and
   their contents, including teaching and later quizzes. Keep teaching block IDs
   and source declarations. Missing assessment structure must be repaired without
   changing its meaning. If that cannot be done under these constraints, report the
   lesson as blocked; create a separate new lesson through normal authoring instead.
4. Pass the candidate explicitly:

   ```bash
   node scripts/migrate-ui.ts --apply --accept-state-loss --classroom biology --lesson 001-cells --candidate /absolute/path/candidate.html
   ```

   For a previously failed or interrupted migration, add `--retry`. A corrected
   candidate replaces only the saved candidate, never the preserved original.

5. The command validates the v2 promise, unchanged assessments and private contracts,
   then runs `scripts/check-lesson.ts` against disposable state. It checks both
   initial and released gates, errors and authored controls. The checker must pass
   before the live HTML is replaced. Missing browser prerequisites are a failure;
   fix the stated cause and issue an explicit retry. Do not bypass the checker.
6. After success, open the lesson through the ordinary classroom link. Inspect
   reading order, typography, keyboard controls, teaching interactions and gated
   content. Do not submit a quiz as part of migration. The checker verifies controls,
   not teaching quality or every visual override. See `docs/EVALUATION.md` for
   teaching-quality evaluation.

## Private grading and recovery

**Keep the existing rubric.** This is simpler and preserves the grading contract.
The migration never regenerates or rewrites keys, objective plans, metadata,
submissions, grades, review pools or teacher state. It does not invoke a teacher,
replay requests, award evidence or regrade. Source-bound expected-answer access for
old attempts can become unavailable when HTML changes; migration does not weaken
that digest gate or invent replacement answers.

Before checking or replacing a candidate, the command saves the original HTML bytes
(base64), candidate and input hashes in private `quiz/ui-migration.json`. This is a
migration plan and backup, not a teacher plan. The existing `quiz/` static-route
guard keeps it off HTTP routes. All live paths use `src/paths.ts` guards, including
symlink rejection. Preserve this journal and your full backup.

Replacement is an atomic rename only after validation and the browser check pass,
and after confirming the original inputs still match. A failed validation/check
leaves the original HTML in place and retains the failed candidate and reason.
A concurrent edit is left in place and reported; never overwrite it to force success.

```bash
node scripts/migrate-ui.ts --apply --accept-state-loss --classroom biology --lesson 001-cells --retry
```

Retry reuses the saved candidate unless `--candidate` is also supplied. An
interruption after the HTML rename but before the completion receipt is recovered
by matching the saved candidate hash and completing the receipt. No teacher,
checking or grading runs again in that case. A completed migration is a no-op.
Changed source/private inputs fail with a specific conflict and require manual
reconciliation from the preserved backup before retry. Do not delete private
assessment history to make migration pass.

The exclusive `quiz/ui-migration.lock` prevents concurrent migration commands. An
interrupted process may leave it behind. Confirm that its process has exited and
all classroom writers are stopped, remove only that lesson's stale lock, then run
the explicit retry command. There is no automatic stale-lock takeover. Power-loss
recovery still depends on the filesystem and the separate classroom backup.

To roll back, stop writers, restore the journal's original bytes to its recorded
HTML filename using an atomic replacement, and archive/remove this migration's
journal. Do not roll back newer learner/private state from an old backup. Review
any source-bound state with the learner before resuming.
