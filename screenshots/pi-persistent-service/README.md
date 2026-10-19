# Pi persistent service evidence

Matching fixture captures from main `ff52f741` and this migration. Both use the same classroom, lesson, panel message, viewports, and themes. The base bridge ends without a reply; the after fixture reports a specific Pi model error. These comparisons prove UI behavior, not model behavior or human learning.

| State                    | Before                                                            | After                                                             |
| ------------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| light, desktop, settings | ![Before light desktop settings](base/light-desktop-settings.png) | ![After light desktop settings](after/light-desktop-settings.png) |
| light, desktop, teacher  | ![Before light desktop teacher](base/light-desktop-teacher.png)   | ![After light desktop teacher](after/light-desktop-teacher.png)   |
| light, mobile, settings  | ![Before light mobile settings](base/light-mobile-settings.png)   | ![After light mobile settings](after/light-mobile-settings.png)   |
| light, mobile, teacher   | ![Before light mobile teacher](base/light-mobile-teacher.png)     | ![After light mobile teacher](after/light-mobile-teacher.png)     |
| dark, desktop, settings  | ![Before dark desktop settings](base/dark-desktop-settings.png)   | ![After dark desktop settings](after/dark-desktop-settings.png)   |
| dark, desktop, teacher   | ![Before dark desktop teacher](base/dark-desktop-teacher.png)     | ![After dark desktop teacher](after/dark-desktop-teacher.png)     |
| dark, mobile, settings   | ![Before dark mobile settings](base/dark-mobile-settings.png)     | ![After dark mobile settings](after/dark-mobile-settings.png)     |
| dark, mobile, teacher    | ![Before dark mobile teacher](base/dark-mobile-teacher.png)       | ![After dark mobile teacher](after/dark-mobile-teacher.png)       |

Desktop: 1280×900. Mobile: 375×812. Full-page images can be taller than the viewport. Source ports and generated request IDs differ. See [capture provenance](provenance.json) for inspected image hashes and source hashes.
