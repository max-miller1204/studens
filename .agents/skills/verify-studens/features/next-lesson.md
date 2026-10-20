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
3. Select `Next lesson`. The request remains saved if you leave or reload.
4. Read a specific failure and select `Retry lesson` after correcting its cause.
5. The finished lesson opens automatically in the requesting tab. `Open lesson`
   remains available from the classroom page.
6. Answer questions and send teacher replies on the lesson page.

## Driving it with playwright-cli

Run `npm run verify -- browser --artifacts /tmp/studens-next-lesson-browser`.

Inspect `next-lesson/{pi,claude,codex}/result.json` and the desktop, mobile, failed,
and opened screenshots. The fixture drives the optional topic, failed publication,
reload, explicit retry, and automatic opening. It checks repeated requests, invalid
topic length, private routes, unpublished lessons, and unchanged source material.
Service publication retry follows a service restart and uses one model-plan turn.
An additional request deliberately throws a page error; it must remain unpublished
until an explicit retry supplies corrected output. Inspect `page-check-failed.png`
and the retained rejected document. Wrong-host status and retry requests must show
an owner error without changing work. Neither page check creates learner submissions.

The real host targets in the shared skill now start a lesson from the classroom
before the original reading/quiz/panel paths. They request an official Rust source,
check saved output and a page-check receipt, open and reload the page, and verify
zero submissions, grades, or learning records from checking. They bind the receipt to
all saved document fields. Service drives select the fixed verification model through
Settings, check the requested and answering models on the authoring request, then
reset to the configured default before the ordinary teacher checks. A rejected model plan is retained and
receives at most one explicit browser retry with its actual error in context.
Inspect `stored-next-lesson.json`, `*-next-lesson.png`, and any
`next-lesson-failed.json` / `next-lesson-retry-failed.json`. Host model output may
fail validation; a fixture success does not cancel a real-host failure.
Inspect the owning native teacher trace before claiming actual research. A source
URL in saved HTML proves a citation, not that a web tool fetched it. Keep native
tool-scope, rejected-output recovery and successful publication receipts separate.

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

Run `npx vitest run test/next-lesson.test.ts` for authoring state recovery. Decoder
rejections must retain raw output in private authoring state before failure. A
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
