# Start a review

Start a daily review from Classrooms or a spaced review from the classroom memory map. Pi, Claude Code, and Codex assemble
prepared private variants without a model turn. The selected questions, keys, and
plan are saved before publication. Existing in-flight authoring requests retain
their original host and recovery behavior.

## Sub-features

- Use classroom **Up next** to resume saved unfinished work, otherwise review due items or start the next lesson. Lessons and the compact forecast precede the memory rows.
- Expand an objective row to read per-objective evidence strength, latest answer time/context/credit, open or resolved gaps, and next due time. Older question identities keep original lesson links.
- Expand **Why is this due?** for the replayed schedule reason, saved source, evidence counts and explicitly estimated stability/difficulty.
- Read fourteen UTC saved-due dates visually or in a keyboard-accessible table; compare today’s backlog with the actual shared allowance and deferred count.

- Choose Quick 3 through 12 items, a classroom, and a topic from saved objective groups (historical questions use their original lesson).
- Show the total due across all classrooms, including classrooms in folders.
- Start or continue saved daily groups, with one classroom at a time.
- Keep daily group history and each classroom’s review history separate from Lessons.
- Open due prepared questions immediately without teacher authoring.
- Opt into early review without extending its saved interval, including after a miss.
- Retire or restore an item while retaining its evidence, grades, and published reviews.
- Flag a bad question in the owning teacher panel with durable status and explicit retry.
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

From Today, read `N due across classrooms` and select `Start daily review`.
The daily overview shows each classroom separately. Select `Continue <classroom>
review`, answer all its cards, then use `Continue daily review` to return to the
classroom groups. The next classroom starts only when all earlier cards are graded.
Reload or another tab must reuse the daily batch. Correct an error’s cause before
selecting `Retry <classroom> review`. Read earlier groups from `Daily review history`
or each classroom’s `Review history`. A zero-due landing disables start while an
unfinished daily batch can still be continued.

For a single classroom:

1. Open a classroom with due check questions and prepared private pools.
2. Choose `Review size` and `Topic` in the memory map, then select `Start review`. Enable
   `Review early anyway` to include items before their due date. Options survive reload;
   the ready review preserves its selection and original item identities.
3. If publication fails, read the specific error and select `Retry review` after
   correcting its cause. Reload must not retry it automatically.
4. Answer the current card and submit. Closed answers grade immediately. Read the
   feedback, then select `Next question`. A miss starts a corrective panel question;
   answer on this screen. Failed teacher work requires `Retry request`.
5. Reload during an unfinished review. The current card, saved draft, earlier grades,
   and original schedule must be preserved. `Continue review` resumes the unfinished
   session from the classroom memory map.
6. On a card, select `Flag bad question`. Describe the problem in the prefilled
   teacher reply, then select `Send reply`. The report includes the original key and
   displayed question. Reload preserves the report and any failed request; use
   `Retry request` explicitly. Send or clear an existing reply draft before flagging.
7. Select `Retire item` on a card or in classroom `Manage review items`. Reload:
   active counts exclude it, its history remains, and `Restore item` restores selection.
   A published review remains answerable. Conflicting edits show a specific error;
   use `Retry item action` after resolving a lock, or reload after a stale-tab error.
8. Open `Review history` from the classroom or review screen. Reviews appear here,
   with answered counts, and stay out of Lessons. Open an older numbered review link.
9. For an item with three unresolved misses, select `Open short re-teach` in the memory map,
   then `Start short re-teach` on the lesson page. Read the explanation and reply there.
   A failure keeps its specific error after reload and requires `Retry request`.
   A message interrupted before queuing offers `Retry short re-teach`.

## Driving it with playwright-cli

Run `npm run verify -- browser --artifacts /tmp/studens-review-browser`.

The memory-map drive uses production saved-attempt replay and isolated Pi, Claude
and Codex service-owner fixtures. No model connection is claimed. Inspect
`memory-map/<owner>/result.json`, `source-before.json` and `read-only-hashes.json`.
It expands rows with Enter and compares every row’s latest answer time and expanded schedule reason to replay,
and table counts to fourteen saved UTC due dates. It follows legacy original lesson
links and the course map, uses Enter for explanations/table, and captures 1280×800
and 390×844 in both themes, including long unbroken objective text. The primary action stays above the fold at both sizes, with exactly one visible primary control. Visiting an unfinished lesson switches Up next to Resume and retains it after reload; completed lessons leave review as the next step. Evidence times show relative/local text and expose exact UTC on hover or keyboard focus. Expand **How review is scheduled** for the allowance and scheduling details. Reads make no
non-GET/HEAD requests and leave classroom hashes unchanged. An explicit native
retire/restore and prepared closed review correction update the map after reload;
restart retains one grade. Malformed saved timing gives a specific error and explicit
**Retry loading review state** after correction; private inputs remain 404.
The focused command is
`node --input-type=module -e 'import {verifyMemoryMapBrowser} from "./scripts/e2e-memory-map-browser.ts";await verifyMemoryMapBrowser("/tmp/studens-memory-map")'`.
Owner attachment happens before the fixture histories are seeded, so this drive
isolates read projection from startup maintenance/refill work. It does not verify
teacher maintenance or model behavior; select the existing host targets for those.

The review fixtures check Pi and the service. Wait for the active card to reach
`data-state="fresh"` after opening Continue review, before selecting an answer. They cover zero model turns during
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

The control fixtures exercise both Pi and service queues. They choose Quick 3 and request 12 through the browser with paused and retired items excluded even for early review,
navigate classrooms, pick a saved objective group, reload
options, answer early with assistance and compare the original due date, retire and
restore while preserving evidence, and flag a question. Each report deliberately
fails once, stays failed on reload, and reaches the fixture teacher only after
`Retry request`. The service fixture changes the model in Settings while the report
is failed: selection alone must not retry or rewrite its snapshot; explicit retry
uses the new model in the same conversation, and server restart retains the durable
report and requested/answering metadata. Its catalog and teacher are fixtures.
The prepared early cards also retain private criterion definitions and code-owned
allocations alongside selection timing. The fixture checks both snapshots remain
off learner state while the saved missed criterion and original due date survive.
They probe invalid size, a real edit lock, stale revisions,
corrupt control state with `Retry loading review state`, malformed saved options
with `Reset review options`, failed item loading with `Retry item state`, an
existing teacher draft that must not be overwritten, unrelated classrooms,
private files, and startup without duplicate grades or reports. Inspect
`review-controls/pi/` and `review-controls/service/`, especially `result.json`.

The workload fixtures drive 20 overdue items with 5 available slots and 15 deferred,
then complete 3 and 2 unique closed cards. Another start shows the explicit shared
allowance error; reload/restart preserve dates and grades. They also drive seven
classrooms through the daily landing: only five total new cards are saved, an
individual early start cannot bypass those reservations, and midnight/reload keep
unfinished plans. After completing carried cards, an explicit classroom takes three
new slots and the daily picker receives the remaining two. Inspect
`review-workload/result.json`, `root/result.json`, and matching desktop/mobile
screenshots below `review-workload/` (the root report is `review-workload/root/result.json`). The server clock is fixed and advanced across
UTC midnight; this proves workload boundaries, not real elapsed human retention.
The control fixture's later unrelated classroom now receives the shared allowance
error after earlier cards consume its slots. Contract tests cover multi-day allowance
ramping, nine-classroom/topic fairness, duplicate identities across classrooms,
independent host processes and explicit lock contention. For this focused browser
path, the exercised command is
`node --input-type=module -e 'import {verifyReviewWorkload} from "./scripts/e2e-review-workload.ts";await verifyReviewWorkload("/tmp/studens-workload")'`.

The card fixtures additionally check two-card order, immediate correct feedback
without a model turn, a miss followed by a same-screen corrective exchange, 375px
layout, second-card drafts, completion counts, duplicate submission rejection,
private history routes, legacy links, and startup without duplicate grades or
corrections. The service fixture fails a correction and checks explicit retry after
reload. Invalid saved state shows its specific error and `Retry review state`.
Inspect `review-cards/pi/` and `review-cards/service/`, including `result.json`.

The card fixtures also require ordinary entry, fresh/finished reloads, saved-card
links and keyboard next/previous navigation to retain the selected card without a
teaching-source notice or stolen focus. A later-card URL cannot bypass an unanswered
card. Navigation preserves every classroom file hash and adds no teacher turns;
draft saving and the two explicit submissions are separate controlled writes.
Inspect `*-hashes.json`, `result.json`'s `fragments`, and mobile light/dark captures.
An unknown card fragment still shows the source error and retry link; returning to
an existing card removes that notice. The focused command is
`node --input-type=module -e 'import {verifyReviewCards} from "./scripts/e2e-review-cards.ts";await verifyReviewCards("/tmp/studens-review-cards")'`.
Use the [lesson-source recipe](reading.md) for valid/stale teaching destinations.

The daily fixtures additionally exercise the landing buttons, a second view, two
unrelated subjects in separate classroom groups, mobile layouts, saved drafts,
a partial publication conflict, explicit retry after reload, unchanged original
grade revisions, one grade per card, corrective replies on the relevant review
page, empty due work, malformed daily state, and private routes. Inspect
`daily-review/pi/` and `daily-review/service/`, including `result.json`,
`selected-before-progress.json`, and `partial-failure.json`. The service fixture
keeps Biology on Claude and Rust on Codex; these fixture teachers prove routing,
not real model access. Contract tests additionally reject foreign ownership and
competing unfinished reviews. Daily selections use the same prepared-variant boundary as the classroom memory map and one root-wide allowance. The daily fixtures
also use predeclared private criteria, require the saved publication contract,
render the code-owned closed allocation, and verify criterion/timing snapshots
remain private. Daily contracts additionally reuse an existing early judgment
review through restart and grade its fixed components without extending the due cap.

Daily edits also share a root transaction lock across live Pi and service processes.
If another server is saving, read its specific lock error, then explicitly retry;
loading status cannot publish or retry a classroom. Foreign start/continue/retry
actions must leave the owning host's saved errors and progress unchanged. A
published classroom review still opens across hosts. A delayed landing start after
the first classroom is graded must leave the next group planned until its explicit
`Start <classroom> review` control is used.

Replayed item fields also enter the dedicated teacher context as a complete array.
Changes to those fields require the real Pi, Claude and Codex targets even though
viewing the memory map itself must remain inference-free.

For service or shared prompt changes, select the real Claude and Codex drives from
the project skill. Each opens a prepared closed review, submits a miss, checks its
immediate grade, receives a real corrective question, and replies in the same panel.
Inspect `stored-review.json`, `stored-refills.json`, and the host review screenshot. Select the Pi drive
for Pi client or teacher changes and inspect `stored-review.json`, `pi-review.png`, and
`pi-review-correction.png`. All service hosts capture `<host>-review-correction.png`. Each real host uses
`Flag bad question` and `Send reply`, receives a teacher response, reloads the saved
report, and preserves quiz grading. Inspect `stored-question-report.json` and
`<host>-question-report.png`.
The real host drives now enter through `Start daily review`, retain separate Rust
and Biology plans, perform the real Rust correction and report, and explicitly
complete Biology before reloading the finished batch. Inspect `stored-daily.json`
and `<host>-daily-complete.png`. The lesson material is a fixture; the host and
corrective teacher are real at the prescribed settings.

Service quiz and historical-resume drives retain `quiz-retrieval-task.json` and
`resume-retrieval-task.json`. Mechanical checks link the visible panel message to
its completed validated request and saved grade; callless plans have zero applied
calls even when the field is absent. Inspect each complete saved task manually:
it must request fresh, answerable retrieval in the relevant lesson, without giving
that task's answer. An imperative can satisfy this requirement without a question
mark. Generic feedback fails this semantic review even if mechanical checks pass.
Current panel timing uses the host-owned saved learner reply time and latest actual
feedback/check boundary. The old selected review delay cannot label a new correction.
Inspect new checks for `answeredAt` matching the learner message, separately from
the check write time `at`; queued teacher latency must not manufacture delayed evidence.
The subsequent real learner reply must still create its original linked evidence
and learning record while preserving the grade.

Unexpected native corrective-reply or background-refill failures stop the ordinary host drive on the original request. Preserve the failed screenshot/request and `failed-review-refills.json`; do not rerun generation to turn that gate green. Product Retry controls remain available. Any parent-approved causal retry is separate evidence and does not replace the original verdict.

Controlled browser recovery remains in the default `npm run verify`: `e2e-review-cards.ts` injects a correction error, reloads without inference, and explicitly retries; `e2e-review-controls.ts` does the same for a failed question report while checking the saved model snapshot; `e2e-review-browser.ts` injects a background-provider failure and explicitly retries exactly once without changing the grade or unlocking the quiz. Inspect `browser/review-cards/{pi,service}`, `browser/review-controls/{pi,service}`, and `browser/review/{pi,service}` including failed/retried captures and saved result state. These teachers are fixtures, not native authoring successes.

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
failed teacher work with request errors contained within the mobile viewport, explicit
retry, the explanation, a learner reply, and reload.
Inspect `reteach/pi/result.json`, `reteach/service/result.json`, and their screenshots.
They require unchanged assessments and no delayed-retention credit. Real host drives
also include this entry after their existing teacher checks; an earlier host failure
leaves the re-teach entry unverified for that run. Inspect the first saved teacher
message for the complete explanation, worked example, and question. A reminder that
refers to unseen teaching is a failure even if the mechanical target passes. Service
learners see only the structured plan's message, not other model-session prose.

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

Miss counts remain cumulative. An independently demonstrated latest result can resolve the current gap
under existing evidence rules; assisted or unknown-independence replies keep the pause, including historical questions without an objective snapshot; opening a re-teach never resets the count. The two-miss
health warning remains earlier than the three-miss review pause. Private request
instructions and variant keys must not appear in the learner's help message.
Daily plans live privately at the classrooms root. GET status never publishes a
classroom or retries a failure. A stale progression click cannot start a later
group. An ownership error names the classroom’s selected host; daily navigation
never attaches it to a different backend.

If an unstarted group’s canonical due selection changes, opening it shows a stale
selection error. Explicit retry refreshes the plan before publication. If no due
items remain, that group finishes with no new review or grade. Published reviews
retain their saved questions and assessment history.

A failed child publication also rechecks current eligibility before explicit retry.
If its item was retired or paused after the failure, the specific error persists
without publishing it or replaying completed groups. Repair the cause (for example,
restore the selected item), then explicitly retry the same saved plan. Already
published cards remain available. A queued early review retains its saved early
option while applying all other canonical exclusions.
