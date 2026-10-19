# Start a review

Start a spaced review from classroom Progress. Pi, Claude Code, and Codex assemble
prepared private variants without a model turn. The selected questions, keys, and
plan are saved before publication. Existing in-flight authoring requests retain
their original host and recovery behavior.

## Sub-features

- Open due prepared questions immediately without teacher authoring.
- Skip legacy questions without pools with a specific message.
- Preserve selections after reload and publication retry.
- Return to draft answers in an unfinished review, including from another host.
- Grade a review and update its original objective schedule.
- Combine same-attempt probes into one objective and select an independent transfer variant when required.
- Preserve historical question schedules and their unknown context.
- Keep all variant pools, private keys, and saved documents off HTTP routes.

## How to get to it (user POV)

1. Open a classroom with due check questions and prepared private pools.
2. Select `Start review` in Progress. The ready review opens.
3. If publication fails, read the specific error and select `Retry review` after
   correcting its cause. Reload must not retry it automatically.
4. Answer the review. Use `Continue review` to return to saved draft answers.
5. Submit and reload. The grade and original schedule must be preserved.

## Driving it with playwright-cli

Run `npm run verify -- browser --artifacts /tmp/studens-review-browser`.

The review fixtures check Pi and the service. They cover zero model turns during
assembly, legacy pool absence, a publication conflict and explicit retry, reload,
automatic navigation, saved answers, another host opening the finished document,
mobile controls, private routes, grading, and the original schedule. Inspect
`review/pi/result.json` and `review/service/result.json` and their screenshots.
The service fixture combines three probes into one transfer-needed objective and
grades its prepared independent transfer. Publication contracts reject retrieval
or assisted tasks for that objective before writes.

For service or shared prompt changes, select the real Claude and Codex drives from
the project skill. Each drives a prepared review after the teacher conversation.
Inspect `stored-review.json` and the host review screenshot. Select the Pi drive
for bridge changes and inspect `stored-review.json` and `pi-review.png`.

## Gotchas

Repeated clicks reuse the saved document and variant selection. A publication
failure requires explicit retry. Prepared documents recover without authoring.
Saved legacy service plans still resume without another model turn. Interrupted
legacy Pi authoring fails visibly when its owner stops. Hosts cannot take over
another host's unpublished work. Finished reviews open across hosts.

Private source pools and published rubric files must return 404. Unfinished reviews
must be unavailable. The browser fixtures do not judge question quality or human
retention.
