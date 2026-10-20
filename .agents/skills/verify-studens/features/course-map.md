# Course map

The learner sees the mission, planned upcoming objectives, lesson coverage and
explicit objective connections without changing learner or teacher state.

## Sub-features

- Read legacy mission prose as headings, lists and safe links.
- Read explicitly authored upcoming objectives and prerequisite or related links.
- Follow lesson links and objective anchors; several quizzes can share an objective.
- Keep unreleased pretest objectives and their entire connections private.
- View empty and legacy classrooms; correct saved data and retry explicitly.

## How to get to it (user POV)

1. Open a classroom and select **Course map** (also works with keyboard Enter).
2. Use **Coming up**, **Lesson objectives** and **Connections** to move around the map.
3. Follow a lesson title to study it or **Read mission document** for the mission.
4. Use **Back to classroom** to return.

## Driving it with playwright-cli

Run `npm run verify -- browser --artifacts /tmp/studens-course-map` using the shared
launch instructions. The course-map drive uses scratch classrooms and the actual
loopback server, with a fixture grader only for the pretest release.

The drive opens the classroom link with keyboard Enter. It checks `.cl-map-objective`
and `.cl-map-connections` for one objective shared by two quizzes, and `.cl-map-edges`
for explicitly recorded links. Same objective ids in separate lessons remain distinct.
It follows a lesson and the mission document, returns to the classroom, and checks
an empty classroom and an unstructured legacy mission without invented links.

Inspect `course-map/` screenshots at desktop 1280×900 and mobile 390×844 in both
themes. Long statements must wrap without horizontal overflow. Inspect error,
legacy, empty and released screenshots as well.

The drive corrupts a private plan on disk and then a mission connection target.
Both produce a specific file error. After correcting the file, select
**Retry loading course map**; no teacher retry is triggered. Private direct/API/static
and symlink routes must return 404. Inspect `result.json` for route statuses and
`*-hashes.json` for identical classroom files after ordinary, error, legacy and
released viewing. The initial viewing phase must make zero non-GET/HEAD requests.

The summary privacy probe puts a tilde metadata fence immediately after the Why
paragraph, without a blank line. It opens the landing card, classroom hero, mission
document and course map. Every surface must preserve the public Why prose and omit
the gated metadata references; `summary-viewing-hashes.json` must remain identical.

The math compatibility probe opens the mission document and map with two inline
formulas, one display formula and one invalid formula. Each surface must show
three MathML elements, the specific canonical parse error, its original heading
level, no metadata references and no horizontal overflow in both sizes/themes.
Inspect `math-*.png`, `result.json` and identical `math-viewing-hashes.json`.

Finally submit the real pretest through its textarea and **Submit for grading**.
Only this explicit answer creates one submission and grade. Before grading, neither
the gated objective nor its edge appears in the map or mission document. After
grading the objective and edge appear; reload preserves them and adds no writes.

## Gotchas

The optional `studens-course-map` block in `MISSION.md` is an authoring contract;
see `docs/MISSION-FORMAT.md`. Upcoming statements are public. Hidden endpoint
connections have no stub, type, label or count. Legacy absence is not corruption.
Tests cover invalid JSON, duplicates, stale targets and prerequisite cycles; the
browser drive proves actual load errors and explicit retry.

This feature describes teaching coverage and author intentions. It does not mark
mastery or prove human retention. Fixture grading does not prove a model connection
or real authoring adoption. Select the authoring targets when changing the mission
contract or its guidance.
