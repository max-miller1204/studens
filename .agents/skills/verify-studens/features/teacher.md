# Teacher conversation

The learner receives follow-up questions and answers them in the lesson's teacher panel.

## Sub-features

- Place the panel after the submitted quiz.
- Point new-message notices toward the teacher, update them while scrolling, and render teacher Markdown.
- Resume a graded historical review from initiating chat with `resume_lesson_teacher`.
- Reuse pending panel work and reject cross-lesson or cross-host handoffs.
- Recover a saved panel reply whose teacher request was lost.
- Save replies and restore the conversation after reload.
- Link a successful panel check to a learning record without changing the quiz grade.
- Show classroom activity across pages, with item links, queued work, specific failures, and explicit retries.
- Regenerate a plan rejected before writes. Keep valid plans for recovery.
- Request a new grade plan after an explicit retry of a rejected score.
- Keep the persistent service available after Pi or MCP exit.
- Switch the dedicated teacher to the opening app after active work and readiness.
- Check same-adapter readiness without replacing its saved session or model.
- Migrate all classrooms together when opening the list. Keep prior owners if readiness fails.
- Process concurrent opens in service order. Keep saved grades and request order.
- Discover the packaged Pi teaching skills alongside the classroom extension.

## How to get to it (user POV)

1. Submit a quiz.
2. Read the teacher's question below it.
3. Enter an answer in `Reply to your teacher`.
4. Select `Send reply`.
5. Use `Retry request` only when a request fails.
6. To resume a graded review from chat, ask to continue. Open the returned lesson link.
   Read the existing question or the response to your saved panel reply.

## Driving it with playwright-cli

Run `npm run verify -- browser --artifacts /tmp/studens-teacher`.

The default browser target includes `ownership/`. It uses the public MCP dispatcher,
HTTP and browser controls with a controlled dedicated-teacher boundary. Submit a
quiz, start a Codex open during Claude grading, and send a panel reply while
switching. Require one Claude grade before Codex readiness and a Codex reply after
commit. Inspect `switching.png`, `after.png`, `active-boundary.json` and `result.json`.
The same drive checks same-adapter session reuse, conflicting or unknown hosts,
startup failure without a link, list-wide failure without partial ownership,
concurrent list and named opens, private routes and restart without another grade.
These fixture adapters do not prove real provider startup or model behavior.

Run `npx vitest run test/teacher-ownership.test.ts test/service-process.test.ts`
for active failure and explicit retry, pre/post-commit recovery, interrupted batch
writes, session provenance and real MCP stdio transport. Use the real-host targets
below to check provider access. A passing single-host run does not prove every
cross-provider model combination.

Run `npx vitest run test/service-control.test.ts test/service-process.test.ts` to
check real control sockets and MCP. An ordered open must stay connected while
it waits for bounded teacher turns. Other control calls retain their timeout.

The legacy Pi bridge fixture checks `.cl-teacher` follows the quiz, a prose-only grading run fails, and an explicit retry permits grading. It checks the panel reply reaches the correct prompt and all three conversation messages survive reload.

It also receives replies while reading before and after the quiz. The notice must point down or up toward the teacher, update when scrolling past the panel, and dismiss when clicked as the teacher comes into view. Inspect `pi-panel/teacher-notice-below.png`, `pi-panel/teacher-notice-above.png`, and `pi-panel/pi-panel.json`.

The service fixture checks failure, retry, MCP disconnect and reconnect, request isolation between lessons, and teacher drafts. Inspect `pi-panel/pi-panel.json` and service state evidence.

For MCP connection cleanup, run `npx vitest run test/mcp-stdio-lifecycle.test.ts test/service-process.test.ts test/service-process-owner.test.ts`.
The actual launcher/service checks use both Codex and Claude client identities: discovery,
status and stop leave a stopped service stopped; start serves HTTP; acknowledged stop
followed by stdin close must exit without a detach error. A refused stop keeps its
specific error and leaves HTTP live after client exit. A held fixture teacher keeps
running and queued requests intact across live detach, then saves each grade once.
After a stop acknowledgement, wait for the exact recorded PID to exit and its owner
file and socket to disappear before asserting stopped status. The acknowledgement
precedes teardown; a status connection during listener close can report
`connect ECONNRESET`. Keep that transport error visible. Fixture cleanup validates
the recorded package and port, closes its MCP children, and waits for owned teardown;
it must not probe the closing listener or treat missing paths alone as process exit.
The simultaneous-start fixture holds both real startup children before product
imports. It releases one winner and requires the other start to remain pending
with HTTP live. Release the loser, require its actual exit and both successful
same-owner replies, then stop publicly and require natural owner exit and absent
owner/socket without another start. A matching winner must not complete a start
while that invocation's child can still claim ownership later.
For a control-only service change, also drive the actual Pi extension in RPC mode
with an isolated `PI_CODING_AGENT_DIR` and offline resource loading: use
`/classroom start`, `/classroom status`, `/classroom rust`, initiating Pi exit,
reconnect, and `/classroom stop`. Require the same HTTP owner across initiating
exit, private routes returning 404, no teacher requests or provider calls, and
owned teardown. This does not replace the model drives for teacher changes.
The separate private-control boundary checks delayed stop replies at EOF, tool/RPC/
transport failures, an owner lost between the management probe and request, and an
unexpected missing socket on detach. Errors stay visible and never trigger a retry
or management autostart. Boundary fixtures prove lifecycle ordering, not inference.

The service fixture also submits a quiz whose teacher supplies a forbidden total score. The score-free operation must reject it. The fixture checks the visible error and the absence of a saved grade. `Retry request` must request one corrected plan with no total score. Reload must show the calculated grade. Inspect `service/rejected-grade.json`, `service/retried-grade.json`, and `service/grading-turns.json`. The grading turns must each permit exactly one grade call. Local recovery tests keep the score checks for older saved plans.

The resume fixtures use a saved review with an empty panel or an unanswered saved reply. They check the explicit handoff, panel link, reply recovery, message order, reload, and unchanged assessment and evidence files for Pi, Claude, and Codex. Repeated handoffs must reuse the request. Inspect `resume/`. The real Pi and service host drives also resume a historical 67% review from initiating chat. They check the saved grade and teacher identity.

The actual Pi target uses the same learner drive and dedicated service queue as Claude and Codex, including daily classroom groups. Its additional lifecycle drive closes the initiating Pi while teacher work runs, submits from two browser tabs, reconnects from a fresh Pi, rejects an unavailable model, and uses explicit retry after changing settings. It saves a real valid Pi grade plan while an owned scratch grade directory denies writes, restarts the service, retries the saved plan, then restarts again. Require one saved grade, unchanged plan and conversation bytes, no new inference, the exact Pi model, and low thinking. Explicit `/classroom stop` followed by Pi shutdown must produce no extension errors. Inspect `pi/lifecycle/`, including `lifecycle.json`, the original saved plan, private session transcript, and screenshots.

For launcher or production dependency changes, inspect `.github/workflows/ci.yml`
and run `npm ci`, `npm run verify`, and `npm run audit`. Audit is a separate CI
gate; it first checks actual installed production package versions against the
lock, then runs `npm audit --omit=dev --audit-level=moderate`. Preserve failures.
Require both checks: a published dependency shrinkwrap can install vulnerable
files even when an edited root lock passes audit. Do not accept that mismatch.

Use a clean exact-commit archive
without `node_modules`, retaining `docs/ATTRIBUTION.md`. Run `node mcp/launch.mjs`
with a scratch classrooms root, an unused loopback service port, and tailnet links
disabled. Send MCP `initialize` (client name `codex`) and `tools/list`. These are
lazy discovery; use `classroom_service` action `start` before checking HTTP ownership.
Require the real `npm ci --omit=dev --ignore-scripts` bootstrap, only JSON-RPC on
stdout, and the installed Pi SDK's `createAgentSession` export loading from that
archive. Run `npm run audit` inside that production-only archive too; verify its
actual SDK, undici, and brace-expansion manifests, rather than trusting edited
lock metadata. Development-only packages must be absent. Stop through the management
tool and remove owned scratch roots. No model turn or account edit is needed.
Wait for explicit stop to remove the owned socket before closing launcher stdin;
require exit 0 without `[classroom] detach failed`. Preserve unrelated warnings.
Record actual Node separately from the declared minimum, now 22.19.0.
Record the initiating Pi CLI separately from the dedicated SDK: `npm run verify -- pi`
uses the checkout's local CLI on npm's PATH. The patched dependency path is proven
with CLI/SDK 1.0.1, undici 8.10.2 and brace-expansion 5.0.12. Earlier 0.83.0 receipts
are historical. When changing the SDK, continue a copied saved session through an
actual Pi classroom command and browser reply; require the same session, preserved
old transcript bytes and completed requests, unchanged grade files, visible reload,
and owned cleanup. Disable cache warming as well as retries and compaction.

For Pi SDK resource/configuration changes, run
`npx vitest run test/pi-teacher-resources.test.ts`. This actual-SDK loading contract
configures global and project package/resource sentinels. Positive controls intercept
the SDK installer before execution; dedicated loading must make zero install attempts,
load no external resources, expose only the plan tool, retain model/thinking settings,
and preserve configuration/auth bytes. It uses no model turn or real account and
keeps package resolution enabled, so offline mode cannot hide a discovery failure.

For Pi request-envelope changes, run
`npx vitest run test/pi-teacher-envelope.test.ts`. This actual-SDK fixture reopens
one saved conversation through lesson, typed passage Ask/follow-up, refill, ordinary
and dispute requests. Passage responses contain only `annotation_id` and
`answer_markdown`; the host serializes their canonical saved operation. It inspects
the serialized provider transcript for the active schema and request text, permits
an ordinary `calls: []` reply only with the required outer fields, and requires
research tools to disappear after the explicit lesson. A dispute requires exactly
one `resolve_grade_dispute` call and a message. Its application rejects learning
records and notes; its active SDK loadout still contains only the plan tool. Only the provider stream
and auth preflight are controlled; it makes no real model or network call. A real
failed request still requires one explicit browser retry after an input correction;
a passing fixture does not erase its rejected output or prove why it failed.

`npx vitest run test/passage-answer.test.ts test/teacher-models.test.ts` checks
strict typed fields, annotation ownership, FIFO, raw output before decoding,
refused answer writes and explicit saved-plan recovery. Historical malformed
canonical JSON must remain failed until explicit retry requests new typed output.
Saved canonical plans recover without another inference or duplicate answer.

For a changed real Pi path, run `npm run verify -- pi`. For shared service or prompt changes, run `npm run verify -- claude`, then `npm run verify -- codex`. Add `--artifacts <directory>` to retain host evidence. These drives ask a question, submit a wrong answer, and reply in the panel. They check that the quiz score remains unchanged.

For Pi structured-return lifecycle changes, run
`npx vitest run test/pi-teacher-completion.test.ts test/pi-teacher-envelope.test.ts test/pi-teacher-native-errors.test.ts`.
These use the installed SDK session, tool wrapper, validator and agent loop with a
controlled provider stream. Require one provider request for one successful final
return, including ordinary, typed, lesson, refill, grading and dispute schemas.
Research-only batches must continue. One or several successful source reads and
the final plan in the same assistant batch must complete without another provider
request. The next ordinary request must remove research tools while reopening the
same session. Same-batch duplicate plans, invalid raw arguments, unknown tools,
research after a plan, source errors, external cancellation and the production
timeout must still fail. Probe interruption during mixed-batch research and after
its plan was recorded. Raw arguments must save before validation.
The SDK termination hint applies only when every result in a batch requests it;
it must never skip other calls already generated in that batch.

For a retained native failure, copy its classroom and exact private session into
an owned scratch root before starting the service. Save their original hashes and
request/session identities. Set `PI_CLASSROOMS_DIR` in the process launch
environment before importing storage modules, and require the service's reported
root to equal that scratch root. Startup must retain the failure without inference.
Use its lesson's `Retry request` once, after the causal repair; do not regenerate
the lesson or create a replacement learner request. Compare the original session
prefix, appended assistant/tool messages, durable request and answer count, and
assessment files after reload. Inspect matching before/after screenshots. This
scoped retry supplements the real Pi target; preserve that target's failures and
uncovered paths separately. Bind native evidence to its actual source hash; a later
completion repair needs separate coverage rather than inheriting its verdict.

The service reply fixture reports no help. The drives require the actual reply and reported assistance in a saved retrieval check. They require a linked learning record and keep immediate correction outside retained evidence. Inspect `stored-teacher-state.json` and the retained `classroom/` files.

Dedicated Codex isolation also needs a native catalog check. Start the actual
app-server with the packaged `CODEX_TEACHER_ARGS` and use
`CODEX_TEACHER_FEATURES` in its thread settings, with configured MCP servers
disabled and `web_search=disabled`. Check `mcpServerStatus/list` with `detail=full`
for a fresh `thread/start` and a copied saved `thread/resume`, without `turn/start`.
Accept an empty catalog or rows with explicit `runtimeStatus: "disabled"`, empty
`tools` maps and empty `resources`/`resourceTemplates` arrays, and no advertised
`serverCapabilities`. Missing/null statuses and active states must fail before
`turn/start`. Preserve paginated raw catalogs, source hashes and the original
rollout bytes. Copy only auth, config and session files into the scratch resume
home; a copied Codex state database can retain the original rollout path.
`npx vitest run test/teacher-models.test.ts` covers disabled rows across pages on
start/resume, malformed or contradictory inventories, unsafe statuses and no
inference on rejection. These transport contracts do not replace the native check.
An empty MCP config, a mock transport assertion or
a passing model turn alone does not prove this boundary. Apps and plugins must be
disabled before process discovery as well as in thread settings.

### Packaged Pi commands

For Pi package resource declarations, run
`npx vitest run test/plugin.test.ts test/pi-teacher-resources.test.ts`.
The first checks declared package files; the second checks that dedicated teachers
exclude initiating resources while retaining their model settings.

Also drive the supported native Pi CLI with Node 22.19+ in a fresh scratch cwd.
Create empty owned home, agent, config, data, cache, temporary and classrooms
directories. Pass those paths as `HOME`, `PI_CODING_AGENT_DIR`, `XDG_CONFIG_HOME`,
`XDG_DATA_HOME`, `XDG_CACHE_HOME`, `NODE_COMPILE_CACHE`, `TMPDIR`,
`PI_CLASSROOM_CONFIG` (a file path) and `PI_CLASSROOMS_DIR` before launch.
Use an unused positive loopback `PI_CLASSROOM_SERVICE_PORT` and
`PI_CLASSROOM_TAILSCALE=0`. Do not inherit account files or a native session.
Write only `packages: ["<absolute checkout path>"]`,
`extensions: ["-builtin:mcp"]` and `enableSkillCommands: true` to the scratch
agent's `settings.json`; do not supply explicit skill paths.

Run `"$NODE22" "$PI_PACKAGE/dist/bundle/cli.js" --mode rpc --offline --no-session --no-mcp --no-context-files`
from that scratch cwd, with `PI_OFFLINE=1` and `PI_SKIP_VERSION_CHECK=1`.
Send only `{"id":"commands","type":"get_commands"}`, then
`{"id":"state","type":"get_state"}` after its response. Require successful
responses, zero messages/pending messages and no streaming/compaction. Close stdin
after both replies and require exit 0. Save exact executable/source pins, argv,
scratch environment and settings. Select only command name, source and sourceInfo
for `classroom`, `skill:teach` and `skill:classroom`; withhold other payloads
without hashes. Require the extension's sourceInfo path to equal the package's
`index.ts`, and each skill's path to equal its exact `skills/<name>/SKILL.md`, with
the same package source, baseDir, user scope and package origin. Require no service
owner/socket or classroom writes. Repeat from fresh scratch state when validating
the recipe, then remove only owned runtime directories and retain selected evidence.

This is development package discovery without inference. An installed final release
and actual native skill adoption/teaching remain separate real-host checks; never
claim them from constructor reads, command discovery or these contracts.

### Classroom activity

Every classroom, lesson, review, history, document, reference, course-map, and settings page shows the
same teacher activity view. Open `View teacher activity` for item links and all
pending requests. Running work appears before queued work; failed requests retain
their specific error and `Retry activity`. Completed work leaves the pending list.
The root landing and daily pages show public item links labeled with their owning
classroom. Next lesson distinguishes writing, checking, and publication from its
saved state. A daily group's retry stays with the daily owner and its eligibility
checks. Global retries refresh the matching owning controls.
Dispute links scroll to their saved history after async state arrives and on later
fragment navigation. Ordinary teacher refreshes preserve the reader's scroll and focus.
A lost or unreadable status connection requires `Retry activity status`.
Browser drives require a completed JSON result before advancing. On failure they retain
snapshot, tab-list, and console diagnostics, including stdout/stderr when a diagnostic
command fails. Native dialogs are never dismissed automatically.

The default browser target includes `activity/`. Its fixture submits explanations
on two lessons through their Save controls, follows classroom SSE, and verifies
sequential running/queued transitions. It retains a failed request through reload,
HTTP/service restart and keyboard navigation to its lesson panel, then presses
`Retry` (accessible name `Retry activity: …`) once and checks exactly one additional teacher turn. It also
checks notes, reference, review history, learning records, course map, settings,
root and daily history, an unrelated classroom, malformed request state, and
1280px and 390px/light/dark idle, working, queued, failed and private-state
error screens. A held response across disconnect and explicit reconnect must not restore stale work. Original question and follow-up failures
survive reload, then each global retry adds one turn and preserves the original
answer. Seven total fixture turns finish once. A corrupt private lesson-request
file shows its file/category without quoting stored bytes. The top-bar pill opens a
bounded request panel; Close, Escape (restoring pill focus), and an outside click
dismiss it. Failed requests use inline errors with explicit Retry. Reads leave it unchanged;
restoring it does not recover status until the learner explicitly retries. Inspect `activity/result.json`, `failed-desktop.png`,
`failed-mobile.png`, `disconnected-mobile.png`, and `done-mobile.png`.

This fixture uses a controlled teacher at the production model boundary; real
host targets remain necessary for changes to the bridge/service projections.
The Next lesson, daily review, and dispute browser fixtures also use the global
retry, retaining their original publication, eligibility, grade-history and
ownership assertions. `activity-events*.json` in real-host evidence records public
SSE-triggered projections. The publication-recovery drive explicitly closes and
reopens its recorder around the owned service restart; it never reconnects or
retries model work implicitly.

For HTTP shutdown intake, run `npx vitest run test/server-lifecycle.test.ts`.
An accepted preconnection with zero received and written bytes must not hold
shutdown open: require the close promise to resolve before any client teardown.
Shutdown started inside the connection event must also finish. A socket belongs
only to its accepting listener; closing that listener must leave a replacement's
unused socket able to send a request. Any received byte excludes a socket from
this unused classification, including a one-byte partial header. Require that
partial request and an active response to finish normally while unused neighbors
close. Node 22.19's `closeIdleConnections()` alone does not reap the never-used case;
run these contracts on the actual minimum runtime as well as the installed Node.
The real-socket checks synchronize partial request headers with listener events,
then complete the event request after shutdown starts. Require 503 with
`Connection: close`, no event-stream registration, and shutdown without client
cleanup. Registered root, classroom and lesson streams must receive normal events
and drain. While a replacement listener serves events, the old listener must still
refuse its pending request and finishing its drain must leave the new stream live.
These checks complement the browser restart paths above; they do not establish the
precise cause of a historical browser stall.

The dispute fixture follows the activity link from the classroom into a long lesson
with delayed state. It requires the saved dispute fully inside the mobile viewport,
handles encoded and malformed fragments, then sends a real teacher SSE refresh and
checks that scroll and focus stay put. It still requires exactly one explicit retry,
immutable original grades, second-tab locks and private-path 404s. Inspect the dispute
fixture's `activity-navigation.json`, `activity-navigation-refresh.json` and
`activity-navigation-mobile.png`.

`test/activity-privacy.test.ts` covers malformed lesson, daily, review, refill,
teacher, annotation, lesson metadata and assessment-history JSON, nested private
daily documents and wrapped causes. HTTP retains a class/file/category diagnostic;
raw parser causes stay in private logs. Classroom/root SSE sends no private payload.

Historical Pi card failures without a saved error or supported service retry say
so and link to the original question. Recovery requires their previous package;
this view never creates replacement legacy requests.
Requests rejected before acceptance have no queued activity to invent. Their specific
error and retained question stay in the owning composer, with explicit resend;
see [Read and ask](reading.md).

## Gotchas

Fixture teachers do not prove model responses. All three hosts use a dedicated persistent teacher session. The initiating Pi session context is intentionally separate. Legacy Pi bridge fixtures cover historical state, not a second production delivery path. New lessons start from the classroom page through the same persistent teacher; see [Next lesson](next-lesson.md). Private quiz keys must remain unavailable over HTTP.
