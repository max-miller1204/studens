# Studens UI redesign: "Calm product"

Status: spec, not started. Interviewed 2026-10-20.
Mockup: [ui-directions-mockup.html](ui-directions-mockup.html) (direction 2).

## Problem

The current UI has two main problems.

1. **Inconsistent surfaces.** Radii, borders, shadows, button styles and chips differ
   between the lesson, quiz, review, classroom and settings pages. All of it lives in one
   2.8k-line `classroom.css` with only three transitions and one reduced-motion block.
2. **Weak hierarchy.** The classroom page opens with a 14-day forecast, a paragraph of
   allowance rules and eight full evidence cards with UTC timestamps. The lessons sit at
   the very bottom. Quiz results, teacher activity and settings have the same problem.

There is also a font problem. The serif stack (Iowan / Palatino) is missing on Linux and
on most Windows machines, so the product renders in whatever serif the OS has.

## Decisions

| Topic                | Decision                                                                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visual direction     | **Calm product.** Neutral grays, sans chrome, serif only for lesson prose, one accent, soft ring shadows. Replaces the warm-paper identity.                          |
| Scope                | Every learner-facing surface.                                                                                                                                        |
| Classroom page lead  | One **Up next** card: resume the current lesson, or review N due items, or start the next lesson.                                                                    |
| Memory map           | Summarize, drill in on demand: one compact row per objective with relative due dates. Full evidence opens in place.                                                  |
| Fonts                | Vendor OFL woff2 files: Inter (UI), Source Serif 4 (prose), JetBrains Mono (code). No CDN.                                                                           |
| Icons                | Vendor a Lucide subset (ISC) and recolor with `currentColor`.                                                                                                        |
| App shell            | Persistent left sidebar. It collapses to a rail on lesson pages and the state is remembered per device. On phones it becomes a menu button that opens a left drawer. |
| "Today"              | The root landing page becomes Today. No new route.                                                                                                                   |
| Accent               | User-selectable from a small set. Theme follows the system, with the existing manual toggle.                                                                         |
| Motion               | Purposeful only (see Motion).                                                                                                                                        |
| Lesson markup        | Change the authoring contract. Ship an agent-run migration that rebuilds saved lessons into the new format.                                                          |
| Migration guarantees | **None required.** Losing highlights, threads, drafts or attempt state is acceptable. Keep the migration simple.                                                     |
| Agentation / React   | Not used. The no-build-step rule and the authored-HTML lessons make a React toolbar a poor fit.                                                                      |
| Delivery             | Not implemented in this pass. Triage into GitHub as an epic with sub-issues in Backlog.                                                                              |

## Constraints (from CLAUDE.md / ARCHITECTURE.md)

- No build step. Browser modules stay `.mjs`/`.js` and are served directly. Add a `.d.mts`
  sidecar when TypeScript imports one.
- Vendored assets go under `assets/runtime/vendor/<name>/` with `LICENSE`, `VERSION` and
  provenance, following the Temml and Mermaid pattern. Add attribution to
  `docs/ATTRIBUTION.md`.
- Keep private quiz files off static routes. New font and icon routes go through the
  `src/paths.ts` guards.
- After a lesson starts, learner questions and replies stay on the lesson page. The ask
  panel can move, but it can't leave the page.
- Show specific errors and require an explicit retry, with no fallbacks. This applies to
  migration failures too.
- Use live browser checks for UI behavior, not wording or layout tests. Run
  `npm run verify` and use `verify-studens` scopes.

## Design system

### Tokens

Replace the `--cl-*` palette in `classroom.css` with a semantic token set. Keep the
`--cl-` prefix so lesson CSS and runtime modules keep resolving.

- Surfaces: `--cl-bg`, `--cl-surface`, `--cl-surface-2` (sunk), `--cl-border`, `--cl-border-strong`.
- Text: `--cl-text`, `--cl-text-muted`, `--cl-text-faint`.
- Accent: `--cl-accent`, `--cl-accent-ink` (text on accent), `--cl-accent-soft`. All three
  come from the selected accent.
- Status: `--cl-success(-soft)`, `--cl-danger(-soft)`, `--cl-warn(-soft)`, `--cl-highlight(-active)`.
- Radius: `--cl-radius: 10px`, `--cl-radius-sm: 6px`. Nested surfaces use outer = inner + padding.
- Elevation: ring shadows
  `0 0 0 1px rgb(0 0 0/.06), 0 1px 2px rgb(0 0 0/.06), 0 4px 12px rgb(0 0 0/.04)`, plus a
  dark-mode equivalent and `border: 1px solid transparent` underneath for forced colors.
  Borders stay on inputs, dividers, table cells and selected states.

Light and dark base values follow the mockup (zinc-like neutrals). The tokens are still
defined three times (system media query, `[data-theme=light]`, `[data-theme=dark]`).
Remove that duplication with a shared custom-property block per theme.

### Accent selection

- Offer four accents: **Indigo** (default), **Copper** (continuity with the old look),
  **Green**, **Neutral**. Each one defines light and dark `accent`, `accent-ink` and
  `accent-soft`, with ≥ 4.5:1 text contrast on its soft fill and ≥ 3:1 for the solid fill
  against the surface.
- Store it per device in localStorage next to the theme (`theme.mjs` pattern) and apply it
  as `data-accent` on `<html>` before first paint to avoid a flash.
- Show the picker in Settings and in the sidebar footer menu.
- Accent and theme switches suppress transitions for one frame (better-ui theme-switch
  recipe).

### Typography

- UI chrome: Inter 400/500/600. Prose: Source Serif 4 (opsz). Code: JetBrains Mono.
- Ship variable woff2 Latin and Latin-Extended subsets. Declare them with `font-display: swap`
  and preload the two used above the fold.
- Lesson prose keeps a reading measure of about 34rem, at 17px / 1.65.
- Use tabular numbers for scores, counts and due figures.

### Components (base set)

Button (primary, secondary, ghost, danger, with sizes), icon button, chip/badge (neutral,
accent, success, warn, danger), card, list row, disclosure row, segmented control,
text input, textarea, select, checkbox/radio, meter, mini bar chart, empty state,
inline error with Retry, toast-free status line, skeleton.

Rules:

- Press scales to `0.96` over 150ms with ease-out, never when disabled, and only under
  `prefers-reduced-motion: no-preference`.
- Hover styles go inside `@media (hover: hover)`.
- Name transition properties explicitly. Never use `all`.
- Icons use `currentColor` with a 1.75 stroke next to 400–500 text. Outline is the
  default and filled marks the active state.
- Scrollable overlays (drawer, menus, ask panel) get `overscroll-behavior: contain`.

## Information architecture

### Shell

- **Top bar:** brand, breadcrumbs (hidden when the sidebar shows the location), search,
  theme toggle. On mobile, a menu button replaces the sidebar.
- **Sidebar:** Today (with due badge), Review, Search, then the classroom list with due
  counts, then folders, then a footer with settings and accent.
- **Lesson pages:** the sidebar collapses to a 48px icon rail by default. Expand or
  collapse is remembered per device. The freed width goes to the ask panel.
- **Mobile:** a left drawer with focus trap, Escape to close and contained overscroll. It
  slides in over 250ms with `cubic-bezier(0.32, 0.72, 0, 1)` and slides out the way it came.

### Today (root landing)

1. A **continue** card across classrooms: the most recent in-progress lesson with a resume
   point.
2. **Daily review:** the total due count and a Start button, with history as a secondary link.
3. **Classrooms grid:** title, mission line, lesson count and due count. Move to folder
   goes in an overflow menu, not a card footer.
4. Folders, as they work today.

### Classroom page

1. Title and mission.
2. **Up next** card, with one primary action chosen in this order:
   resume in-progress lesson → review due items (if any are due) → next lesson. Secondary
   actions sit beside it.
3. Two columns: **Lessons** (number, title, status chip: score / In progress / Not
   started) and **Review, next 14 days** (mini bars, with Table as an accessible
   alternative).
4. **Memory map:** compact rows with objective, strength/state chip and relative due
   ("Due now", "In 3 days", "Paused · re-teach"). A row expands in place to strength,
   last evidence, open gap and "why is this due". Long allowance and explanation copy
   moves into a single "How review is scheduled" disclosure.
5. Next lesson request (topic textarea) as a quiet secondary block.
6. Workspace documents, reference and learning records, then export, all below the fold.

Timestamps show relative and local by default, with exact UTC available on hover or focus
in a `<time>` title.

### Lesson page

- Prose in Source Serif 4. Chrome in Inter.
- **Ask panel:** on wide screens it docks in the right column, aligned with the
  highlighted passage. Below about 1100px it sits inline under the paragraph. It stays on
  the lesson page.
- Learner marks (highlight, note, bookmark) use the shared chip and toolbar components.
- Stepper, faded examples, practice, code exercises, math and diagrams are restyled with
  the base components.

### Quiz and grading

- Choice and option rows, text answers and code answers use shared input styles.
- **Submit → waiting:** a status line names what the teacher is doing (it reuses teacher
  activity), not a spinner alone.
- **Result:** a score block (large tabular %, "N of M correct", a one-line summary, a meter),
  then per-question feedback with a static icon and color plus text.
- Disputes, criterion breakdowns and expected answers become disclosure rows under each
  question.

### Review screen and daily review

One card at a time, consistent with quiz components. Progress is shown as "3 of 5" plus a
meter. Each completion state has its own empty or complete view.

### Teacher activity and status

A compact status pill in the top bar (idle / working / queued / failed), plus a panel or
drawer for the request list. A failure shows the specific error and an explicit Retry,
using the inline error component.

### Settings, search, export, course map, records, documents

Restyled to the base components. Settings gains the Accent picker. Search results use
list rows with highlighted matches.

## Motion (purposeful only)

Nothing animates on row hovers, tab switches, keystrokes or keyboard shortcuts. Every
animated change also has a static cue. Everything is gated by `prefers-reduced-motion`,
and reduced motion falls back to an opacity cross-fade.

| Moment                             | Tool                                         | Values                                                                                                                 |
| ---------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Button press                       | CSS transition                               | `scale: .96`, 150ms ease-out, `:not(:disabled):active`                                                                 |
| Ask panel open / close             | CSS transition (`@starting-style` for enter) | enter: opacity + 4px blur + 12px translateY, 300ms ease-out; exit: −12px, 150ms ease-out                               |
| Answer arriving in thread          | CSS transition                               | opacity + 4px blur, 300ms ease-out, no movement                                                                        |
| Memory map row expand              | Height transition (accordion exception)      | 200ms `cubic-bezier(0.23, 1, 0.32, 1)`                                                                                 |
| Grading result reveal              | CSS animation, runs once                     | Staged: score → summary → questions, 100ms stagger, 300ms ease-out; meter `scaleX` 600ms `cubic-bezier(0.23,1,0.32,1)` |
| Page first load (Today, classroom) | CSS animation, runs once                     | Hero, then sections, 100ms stagger; skip on back/forward cache restore                                                 |
| Mobile drawer                      | CSS transition                               | translateX 250ms `cubic-bezier(0.32, 0.72, 0, 1)`                                                                      |
| Icon swaps (copy → copied, theme)  | Both icons in DOM                            | scale .25→1, opacity, blur 4px→0, 300ms `cubic-bezier(0.2,0,0,1)`                                                      |
| Theme / accent switch              | n/a                                          | Suppress all transitions for one frame                                                                                 |

Use transitions, not keyframes, for anything toggled. Animate only transforms, opacity
and filter, except the accordion height.

## Lesson markup contract and migration

### New contract

- Update `assets/templates/*.html` (lesson, quiz, review, practice, stepper, faded,
  reference, assessment) to the new component classes. `quiz.html` stays the canonical
  markup contract.
- Update the `teach` skill and authoring rules so new lessons use the new contract.
- Bump a contract marker (for example `data-cl-ui="2"` on the lesson root) so the runtime
  and migration can tell old lessons from new ones.
- Runtime modules (`quiz-ui.mjs`, `highlights.mjs`, `cards.mjs` and others) target the
  new contract. Old lessons are expected to be migrated, not supported indefinitely.

### Migration tool

The user asked for something an agent can run to rebuild existing Studens content.

- `docs/MIGRATE-UI-2.md`: agent-facing instructions for rebuilding each saved lesson's
  HTML into the new contract. It covers what to keep (the objective and teaching
  content), the target template, and how to check the result in the browser.
- `scripts/migrate-ui.ts`: finds lessons without `data-cl-ui="2"`, lists them, and with
  an explicit flag hands each one to the agent workflow, or rewrites it mechanically where
  that is possible. It reports per-lesson success or a specific failure and never
  silently skips.
- **No preservation guarantees.** Highlights, threads, drafts and quiz attempts may stop
  resolving after a rebuild. The tool says this up front and the user runs it explicitly.
- It must not touch private files (`quiz/`, keys, plans, teacher state) beyond what the
  rebuild needs, and must not re-grade anything.

Open for the implementer: whether a rebuilt lesson keeps its existing private rubric or
the agent regenerates it. Pick the simpler path and document it.

## Verification

- Use `verify-studens` scopes per surface, with live browser checks in light, dark, every
  accent, desktop and mobile (390px), and reduced motion.
- Watch motion at 10% speed in DevTools for each row in the Motion table.
- Check contrast for every accent pair.
- Run `npm run verify` and `claude plugin validate .` if manifests change.
- Keep before and after screenshots per surface under `screenshots/<feature>/`, following
  existing practice.

## Proposed issue breakdown

Epic: **UI redesign: Calm product system** (`epic`). Sub-issues, all in Backlog:

1. Design tokens, accent selection and theme cleanup (`area:browser`). P1.
2. Vendor Inter, Source Serif 4, JetBrains Mono and the Lucide subset (`area:engineering`). P1, blocked by nothing.
3. Base component styles and motion primitives (`area:browser`). P1, blocked by 1 and 2.
4. App shell: sidebar, rail on lessons, mobile drawer, Today landing (`area:navigation`). P1, blocked by 3.
5. Classroom page hierarchy: Up next, lessons, compact memory map (`area:progress`). P1, blocked by 3 and 4.
6. Lesson page and ask panel redesign (`area:lesson`). P2, blocked by 3 and 9.
7. Quiz, grading reveal and feedback redesign (`area:assessment`). P2, blocked by 3 and 9.
8. Review screen and daily review redesign (`area:review`). P2, blocked by 3.
9. Lesson markup contract v2: templates and teach authoring rules (`area:lesson`). P2, blocked by 3.
10. Agent-run lesson migration to contract v2 (`area:engineering`). P2, blocked by 9.
11. Teacher activity status and error surfaces (`area:browser`). P3, blocked by 3 and 4.
12. Settings, search, export, course map, records and document pages restyle (`area:browser`). P3, blocked by 3 and 4.
