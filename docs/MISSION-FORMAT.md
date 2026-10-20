# MISSION.md Format

`MISSION.md` lives at the workspace root. It captures the _reason_ the user is learning this topic. Every teaching decision — what to teach next, which resources to surface, which exercises to design — should trace back to this document.

## Template

```md
# Mission: {Topic}

## Why

{1-3 sentences. The concrete real-world goal the user is chasing. What changes in their life or work when they have this skill? Avoid abstract framings like "to understand X" — push for the underlying outcome.}

## Success looks like

- {A specific, observable thing the user will be able to do}
- {Another specific thing}
- {…}

## Constraints

- {Time, budget, prior commitments, learning preferences, anything that bounds the approach}

## Out of scope

- {Adjacent topics the user explicitly does not want to chase right now — protects the zone of proximal development}
```

## Rules

- **One mission per workspace.** If the user wants to learn two unrelated things, that is two workspaces.
- **Concrete over abstract.** "Run a half marathon by October" beats "get fitter." "Ship a Rust CLI to my team" beats "learn Rust."
- **Push back on vagueness.** If the user cannot articulate why, interview them before writing anything. A bad mission is worse than no mission.
- **Revise when reality shifts.** Missions change. When the user's goal moves, update this file — don't leave a stale mission steering future sessions.
- **Keep it short.** If `MISSION.md` runs past a screen, it has stopped being a compass and started being a plan.

## Optional course map

The learner can open **Course map** from the classroom. The map shows the mission,
validated lesson objectives and their quiz connections. Teaching coverage is not
completion or mastery; an immediate or assisted answer does not demonstrate retention.
Unstructured missions and older lessons without a teaching plan remain readable.
They do not acquire invented upcoming objectives or dependencies.

To record a plan ahead, add one closed, top-level `studens-course-map` fenced JSON
block to the canonical `MISSION.md`. This is optional; never rewrite an existing
mission just to populate the map. Keep prose outside the block. The block is not
rendered in the mission document; its public projection appears in the course map.

````md
```studens-course-map
{
  "version": 1,
  "upcoming": [
    { "id": "safe-cli", "statement": "Design ownership boundaries for a small CLI." }
  ],
  "connections": [
    {
      "from": "@upcoming/safe-cli",
      "to": "001-values/@objective/ownership",
      "kind": "builds-on"
    }
  ]
}
```
````

`upcoming` contains explicitly planned, learner-visible objectives. It does not
promise a scheduled lesson or claim teaching, completion, or retention. Use stable
contract ids (letters, digits, `_`, `-`, `.`) and nonempty statements. Goal ids are
unique within this mission. Remove or revise goals only as the agreed plan changes.

Connection endpoints are `@upcoming/<id>` or
`<lesson>/@objective/<objective-id>`. Lesson objective ids are local to that lesson,
including when several quizzes share the objective. A lesson endpoint must exist
in that classroom's validated private `quiz/plan.json`; no cross-classroom or
review endpoints are accepted. Rename or remove stale links explicitly when
editing a goal, lesson, or objective. No automatic migration runs.

Use `builds-on` from an objective to its planned prerequisite. These edges must be
acyclic. Use `related` for a connection that makes no prerequisite claim. Self links,
duplicate links (including reversed `related` links), duplicate goal ids, unknown
fields, invalid references, and stale targets are errors. Errors identify the saved
file and connection position, without quoting private objective content. Correct the
file, then select **Retry loading course map**. Viewing never repairs state or retries
teacher work.

Upcoming statements are public: keep answer keys, rubrics, variants, teaching
support and private strategies out of them. References to gated lesson objectives
are validated privately, but their complete connections are withheld until the
pretest releases that lesson. No hidden endpoint, relation label or count is
rendered. Legacy missions without this block show their readable context and
explicit absence of a recorded plan ahead. Mission prose renders headings, lists
and safe links; raw HTML is escaped, remote images are not loaded, and script URLs
are not active.

Released lessons also show backward lesson links for their explicit `builds-on`
connections. Related edges and upcoming goals never become prerequisite lesson
links. See [source links](SOURCE-LINKS.md) for the distinction between a planned
prerequisite and the actual declared teaching section of a glossary term.
