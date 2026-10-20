# Read and ask

The learner reads a lesson and asks about text without leaving the page.

## Sub-features

- Select lesson prose or a quiz question and its options. Selection alone sends nothing.
- Explicitly highlight, add a margin note, or bookmark without asking the teacher.
- Revisit, edit notes, and delete marks from the lesson-local Saved marks panel.
- Read a card answer and send a card follow-up.
- Restore saved cards and unsent text after reload.
- Keep rejected questions on the page with their specific error and an explicit resend.
- Save an ungraded self-explanation and restore its text and draft after reload.
- Open glossary definitions. Draw diagrams and math. Change the theme.

## How to get to it (user POV)

1. Start a lesson from the host.
2. Open its localhost URL.
3. Select text.
4. Choose `Highlight`, `Note`, `Bookmark`, or `Ask` in the passage actions.
5. For a note, enter text and select `Save note`. For Ask, enter a question and select `Ask your teacher`.
6. Open `Saved marks` to revisit a passage, edit a note, or delete a mark.

## Driving it with playwright-cli

Run `npm run verify -- browser --artifacts /tmp/studens-reading`.

The suite selects text with the mouse. It uses `.cl-ask-pill`, `[data-cl-question]`, and `[data-cl-followup]`. It checks saved annotations, draft restoration, and card placement after the quiz question. Asking about an option must not select it. Sending a follow-up must not submit the quiz.

The `question-errors/` fixture rejects the real ask and follow-up POSTs through the
service ownership guard. Each specific HTTP error must appear in its form's alert,
with the typed question and draft retained through reload. Rejection must leave the
annotation bytes unchanged and wake no teacher. Keyboard submission while a response
is held must not duplicate the POST. Restoring ownership does not resend; selecting
`Ask your teacher` or the original card's `Ask` accepts exactly one request each.
Immediate answer SSE must remain visible when the older pending HTTP response arrives.
The original answer stays unchanged and no quiz or grade is created. Inspect
`question-errors/result.json` and its matched mobile/light and desktop/dark errors.
The fixture records native dialogs and requires none; it never dismisses one.

The suite fills `form.cl-reflect textarea` and selects `Save`. Saved text must remain
after reload; an unsent reflection draft must survive pretest release without waking
a teacher. Inspect `stored-learner-paths.json` and `disk-draft-history.json`.

The `learner-marks/` fixture drives `.cl-selection-actions` and the `Saved marks`
panel. It checks each explicit action, overlapping paint ranges, note text as literal
markup, reload/revisit/delete, and a real save lock with a retained session draft.
Removing the lock must not resend. Two tabs create marks concurrently and reject
stale note edits; `Refresh saved marks`, `Use refreshed revision`, then `Save note`
are explicit steps to reconcile a kept draft. Corrupt/unsupported state must show
a specific read error while retaining visible marks. Keyboard selection extension
and `Alt+M`, then Tab/Enter, choose an action without teacher work.

The fixture resolves repeated words using canonical context, preserves exact quotes
across reflow/markup edits, and displays missing or ambiguous passages without
choosing another location. It checks private routes and excludes mark UI from the
canonical text index and answer snapshots. Before adjacent Ask, classroom file hashes
(except the private marks file) and the controlled service request list must be
unchanged. Actual Ask/follow-up controls then save two ordered answers through the
persistent service fixture. A neighboring machine assessment grades once, leaves the
note draft editable, and restores its saved answer; a negative answer mutation must
still be detected. This fixture uses no model inference. Inspect `result.json` and
matched desktop/mobile light/dark captures.

For an actual persistent Pi teacher, close initiating Pi after opening a scratch
lesson containing a self-explanation. Fill `form.cl-reflect textarea`, select
`Save`, and require the durable `reflect` request to finish in the saved Pi session.
Highlight prose and ask a question, then fill `[data-cl-followup]` in its answered
card and select `Ask`. Require both saved answers, the reflection text, and the
same Pi session after reload. These ungraded actions must not create quiz grades.
Use a complete scaffold, including `NOTES.md`; this is a transport and persistence
check, not an authored-lesson quality evaluation.

The suite opens glossary definitions and changes the theme. It checks drawn diagrams, accessible descriptions, and a visible error for invalid Mermaid source. Diagram text must not offer the ask pill. It checks drawn math, literal TeX in code, a visible error for invalid TeX, and Markdown math in a card answer. Math text must not offer the ask pill. A highlight around a formula marks the whole formula and quotes it as TeX. Grading receives each formula as TeX.

## Gotchas

The browser suite uses fixture teachers. Use the real host targets for model answers. Quiz help before grading must clarify the question without solving it. Saved cards sit in document flow. A reload must preserve their location.
