# Feature checks

Start with the shared [launch and doctor instructions](../SKILL.md). Each browser run uses fresh scratch classrooms. Real host checks require model access. Keep one evidence directory per run.

| Feature              | Recipe                             | Entry points                                                                                                                         |
| -------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Group classrooms     | [folders.md](folders.md)           | Classrooms page, folders, move controls, reload, explicit retry                                                                      |
| Read and ask         | [reading.md](reading.md)           | Lesson/quiz text, Saved marks, typed card answers/follow-ups/reload/recovery, glossary, diagrams, math, theme                        |
| Step through states  | [step-through.md](step-through.md) | Lesson traces, computed input, local controls, diagrams/math, gates, offline, both themes                                            |
| Answer quizzes       | [quizzes.md](quizzes.md)           | Quiz, runnable JavaScript and practice controls, pretest gate, disputes/history, reload, second tab                                  |
| Next lesson          | [next-lesson.md](next-lesson.md)   | Classroom page, optional topic, durable authoring, publication retry                                                                 |
| Start a review       | [review.md](review.md)             | Daily landing/groups/history, card fragments/reload, memory map/forecast/why, review controls, reports, publication retry            |
| Classroom settings   | [settings.md](settings.md)         | Classroom Settings, preferences, port, tailnet links, requested and answering model                                                  |
| Export classroom     | [export.md](export.md)             | Classroom Export, Anki/Markdown downloads, printable contents/PDF, released-template and corrective answers, read-only/privacy gates |
| Search classrooms    | [search.md](search.md)             | Landing Search, four public domains, exact passage/card/term/record links, errors/retry, privacy                                     |
| Course map           | [course-map.md](course-map.md)     | Classroom Course map, mission, upcoming objectives, explicit connections, lesson navigation, load retry                              |
| Teacher conversation | [teacher.md](teacher.md)           | Classroom activity, shared persistent panels, explicit retry, Pi/MCP reconnect, packaged Pi commands                                 |

Tailnet links: `npm run verify -- phone` checks the service route; `npm run verify -- phone pi` also starts the Pi extension and requires the route and teacher to survive Pi exit. Both change a real Tailscale Serve route, so run them only for link or lifecycle changes on a connected tailnet. Pick an unused HTTPS port with `STUDENS_PHONE_PORT`. They check working URLs, no Funnel, settings disable/enable, stop cleanup, and unchanged unrelated routes. Inspect `phone/tailnet-provenance.json` and `tailnet-after.json`. Legacy live-session routes need explicit cleanup with the previous Pi package.

Coverage gaps: Feedback and quality targets remain separate model evaluations. This map does not claim they ran. Other landing-page navigation and human retention are outside these browser recipes. Use the HTTP tests and [evaluation protocol](../../../../docs/EVALUATION.md) for those boundaries.
