Studens is an independent continuation of Josh Noll's
[`pi-teach`](https://github.com/joshrnoll/pi-teach). Its MIT copyright notice
is preserved in the root `LICENSE`.

The teaching methodology in `TEACHING.md` and the format guides in this directory derive
from the `teach` skill vendored from https://github.com/mattpocock/skills
(`skills/productivity/teach`).

Author: Matt Pocock. Licensed MIT — see `LICENSE.upstream`.

`TEACHING.md` is a rewrite of the original `SKILL.md`: the pedagogy is Matt's, adapted to
the canonical `~/.pi/agent/classrooms/` layout, the scaffold tools, and the interactive
lesson runtime this extension provides. `MISSION-FORMAT.md`, `RESOURCES-FORMAT.md`,
`GLOSSARY-FORMAT.md`, and `LEARNING-RECORD-FORMAT.md` retain the upstream formats, with local cross-references.
`NOTES-FORMAT.md` is original to this extension.

UI fonts are bundled from Fontsource variable packages. Inter 5.3.0,
Source Serif 4 5.3.1, and JetBrains Mono 5.3.0 include unmodified Latin and
Latin-Extended WOFF2 files for normal and italic variable weights.
Each directory in `assets/runtime/vendor/` contains its OFL-1.1 `LICENSE`,
package `VERSION`, upstream font metadata, and `PROVENANCE.json` with source,
package integrity, and file SHA-256 hashes.
Source Serif 4 also retains the project-author notice in `OFL.upstream.txt`,
from [this pinned Google Fonts source](https://github.com/google/fonts/blob/01aa15d05749e35be9167f3f44e6a243f00cd2fc/ofl/sourceserif4/OFL.txt).

The 25 Lucide icons come from `lucide-static` 1.61.0. Lucide Icons and
Contributors license them under ISC. The bundled `lucide/LICENSE` also retains
the Feather MIT notice for derived icons by Cole Bemis. The SVG subset uses
`currentColor` and a 1.75 stroke. The bundled inline module contains the same
decorative SVGs. Control labels supply their accessible names.

Update all UI assets with pinned package versions:

```sh
node scripts/vendor-ui.ts 5.3.0 5.3.1 5.3.0 1.61.0
```

Add `--output <vendor-directory>` to validate an update in a separate directory.
The updater checks all package identities, licenses, font headers, CSS subsets,
and SVG content in scratch space before it replaces bundled files. The browser
loads these assets from the loopback server. It does not use a font or icon CDN.
