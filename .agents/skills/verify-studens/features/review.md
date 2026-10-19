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
- Answer one card at a time, with immediate closed grading and explicit next/previous navigation.
- Keep review history outside Lessons, including legacy numbered review links.
- Grade each card once and update its original objective schedule.
- Continue corrective teacher questions and replies beside the current card.
- Combine same-attempt probes into one objective and select an independent transfer variant when required.
- Preserve historical question schedules and their unknown context.
- Keep all variant pools, private keys, and saved documents off HTTP routes.
- Refill low pools and target missed ideas behind queued learner requests.
- Keep background errors visible with explicit retry after reload.
- Pause unresolved items after three cumulative incomplete attempts, with one exposure per objective per attempt and latest grade revisions only.
- Open a short re-teach on the original lesson page and keep its explanation and replies there.
- Preserve grades and miss history through re-teaching; assisted replies cannot establish delayed retention.

## How to get to it (user POV)

1. Open a classroom with due check questions and prepared private pools.
2. Select `Start review` in Progress. The ready review opens.
3. If publication fails, read the specific error and select `Retry review` after
   correcting its cause. Reload must not retry it automatically.
4. Answer the current card and submit. Closed answers grade immediately. Read the
   feedback, then select `Next question`. A miss starts a corrective panel question;
   answer on this screen. Failed teacher work requires `Retry request`.
5. Reload during an unfinished review. The current card, saved draft, earlier grades,
   and original schedule must be preserved. `Continue review` resumes the unfinished
   session from classroom Progress.
6. Open `Review history` from the classroom or review screen. Reviews appear here,
   with answered counts, and stay out of Lessons. Open an older numbered review link.
7. For an item with three unresolved misses, select `Open short re-teach` in Progress,
   then `Start short re-teach` on the lesson page. Read the explanation and reply there.
   A failure keeps its specific error after reload and requires `Retry request`.
   A message interrupted before queuing offers `Retry short re-teach`.

## Driving it with playwright-cli

Run `npm run verify -- browser --artifacts /tmp/studens-review-browser`.

The review fixtures check Pi and the service. They cover zero model turns during
assembly, legacy pool absence, a publication conflict and explicit retry, reload,
automatic navigation, saved answers, another host opening the finished document,
mobile controls, private routes, grading, and the original schedule. They also check
a failed background refill, its persisted error, and explicit retry while the quiz
stays available. Queued refills use the latest pool at execution, so an earlier
queued write cannot leave the next request with stale variant IDs. Inspect
`review/pi/result.json` and `review/service/result.json` and their screenshots.
The service fixture combines three probes into one transfer-needed objective and
grades its prepared independent transfer. Publication contracts reject retrieval
or assisted tasks for that objective before writes. Its background refill retry
must append to the original question pool while retaining the objective key.

The card fixtures additionally check two-card order, immediate correct feedback
without a model turn, a miss followed by a same-screen corrective exchange, 375px
layout, second-card drafts, completion counts, duplicate submission rejection,
private history routes, legacy links, and startup without duplicate grades or
corrections. The service fixture fails a correction and checks explicit retry after
reload. Invalid saved state shows its specific error and `Retry review state`.
Inspect `review-cards/pi/` and `review-cards/service/`, including `result.json`.

For service or shared prompt changes, select the real Claude and Codex drives from
the project skill. Each opens a prepared closed review, submits a miss, checks its
immediate grade, receives a real corrective question, and replies in the same panel.
Inspect `stored-review.json`, `stored-refills.json`, and the host review screenshot. Select the Pi drive
for bridge changes and inspect `stored-review.json`, `pi-review.png`, and
`pi-review-correction.png`. Service hosts also capture `<host>-review-correction.png`.
If generated background output fails validation, the host drive retains
`failed-review-refills.json` and `review-refills-failed.png`, then presses each
failed request's `Retry request` once. A second failure stops the check.

For the refill protocol, run `npm run verify -- refill claude`, then
`npm run verify -- refill codex`, with separate artifact directories. Each target
seeds a missed answer and a saved invalid refill plan in an isolated classroom,
opens the actual MCP host, observes the persisted failure, and clicks `Retry request`
in the browser. The real teacher must add exactly one private targeted variant,
leave the original key and grade unchanged, and keep the quiz locked. Inspect
`classroom/.review-refills.json`, `failed-refill.png`, and `retried-refill.png`.
The initial failed plan is a fixture at the production recovery boundary.

The repeated-miss fixtures in the same browser target inspect three saved failures,
paused due counts, desktop and mobile offers, a Pi message interrupted before queuing,
failed teacher work, explicit retry, the explanation, a learner reply, and reload.
Inspect `reteach/pi/result.json`, `reteach/service/result.json`, and their screenshots.
They require unchanged assessments and no delayed-retention credit. Real host drives
also include this entry after their existing teacher checks; an earlier host failure
leaves the re-teach entry unverified for that run.

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

New sessions use `/c/<classroom>/reviews/<review-id>` and private `.reviews/`
storage. Numbered legacy sessions retain their documents, URLs, drafts, saved
publication plans, and grading recovery. History does not move or rewrite them.
Each new card is its own quiz; completing one card cannot finish the other cards.
Consecutive Pi misses queue separate durable corrections behind the active turn;
recovery keeps one grade and one corrective request per submission.

Miss counts remain cumulative. A successful latest result can resolve the current gap
under existing evidence rules; opening a re-teach never resets the count. The two-miss
health warning remains earlier than the three-miss review pause. Private request
instructions and variant keys must not appear in the learner's help message.
