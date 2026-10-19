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

Pi loads `index.ts` through `pi.extensions` in `package.json`. Its commands and
extension tools use the same private service socket and tool dispatcher as MCP.
The extension disconnects on session shutdown; HTTP and queued teacher work continue.
It never installs browser hooks or starts a competing HTTP server.

Claude Code and Codex load the root plugin through `.claude-plugin/` and
`.codex-plugin/`. Their marketplaces list this root. `mcp/launch.mjs` checks Node,
installs production dependencies on first use, and starts `src/mcp-stdio.ts`.
MCP clients attach to that persistent service. Closing stdin detaches the client.

Pi's dedicated teacher uses the packaged Pi SDK with the existing Pi account,
provider catalog, and effective model settings. Configuration is read into memory;
retry and compaction are disabled for these service turns, without editing global
settings. A single structured-output tool returns a plan to the service and cannot
write learner data. Its persisted Pi session lives in the private service directory.
Initiating Pi chat context, extensions, skills, and project context files are not
inherited. The dedicated teacher receives saved classroom context and each durable
request instead. Initiating chat remains the entry point for lesson authoring.

One service owns one classrooms root and stable loopback port. Each classroom has
one selected backend and dedicated teacher session. Browser requests start teacher
work without a listening initiating agent. A different backend, package, version,
or configured port requires an explicit stop or error, never an automatic replacement.

The teaching brief is read by skills and `begin_teaching`. Keep it out of the system
prompt and MCP `instructions`. Wake-up prompts must include the classroom, lesson,
request content, and answering tool because they can arrive many turns later.

## Runtime and files

There is no build step. Pi loads `.ts`; Claude Code and Codex use Node 22.19+ type
stripping. Relative imports end in `.ts`, and type-only imports use `import type`.
No enums or parameter properties. Browser code is `.mjs`/`.js`, served directly.
Shared browser modules need handwritten `.d.mts` sidecars for TypeScript callers.

All hosts share `~/.pi/agent/classrooms/`, overridden by `PI_CLASSROOMS_DIR`.
See [configuration and storage](CONFIGURATION.md). Legacy service, socket, and Pi
route ownership names remain stable across the Studens rename; changing them would
hide existing owners and recovery state. Package assets resolve from `import.meta.url`,
never the working directory or files outside the package.

## Module map

| Boundary                                        | Entry points                                                               |
| ----------------------------------------------- | -------------------------------------------------------------------------- |
| Pi service client, commands, status             | `index.ts`, `pi-service-client.ts`, `commands.ts`, `status-widget.ts`      |
| HTTP lifecycle, feature routes, static guards   | `server.ts`, `server/`, `paths.ts`                                         |
| Disk state API and feature storage              | `store.ts`, `store/`                                                       |
| Shared tools and host prompts                   | `tools.ts`, `prompts.ts`                                                   |
| MCP dispatch and control transport              | `mcp.ts`, `mcp-stdio.ts`, `service-client.ts`, `service-main.ts`           |
| Durable requests and plans                      | `service-state.ts`, `teacher-service.ts`                                   |
| Model adapters, deadlines, grade decoding       | `teacher.ts`, `pi-teacher.ts`, `teacher-deadline.ts`, `teacher-grading.ts` |
| Daily classroom groups                          | `server/daily-review.ts`, `store/daily-review.ts`                          |
| Resume and review publication                   | `teacher-resume.ts`, `review-session.ts`                                   |
| Private variant pools and refills               | `review-variants.ts`, `review-pool.ts`, `review-refill.ts`                 |
| Quiz, rubric, pretest, plan validation          | `quiz.ts`, `rubric.ts`, `pretest.ts`, `teaching-plan.ts`                   |
| Review schedule, learning evidence, diagnostics | `review.ts`, `evidence.ts`, `health.ts`                                    |
| HTML and Markdown                               | `pages.ts`, `lesson-html.ts`, `markdown.ts`                                |
| Tailnet route ownership and links               | `phone-access.ts`, `tailnet-links.ts`                                      |

`server.ts` keeps the loopback singleton and public exports. `server/` owns
classroom pages, records, folders, annotations, quizzes, review, teacher endpoints,
and learner state. Shared HTTP helpers, hooks, and the SSE registry live there;
closing the singleton closes its SSE clients before the HTTP server.

`store.ts` preserves the public storage exports. `store/` separates filesystem
discovery, lesson summaries, folders, annotations, quiz history and submissions,
review evidence, reflections, panel messages, drafts, and records. Discovery and
quiz history do not depend on submission creation, so lesson and review reads do
not create circular feature dependencies. Canonical path helpers and static guards
remain in `paths.ts`. Persisted formats and request ordering are unchanged.

Names in the table are under `src/` unless stated. `assets/runtime/classroom.js`
boots the lesson features and dispatches saved state and SSE events. `highlights.mjs`
owns selection and the question composer; `cards.mjs` owns annotation threads;
`quiz-ui.mjs`, `reflections.mjs`, `glossary-ui.mjs`, and `teacher-panel.mjs` own their
respective page features. `review-screen.mjs` presents one review quiz card at a time,
with shared grading, drafts, and the teacher panel. Each feature keeps its own state and receives its lesson
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
  Storage failures retain validated plans; rejected allocations require a new plan.
- **Plans are restricted by request type.** Service teachers return per-question
  allocations through `grade_quiz_answers`; the service computes the score and
  validates identities, rubric weights, correctness, and arithmetic. Version 2 plans
  use this format. Older saved plans retain their original score validation.
  Resume requests permit a teacher message only. Only chat/reflection allow gap notes.
- **Pi uses the service FIFO.** Initiating chat turns cannot answer queued browser
  work. The dedicated Pi session returns exactly one structured plan; prose cannot
  substitute for a grading operation. The old bridge remains only in historical
  regression fixtures and shared answer/grade persistence helpers.
- **Conversations stay on the lesson page.** Cards hold the original answer and ordered
  follow-ups. Answer the oldest pending turn. Post quiz retrieval questions and learner
  replies in the teacher panel. Resume the exact latest graded submission without
  inventing a reply or grading again. Interrupted inference requires explicit retry on every host.
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
- **Review history is separate.** New review identities resolve under classroom `.reviews/`
  and use `/c/<classroom>/reviews/<review-id>`. Each card has a durable quiz and grade;
  all cards must be graded before the session completes. Keep numbered legacy review
  paths and saved documents unchanged. Both layouts participate in discovery and recovery,
  while reviews stay out of the learner's lesson list and lesson count. Closed misses
  enqueue durable corrective panel requests, with one request per submission.
- **Reviews are derived.** Schedule lesson-local objectives from saved answer evidence;
  questions are probes. Same-attempt probes count as one exposure, and any incomplete
  probe resets the objective. Historical answers without objective context keep their
  question key and unknown context. Never read the current plan to replay history.
  Keep old question links usable by saved reviews, panel checks, and recovery.
  Exclude pretests. Save review requests and selected items before
  publication. New reviews deterministically select private preauthored variants and
  save the complete document before writes; no model authoring is needed. Legacy
  questions without pools are skipped with an explicit error when none are eligible.
  Validate keys, rubric, controls, and plan before publication. Hide unfinished
  reviews from lists, routes, and submissions. Repeated clicks reuse work; published
  reviews open across hosts. Saved service plans resume without another model turn.
- **Daily review keeps classroom boundaries.** The private root `.daily-reviews.json`
  saves every classroom selection and document before the first publication. Each
  group reuses a normal classroom review and its original objective keys. Group
  completion derives from saved card grades; navigation never grades or extends a
  schedule. Later groups need explicit progression. Reads, reloads and repeated
  starts reuse saved requests; publication and ownership failures require retry.
  Daily history links to each classroom’s separate review history and teacher panel.
  Save declared criterion requirements with new prepared plans and retain their
  definitions in the private document through publication. Legacy plans remain
  compatible. Public attempts redact criterion and early-timing snapshots.
- **Variant refills are background work.** Save private refill requests with their host
  and learner mistake. Run them after queued learner requests in the same sequential
  teacher session. Save validated output before atomically adding a supplemental
  private pool; never rewrite a submitted rubric. Recover saved output once. Failed
  model work requires explicit retry and cannot block an already prepared review.
  Replaying the same saved batch never duplicates variants.
- **Drafts never wake a teacher.** Restore them once on load, only into fresh quizzes.
  Reconnect must not overwrite typing. Successful submissions clear their draft.
- **Daily edits serialize across hosts.** Lock root batch creation and group edits,
  reloading state under the lock. Save every classroom plan before publication.
  A busy or interrupted save names the lock and requires explicit retry. Reads
  never publish or retry classroom work.
- **Folder edits keep classroom paths stable.** Lock `.folders.json` edits and replace
  state atomically. Conflicts and stale locks name the cause and require explicit retry.

## HTTP and browser boundaries

Bind HTTP to loopback. Connected Tailscale links use owned, tailnet-only Serve routes;
respect config, preserve unrelated routes, and never enable Funnel. All hosts use the service-owned route. Legacy Pi route ownership remains
discoverable for explicit cleanup; never take over a live legacy route. Route errors do not select another port or backend.

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
