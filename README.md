# Studens

Interactive lessons for Pi, Claude Code, and Codex. Highlight a passage to ask a
question, get answers in a saved thread, and submit quizzes for feedback.

![An answer card below a highlighted passage](screenshots/answer.png)

## Install

**Pi**

```sh
pi install git:github.com/max-miller1204/studens
```

**Claude Code**

```sh
claude plugin marketplace add max-miller1204/studens
claude plugin install studens@studens
```

**Codex**

```sh
codex plugin marketplace add max-miller1204/studens
codex plugin add studens@studens
```

Claude Code and Codex need Node 22.18 or later. The plugin installs its runtime
dependency on first start. There is no build step.

Upgrading from pi-teach? Remove the old plugin before installing Studens; see the
[upgrade guide](docs/USAGE.md#upgrading-from-pi-teach). Existing classrooms stay in place.

## Start learning

- **Pi:** `/teach <topic>`, then `/classroom` for the lesson link. Keep Pi open.
- **Claude Code:** `/studens:teach <topic>` and `/studens:classroom`.
- **Codex:** Ask it to teach you a topic, then open your classroom.

Read, ask questions, and reply to the teacher on the lesson page. Quizzes save your
answers and feedback. The classroom page offers spaced reviews and folders.
Claude Code and Codex teachers run in a persistent local service.

All three hosts save material in `~/.pi/agent/classrooms/`.

## More

- [Usage](docs/USAGE.md): commands, upgrades, service recovery, and phone access.
- [Configuration](docs/CONFIGURATION.md): settings, storage, and lesson links.
- [Screenshots](docs/FEATURES.md) · [Development](docs/DEVELOPMENT.md)
- [Teaching and authoring references](docs/README.md)

[MIT](LICENSE). Derived from Josh Noll's pi-teach and Matt Pocock's teaching skill;
see [attribution](docs/ATTRIBUTION.md).
