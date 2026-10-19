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
- Refill low pools and target missed ideas behind queued learner requests.
- Keep background errors visible with explicit retry after reload.

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
mobile controls, private routes, grading, and the original schedule. They also check
a failed background refill, its persisted error, and explicit retry while the quiz
stays available. Inspect
`review/pi/result.json` and `review/service/result.json` and their screenshots.
The service fixture combines three probes into one transfer-needed objective and
grades its prepared independent transfer. Publication contracts reject retrieval
or assisted tasks for that objective before writes. Its background refill retry
must append to the original question pool while retaining the objective key.

For service or shared prompt changes, select the real Claude and Codex drives from
the project skill. Each drives a prepared review after the teacher conversation.
Inspect `stored-review.json`, `stored-refills.json`, and the host review screenshot. Select the Pi drive
for bridge changes and inspect `stored-review.json` and `pi-review.png`.

For the refill protocol, run `npm run verify -- refill claude`, then
`npm run verify -- refill codex`, with separate artifact directories. Each target
seeds a missed answer and a saved invalid refill plan in an isolated classroom,
opens the actual MCP host, observes the persisted failure, and clicks `Retry request`
in the browser. The real teacher must add exactly one private targeted variant,
leave the original key and grade unchanged, and keep the quiz locked. Inspect
`classroom/.review-refills.json`, `failed-refill.png`, and `retried-refill.png`.
The initial failed plan is a fixture at the production recovery boundary.

## Gotchas

Repeated clicks reuse the saved document and variant selection. A publication
failure requires explicit retry. Prepared documents recover without authoring.
Saved legacy service plans still resume without another model turn. Interrupted
legacy Pi authoring fails visibly when its owner stops. Hosts cannot take over
another host's unpublished work. Finished reviews open across hosts.

Background plans are saved before a private supplemental pool is updated. Recovery
must not call the model or grade again for saved output. Interrupted model work
requires explicit retry. Original keys stay unchanged so pending submissions retain
their original rubric.

Private source pools and published rubric files must return 404. Unfinished reviews
must be unavailable. The browser fixtures do not judge question quality or human
retention.
