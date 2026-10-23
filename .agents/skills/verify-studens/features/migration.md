# Migrate saved lesson UI

An agent explicitly lists saved legacy lessons, rebuilds their markup to v2 and
recovers interrupted migration without changing private grading history.

## Sub-features

- Discover canonical and alternative filenames, legacy lessons and private reviews.
- List without changing disk bytes, modes or modification times.
- Require explicit apply and acknowledgement of unresolved learner state.
- Preserve rubric-bound assessments and all original private grading files.
- Check candidates through the disposable initial/released browser checker.
- Preserve original HTML on failure and require explicit retry.
- Continue a batch after a per-lesson failure and return nonzero overall.
- Recover a committed replacement from its journal without another check or grade.

## How to get to it (user POV)

1. Read [the agent migration guide](../../../../docs/MIGRATE-UI-2.md).
2. Stop classroom writers and back up the classroom.
3. Run `node scripts/migrate-ui.ts` to list legacy lessons.
4. Select a classroom/lesson and apply with `--apply --accept-state-loss`.
5. Read the specific failure, correct the candidate if required and use `--retry`.
6. Open the migrated lesson through its normal classroom link to inspect it.

## Driving it with the terminal and browser checker

Run `node scripts/e2e-migrate-ui.ts /tmp/studens-migration-check` with a new artifact
directory. It invokes the actual CLI and packaged browser checker against scratch
classrooms. Inspect `result.json`, the per-command JSON logs and
`dry-before-after.json`. The latter includes file/directory modification times,
modes and file digests before and after listing.

The intentionally thrown page error must leave the original HTML in place.
A command without `--retry` must refuse that saved failure. The corrected candidate
must convert legacy div questions to the v2 list and pass both browser stages. The mechanical path covers an alternative filename
and a dedicated private review. Batch processing must report the malformed lesson
and still migrate the next valid one. Recovery changes only the completion receipt;
the retained original key, attempt, grade and teacher-plan bytes stay unchanged.
Successful private journals retain the raw browser checker receipt. Scratch
classrooms are removed; logs and a fixture classroom snapshot remain as evidence.

Run `npx vitest run test/migrate-ui.test.ts` for assessment-change rejection,
source/private-input conflicts, existing locks, guarded symlinks and both sides of
the atomic replacement recovery boundary. These controlled tests supplement the
live command drive. Run the default verifier as required by the shared skill.

## Gotchas

Use a new evidence directory for every run. This fixture does not call a model or
prove teaching quality. No service-host protocol, prompt or visible UI is changed
by the migration command. Existing expected-answer source-digest gates remain in
force for earlier attempts. There is no automatic stale-lock takeover or grading
fallback. Manual recovery and the state-loss warning are part of the agent guide.
