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

1. Open a classroom whose teacher host is connected.
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

## Gotchas

Pi stays in its live session. Claude and Codex keep the persistent service and
teacher conversation identity. Research tools are enabled only for explicit
lesson authoring; ordinary questions and panel replies retain their permissions.
Pi's `read_lesson_source` pins every HTTP(S) connection to its checked public DNS
answer, checks each redirect independently, and retains hostname and TLS validation.
Run `npx vitest run test/lesson-research.test.ts` for the DNS, destination, redirect,
size, and timeout contracts. Private, mapped, link-local, and transition addresses
must be refused. Resource reads stay within the requested classroom and packaged
guidance.

A saved document that passed the page check recovers without another model turn.
A rejected page requires explicit retry; its output is retained before requesting
correction. A stopped model turn never retries automatically. Private keys, plans,
and request documents must remain unavailable over HTTP. These checks establish
mechanical behavior, not human learning or lesson quality.
