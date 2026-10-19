# Criterion grading after released Settings integration

Matched disposable browser fixtures at before `67fe9518db0c260e1a83e368782c748fd12d2304`
(exact v0.11.5 archive, including docs/ATTRIBUTION.md) and after runtime
`8f2dd65621aa96326dfbdc8b05265cb2ea1807a4`. The after merge preserves Settings,
model selection and error presentation; later verification-only additions do not
change runtime rendering. No unmerged sibling implementation is included.

Each pair uses the same partial answer, fixed rubric, 1280×900 desktop or 375×812
mobile viewport, and actual light/dark theme controls. `partial` and `reload` show
2/4 (50%); after adds sum 2/2 and average 0/2. `history` shows an explicit
explanation-only grade revision with the same points and original grade retained.
`error` shows invalid rubric points with the draft preserved. Each image was
inspected. Timestamp values differ because each source has its own fixture.

These are fixture-teacher UI/storage checks, not model quality or human learning
evidence. The first capture helper mislabeled an inherited desktop theme; those
original images remain outside the repository. These images use the corrected
effective-theme check. No private rubric files or teacher plans are published.

The original sixteen images and their provenance remain in
[criterion-breakdown](../criterion-breakdown/README.md). The integration evidence
root is `/tmp/studens-issue24-round24`: source hashes, public image hashes, full
verification receipts, rollback fixture/proof, authoring review and handoff.
