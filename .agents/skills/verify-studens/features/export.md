# Export a classroom

The learner takes saved public classroom material into Anki, print, or Markdown.

## Sub-features

- Download an `.apkg` deck and portable Markdown; open a printable classroom.
- Include public documents, notes, learning records, released lessons, glossary, and question threads.
- Preserve Unicode, code line breaks, formulas, Mermaid source, public media, and static SVG text.
- Keep form labels and options readable after controls are removed.
- Exclude private keys, plans, variants, drafts, teacher files, and unreleased teaching.
- Include already-unlocked expected answers only when explicitly selected.
- Export without teacher calls, grades, evidence, or scheduling writes.

## How to get to it (user POV)

1. Open the classroom and choose `Export`.
2. Leave `Include answers already unlocked in Studens` unchecked unless you want answers. Reload resets it.
3. Choose `Download Anki deck`, `Download Markdown`, or `Open printable classroom`.
4. Print or save a PDF from the browser.
5. After a failure, fix the named source and choose `Retry export`.

## Driving it with playwright-cli

The default browser suite runs both export drives. Focused checks:

```sh
node --input-type=module -e 'import("./scripts/e2e-export-browser.ts").then(m=>m.verifyClassroomExportBrowser("/tmp/studens-export-browser"))'
node --input-type=module -e 'import("./scripts/e2e-export-template-browser.ts").then(m=>m.verifyExportTemplateBrowser("/tmp/studens-export-template"))'
```

**Classroom export.** Uses the real download controls in empty and rich classrooms,
desktop/mobile, light/dark, answers on and off, malformed state with retry, and
private/traversal/symlink probes. Pi, Claude, and Codex owners must produce identical
content with zero teacher calls. Inspect `result.json`, `read-only.json`,
`source-links.json`, the downloaded files, and the print captures. Generic form
labels must sit on separate, non-overlapping lines; inspect
`rust-generic-markdown.png`. SVG labels must render with glyph geometry and no
hidden, script, or external content.

**Released-template answers.** Submits a diagnostic, releases its template, and grades
choice/multi/order/match/locate answers through lesson controls. A corrective turn
unlocks one numeric miss while a neighbor stays locked. Inspect `learner.json`,
`graded-{off,on}.{md,apkg,pdf}`, `*-reading.png`, and `*-read-only.json`. Rasterize a
downloaded PDF to check option readability:

```sh
pdftoppm -f 2 -singlefile -scale-to 1500 -png graded-on.pdf page
```

### Official Anki import

Set `ANKI_PYTHON` to an isolated Python with `anki==26.9.3`. This is a verification
prerequisite, not a runtime dependency. Use a fresh artifact directory.

```sh
"$ANKI_PYTHON" scripts/check-export-anki.py /tmp/studens-export-browser
node --input-type=module -e 'import("./scripts/e2e-export-browser.ts").then(m=>m.verifyImportedCardBrowser("/tmp/studens-export-browser/official-import"))'
"$ANKI_PYTHON" scripts/check-export-template-anki.py /tmp/studens-export-template
node --input-type=module -e 'import("./scripts/e2e-export-template-browser.ts").then(m=>m.verifyTemplateImportedCardBrowser("/tmp/studens-export-template/official-import"))'
```

Inspect `official-import/report.json`, `card-browser-report.json`, and the imported
card captures. Import must keep fields, media, GUIDs, and deck ownership with no
review history. Reimport must not duplicate notes, must update newer sources, and
must keep unrelated notes and local edits.

HTTP contract tests cover tailnet canonical sources, alias media and private links,
untrusted forwarding headers, and legacy filenames. They make no real Tailscale change.

## Gotchas

- Anki exports saved reading cards and public threads; it does not invent questions.
  Empty classrooms have no cards.
- Expected-answer errors stop an answer export. Locked or ungraded answers are listed
  as omissions. Disputes do not bypass the original gate.
- Scripts, custom styles, external images, audio/video, and interactive widgets are omitted.
- Markdown keeps diagrams as Mermaid fences; print and Anki render them.
- Source links need the original service running.
- Core import and Chromium rendering do not verify the Anki desktop or mobile UI.
