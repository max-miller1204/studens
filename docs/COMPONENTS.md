# Shared browser components

[Documentation](README.md)

`assets/runtime/classroom.css` supplies the shared layer. These classes are opt-in
for consumer pages; existing `.cl-button-quiet`, `.cl-badge`, `.cl-card-link`,
`.cl-meter`, and `.cl-empty` callers remain supported. No build or JavaScript
component framework is required. Use the existing [icons](../assets/runtime/icons.mjs)
with an accessible name on icon-only controls.

| Component         | Class and contract                                                                                                                                                                                                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Button            | `.cl-button` is primary. Add `.cl-button-secondary`, `.cl-button-ghost`, or `.cl-button-danger`. `.cl-button-sm` / `.cl-button-lg` select size; default is medium. Use native `disabled`. Links may use the visual class; an `aria-disabled` link still needs its owner to prevent navigation.                       |
| Icon button       | `.cl-icon-button` on a named `<button>`; decorative SVG children remain `aria-hidden`. Touch targets grow to 44px.                                                                                                                                                                                                   |
| Chip / badge      | `.cl-chip` with optional `.cl-chip-accent`, `-success`, `-warn`, `-danger`. Include a status label, not color alone. Existing `.cl-badge-*` classes keep their meanings.                                                                                                                                             |
| Card              | `.cl-card-box` supplies padding, surface, radius, and ring shadow. `.cl-card` remains the existing classroom-list wrapper.                                                                                                                                                                                           |
| List row          | `.cl-list-row` on a link, or a noninteractive container with separate named actions. Rows change color instantly on hover.                                                                                                                                                                                           |
| Disclosure        | `<details class="cl-disclosure"><summary>Label</summary><div>Content</div></details>`. Native keyboard/expanded semantics; plus/minus is a static cue. For animated height, use a `.cl-disclosure-row` button with `aria-controls` / `aria-expanded` and a `.cl-accordion` panel containing `.cl-accordion-content`. |
| Segmented control | `.cl-segmented` containing buttons with `aria-pressed`, or a complete tab pattern with `aria-selected`. The owner updates state and content. Selection changes instantly.                                                                                                                                            |
| Forms             | `.cl-input` on text inputs, textareas, and selects; `.cl-check` on native checkbox/radio inputs. Supply labels; pair `aria-invalid="true"` with specific text via `aria-describedby`.                                                                                                                                |
| Meter             | `.cl-meter > span` with an explicit percentage width. Supply `role="meter"`, name, min/max/current values, and a visible count. No automatic fill animation.                                                                                                                                                         |
| Mini bars         | `.cl-mini-bars` on an ordered list. Each item has a count, `<div><i style="height: …%"></i></div>`, and label. Supply a table alternative for longer charts; leave zero bars at zero. No animation.                                                                                                                  |
| Empty state       | `.cl-empty` containing `.cl-empty-title` and `.cl-empty-body`. State what is empty and the next useful action.                                                                                                                                                                                                       |
| Inline error      | `.cl-inline-error` with `role="alert"`, a `<p>` naming the specific failure, and a labelled Retry button. Its owner retries only on activation and retains failed input. Styling never retries or hides errors.                                                                                                      |
| Status line       | `.cl-status-line` with optional `data-tone="success"` / `"danger"`. Use `role="status"` for updates. No toast.                                                                                                                                                                                                       |
| Skeleton          | `.cl-skeleton` on decorative placeholders (`aria-hidden="true"`) inside an `aria-busy="true"` region with visible loading text. Set dimensions for the content being loaded. Static under reduced motion.                                                                                                            |

## Motion primitives

Only opt in for an occasional change that benefits from continuity. Do not apply
entrances to rows, tabs, typing, or keyboard shortcuts. Keep a visible label, icon,
or color change even when motion is disabled. Theme/accent changes already suppress
transitions for a paint frame.

- Buttons give pointer press feedback at `scale: .96` over 150ms ease-out. Disabled,
  keyboard-focused, and segmented/tab controls do not scale. Reduced motion fades
  opacity to .8 over 150ms instead; the inset press ring remains a static cue.
- `.cl-motion-enter` uses an opacity transition when inserted or when `hidden`
  changes. Under no-preference it also blurs 4px and moves from 12px below over
  300ms ease-out; exit moves 12px up over 150ms. Keep the node mounted while exiting;
  `hidden` provides the discrete display transition and removes interaction.
- `.cl-accordion` transitions height over 200ms with
  `cubic-bezier(0.23, 1, 0.32, 1)`. Its owner measures the inner content height into
  `--cl-accordion-height` (pixels), keeps it current with `ResizeObserver`, and
  sets `data-open="true"` / `"false"` on explicit activation. Update the trigger's
  `aria-expanded` and set `inert` on the closed panel so hidden controls cannot
  receive focus. Reduced motion changes height immediately and cross-fades opacity.
  See the live reference fixture for the complete owner code. Native `<details>`
  remains available for disclosures that do not need motion.
- `.cl-icon-swap` keeps both decorative icons in the DOM, in the same grid cell.
  Set `data-active="true"` on exactly one child, `"false"` on the other. Its
  300ms `cubic-bezier(0.2, 0, 0, 1)` transition uses scale .25→1, opacity, and
  blur 4px→0; reduced motion uses opacity only. Initialize attributes before
  insertion, update the accessible label/status separately, and retain focus.

Transitions retarget when interrupted. Accordion height uses an explicit measured
pixel value; entrance/exit uses `@starting-style` and discrete display transitions.
Consumers must not delay the underlying state or depend on an animation completion
event for correctness.

## Live reference

Run `node scripts/e2e-components.ts /tmp/studens-components` after the shared
verification prerequisites. It serves the authored fixture through the public
reference route in a disposable classroom, drives controls, records motion, and
captures both themes × four accents × motion preferences × desktop/touch sizes.
The fixture is verification scaffolding, not a production gallery or teacher test.
