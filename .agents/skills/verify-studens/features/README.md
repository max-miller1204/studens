# Feature checks

Start with the shared [launch and doctor instructions](../SKILL.md). Each browser run uses fresh scratch classrooms. Real host checks require model access. Keep one evidence directory per run.

| Feature              | Recipe                             | Entry points                                                                                                                                 |
| -------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| App navigation       | [navigation.md](navigation.md)     | Today, sidebar due counts, classroom/folder links, lesson rail, phone drawer/focus, resume anchors, accent, explicit retry                   |
| Group classrooms     | [folders.md](folders.md)           | Today, folders, classroom overflow/move controls, reload, explicit retry                                                                     |
| Read and ask         | [reading.md](reading.md)           | Lesson/quiz text, Saved marks, typed card answers/follow-ups/reload/recovery, glossary, diagrams, math, theme                                |
| Step through states  | [step-through.md](step-through.md) | Lesson traces, computed input, local controls, diagrams/math, gates, offline, both themes                                                    |
| Answer quizzes       | [quizzes.md](quizzes.md)           | Quiz, runnable JavaScript and practice controls, pretest gate, disputes/history, reload, second tab                                          |
| Lesson UI migration  | [migration.md](migration.md)       | Explicit agent CLI discovery/apply/retry, disposable checks, original preservation and private grading recovery                              |
| Next lesson          | [next-lesson.md](next-lesson.md)   | Classroom page, optional topic, durable authoring, publication retry                                                                         |
| Start a review       | [review.md](review.md)             | Classroom Up next, daily landing/groups/history, card fragments/reload, memory map/forecast/why, review controls, reports, publication retry |
| Classroom settings   | [settings.md](settings.md)         | Classroom Settings, preferences, port, tailnet links, requested and answering model                                                          |
| Export classroom     | [export.md](export.md)             | Classroom Export, Anki/Markdown downloads, printable contents/PDF, released-template and corrective answers, read-only/privacy gates         |
| Search classrooms    | [search.md](search.md)             | Landing Search, four public domains, exact passage/card/term/record links, errors/retry, privacy                                             |
| Course map           | [course-map.md](course-map.md)     | Classroom Course map, mission, upcoming objectives, explicit connections, lesson navigation, load retry                                      |
| Teacher conversation | [teacher.md](teacher.md)           | Classroom activity, shared persistent panels, explicit retry, Pi/MCP reconnect, packaged Pi commands                                         |

Tailnet links: `npm run verify -- phone` checks the service route; `npm run verify -- phone pi` additionally starts the actual Pi extension, obtains canonical classroom and lesson links through `open_classroom`, and requires the route and Pi teacher ownership to survive initiating Pi exit. These commands change a real Tailscale Serve route. Run them only for link or lifecycle changes with a connected tailnet. They verify working URLs, service status, no Funnel, settings-page disable/enable, explicit config disable, service-stop cleanup, and unchanged unrelated routes. Inspect `phone/tailnet-provenance.json`, `tailnet-after.json`, Pi event output, and the settings screenshot. Choose an unused HTTPS port with `STUDENS_PHONE_PORT`; an already configured port is rejected before route changes. All production hosts use the service-owned route. Legacy live-session route records require explicit cleanup with the previous Pi package; startup must not silently replace them.

Coverage gaps: Feedback and quality targets remain separate model evaluations. This map does not claim they ran. Human retention is outside these browser recipes. Use the HTTP tests and [evaluation protocol](../../../../docs/EVALUATION.md) for those boundaries.
