# Next lesson

The learner asks for a new lesson on the classroom page, optionally names a topic,
and opens it after the teacher writes and checks it.

## Sub-features

- Save one queued request across repeated clicks and tabs.
- Show queued, running, done, or the specific failure after reload.
- Keep unfinished lessons off lists, routes, and submission endpoints.
- Require the original host for unfinished work.
- Save and validate the plan before publication; check controls in disposable state.
- Retry failed publication from saved output without another model turn.
- Keep rejected output and require explicit retry for new authoring.
- Allow research only for explicit lesson requests.

## How to get to it (user POV)

1. Open a classroom with the persistent service running.
2. Optionally enter `What would you like to learn next?`.
3. Select `Next lesson`. The request survives leaving or reloading.
4. After a failure, fix its cause and select `Retry lesson`.
5. The finished lesson opens in the requesting tab; `Open lesson` stays available.

## Driving it with playwright-cli

Run `npm run verify -- browser --artifacts /tmp/studens-next-lesson-browser`.

Inspect `next-lesson/{pi,claude,codex}/result.json` and its screenshots. The fixture
covers the optional topic, failed publication, reload, explicit retry, automatic
opening, invalid topic length, private routes, and wrong-host errors. A page error
keeps the lesson unpublished until retry; inspect `page-check-failed.png`. The
receipt binds all four files: HTML, metadata, private key, and teaching plan.

Real host targets start a lesson from the classroom first. They check saved output,
the page-check receipt, and zero submissions or grades from checking. Inspect
`stored-next-lesson.json`, `next-lesson-source-provenance.json`, and any
`next-lesson-failed.json`. A source URL in saved HTML proves a citation, not a fetch;
read the native trace before claiming research.

### Directed widgets

Prefix a real host target with one of these (they are mutually exclusive):

| Variable                       | Topic                | Inspect                   |
| ------------------------------ | -------------------- | ------------------------- |
| `STUDENS_VERIFY_FADED=1`       | Faded worked example | `faded-authoring.json`    |
| `STUDENS_VERIFY_STEPPER=1`     | Prefix-sum stepper   | `stepper-authoring.json`  |
| `STUDENS_VERIFY_CODE_LESSON=1` | Code exercise        | `stored-next-lesson.json` |

For example, `STUDENS_VERIFY_FADED=1 npm run verify -- pi --artifacts /tmp/studens-faded-pi`.
Require zero widgets before release, at least one after, four matching hashes, and
unchanged learner state. This proves directed adoption, not autonomous use or quality.

For teaching-origin declarations, run
`node scripts/e2e-source-authoring.ts <pi|claude|codex> <new-artifact-directory>`
and inspect the native request, raw output, checker receipt, and clicked destination.

## Contract tests

| Area                                 | Run                                                                     |
| ------------------------------------ | ----------------------------------------------------------------------- |
| Request assembly and authoring state | `npx vitest run test/next-lesson.test.ts`                               |
| Typed lesson output                  | `npx vitest run test/lesson-output.test.ts test/teacher-models.test.ts` |
| Pi research reader (DNS, redirects)  | `npx vitest run test/lesson-research.test.ts`                           |
| Pi native tool errors                | `npx vitest run test/pi-teacher-native-errors.test.ts`                  |

## Gotchas

- Research tools exist only for explicit lesson authoring. Ordinary Pi turns expose
  only `submit_teacher_plan`.
- Pi's `read_lesson_source` pins each connection to its checked public DNS answer and
  refuses private, mapped, and link-local addresses. Cancellation never accepts late output.
- Dedicated Codex teachers disable plugins, apps, MCP servers, and execution tools,
  and refuse a non-empty MCP inventory. An empty `mcp_servers` override proves nothing.
- Decoder rejections keep raw output before failure. Restart shows the failure without
  another turn.
- A checked saved document recovers without another model turn. Private keys, plans,
  and request files stay unavailable over HTTP.
- These checks are mechanical. They do not measure lesson quality or learning.
