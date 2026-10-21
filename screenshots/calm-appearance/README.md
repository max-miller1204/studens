# Calm appearance evidence

These captures use isolated Chromium fixtures and the real loopback HTTP server.
The before captures use base `0633bdce0c8ba5697f2b87f38144fc43c0396bf7`.
The after captures use this PR's runtime changes.
Desktop captures use 1280 by 900 pixels. Mobile captures use 390 by 844 pixels.
Each isolated run uses its own loopback port.
The fixture content and routes match. Settings gains an Appearance section.

## Runtime scope

The appearance drive covers all eight light/dark and accent pairs.
It measures resolved text, soft-fill, solid-fill, and button contrast.
It checks local save, reload, navigation, System theme changes, keyboard focus,
cross-tab updates, transition suppression, reduced motion, and forced colors.
It holds the stylesheet request to inspect saved attributes before paint on shell,
lesson, review, Markdown document, and reference routes.
It opens Ask beside a selected quiz answer and checks that the answer stays selected.
Invalid theme/accent values and blocked storage show specific errors and require
an explicit correction or retry.

`after/result.json` contains measured results. `after/state.json` records zero
teacher requests and equal durable file hashes, excluding draft files.
The review fixture is read-only. It does not prove review scheduling or grading.
Fixture teachers do not prove model access, model quality, or human learning.
Only Chromium was exercised. This change requires browser support for `light-dark()`.

## Reproduce

Follow the shared launch and doctor steps in
[verify-studens](../../.agents/skills/verify-studens/SKILL.md).
Run `npm run verify -- --artifacts /tmp/studens-calm-verify`.
The settings recipe describes the appearance drive and its artifacts.

## Required checks

`verification-pass.json` records PASS for `npm run verify`, including version,
formatting, types, all 1374 tests, and the complete browser suite.
See `test-pass.log` and `browser-pass.log` for the captured output.
The runtime and harness files match the source hashes recorded at launch.

## Failure diagnosis

The initial check run passed 1373 tests and exceeded Vitest's five-second limit
in the Claude explicit-stop test. See `initial-check-failure.json` and
`initial-test-failure.log`. The standalone canonical-temp-path run passed all 17
service-process tests. The Claude stop case took 1211 ms. See
`service-process-pass.log`. The next full check run passed all 1374 tests.
The original run had a longer import and test duration. The exact cause of its
slow stop case remains unproven. No lifecycle code or time limits were changed.
An earlier standalone invocation without canonical TMPDIR produced HTTP 500
failures. The documented macOS TMPDIR setup corrected that invocation.

The first full browser run exposed a product defect. Mermaid rejected unresolved
`light-dark(...)` tokens. See `diagram-check-failure.json` and `diagram-error.txt`.
The repair resolves each color through a browser color property before passing
it to Mermaid. It also redraws diagrams when the accent changes.
The appearance drive now checks diagram redraw after a cross-tab accent change.

The next browser run found a review-drive race after Continue review.
The drive selected a form before the review runtime marked its active card.
Its selector matched three initial forms. The later snapshot showed one card.
The repair waits for the active card's fresh state before selecting an answer.
This changes the drive only. It does not change review behavior.
See `review-drive-check-failure.json` and `review-drive-error.txt`.

## Captures

Compare matching files under `before/` and `after/`.
`after/matrix-*.png` shows every theme/accent pair.
`after/forced-colors-*.png` shows visible boundaries and keyboard focus.
`after/invalid-accent.png` and `after/unavailable-storage.png` show explicit errors.
`before/switch-reload.webm` records the header theme toggle and reload.
`after/switch-reload.webm` records the complete appearance drive.
