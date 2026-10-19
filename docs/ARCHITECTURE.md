# Architecture

[Documentation](README.md)

Studens is a self-contained Pi package and Claude Code/Codex plugin, installed from
[max-miller1204/studens](https://github.com/max-miller1204/studens). It is an
independent continuation of [joshrnoll/pi-teach](https://github.com/joshrnoll/pi-teach),
outside the upstream fork network. It is not published to npm. Keep the upstream MIT
notices and [teaching attribution](ATTRIBUTION.md).

Release installs resolve a named `v<version>` Git tag. Pi's install spec and both
plugin marketplace source entries pin that tag. Marketplace catalogs may track
`main`, but their plugin sources do not. Successful `main` CI publishes a release
only when that version has not been released. Existing release tags are never moved.
Loading a checkout directly remains an explicit development path.

## Hosts and lifecycles

Pi loads `index.ts` through `pi.extensions` in `package.json`. Its HTTP server stays
inside the live Pi session. Browser requests reach `pi.sendUserMessage` through the
bridge. Session shutdown stops the server. Never detach it.

Claude Code and Codex load the root plugin through `.claude-plugin/` and
`.codex-plugin/`. Their marketplaces list this root. `mcp/launch.mjs` checks Node,
installs production dependencies on first use, and starts `src/mcp-stdio.ts`.
MCP clients attach to a persistent service over a private Unix socket. Closing
stdin detaches that client; it does not stop HTTP or teacher work.

One service owns one classrooms root and stable loopback port. Each classroom has
one selected backend and dedicated teacher session. Browser requests start teacher
work without a listening initiating agent. A different backend, package, version,
or configured port requires an explicit stop or error, never an automatic replacement.

The teaching brief is read by skills and `begin_teaching`. Keep it out of the system
prompt and MCP `instructions`. Wake-up prompts must include the classroom, lesson,
request content, and answering tool because they can arrive many turns later.

## Runtime and files

There is no build step. Pi loads `.ts`; Claude Code and Codex use Node 22.18+ type
stripping. Relative imports end in `.ts`, and type-only imports use `import type`.
No enums or parameter properties. Browser code is `.mjs`/`.js`, served directly.
Shared browser modules need handwritten `.d.mts` sidecars for TypeScript callers.

All hosts share `~/.pi/agent/classrooms/`, overridden by `PI_CLASSROOMS_DIR`.
See [configuration and storage](CONFIGURATION.md). Legacy service, socket, and Pi
route ownership names remain stable across the Studens rename; changing them would
hide existing owners and recovery state. Package assets resolve from `import.meta.url`,
never the working directory or files outside the package.

## Module map

| Boundary                                        | Entry points                                                     |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| Pi commands, origins, status                    | `index.ts`, `commands.ts`, `bridge.ts`, `status-widget.ts`       |
| HTTP, SSE, static path guards                   | `server.ts`, `paths.ts`                                          |
| Disk state and discovery                        | `store.ts`                                                       |
| Shared tools and host prompts                   | `tools.ts`, `prompts.ts`                                         |
| MCP dispatch and control transport              | `mcp.ts`, `mcp-stdio.ts`, `service-client.ts`, `service-main.ts` |
| Durable requests and plans                      | `service-state.ts`, `teacher-service.ts`                         |
| Model adapters, deadlines, grade decoding       | `teacher.ts`, `teacher-deadline.ts`, `teacher-grading.ts`        |
| Resume and review publication                   | `teacher-resume.ts`, `review-session.ts`                         |
| Quiz, rubric, pretest, plan validation          | `quiz.ts`, `rubric.ts`, `pretest.ts`, `teaching-plan.ts`         |
| Review schedule, learning evidence, diagnostics | `review.ts`, `evidence.ts`, `health.ts`                          |
| HTML and Markdown                               | `pages.ts`, `lesson-html.ts`, `markdown.ts`                      |
| Tailnet route ownership and links               | `phone-access.ts`, `tailnet-links.ts`                            |

Names in the table are under `src/` unless stated. `assets/runtime/classroom.js`
boots the lesson features and dispatches saved state and SSE events. `highlights.mjs`
owns selection and the question composer; `cards.mjs` owns annotation threads;
`quiz-ui.mjs`, `reflections.mjs`, `glossary-ui.mjs`, and `teacher-panel.mjs` own their
respective page features. Each feature keeps its own state and receives its lesson
config, content root, and dependencies at construction. `drafts.mjs` serializes draft
saves; each feature restores its own draft after saved state has rendered.
`lesson-dom.mjs` holds shared DOM helpers, while `anchor.mjs` stays DOM-free.
`shell.js` owns other pages. Pure contracts in that folder are imported by the server
and tests as well as the browser. Browser modules are served directly without a build.
`assets/templates/quiz.html` is the markup contract; lesson and review templates
are shells with an invalid placeholder type until authored.

Mermaid and Temml are vendored with licenses and versions. Update them through
`scripts/vendor-mermaid.ts` and `scripts/vendor-temml.ts`. Load diagrams and math
before text indexing. Skip generated diagram/MathML nodes in highlights and send
source notation to grading. Answers and feedback render Markdown server-side.

## State invariants

- **Requests are sequential and durable per classroom.** Save each plan before writes.
  Save raw model output before decoding. Recovery completes saved calls and skips
  already saved grades. Interrupted calls show specific errors and require retry.
- **Plans are restricted by request type.** Service teachers return per-question
  allocations through `grade_quiz_answers`; the service computes the score and
  validates identities, rubric weights, correctness, and arithmetic. Version 2 plans
  use this format. Older saved plans retain their original score validation.
  Resume requests permit a teacher message only. Only chat/reflection allow gap notes.
- **Pi attribution follows the origin FIFO.** Mark typed and initiating turns foreign.
  Question, grade, reflection, and panel origins must receive only their own run's
  final output. Prose cannot substitute for a grading tool call.
- **Conversations stay on the lesson page.** Cards hold the original answer and ordered
  follow-ups. Answer the oldest pending turn. Post quiz retrieval questions and learner
  replies in the teacher panel. Resume the exact latest graded submission without
  inventing a reply or grading again. Interrupted Pi resumes require retry.
- **Closed grades are code-owned.** Validated assessments use machine-checkable
  private keys for choice, multi, numeric, order, match, and normally cloze. Term
  and locate can explicitly opt into exact grading. Save the computed allocations
  privately on the submission before grade writes. HTTP completes closed-only
  attempts without a teacher turn; startup and host recovery reuse the saved
  allocations and skip existing grades. Mixed requests contain only judgment
  answers. Reject teacher overrides and compute the final score with `gradeScore`
  from merged raw points. Attempts saved before machine allocations existed retain
  the original rubric validation and teacher grading contract.
- **Submission order is total.** Timestamps increase strictly per lesson. Attempts
  count submissions; regrades are revisions. Use `latestGrades()` consistently for
  scores, quiz state, health, and review. Refuse another attempt while one is ungraded.
- **Reviews are derived.** Build the schedule from graded answers and linked retrieval
  evidence, excluding pretests. Save review requests and selected items before
  authoring. Validate keys, rubric, controls, and plan before publication. Hide unfinished
  reviews from lists, routes, and submissions. Repeated clicks reuse work; published
  reviews open across hosts. Saved service plans resume without another model turn.
- **Drafts never wake a teacher.** Restore them once on load, only into fresh quizzes.
  Reconnect must not overwrite typing. Successful submissions clear their draft.
- **Folder edits keep classroom paths stable.** Lock `.folders.json` edits and replace
  state atomically. Conflicts and stale locks name the cause and require explicit retry.

## HTTP and browser boundaries

Bind HTTP to loopback. Connected Tailscale links use owned, tailnet-only Serve routes;
respect config, preserve unrelated routes, and never enable Funnel. Keep Pi and service
route ownership separate. Route errors do not select another port or backend.

Every static route uses the guards in `paths.ts`, including symlink checks.
Never serve `quiz/`, private plans, teacher state, or recovery files. Media routes
are deliberately narrow. Invalid stored state must throw a specific error.

Cards live in document flow after their highlighted block, outside quiz controls.
Ignore nested card events when collecting or locking quiz answers. Exclude mutable
quiz runtime UI from text indexing. Preserve question IDs after submission.
The lesson runtime adds the header before wiring the theme toggle; the inline theme
bootstrap prevents a light flash. Widgets derive the current port from server state;
unsupported widget APIs must not bring the server down.

See [development](DEVELOPMENT.md) for verification and the
[feature recipes](../.agents/skills/verify-studens/features/README.md) for browser checks.
