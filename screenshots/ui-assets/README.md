# UI asset evidence

The before captures use main at `0633bdce0c8ba5697f2b87f38144fc43c0396bf7`.
They were captured before the UI asset changes. The after captures use this change.
Both runs use the same fixture content and interaction state. Generated attempt
timestamps differ by capture time. Viewports are 1280×900 and 390×900.

Both runs block external browser requests and retain loopback access. Each capture
starts at the top of the page. All screenshots were inspected.

| Page and state           | Before                                     | After                                     |
| ------------------------ | ------------------------------------------ | ----------------------------------------- |
| shell, 1280px, light     | [Capture](before/shell-1280-light.png)     | [Capture](after/shell-1280-light.png)     |
| shell, 1280px, dark      | [Capture](before/shell-1280-dark.png)      | [Capture](after/shell-1280-dark.png)      |
| shell, 390px, light      | [Capture](before/shell-390-light.png)      | [Capture](after/shell-390-light.png)      |
| shell, 390px, dark       | [Capture](before/shell-390-dark.png)       | [Capture](after/shell-390-dark.png)       |
| lesson, 1280px, light    | [Capture](before/lesson-1280-light.png)    | [Capture](after/lesson-1280-light.png)    |
| lesson, 1280px, dark     | [Capture](before/lesson-1280-dark.png)     | [Capture](after/lesson-1280-dark.png)     |
| lesson, 390px, light     | [Capture](before/lesson-390-light.png)     | [Capture](after/lesson-390-light.png)     |
| lesson, 390px, dark      | [Capture](before/lesson-390-dark.png)      | [Capture](after/lesson-390-dark.png)      |
| review, 1280px, light    | [Capture](before/review-1280-light.png)    | [Capture](after/review-1280-light.png)    |
| review, 1280px, dark     | [Capture](before/review-1280-dark.png)     | [Capture](after/review-1280-dark.png)     |
| review, 390px, light     | [Capture](before/review-390-light.png)     | [Capture](after/review-390-light.png)     |
| review, 390px, dark      | [Capture](before/review-390-dark.png)      | [Capture](after/review-390-dark.png)      |
| reference, 1280px, light | [Capture](before/reference-1280-light.png) | [Capture](after/reference-1280-light.png) |
| reference, 1280px, dark  | [Capture](before/reference-1280-dark.png)  | [Capture](after/reference-1280-dark.png)  |
| reference, 390px, light  | [Capture](before/reference-390-light.png)  | [Capture](after/reference-390-light.png)  |
| reference, 390px, dark   | [Capture](before/reference-390-dark.png)   | [Capture](after/reference-390-dark.png)   |

The [after runtime record](after/runtime.json) contains the network responses,
actual Chromium font names, glyph counts, preloads, SVGs, and theme state for
each capture. The [before runtime record](before/runtime.json) records the same
base views.

Runtime observation: **PASS**. The after drive checked local Inter headers,
Source Serif 4 prose and review questions, JetBrains Mono code, Latin-Extended
glyphs, the 34rem reading measure, viewport bounds, and theme persistence.
Separate rendering probes checked all three families at weights 400 and 700,
normal and italic. All 12 WOFF2 subset URLs returned 200 with `font/woff2`.

The deliberate external fetch failed. No page requested an external font or icon.
Missing SVG and WOFF2 URLs returned 404. An unknown icon name threw
`Unknown bundled icon: missing`. The header accessible name stayed
`Toggle colour theme`.

These fixtures prove UI and asset delivery. They do not prove model behavior.
Repository checks are reported separately in the pull request.

Reproduce with the project launch preconditions:

```sh
node scripts/e2e-ui-assets.ts /tmp/studens-ui-assets
```
