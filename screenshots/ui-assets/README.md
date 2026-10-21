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

## Combined Calm appearance check

The conflict resolution merges main at `2cb641178c89c4c12cffd27199ad5d02278a4c88`.
It keeps the appearance bootstrap before the stylesheet and adds local fonts after it.
The shell and lesson headers retain the Lucide SVG controls.
The original before/after captures above remain unchanged.

The expanded drive passed all 64 page, viewport, theme, and accent combinations.
It selects each accent through Settings, then checks navigation and theme reload.
It checks the actual Chromium font for each observed text role.
The 12 face probes and all 12 WOFF2 URLs passed. Missing assets returned 404.
Unknown icons and the external fetch failed as required.
See the [combined runtime summary](combined/summary.json).

All 64 captures were inspected in these contact sheets:

| Page      | 390px                                         | 1280px                                         |
| --------- | --------------------------------------------- | ---------------------------------------------- |
| Shell     | [Capture](combined/contact-shell-390.jpg)     | [Capture](combined/contact-shell-1280.jpg)     |
| Lesson    | [Capture](combined/contact-lesson-390.jpg)    | [Capture](combined/contact-lesson-1280.jpg)    |
| Review    | [Capture](combined/contact-review-390.jpg)    | [Capture](combined/contact-review-1280.jpg)    |
| Reference | [Capture](combined/contact-reference-390.jpg) | [Capture](combined/contact-reference-1280.jpg) |

Columns use Indigo, Copper, Green, and Neutral. The first row uses Light.
The second row uses Dark. Full captures and the complete runtime record remain in
`/tmp/studens-pr150-merge/ui-assets/`.
These fixture checks prove combined UI and asset delivery, not model behavior.

The combined [appearance result](combined/appearance-result.json) passed all eight
color pairs and eight before-paint routes. System mode, keyboard focus, cross-tab
Mermaid redraw, transition suppression, and forced colors passed. Invalid saved
values and blocked storage kept specific errors and explicit retry.
The [state record](combined/appearance-state.json) shows zero teacher requests and
unchanged durable classroom files. The [cleanup record](combined/appearance-cleanup.json)
shows that the server stopped and the fixture was removed.

The [full verification record](combined/verify-run.json) reports PASS for version,
formatting, types, 1,380 tests, and the complete browser suite. It records the old
HEAD plus the staged merge, because verification ran before the merge commit.
The [source hashes](combined/verify-source-hashes.json) identify the checked source.
The activity drive passed in this run. The earlier timeout remains unexplained.
`npm run audit` also passed: 125 production package versions matched the lock,
with zero vulnerabilities. Full local logs remain in `/tmp/studens-pr150-merge/verify/`.
