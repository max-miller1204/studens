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

Run `npm run verify -- browser --artifacts /tmp/studens-step-through`.
The suite exercises four examples from `assets/templates/stepper.html`. Inspect
`stepper/result.json`, matching desktop/mobile light/dark screenshots and the short
`stepper/step-through.webm` recording. The recording follows a packet from receive
through decode to emit and stops automatically. Inspect start, middle and end.

The drive uses `.cl-stepper`, `data-stepper-id`, `data-step` and `data-state`, with
Back/Next/Reset/Play/Pause/Recompute buttons and the labeled Values input. It
exhausts every frame, changes computed values, rejects malformed input without
keeping a stale result, checks keyboard focus and waits for reduced-motion media
changes before checking the disabled Play control. It rapidly replaces pending
frames, toggles themes, checks unique SVG IDs, blocks all network requests after
local renderer assets load, removes a playing widget, reloads and navigates away
and back. Newly rendered formulas and diagrams must draw without contract errors.

Invalid JSON, version, Mermaid and TeX show specific visible errors; another valid
widget remains usable. State formulas must render as MathML in both the frame
and its visible polite announcement, including after Next; neither may show raw
TeX. Authored text is literal. Compare all classroom file hashes
before/after exploration, require zero HTTP writes and teacher hooks, and check
neighboring local practice and a normal graded check. A widget identity cannot be
submitted as an assessment; private quiz files remain 404.

`stepper-publication/publication.json` traces a typed fixture through canonical
private serialization, the actual disposable initial/released page checker and
publication with all four exact file hashes. Widgets must be absent before release,
all four must be exercised after it, checking must create no learner work, and an
invalid widget must remain unpublished. This is a software fixture, not model use.

## Gotchas

Authored traces display snapshots supplied by the author; the runtime does not
verify domain truth. Only prefix-sum computes new results. Public widget content
must use different cases/values from private graded checks. No local action proves
learning or creates assessment/review evidence. The existing static Mermaid and
math paths remain covered by the reading checks. Real authoring requires the
fixed-model host checks in the shared skill; fixture publication cannot prove it.
