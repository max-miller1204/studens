# Learner marks evidence

Matching `before-*` and `after-*` images select **Every value has one owner.** in the canonical lesson shell. The base is `67092d07d143050caa6648de5a8280164ce05f96` (Studens 0.11.8). Desktop is 1280 × 900; mobile is 390 × 844. Each has light and dark captures. The viewport is set before loading, with scroll reset before full-page screenshots.

`after-*` shows explicit Ask, Highlight, Note, and Bookmark actions and the closed Saved marks panel. `saved-*` shows all three saved kinds, overlapping paint ranges, revisit/edit/delete controls, and literal markup in a note. `save-error.png` shows the real storage-lock rejection with the draft retained and an explicit retry. `unresolved-passages.png` shows missing and ambiguous anchors after an edit, with no alternate match chosen.

All captures were inspected. `provenance.json` records source and image SHA256 hashes. The source files match the focused verification source commit; adding this evidence does not change runtime behavior. Public PR links use the full commit SHA and are checked without authentication against local files and committed Git blobs.

The full integrated browser gate remains BLOCKED at the daily-review server-close step; this evidence does not waive that gate. The unchanged-base daily control passed, so the cause is not established.

The drive uses a controlled persistent-service fixture. Learner mark reads and actions make zero teacher calls and change no classroom files except `.learner-marks.json`. Adjacent Ask and follow-up use two fixture plans through the durable request queue. Neighboring assessments are machine graded. These images do not claim real model inference, teaching quality, or other-host coverage.
