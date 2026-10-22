# Shared controls evidence

These are captured browser results from a disposable classroom's public
`/r/rust/components.html` reference route. Both sides use the same authored fixture
and saved Settings choices. The base is `53b9b2c`; the after stylesheet and fixture
hashes are in [verification.json](verification.json).

The reference exposes the component API without adopting consumer page redesigns.
New classes are intentionally unstyled on the base. The existing button, icon
button, meter, and empty state show the previous shared defaults.

The four matched pairs cover Indigo/light/1280px/normal motion,
Copper/dark/390px/reduced motion, Green/dark/1280px/reduced motion, and
Neutral/light/390px/normal motion. Viewports are 900px tall; captures are full page.
The full drive checks all 32 theme × accent × motion × viewport combinations.
Every capture includes disabled controls, an invalid field, a specific error and
Retry, and a labelled loading skeleton. The script changes appearance through
Settings, then navigates to the controls to prove persistence.

[Before motion](before-motion.webm) and [after motion](after-motion.webm) retain
the final 12 seconds of their browser recordings. The drive sets DevTools animation
playback to 10%, opens/closes an explanation, expands a measured accordion, swaps
icons, and presses a button, then repeats with reduced motion. It finishes each
transition after capturing its intermediate frame. Reduced motion keeps opacity
feedback and static cues; the skeleton stays still. The JSON records actual
transition properties observed in those frames.

Reproduce after installing dependencies and passing the project doctor:

```sh
node scripts/e2e-components.ts /tmp/studens-components
```

The fixture's Retry and save icon demonstrate the visual contract only. The normal
browser suite checks real rejected requests, explicit resend, and persistence.
No teacher runs in this component drive; zero non-read requests and unchanged
durable classroom files are asserted. The harness closes its browser/server and
removes its scratch classroom while retaining evidence.
