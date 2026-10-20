# Read and ask

The learner reads a lesson and asks about text without leaving the page.

## Sub-features

- Select lesson prose or a quiz question and its options. Selection alone sends nothing.
- Highlight, add a margin note, or bookmark without asking the teacher.
- Revisit, edit, and delete marks from the Saved marks panel.
- Read a card answer and send a follow-up, keeping multiline Markdown and code.
- Restore saved cards and unsent text after reload.
- Keep rejected questions on the page with their error and an explicit resend.
- Save an ungraded self-explanation.
- Open glossary definitions after recall and follow their teaching origin.
- Follow prerequisite lesson links. Draw diagrams and math. Change the theme.

## How to get to it (user POV)

1. Open a lesson link and select text.
2. Choose `Highlight`, `Note`, `Bookmark`, or `Ask`.
3. For a note, select `Save note`. For Ask, enter a question and select `Ask your teacher`.
4. Open `Saved marks` to revisit, edit, or delete.

## Driving it with playwright-cli

Run `npm run verify -- browser --artifacts /tmp/studens-reading`.

The suite selects text with the mouse and uses `.cl-ask-pill`, `[data-cl-question]`,
and `[data-cl-followup]`. Asking about an option must not select it; a follow-up
must not submit the quiz.

- **Question errors** (`question-errors/`). Rejected ask and follow-up POSTs show
  their HTTP error with the typed text kept through reload. Restoring ownership does
  not resend; one explicit click sends exactly one request.
- **Typed answers** (`service/typed-passage-*.json`). Answers with line breaks,
  quotes, Unicode, and fenced code survive reload and an interrupted receipt with no
  new model turn.
- **Reflections.** `form.cl-reflect` saves text that survives reload and pretest
  release. Inspect `stored-learner-paths.json`.
- **Learner marks** (`learner-marks/result.json`). Each action, overlapping ranges,
  literal note markup, a save lock with a kept draft, two-tab stale edits, corrupt
  state errors, and keyboard `Alt+M`. Marks never wake the teacher or enter the text
  index or answer snapshots.
- **Glossary, diagrams, math, theme.** Invalid Mermaid and TeX show visible errors.
  Diagram and math text do not offer the ask pill. A highlight around a formula
  quotes it as TeX.
- **Lesson sources** (`lesson-sources/result.json`). **Builds on** opens the
  prerequisite; **Taught in** opens the owning section after **Show the definition**.
  Escape returns focus to the term. Broken declarations show a specific error with
  **Retry loading teaching sources** or **Retry loading lesson links**, which run no
  teacher.

For a real persistent Pi teacher, close initiating Pi after opening a lesson, then
save a reflection, ask about a highlight, and send a follow-up. All three must be
saved in the same Pi session after reload, with no quiz grades.

## Gotchas

- The browser suite uses fixture teachers. Use real host targets for model answers.
- Quiz help before grading must clarify the question without solving it.
- Saved cards sit in document flow and keep their place after reload.
- Source links focus the section below the sticky header. An edited section shows a
  missing-section notice with Retry; it never guesses a replacement.
- [Review card fragments](review.md) are review navigation and must not show a
  missing-section notice.
- Following a glossary source closes its dialog, including within the same lesson.
