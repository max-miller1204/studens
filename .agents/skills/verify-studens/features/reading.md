# Read and ask

The learner reads a lesson and asks about text without leaving the page.

## Sub-features

- Select lesson prose or a quiz question and its options. Selection alone sends nothing.
- Explicitly highlight, add a margin note, or bookmark without asking the teacher.
- Revisit, edit notes, and delete marks from the lesson-local Saved marks panel.
- Read a card answer and send a card follow-up, preserving multiline Markdown and code.
- Restore saved cards and unsent text after reload.
- Keep rejected questions on the page with their specific error and an explicit resend.
- Save an ungraded self-explanation and restore its text and draft after reload.
- Open glossary definitions after recall, then follow a declared teaching origin.
- Follow explicit prerequisite lesson links. Draw diagrams and math. Change the theme.

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

The service fixture also sends typed passage answers containing line breaks, quotes,
backslashes, Unicode and fenced code. It clicks the card follow-up, reloads both
answers, then restarts with a saved plan whose answer receipt was interrupted.
Require unchanged answer bytes and no new model turn. Inspect
`service/typed-passage-reload.json`, `typed-passage-reload.png`, and
`typed-passage-recovered.json`. These controlled responses prove transport and
persistence, not model behavior.

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

The fixture resolves repeated words and overlapping quote occurrences using canonical context, preserves exact quotes
across reflow/markup edits, and displays missing or ambiguous passages without
choosing another location. It checks private routes and excludes mark UI from the
canonical text index and answer snapshots. Expected-answer panels also remain outside
selection actions and indexing, while authored quiz prompts stay selectable. Before
adjacent Ask, classroom file hashes
(except the private marks file) and the controlled service request list must be
unchanged. Actual Ask/follow-up controls then save two ordered answers through the
persistent service fixture. A neighboring machine assessment grades once, leaves the
note draft editable, and restores its saved answer; a negative answer mutation must
still be detected. This fixture uses no model inference. Inspect `result.json` and
matched desktop/mobile light/dark captures.

The authoring submit/reload snapshot keeps checked, text, and select answers from
the question while excluding verdict, question-thread, expected-answer, and mark
UI. The fixture probes each excluded owner and verifies that mutations of each
real answer-control category still change the snapshot.

For an actual persistent Pi teacher, close initiating Pi after opening a scratch
lesson containing a self-explanation. Fill `form.cl-reflect textarea`, select
`Save`, and require the durable `reflect` request to finish in the saved Pi session.
Highlight prose and ask a question, then fill `[data-cl-followup]` in its answered
card and select `Ask`. Require both saved answers, the reflection text, and the
same Pi session after reload. These ungraded actions must not create quiz grades.
Use a complete scaffold, including `NOTES.md`; this is a transport and persistence
check, not an authored-lesson quality evaluation.

The suite opens glossary definitions and changes the theme. It checks drawn diagrams, accessible descriptions, and a visible error for invalid Mermaid source. Diagram text must not offer the ask pill. It checks drawn math, literal TeX in code, a visible error for invalid TeX, and Markdown math in a card answer. Math text must not offer the ask pill. A highlight around a formula marks the whole formula and quotes it as TeX. Grading receives each formula as TeX.

The `lesson-sources/` drive opens the canonical `.cl-lesson-shell` with Pi, Claude,
and Codex owner fixtures. Use the **Builds on** link to open the prerequisite lesson.
Focus a `.cl-term`, press Enter, and require the source link to stay hidden until
**Show the definition**. The **Taught in** link opens the canonical owning lesson
and its declared section. Escape and **Close definition** return focus to the term.
The drive clicks actual destinations, reloads them, and checks viewport bounds in
1280×900 and 390×844 light/dark layouts. Repeated sections retain term controls;
code, generated math and diagram nodes remain unwrapped. Search's glossary-term
result also opens its real teaching source.

Source-error probes remove or edit a declaration, supply traversal/URL-like anchor
ids, and corrupt the saved prerequisite relationship. Missing provenance stays
unlinked; malformed provenance names its file. Correct the file, then use **Retry
loading teaching sources** or **Retry loading lesson links**. Neither control runs
a teacher. Pending authoring, private files, legacy and private review neighbors,
and unreleased teaching must never become source destinations. Only a separate
explicit diagnostic submission releases its pretest; reloading and following links
adds no grade or learning record. Inspect `result.json`, per-phase `*-hashes.json`,
raw screenshots and `cleanup.json`. These declarations are fixture author metadata,
not evidence of native model adoption or human learning.

## Gotchas

The browser suite uses fixture teachers. Use the real host targets for model answers. Quiz help before grading must clarify the question without solving it. Saved cards sit in document flow. A reload must preserve their location.

Source destinations measure the actual sticky header, position and focus the teaching
section below it, and retain the anchor after reload. A previously shown link whose
section was edited keeps its original hash and shows a specific missing-section state
with explicit Retry and lesson-start links; it never guesses a replacement. Inspect
`stale-held-source-hashes.json` and `stale-source-retry-hashes.json` alongside actual
viewport bounding boxes. Published full-page captures reset scroll to the top.

Existing [review card fragments](review.md) belong to review navigation and must
not produce a missing teaching-section notice. Question-card and search fragments
retain their own `cl-` destinations; Saved marks revisit their anchored ranges.

Following a glossary source closes its dialog, including a source in the current
lesson. Retained native output checks must assert the dialog closes before reload
and focus reaches the actual teaching section; reloading alone can hide this bug.
The original same-lesson failure and unchanged classroom hashes remain in the packet.
