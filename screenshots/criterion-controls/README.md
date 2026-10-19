# Criterion feedback with review controls

The 32 `before-*` / `after-*` images use matching calculation fixtures at
1280×900 and 375×812 in light and dark themes. They cover rejected submission,
partial credit, reload and an explanation revision. Before is exact published main
`fb8a4f9e226e3c227fad02da878e31fa05b6df3e` (0.11.6), loaded from a git archive;
after is clean committed `6e7ac926b34edde9a09c106b965c5aa5fe42b6ef`.
Both store 2/4. After also displays the saved 2/2 and 0/2 criterion allocations.
The revision adds a grade file while preserving the original grade and weights.

Six further images come from the same clean full browser run: Pi/service early
review cards with code-owned criterion feedback, service retirement and owning-model
report failure before explicit retry, a partly met 1/2 + missed 0/2 allocation,
and an incomplete teacher allocation rejected before any grade. These use fixture
teachers, not live model calls. The service report shows requested `report-after`
while the saved error still names `report-before`; changing selection did not retry.

All 38 captures were inspected. Themes match their filenames and text remains
readable on mobile. The full run passed 791 tests and the complete browser suite.
No version bump was made. Runtime, tests and harness are unchanged by this evidence commit.

## Earlier evidence

These 52 immutable URLs retain their original source provenance. They were
rechecked for HTTP 200, PNG type and matching SHA256 in this integration; they
were inspected in prior rounds. They do not represent fresh real-model runs on
the controls integration.

- [screenshots/criterion-integration/after-error-desktop-dark.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/after-error-desktop-dark.png)
- [screenshots/criterion-integration/after-error-desktop-light.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/after-error-desktop-light.png)
- [screenshots/criterion-integration/after-error-mobile-dark.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/after-error-mobile-dark.png)
- [screenshots/criterion-integration/after-error-mobile-light.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/after-error-mobile-light.png)
- [screenshots/criterion-integration/after-history-desktop-dark.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/after-history-desktop-dark.png)
- [screenshots/criterion-integration/after-history-desktop-light.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/after-history-desktop-light.png)
- [screenshots/criterion-integration/after-history-mobile-dark.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/after-history-mobile-dark.png)
- [screenshots/criterion-integration/after-history-mobile-light.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/after-history-mobile-light.png)
- [screenshots/criterion-integration/after-partial-desktop-dark.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/after-partial-desktop-dark.png)
- [screenshots/criterion-integration/after-partial-desktop-light.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/after-partial-desktop-light.png)
- [screenshots/criterion-integration/after-partial-mobile-dark.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/after-partial-mobile-dark.png)
- [screenshots/criterion-integration/after-partial-mobile-light.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/after-partial-mobile-light.png)
- [screenshots/criterion-integration/after-reload-desktop-dark.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/after-reload-desktop-dark.png)
- [screenshots/criterion-integration/after-reload-desktop-light.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/after-reload-desktop-light.png)
- [screenshots/criterion-integration/after-reload-mobile-dark.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/after-reload-mobile-dark.png)
- [screenshots/criterion-integration/after-reload-mobile-light.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/after-reload-mobile-light.png)
- [screenshots/criterion-integration/before-error-desktop-dark.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/before-error-desktop-dark.png)
- [screenshots/criterion-integration/before-error-desktop-light.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/before-error-desktop-light.png)
- [screenshots/criterion-integration/before-error-mobile-dark.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/before-error-mobile-dark.png)
- [screenshots/criterion-integration/before-error-mobile-light.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/before-error-mobile-light.png)
- [screenshots/criterion-integration/before-history-desktop-dark.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/before-history-desktop-dark.png)
- [screenshots/criterion-integration/before-history-desktop-light.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/before-history-desktop-light.png)
- [screenshots/criterion-integration/before-history-mobile-dark.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/before-history-mobile-dark.png)
- [screenshots/criterion-integration/before-history-mobile-light.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/before-history-mobile-light.png)
- [screenshots/criterion-integration/before-partial-desktop-dark.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/before-partial-desktop-dark.png)
- [screenshots/criterion-integration/before-partial-desktop-light.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/before-partial-desktop-light.png)
- [screenshots/criterion-integration/before-partial-mobile-dark.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/before-partial-mobile-dark.png)
- [screenshots/criterion-integration/before-partial-mobile-light.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/before-partial-mobile-light.png)
- [screenshots/criterion-integration/before-reload-desktop-dark.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/before-reload-desktop-dark.png)
- [screenshots/criterion-integration/before-reload-desktop-light.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/before-reload-desktop-light.png)
- [screenshots/criterion-integration/before-reload-mobile-dark.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/before-reload-mobile-dark.png)
- [screenshots/criterion-integration/before-reload-mobile-light.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/before-reload-mobile-light.png)
- [screenshots/criterion-integration/claude-mobile.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/claude-mobile.png)
- [screenshots/criterion-integration/codex-mobile.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/codex-mobile.png)
- [screenshots/criterion-integration/partly-met-mobile.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/partly-met-mobile.png)
- [screenshots/criterion-integration/pi-mobile.png](https://raw.githubusercontent.com/max-miller1204/studens/41f0ee89662a5b874715317ffa7963d685f46308/screenshots/criterion-integration/pi-mobile.png)
- [screenshots/criterion-breakdown/before-desktop.png](https://raw.githubusercontent.com/max-miller1204/studens/ca8cd20a17658bb5790dc17fe43c527d4d4ba95c/screenshots/criterion-breakdown/before-desktop.png)
- [screenshots/criterion-breakdown/before-mobile.png](https://raw.githubusercontent.com/max-miller1204/studens/ca8cd20a17658bb5790dc17fe43c527d4d4ba95c/screenshots/criterion-breakdown/before-mobile.png)
- [screenshots/criterion-breakdown/after-desktop.png](https://raw.githubusercontent.com/max-miller1204/studens/ca8cd20a17658bb5790dc17fe43c527d4d4ba95c/screenshots/criterion-breakdown/after-desktop.png)
- [screenshots/criterion-breakdown/after-mobile.png](https://raw.githubusercontent.com/max-miller1204/studens/ca8cd20a17658bb5790dc17fe43c527d4d4ba95c/screenshots/criterion-breakdown/after-mobile.png)
- [screenshots/criterion-breakdown/reloaded-mobile.png](https://raw.githubusercontent.com/max-miller1204/studens/ca8cd20a17658bb5790dc17fe43c527d4d4ba95c/screenshots/criterion-breakdown/reloaded-mobile.png)
- [screenshots/criterion-breakdown/revision-desktop.png](https://raw.githubusercontent.com/max-miller1204/studens/ca8cd20a17658bb5790dc17fe43c527d4d4ba95c/screenshots/criterion-breakdown/revision-desktop.png)
- [screenshots/criterion-breakdown/revision-mobile.png](https://raw.githubusercontent.com/max-miller1204/studens/ca8cd20a17658bb5790dc17fe43c527d4d4ba95c/screenshots/criterion-breakdown/revision-mobile.png)
- [screenshots/criterion-breakdown/error-before-desktop.png](https://raw.githubusercontent.com/max-miller1204/studens/ca8cd20a17658bb5790dc17fe43c527d4d4ba95c/screenshots/criterion-breakdown/error-before-desktop.png)
- [screenshots/criterion-breakdown/error-before-mobile.png](https://raw.githubusercontent.com/max-miller1204/studens/ca8cd20a17658bb5790dc17fe43c527d4d4ba95c/screenshots/criterion-breakdown/error-before-mobile.png)
- [screenshots/criterion-breakdown/error-after-desktop.png](https://raw.githubusercontent.com/max-miller1204/studens/ca8cd20a17658bb5790dc17fe43c527d4d4ba95c/screenshots/criterion-breakdown/error-after-desktop.png)
- [screenshots/criterion-breakdown/error-after-mobile.png](https://raw.githubusercontent.com/max-miller1204/studens/ca8cd20a17658bb5790dc17fe43c527d4d4ba95c/screenshots/criterion-breakdown/error-after-mobile.png)
- [screenshots/criterion-breakdown/teacher-error-mobile.png](https://raw.githubusercontent.com/max-miller1204/studens/ca8cd20a17658bb5790dc17fe43c527d4d4ba95c/screenshots/criterion-breakdown/teacher-error-mobile.png)
- [screenshots/criterion-breakdown/historical-mobile.png](https://raw.githubusercontent.com/max-miller1204/studens/ca8cd20a17658bb5790dc17fe43c527d4d4ba95c/screenshots/criterion-breakdown/historical-mobile.png)
- [screenshots/criterion-breakdown/pi-mobile.png](https://raw.githubusercontent.com/max-miller1204/studens/ca8cd20a17658bb5790dc17fe43c527d4d4ba95c/screenshots/criterion-breakdown/pi-mobile.png)
- [screenshots/criterion-breakdown/claude-mobile.png](https://raw.githubusercontent.com/max-miller1204/studens/ca8cd20a17658bb5790dc17fe43c527d4d4ba95c/screenshots/criterion-breakdown/claude-mobile.png)
- [screenshots/criterion-breakdown/codex-mobile.png](https://raw.githubusercontent.com/max-miller1204/studens/ca8cd20a17658bb5790dc17fe43c527d4d4ba95c/screenshots/criterion-breakdown/codex-mobile.png)
