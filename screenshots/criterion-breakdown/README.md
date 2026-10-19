# Criterion feedback evidence

Captured from running loopback classrooms with the repository's headless browser harness.
Desktop captures use 1280×900; mobile captures use 375×812 with full-page screenshots.

- Before: exact `c351802ec689b99fdeaeb7d9f193f1c5be092722` source archive.
- After: frozen runtime `dc6a7b006c9ff40452ae578a6083a4445a3cfefb`.
- Both use residuals 2 and -1 and the same answer: “The squared errors sum to 5.
  Therefore the mean squared error is 5.” Both store 2/4 (50%). The new view
  explains the fixed 2/2 sum criterion and 0/2 averaging criterion.
- `reloaded-mobile.png` keeps those allocations and locked controls.
  `revision-*.png` shows an explicit explanation revision; the earlier grade file
  remains unchanged with the same allocations.
- `error-before-*.png` and `error-after-*.png` show the same invalid rubric-points
  rejection without saving an attempt. `teacher-error-mobile.png` shows a new
  incomplete criterion plan rejected before grading, with explicit retry.
- `historical-mobile.png` replays the original saved attempt and grade with no
  structured criterion snapshot. Both files keep their original hashes; display
  adds no criterion data and makes no teacher request.
- `pi-mobile.png`, `claude-mobile.png`, and `codex-mobile.png` show real dedicated
  host responses to the same partial calculation. Pi and Codex ran at `4ef0723`;
  Claude ran at `af06767`. Later runtime changes guard invalid saved rows and
  preserve drafts on rejected submissions; the positive grading and rendering
  paths are unchanged. The frozen runtime passed the full local suite separately.

The before/after, history, and error captures use fixture teachers. The named host
captures use the fixed project verification models. These are software and model
adherence checks, with no human-learning claim.
