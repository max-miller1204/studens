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
- Show specific failures and require an explicit retry.
- Regenerate a plan rejected before writes. Keep valid plans for recovery.
- Request a new grade plan after an explicit retry of a rejected score.
- Keep the persistent service available after Pi or MCP exit.

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

The legacy Pi bridge fixture checks `.cl-teacher` follows the quiz, a prose-only grading run fails, and an explicit retry permits grading. It checks the panel reply reaches the correct prompt and all three conversation messages survive reload.

It also receives replies while reading before and after the quiz. The notice must point down or up toward the teacher, update when scrolling past the panel, and dismiss when clicked as the teacher comes into view. Inspect `pi-panel/teacher-notice-below.png`, `pi-panel/teacher-notice-above.png`, and `pi-panel/pi-panel.json`.

The service fixture checks failure, retry, MCP disconnect and reconnect, request isolation between lessons, and teacher drafts. Inspect `pi-panel/pi-panel.json` and service state evidence.

The service fixture also submits a quiz whose teacher supplies a forbidden total score. The score-free operation must reject it. The fixture checks the visible error and the absence of a saved grade. `Retry request` must request one corrected plan with no total score. Reload must show the calculated grade. Inspect `service/rejected-grade.json`, `service/retried-grade.json`, and `service/grading-turns.json`. The grading turns must each permit exactly one grade call. Local recovery tests keep the score checks for older saved plans.

The resume fixtures use a saved review with an empty panel or an unanswered saved reply. They check the explicit handoff, panel link, reply recovery, message order, reload, and unchanged assessment and evidence files for Pi, Claude, and Codex. Repeated handoffs must reuse the request. Inspect `resume/`. The real Pi and service host drives also resume a historical 67% review from initiating chat. They check the saved grade and teacher identity.

The actual Pi target uses the same learner drive and dedicated service queue as Claude and Codex, including daily classroom groups. Its additional lifecycle drive closes the initiating Pi while teacher work runs, submits from two browser tabs, reconnects from a fresh Pi, rejects an unavailable model, and uses explicit retry after changing settings. It saves a real valid Pi grade plan while an owned scratch grade directory denies writes, restarts the service, retries the saved plan, then restarts again. Require one saved grade, unchanged plan and conversation bytes, no new inference, the exact Pi model, and low thinking. Explicit `/classroom stop` followed by Pi shutdown must produce no extension errors. Inspect `pi/lifecycle/`, including `lifecycle.json`, the original saved plan, private session transcript, and screenshots.

For launcher or production dependency changes, use a clean exact-commit archive
without `node_modules`, retaining `docs/ATTRIBUTION.md`. Run `node mcp/launch.mjs`
with a scratch classrooms root, an unused loopback service port, and tailnet links
disabled. Send MCP `initialize` (client name `codex`) and `tools/list`. These are
lazy discovery; use `classroom_service` action `start` before checking HTTP ownership.
Require the real `npm ci --omit=dev --ignore-scripts` bootstrap, only JSON-RPC on
stdout, and the installed Pi SDK's `createAgentSession` export loading from that
archive. Development-only packages must be absent. Stop through the management
tool and remove owned scratch roots. No model turn or account edit is needed.
Record actual Node separately from the declared minimum, now 22.19.0.

For a changed real Pi path, run `npm run verify -- pi`. For shared service or prompt changes, run `npm run verify -- claude`, then `npm run verify -- codex`. Add `--artifacts <directory>` to retain host evidence. These drives ask a question, submit a wrong answer, and reply in the panel. They check that the quiz score remains unchanged.

The service reply fixture reports no help. The drives require the actual reply and reported assistance in a saved retrieval check. They require a linked learning record and keep immediate correction outside retained evidence. Inspect `stored-teacher-state.json` and the retained `classroom/` files.

## Gotchas

Fixture teachers do not prove model responses. All three hosts use a dedicated persistent teacher session. The initiating Pi session context is intentionally separate. Legacy Pi bridge fixtures cover historical state, not a second production delivery path. Starting a new lesson still requires the initiating host. Private quiz keys must remain unavailable over HTTP.
