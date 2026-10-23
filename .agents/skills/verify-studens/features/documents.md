# Documents and saved history

Read classroom documents, learning records, and review history inside the shared app navigation.

## Sub-features

- Read mission and notes with Source Serif prose and Inter headings.
- Open learning records from their index without changing saved evidence.
- Read review history separately from lessons and daily review progress.
- Keep workspace controls and text usable at desktop and 390px in both themes.

## How to get to it (user POV)

1. Open Today, then a classroom.
2. Select Course map, then Read mission document; or select Notes in Workspace.
3. Select All records under Learning records, then a record title.
4. Select Review history beside Settings to open saved classroom reviews.

## Driving it with playwright-cli

Use the shared launch and doctor instructions. Run the focused workspace capture:

```sh
node --input-type=module -e 'import {verifyDocumentPagesBrowser} from "./scripts/e2e-document-pages-browser.ts";await verifyDocumentPagesBrowser("/tmp/studens-documents")'
```

This drive enters through Today and classroom links, follows the course map to the
mission, opens the learning-record index and record, reads notes and populated review
history, and opens Export. It captures these families plus settings, search results,
and no-results at 1280×900 and 390×900 in light/dark. It selects all four accents in
Settings and reloads each selection. Search follows a highlighted result and uses
Back to check query preservation. Inspect the PNGs, `result.json` for unchanged
classroom hashes and zero teacher requests, and `cleanup.json` for removed scratch
state and a stopped server. This read-only fixture does not prove model access.
The drive also opens Export before corrupting its saved publication source, clicks
Open printable classroom, checks the specific export error in each size/theme,
repairs the source, and uses Retry export. Base error pages have no theme bootstrap
or viewport support; the new shell applies the selected appearance. The existing
review and export recipes cover empty review histories, saved answers, actual
downloads, and private-file access.

## Gotchas

Appearance is device-local. Classroom documents and history remain read-only;
appearance selection must not create teacher requests or learning evidence.
Scratch loopback ports vary between runs and appear in the settings capture.
