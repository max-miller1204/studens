# Feature checks

Start with the shared [launch and doctor instructions](../SKILL.md). Each browser run uses fresh scratch classrooms. Real host checks require model access. Keep one evidence directory per run.

| Feature              | Recipe                           | Entry points                                                                                                                 |
| -------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Group classrooms     | [folders.md](folders.md)         | Classrooms page, folders, move controls, reload, explicit retry                                                              |
| Read and ask         | [reading.md](reading.md)         | Lesson text, quiz text, cards, glossary, diagrams, math, theme                                                               |
| Answer quizzes       | [quizzes.md](quizzes.md)         | Quiz, runnable JavaScript and practice controls, pretest gate, disputes/history, reload, second tab                          |
| Next lesson          | [next-lesson.md](next-lesson.md) | Classroom page, optional topic, durable authoring, publication retry                                                         |
| Start a review       | [review.md](review.md)           | Daily landing/groups/history, classroom progress, size/topic/early controls, retirement, question reports, publication retry |
| Classroom settings   | [settings.md](settings.md)       | Classroom Settings, preferences, port, tailnet links, requested and answering model                                          |
| Course map           | [course-map.md](course-map.md)   | Classroom Course map, mission, upcoming objectives, explicit connections, lesson navigation, load retry                      |
| Teacher conversation | [teacher.md](teacher.md)         | Classroom activity, shared persistent panels, explicit retry, Pi/MCP reconnect                                               |

Tailnet links: `npm run verify -- phone` checks the service route; `npm run verify -- phone pi` additionally starts the actual Pi extension, obtains canonical classroom and lesson links through `open_classroom`, and requires the route and Pi teacher ownership to survive initiating Pi exit. These commands change a real Tailscale Serve route. Run them only for link or lifecycle changes with a connected tailnet. They verify working URLs, service status, no Funnel, settings-page disable/enable, explicit config disable, service-stop cleanup, and unchanged unrelated routes. Inspect `phone/tailnet-provenance.json`, `tailnet-after.json`, Pi event output, and the settings screenshot. Choose an unused HTTPS port with `STUDENS_PHONE_PORT`; an already configured port is rejected before route changes. All production hosts use the service-owned route. Legacy live-session route records require explicit cleanup with the previous Pi package; startup must not silently replace them.

Coverage gaps: Feedback and quality targets remain separate model evaluations. This map does not claim they ran. Other landing-page navigation and human retention are outside these browser recipes. Use the HTTP tests and [evaluation protocol](../../../../docs/EVALUATION.md) for those boundaries.
