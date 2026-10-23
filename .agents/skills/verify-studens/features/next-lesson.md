# Next lesson

The learner asks for a new lesson on the classroom page, optionally names a topic,
and opens it after the teacher finishes authoring and checking it.

## Sub-features

- Save one queued request across repeated clicks and tabs.
- Show queued, running, done, or the concrete failure after reload.
- Keep unfinished lessons off lists, routes, and submission endpoints.
- Require the original Pi, Claude, or Codex owner for unfinished work.
- Save and validate the authoring plan before publication writes.
- Check initial and released lesson controls headlessly in disposable state.
- Retry failed publication from saved output without another model turn.
- Preserve rejected output and require explicit retry for corrected authoring.
- Restrict research and resource reading to explicit lesson requests.

## How to get to it (user POV)

1. Open a classroom whose persistent teacher service is running. The initiating host may be closed.
2. Optionally enter `What would you like to learn next?`.
3. Select `Next lesson`, or the **Up next** `Start next lesson` shortcut when no lesson is in progress and no review is due. The request remains saved if you leave or reload.
4. Read a specific failure and select `Retry lesson` after correcting its cause.
5. The finished lesson opens automatically in the requesting tab. `Open lesson`
   remains available from the classroom page.
6. Answer questions and send teacher replies on the lesson page.

## Driving it with playwright-cli

Run `npm run verify -- browser --artifacts /tmp/studens-next-lesson-browser`.

Inspect `next-lesson/{pi,claude,codex}/result.json` and the desktop, mobile, failed,
and opened screenshots. The fixture drives the Up next shortcut with the optional topic, failed publication,
reload, explicit retry, and automatic opening. It checks repeated requests, invalid
topic length, private routes, unpublished lessons, and unchanged source material.
Service publication retry follows a service restart and uses one model-plan turn.
An additional request deliberately throws a page error; it must remain unpublished
until an explicit retry supplies corrected output. Inspect `page-check-failed.png`
and the retained rejected document. Wrong-host status and retry requests must show
an owner error without changing work. Neither page check creates learner submissions. The receipt must bind all four exact
publication files: HTML, metadata, private key and teaching plan. A pending older
HTML-only receipt is rechecked on explicit saved-plan retry, without another model
turn; compare its restored hashes with the published bytes.

Fresh service publication requires a v2 lesson root (`data-cl-ui="2"`) and checks
its component classes and required hooks, including inert gated teaching. The
packaged checker validates explicit v2 promises; unmarked saved documents and
saved publication plans retain their original bytes. `test/lesson-markup.test.ts`
and the next-lesson contracts cover missing/unsupported markers, missing hooks,
and legacy recovery. The authoring targets also check every newly authored page
against v2; compare their quality reports with main over multiple runs as required
by the shared skill. Quality findings remain separate from mechanical verdicts.
Inspect `<host>-receipts.json` against the four final input hashes and the native
transcript. After an authored-page repair, the checker must run in a separate
standalone shell call; a successful result bundled with file edits is insufficient.
Retain the failed run when explicitly retrying after an instruction correction.

The real host targets in the shared skill now start a lesson from the classroom
before the original reading/quiz/panel paths. They request an official Rust source,
check saved output and a page-check receipt, open and reload the page, and verify
zero submissions, grades, or learning records from checking. They bind the receipt to
all saved document fields. Service drives select the fixed verification model through
Settings, check the requested and answering models on the authoring request, then
reset to the configured default before the ordinary teacher checks. An unexpected rejected model plan stops the native gate on its original request;
preserve its output and error without a generation reroll. Product explicit Retry
remains available. Controlled publication-conflict recovery still restarts the
service and explicitly retries its same validated document and saved plan, checking
the same native session bytes and identity with no additional inference.
Inspect `next-lesson-source-provenance.json` for matching checkout and loaded-service
hashes, `stored-next-lesson.json`, `*-next-lesson.png`, and any
`next-lesson-failed.json` / `next-lesson-retry-failed.json`. Host model output may
fail validation; a fixture success does not cancel a real-host failure.
Inspect the owning native teacher trace before claiming actual research. A source
URL in saved HTML proves a citation, not that a web tool fetched it. Keep native
tool-scope, rejected-output recovery and successful publication receipts separate.

For a directed faded-widget publication check, prefix a real host target with
`STUDENS_VERIFY_FADED=1` (for example,
`STUDENS_VERIFY_FADED=1 npm run verify -- pi --artifacts /tmp/studens-faded-pi`).
The same option selects the widget topic for Claude and Codex. Inspect
`faded-authoring.json`: initial widgets must be zero, released widgets at least one,
all four file hashes must bind publication, and checking must leave learner state
unchanged. Read the saved HTML and native output for case completeness, principle
reasoning, answer cues and separation from the graded check. This explicitly asks
for the widget; it proves directed adoption, not autonomous use or content quality.
Widget publication and the later host criterion/dispute gates have separate
observations: a publication receipt does not turn a later failed host gate into PASS.
Keep any first-output rejection and explicit retry alongside the successful receipt.

For directed computed-stepper publication, use `STUDENS_VERIFY_STEPPER=1` with a
real Pi, Claude or Codex target (for example,
`STUDENS_VERIFY_STEPPER=1 npm run verify -- pi --artifacts /tmp/studens-stepper-pi`).
This selects a prefix-sum topic. The code (`STUDENS_VERIFY_CODE_LESSON=1`),
faded and stepper options are mutually exclusive; conflicting selections fail
before the verifier starts browser, service or model work. Without any option,
the ordinary Rust borrowing topic remains selected.
Inspect `stepper-authoring.json`: zero initial and one released widget, all four
publication hashes, and unchanged learner state. The disposable checker steps
through the original authored frames and recomputes changed input. Read the actual
saved HTML, rubric and native trace separately: successful publication verifies
structure and controls, not arithmetic truth of an authored private key, research
execution or human learning. Keep directed adoption separate from autonomous
widgets in the repeated authoring reports. Later full-host gates retain their own
verdicts even when the widget publication succeeds.

## Gotchas

Pi, Claude and Codex keep the persistent service and their dedicated teacher
conversation identity. Research tools are enabled only for explicit lesson
authoring. Ordinary Pi requests expose only `submit_teacher_plan`; no initiating
session tools or external resources are inherited.
Pi's `read_lesson_source` pins every HTTP(S) connection to its checked public DNS
answer, checks each redirect independently, and retains hostname and TLS validation.
Run `npx vitest run test/lesson-research.test.ts` for the DNS, destination, redirect,
size, timeout, and interruption contracts. Pre-aborted calls must perform no DNS
or connection work; a late DNS result after interruption must not start a socket.
Active transfers must stop and an interrupted redirect must not start another
request. The owning service turn and current SDK tool signal both reach the reader.
Cancellation must never accept late output. Private, mapped, link-local, and transition addresses
must be refused. Resource reads stay within the requested classroom and packaged
guidance.

A saved document that passed the page check recovers without another model turn.
A rejected page requires explicit retry; its output is retained before requesting
correction. A stopped model turn never retries automatically. Private keys, plans,
and request documents must remain unavailable over HTTP. These checks establish
mechanical behavior, not human learning or lesson quality.

Dedicated Codex teachers disable installed plugins, apps, configured MCP servers
and execution tools before starting inference. They check the actual per-thread
MCP inventory and refuse exposed servers. The transport contracts below exercise
that refusal, malformed inventory, execution guards and explicit-only native web
research. The real Codex drive must still demonstrate public research and the
ordinary teacher paths; an empty `mcp_servers` override alone proves no isolation.

Service lesson responses use a dedicated strict schema: direct HTML strings and typed
private objective, quiz, rubric and variant rows. The host alone serializes the
canonical private files and saved publication call. Run
`npx vitest run test/lesson-output.test.ts test/teacher-models.test.ts` to check
complete-document round trips, fixed criteria and private review assembly,
private HTML preservation, malformed and duplicate
input refusal, and the installed CLI structured-schema boundary. These transport
contracts do not replace the required real service drives.

Run `npx vitest run test/next-lesson.test.ts` for assembled request contracts and
authoring state recovery. The producer-boundary checks capture the actual Pi,
Claude and Codex service request: all inline teaching, plan, code, teaching-origin, quiz, lesson,
faded and stepper sources must remain complete; local contract paths and shell /
browser launch commands must be absent from its operational guidance. Reference
file instructions belong to the host, which serializes, checks and publishes the
structured result. Scaffold tools and historical Pi bridge requests retain their
explicit filesystem authoring mode. These controlled checks do not prove model
adoption; inspect fresh real-host traces and preserve any original rejected output.

Decoder rejections must retain raw output in private authoring state before failure. A
restart must leave the failure visible without another turn; explicit retry must
retain the rejected attempt, including older failures saved only in teacher state.

The Pi host drive uses the same persistent service browser path as Claude and
Codex. Its initiating Pi exits before Next lesson. Inspect the retained private SDK
session: `studens_teacher_scope` records the actual active tools and SDK model
selection for each inference turn. Explicit authoring exposes only
`submit_teacher_plan` and `read_lesson_source`; later ordinary turns expose only
the plan tool in the same conversation. The SDK resource sentinel contract in the
[teacher recipe](teacher.md) reopens one session with both loadouts and requires
zero external resource installs or loading. These no-inference contracts do not
replace the real Pi drive or an actual source-fetch trace.

Legacy bridge publication/order fixtures retain historical live-session recovery
contracts. They are not a second production teacher or a fallback for SDK failures.
The persistent Pi service uses the same saved canonical publication plan,
publication ownership, privacy and idempotent recovery as the other service hosts.
The service transport keeps string/list/numeric expected answers in canonical
types; only dynamic mapping keys use entry rows. Later refills explicitly return
to canonical tool arguments in the same teacher conversation. Strict private-key
validation remains authoritative.

The persistent Pi request must fail on the first native SDK tool error, including
argument validation and unknown-tool errors before custom execution. The actual-SDK
controlled-loop regression in `test/pi-teacher-native-errors.test.ts` checks that a
later valid call cannot rescue the turn, raw plan arguments persist before native
validation, and an explicit retry reopens the same conversation with the failed
history intact. This is a fixture check with no provider inference.

Teaching-origin authoring uses `data-cl-teaches` on a stable teaching section; see
`docs/SOURCE-LINKS.md`. The service receives the complete contract in its actual
producer request, and its typed `lesson_html` carries declarations without new
filesystem tools or glossary writes. The four-file checker rejects unsafe, duplicate,
or unreachable declarations before publication while retaining all private validators.
The browser `lesson-sources/` fixture proves navigation, not native authoring.
A directed native probe is available as `node scripts/e2e-source-authoring.ts
<pi|claude|codex> <new-artifact-directory>`; inspect its original native request,
raw saved output, source hashes, four-file checker receipt and clicked destination.
This path is separate from repeated autonomous authoring comparisons; a failure
requires its own evidence and explicit retry rather than another favorable run.
