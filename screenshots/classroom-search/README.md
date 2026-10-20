# Classroom search evidence

Matched landing captures use accepted main `67092d0`, 1280×900 desktop and 390×844 mobile, both themes, and the same two classroom cards. Original dispatch-base `5cb7dce` captures remain in `original-base/`. Images were captured with the repository's headless Playwright harness and inspected.

`results-*` shows all four public domains in both classrooms. `error.png` shows a safe malformed-source error and explicit retry; `edited-passage.png` shows honest unavailable-passage navigation. `browser-result.json` records exact result links, privacy probes, zero search writes, pretest release, Ask and graded-quiz observations. `owner-fixtures.json` records independent Pi/Claude/Codex fixture routes with unchanged classroom hashes and zero teacher turns. These fixtures do not prove model behavior.

`provenance.json` identifies source epochs, viewport/theme/data, screenshot hashes, and limits. Full command receipts, original failures, snapshots, owner state hashes and cleanup reports remain under `/tmp/studens-search30` for integration review. No teaching-quality or human-learning claim follows from these checks.

`optional-tags.png` shows legacy paragraphs, nested lists and tables with omitted optional end tags. Seven result links open exact visible passages. `optional-tags-comparison.json` preserves the parent's same-input HTTP comparison: accepted main 200, initial search implementation 500, repaired search 200; canonical source unchanged and model calls zero throughout. Original parent receipts remain untouched. Fresh repaired landing/result captures match the six committed images byte-for-byte.
