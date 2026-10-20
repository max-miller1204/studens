# Teacher conversation

The learner receives follow-up questions and answers them in the lesson's teacher panel.

## Sub-features

- Place the panel after the submitted quiz and render teacher Markdown.
- Point new-message notices toward the teacher while scrolling.
- Resume a graded historical review from chat with `resume_lesson_teacher`.
- Save replies and restore the conversation after reload.
- Link a successful panel check to a learning record without changing the grade.
- Show classroom activity on every page, with queued work, failures, and explicit retry.
- Reject a forbidden total score and request a corrected plan on retry.
- Keep the persistent service running after Pi or MCP clients exit.
- Discover the packaged Pi teaching skills alongside the classroom extension.

## How to get to it (user POV)

1. Submit a quiz and read the teacher's question below it.
2. Enter an answer in `Reply to your teacher` and select `Send reply`.
3. Use `Retry request` only when a request fails.
4. To resume a graded review, ask in chat and open the returned lesson link.

## Driving it with playwright-cli

Run `npm run verify -- browser --artifacts /tmp/studens-teacher`.

- **Panel.** The legacy Pi bridge fixture checks placement, a failed prose-only
  grading run, retry, and reload. Notices point toward the teacher. Inspect
  `pi-panel/pi-panel.json` and `pi-panel/teacher-notice-*.png`.
- **Service.** Failure, retry, MCP disconnect and reconnect, lesson isolation, and
  drafts. A forbidden total score is rejected; `Retry request` saves one calculated
  grade. Inspect `service/rejected-grade.json`, `service/retried-grade.json`, and
  `service/grading-turns.json`.
- **Resume.** Empty panels and unanswered saved replies resume for Pi, Claude, and
  Codex. Repeated handoffs reuse the request. Inspect `resume/`.
- **Activity.** Two lessons queue in order; a failed request survives reload and
  restart, and `Retry activity` adds exactly one turn. A lost status connection needs
  `Retry activity status`. Inspect `activity/result.json` and its captures.

Real hosts: `npm run verify -- pi`, then `claude` and `codex` for shared service or
prompt changes. Each asks a question, submits a wrong answer, and replies in the
panel; the quiz score must not change. The Pi lifecycle drive also closes the
initiating Pi during work, reconnects, rejects an unavailable model, and retries a
saved plan after a write failure with no new inference. Inspect `pi/lifecycle/`.

## Focused contract tests

| Change                            | Run                                                                                                                        |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| MCP launcher or service lifecycle | `npx vitest run test/mcp-stdio-lifecycle.test.ts test/service-process.test.ts test/service-process-owner.test.ts`          |
| HTTP shutdown                     | `npx vitest run test/server-lifecycle.test.ts` (also on Node 22.19)                                                        |
| Pi SDK resources                  | `npx vitest run test/pi-teacher-resources.test.ts`                                                                         |
| Pi request envelope or completion | `npx vitest run test/pi-teacher-completion.test.ts test/pi-teacher-envelope.test.ts test/pi-teacher-native-errors.test.ts` |
| Typed passage answers             | `npx vitest run test/passage-answer.test.ts test/teacher-models.test.ts`                                                   |
| Pi package declarations           | `npx vitest run test/plugin.test.ts test/pi-teacher-resources.test.ts`                                                     |
| Activity privacy                  | `npx vitest run test/activity-privacy.test.ts`                                                                             |

These use controlled provider streams. They do not replace real host drives.

## Production launcher

For launcher or production dependency changes, run `npm ci`, `npm run verify`, and
`npm run audit`. Audit compares installed production versions with the lock, then
audits that tree.

Then test a clean archive of the exact commit without `node_modules` (keep
`docs/ATTRIBUTION.md`). Run `node mcp/launch.mjs` with a scratch classrooms root, an
unused loopback port, and tailnet links disabled. Send MCP `initialize` (client
`codex`) and `tools/list`, then `classroom_service` action `start`. Require the
`npm ci --omit=dev --ignore-scripts` bootstrap, only JSON-RPC on stdout, and the Pi
SDK's `createAgentSession` export. Run `npm run audit` in the archive. Stop through the
management tool, wait for the socket to disappear, then close stdin; require exit 0
without `[classroom] detach failed`.

## Packaged Pi commands

Drive the native Pi CLI with Node 22.19+ in a fresh scratch cwd. Point `HOME`,
`PI_CODING_AGENT_DIR`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`,
`NODE_COMPILE_CACHE`, `TMPDIR`, `PI_CLASSROOM_CONFIG`, and `PI_CLASSROOMS_DIR` at
empty owned paths. Set an unused `PI_CLASSROOM_SERVICE_PORT` and
`PI_CLASSROOM_TAILSCALE=0`. The scratch `settings.json` contains only
`packages: ["<checkout>"]`, `extensions: ["-builtin:mcp"]`, and
`enableSkillCommands: true`.

```sh
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 "$NODE22" "$PI_PACKAGE/dist/bundle/cli.js" \
  --mode rpc --offline --no-session --no-mcp --no-context-files
```

Send `{"id":"commands","type":"get_commands"}`, then `{"id":"state","type":"get_state"}`.
Require `classroom` from the package `index.ts`, and `skill:teach` and
`skill:classroom` from `skills/<name>/SKILL.md`, with no service or classroom
writes. This proves discovery, not skill adoption or teaching.

## Codex isolation

Start the app-server with the packaged `CODEX_TEACHER_ARGS` and
`CODEX_TEACHER_FEATURES`, MCP servers disabled, and `web_search=disabled`. Call
`mcpServerStatus/list` with `detail=full` after `thread/start` and a copied
`thread/resume`, without `turn/start`. Both must list zero servers and tools.

## Retained Pi failures

Copy the classroom and its private session into a scratch root, set
`PI_CLASSROOMS_DIR` before startup, and confirm the service reports that root.
Startup must keep the failure without inference. After the causal fix, select
`Retry request` once. Compare session prefix, request, and assessment files.

## Gotchas

- Fixture teachers do not prove model responses.
- All three hosts use a dedicated persistent teacher, separate from the initiating
  session. Legacy Pi bridge fixtures cover historical state only.
- Requests rejected before acceptance stay in the owning composer with an explicit
  resend; see [Read and ask](reading.md).
- Private quiz keys must stay unavailable over HTTP.
