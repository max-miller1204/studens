# Configuration and storage

[Back to the README](../README.md)

## Configuration

Optional, at `~/.pi/agent/classroom.json`:

```json
{
  "port": 4098
}
```

| Key               | Default | Meaning                                                                                                |
| ----------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| `port`            | `43123` | Fixed port. An occupied or invalid port causes an error.                                               |
| `tailscale`       | `true`  | Use tailnet links while Tailscale is connected. `PI_CLASSROOM_TAILSCALE=0` overrides.                  |
| `tailscalePort`   | `8443`  | HTTPS port for the shared persistent service tailnet route. An occupied port causes an error.          |
| `piTailscalePort` | `8444`  | Legacy live-session Pi route port; retained for old-package cleanup. An occupied port causes an error. |

Claude Code and Codex read the same file. `/classroom`, `/teach`, and `open_classroom`
return a link. They never open a browser. See [phone and remote links](USAGE.md#phone-and-remote-links). Lesson checks run in a separate headless
session. The scaffold instructions name the packaged headless config.
Set `PI_CLASSROOM_CONFIG` to read the settings from another file.

All three hosts share the service port, `43123` by default. `PI_CLASSROOM_SERVICE_PORT`
overrides `port`. An occupied port fails; no other port is tried. Pi's SDK reads
`PI_CODING_AGENT_DIR` (default `~/.pi/agent`) for credentials, `models.json`, and
model settings. The service captures its environment at startup, so restart it after
changing these.
Get the current URL from `open_classroom` or `/classroom`.

## Storage

```text
~/.pi/agent/classrooms/
  <classroom-name>/
    classroom.json          title and emoji
    MISSION.md              why you are learning this
    RESOURCES.md            trusted sources, split Knowledge / Wisdom
    GLOSSARY.md             canonical terminology
    NOTES.md                your preferences, and an index of the teacher's notes
    notes/                  slug.md: the topic files NOTES.md indexes
    quiz/retrieval-checks/  successful chat checks linked to review items
    learning-records/       NNNN-slug.md: what you have actually learned
    reference/*.html        cheat sheets, built to be revisited and printed
    assets/                 shared components across lessons
    .review-controls.json   retirement state and revisions; evidence stays in quiz history
    .reviews.json           durable review requests, selected options, and saved documents
    .reviews/review-<id>/   review pages, drafts, panel state, and private quiz history
    NNN-lesson-name/
      lesson.html           the lesson
      lesson.json           title and summary
      annotations.json      your question threads and their answers
      reflections.json      your self-explanations
      quiz/
        key.json            private rubric and predeclared criterion weights
        submissions/*.json  your answers and private grading snapshots
        grades/*.json       your teacher's grading
```

Set `PI_CLASSROOMS_DIR` to keep material somewhere else. Pi, Claude Code, and Codex all
use the same directory, so a classroom you start in one continues in the others.

A lesson directory is recognised by containing an HTML document: `lesson.html` if
present, else the first `lesson-*.html` (so a literal `lesson-001.html` works), else the
first `.html` file. Lesson order comes from the numeric prefix on the directory name.

The `quiz/` directory is never served as static files, only through the JSON API. An
answer key written to `quiz/key.json` is therefore not readable from the page.
Submissions privately save the `rubricCriteria` fixed before submission. Public
grades show only each question's criterion descriptions, points, and explanations.
Regrades add files and never rewrite history; older attempts show no breakdown.

New reviews open at `/c/<classroom>/reviews/<review-id>`, with history at
`/c/<classroom>/reviews`. Reviews stay out of the lesson list, and numbered legacy
reviews keep their links. `.reviews/` is never served.

Reviews offer 3 to 12 items and topics from saved objective groups. Early reviews
never extend the scheduled interval. Retiring an item removes it from counts and
future selections but keeps its evidence; restore it from `Manage review items`.
`Flag bad question` sends a report through the review's teacher panel without
changing pools or grades. Stale or interrupted edits need an explicit retry.

### Links in teaching documents

Links to other sites and PDFs open in a new tab. This applies to lessons,
reference documents, and the classroom's markdown pages. Classroom and lesson
navigation stay in the current tab. Links that set their own `target`, or carry a
`download` attribute, are left alone.

Lesson URLs use `/c/<classroom>/<lesson>` without a trailing slash. They do not match
filesystem paths. From a lesson, use:

- `./` for the classroom page.
- `assets/<path>` for shared classroom assets.
- `<other-lesson>` for another lesson in the same classroom.
- `/r/<classroom>/<file>.html` for a reference document.

Do not use `../assets/<path>` from a lesson. It resolves to `/c/assets/<path>`.
From a reference document, use `/c/<classroom>/<lesson>` for lesson links. Replace
`{{CLASSROOM_NAME}}` in the reference template with the classroom directory name.

## Settings page

Open a classroom and select **Settings** beside Review history.

**Connection.** Settings are shared across classrooms and saved to the configuration
file above, keeping unrelated keys. Tailnet link changes apply on save; environment
overrides still win. A local port change applies only after you stop and restart the
service. A failed link update keeps the saved settings and needs another explicit save.

**Preferences.** Pace, depth, and tone are single lines of up to 200 characters,
saved as `- Pace:`, `- Depth:`, and `- Tone:` under `## Preferences` in `NOTES.md`.
Other notes are kept. A stale page must reload before saving.

**Teacher model.** Choose **Use tool's configured default**, a model from the host's
catalog (Codex `model/list`; Claude's initialization catalog; Pi's SDK catalog), or
**Custom model ID…**. A catalog entry does not guarantee account access. The choice is
private to the classroom's `.teacher.json`, survives restarts, and never edits global
CLI settings. **Last answering model** shows the model that actually answered; Pi shows
**Last Pi SDK model selection**, which does not prove provider routing. An unexpected
reroute fails the request before its plan is applied.

Changes apply between requests and keep the conversation. Running work finishes on
its original model. A model error stays visible until you retry the request;
changing the setting alone does not retry. Pi's teacher session is saved under
`.pi-teach-service/pi-sessions/`; include it in backups. A missing session file is a
recovery error, never a new conversation.
