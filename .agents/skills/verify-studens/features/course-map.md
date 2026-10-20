# Course map

The learner sees the mission, upcoming objectives, lesson coverage, and objective
connections without changing learner or teacher state.

## Sub-features

- Read legacy mission prose as headings, lists, and safe links.
- Read authored upcoming objectives and prerequisite or related links.
- Follow lesson links and objective anchors; several quizzes can share an objective.
- Keep unreleased pretest objectives and their connections private.
- View empty and legacy classrooms; fix saved data and retry explicitly.

## How to get to it (user POV)

1. Open a classroom and select **Course map**.
2. Use **Coming up**, **Lesson objectives**, and **Connections**.
3. Follow a lesson title, or **Read mission document**.
4. Use **Back to classroom** to return.

## Driving it with playwright-cli

Run `npm run verify -- browser --artifacts /tmp/studens-course-map`.

The drive opens the map with keyboard Enter and checks `.cl-map-objective`,
`.cl-map-connections`, and `.cl-map-edges` for an objective shared by two quizzes.
It checks empty and legacy classrooms, a metadata fence directly after the Why
paragraph, and valid and invalid math. Inspect `course-map/` captures at 1280×900 and
390×844 in both themes; long statements must wrap.

A corrupt plan and a broken connection target each show a specific file error.
After the fix, **Retry loading course map** recovers with no teacher work. Private
routes return 404. Viewing makes no non-GET/HEAD requests; `*-hashes.json` must stay
identical.

Finally, submitting the real pretest releases the gated objective and its edge. Only
that submission creates a grade.

## Gotchas

- The `studens-course-map` block in `MISSION.md` is an authoring contract; see
  `docs/MISSION-FORMAT.md`. Hidden endpoints leave no stub, label, or count.
- A released prequestion mapping links to its unique section anchor; missing or
  ambiguous mappings link to the lesson.
- The map shows coverage and intentions. It does not mark mastery or retention.
