# Export a classroom

The learner takes saved public classroom material into Anki, print, or Markdown.

## Sub-features

- Download a real `.apkg` deck and portable Markdown; open a printable classroom.
- Keep public documents, notes, learning records, released lessons, glossary and question threads.
- Preserve Unicode, code line breaks, formulas, Mermaid source and referenced public media.
- Keep adjacent public input/select/textarea labels separately readable after controls are removed, including radio/checkbox options, associated `for`/`id` labels, inline emphasis and exact Unicode.
- Keep inline and referenced static SVG labels, nested positioned text spans and exact Unicode; omit hidden and active SVG content.
- Exclude private keys/plans/variants/drafts/teacher/recovery files and unreleased teaching.
- Include only already-unlocked expected answers after explicit, off-by-default selection.
- Resolve answer labels from released teaching while independent diagnostic gates and nested inert templates stay private.
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
The rich fixture also includes the exact no-whitespace `Size`/`Unit` quantity pair,
number input, associated select/textarea labels, inline emphasis and Unicode.
Inspect `rust-generic-markdown.png`, `rust-answers-generic-markdown.png` and
`official-import/imported-generic{,-answers}.png`. Label glyphs must occupy
separate non-overlapping lines in their original numbered quantity item, with the
next item separate. Both consent states download PDF, Markdown and Anki through
Export controls; inspect the actual PDF text and rasterized quantity page as well.
Controls, values and source attributes must be absent. The normal saved assessment
and course navigation remain usable alongside this public reading fixture.

The rich fixture includes inline and referenced SVG labels with nested positioned
`tspan` text. Print, rendered Markdown and the imported card must show both labels;
inspect `imported-svg.png` for the focused card view. Checks require nonzero glyph
geometry and loaded SVG media, exact imported label/media bytes, and absent hidden,
script, event, foreign-object and external-reference canaries.

The default browser suite also runs the released-template answer regression. For a focused check:

```sh
node --input-type=module -e 'import("./scripts/e2e-export-template-browser.ts").then(m=>m.verifyExportTemplateBrowser("/tmp/studens-export-template"))'
"$ANKI_PYTHON" scripts/check-export-template-anki.py /tmp/studens-export-template
node --input-type=module -e 'import("./scripts/e2e-export-template-browser.ts").then(m=>m.verifyTemplateImportedCardBrowser("/tmp/studens-export-template/official-import"))'
```

This controlled fixture submits a real diagnostic, releases its original template,
then grades choice/multi/order/match/locate answers through lesson controls. Open
`Expected answer and criteria` on the choice question to compare its original public
label before exporting. Inspect
`learner.json`, `graded-{off,on}.{md,apkg,pdf}` and `graded-on-print.png`.
Inspect `*-downloads.json`, `*-markdown-reading.json` and `*-reading.png` for
the exact public choice/multi labels and non-overlapping text geometry. Checks
also require seven distinct ordered question items, options inside their original
question, and original nested order/match lists in print, rendered Markdown and
imported reading cards. Inspect `*-markdown-reading.png` for focused question boundaries.
The fixture uses adjacent labels with no intervening whitespace. Rasterize an actual downloaded
PDF with `pdftoppm -f 2 -singlefile -scale-to 1500 -png <graded-on.pdf> <page-prefix>`
and inspect its reading page; expected-answer blocks alone do not prove option readability.
Two controlled teacher turns create an exact corrective task/reply/check, unlocking
one numeric miss while a neighboring miss stays locked. Inspect `corrected-*`,
`*-read-only.json`, `official-import/report.json` and `answer-card.png`. The answer
and four `*-reading-card.png` captures come from official imported `card.answer()`
HTML; `card-browser-report.json` checks choice/multi geometry with answers off/on
before and after correction. Distinct labels must have a visible gap or separate lines.
Answer cards must use original public labels, preserve GUIDs on reimport and contain no
private keys, internal option identities, unreleased neighbor or nested inert content.
Read inventories cover sources, attempts/grades, teacher state, reviews/schedules and
an unrelated classroom, allowing only deliberate fixture-owner changes. Export reads
must make zero teacher calls. These fixture turns prove persistence and eligibility,
not model behavior or learning. Contract tests additionally reject nested pretest
gates and missing/duplicate identities or ambiguous labels with explicit-retry errors.

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
