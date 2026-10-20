# Export a classroom

The learner takes saved public classroom material into Anki, print, or Markdown.

## Sub-features

- Download a real `.apkg` deck and portable Markdown; open a printable classroom.
- Keep public documents, notes, learning records, released lessons, glossary and question threads.
- Preserve Unicode, code line breaks, formulas, Mermaid source and referenced public media.
- Exclude private keys/plans/variants/drafts/teacher/recovery files and unreleased teaching.
- Include only already-unlocked expected answers after explicit, off-by-default selection.
- Keep checked canonical source links and reject private routes across aliases.
- Export without teacher calls, grades, learning evidence or scheduling writes.

## How to get to it (user POV)

1. Open the classroom and choose `Export`.
2. Leave `Include answers already unlocked in Studens` unchecked for ordinary exports.
3. Choose `Download Anki deck`, `Download Markdown`, or `Open printable classroom`.
4. Use the browser's print command to print or save a PDF. Contents links navigate within the printable document.
5. To include eligible answers, deliberately check the answer option before exporting. Reload resets it.
6. A failed export names the saved source problem. Correct it and choose `Retry export` explicitly.

## Driving it with playwright-cli

The default browser suite includes this capability. For a focused check:

```sh
node --input-type=module -e 'import("./scripts/e2e-export-browser.ts").then(m=>m.verifyClassroomExportBrowser("/tmp/studens-export-browser"))'
```

Inspect `result.json`, `read-only.json`, `source-links.json`, the actual downloaded
`.apkg`/`.md` files, rendered Markdown screenshots, PDFs and print screenshots.
The harness uses actual download controls in empty and rich classrooms, desktop/mobile
and light/dark, explicit answers and reload, malformed publication state and retry,
private/traversal/symlink probes, pretest release and neighboring quiz/course navigation.
Owner fixtures must produce identical content for Pi, Claude and Codex, with zero
teacher calls. These fixtures do not prove model inference.

For package acceptance, set `ANKI_PYTHON` to an isolated Python executable with the
official `anki==26.9.3` package. Retain wheel and dependency provenance with the run.
This is a verification prerequisite, never a product runtime dependency.

```sh
"$ANKI_PYTHON" scripts/check-export-anki.py /tmp/studens-export-browser
node --input-type=module -e 'import("./scripts/e2e-export-browser.ts").then(m=>m.verifyImportedCardBrowser("/tmp/studens-export-browser/official-import"))'
```

Use a fresh artifact directory; existing importer collections are never overwritten.
Inspect `official-import/report.json`, `card-browser-report.json` and
`imported-card.png`. Official core must preserve exact frozen public fields, media,
GUID/card identities, classroom deck ownership, and zero review history. Reimport
must not duplicate notes; newer source updates existing identities, unrelated notes
survive, local newer edits remain, and removing a source does not delete Anki notes.
The card browser check renders the actual imported `card.answer()` HTML and media.

HTTP contract tests additionally cover checked tailnet canonical sources in all
three formats, local sources when disabled, alias media/private links, untrusted
forwarding headers, legacy filenames, HTML5 entities/optional tags and static SVG.
This checked-base test makes no real Tailscale route change and is not a phone test.

## Gotchas

- Anki exports saved reading cards and public threads; it does not invent questions or answers. Empty classrooms have no cards.
- Expected-answer errors stop an answer-bearing export. Historical, ungraded or still-locked answers are listed as omissions. Dispute revisions do not bypass the original grading/corrective gate.
- Public media is embedded in Markdown/print and bundled in Anki. SVG uses static primitives. Scripts, custom styles, external images and audio/video are omitted. Interactive widgets are explicitly omitted; a portable export is not a live simulation.
- Markdown preserves diagrams as Mermaid fences. Printable HTML and supported Anki webviews render them using the packaged renderer; exact source remains available if rendering reports an error.
- Source links return to the original service's checked canonical URL. Offline reading is portable; opening source links requires that service.
- Core importer and Chromium card rendering do not verify Anki desktop/mobile UI. Use an actual Anki application separately when that coverage is required.
