# Read and ask

The learner reads a lesson and asks about text without leaving the page.

## Sub-features

- Highlight lesson prose or a quiz question and its options.
- Read a card answer and send a card follow-up.
- Restore saved cards and unsent text after reload.
- Keep rejected questions on the page with their specific error and an explicit resend.
- Save an ungraded self-explanation and restore its text and draft after reload.
- Open glossary definitions. Draw diagrams and math. Change the theme.

## How to get to it (user POV)

1. Start a lesson from the host.
2. Open its localhost URL.
3. Select text.
4. Select `Ask your teacher`.
5. Enter a question.
6. Submit it.

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
