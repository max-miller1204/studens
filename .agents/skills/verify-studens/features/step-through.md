# Step-through teaching

The learner inspects ordered state changes or changes a computed simulation input
without leaving the lesson page.

## Sub-features

- Inspect authored process, state-machine and pipeline traces with causal text.
- Compute prefix sums from bounded integer input; explicitly recompute a new run.
- Step backward/forward, reset, play and pause; stop at the final state.
- Read diagrams, multiline state and MathML in both themes and on a narrow screen.
- Keep local exploration behind the pretest release and outside assessment forms.

## How to get to it (user POV)

1. Open a lesson that includes `.cl-stepper` teaching.
2. Complete its pretest. The server releases the teaching after grading.
3. Use Back, Next, Reset or Play/Pause. With reduced motion, use manual steps.
4. In a computed prefix-sum widget, edit Values and select Recompute.
5. Reload to return to the initial run.

## Driving it with playwright-cli

Run `npm run verify -- browser --artifacts /tmp/studens-step-through`. The suite
exercises the four examples in `assets/templates/stepper.html` through `.cl-stepper`,
`data-stepper-id`, `data-step`, and `data-state`. Inspect `stepper/result.json`, the
captures, and `stepper/step-through.webm`.

It steps through every frame, recomputes values, rejects malformed input, checks
keyboard focus and reduced motion, toggles themes, blocks network after renderer
assets load, and reloads. Invalid JSON, version, Mermaid, and TeX show specific
errors while other widgets keep working. Formulas render as MathML in the frame and
its announcement. Exploration makes no HTTP writes or teacher calls.

`stepper-publication/publication.json` traces a typed fixture through the real page
checker: widgets are absent before release and all four are exercised after it.

## Gotchas

- Authored traces show the author's snapshots; only prefix-sum computes results.
- Public widget values must differ from private graded checks.
- Local exploration is not assessment or review evidence.
- Real authoring needs the fixed-model host checks in the shared skill.
