# Lesson teaching origins

Source links provide navigation and context. They never award points, record learning,
or establish retention. A saved `builds-on` course-map connection is a planned
prerequisite, distinct from the teaching origin of a glossary term.

## Glossary teaching origin

On the section or article that originally teaches a term, declare its exact canonical
`GLOSSARY.md` term as `data-cl-teaches`, with a safe, unique, stable element `id`:

```html
<section id="ownership" data-cl-teaches="Ownership">
  <h2>Following a value</h2>
  <p>Each value has one owner. Trace how ownership moves in this example.</p>
</section>
```

This is explicit author provenance, not a conclusion from matching words. Declare
only a section that actually teaches the concept. Do not mark repeated mentions,
reviews, assessments, answer controls, code or generated math/diagram nodes as origins.
Use one canonical term per section; nested teaching sections may declare distinct
terms. Preserve section ids when editing. Do not move an origin to a later mention.
Do not invent an origin for old material whose teaching source is unknown. A term
can be declared before it is promoted to the glossary; that does not promote it or
claim the learner understands it.

The host checks declarations before publication, including those behind pretest
gates. An id uses the existing question-id alphabet (letters, digits, `_`, `.`, `-`),
with no URL, slash or fragment syntax, and must occur exactly once. A lesson may
declare a term only once. Empty or malformed declarations reject publication.
Private keys, variants, criteria and objective mappings keep their existing validation.

The glossary popover still asks for recall first. After **Show the definition**, it
links to the unique declared teaching section in a published, released ordinary
lesson, using the canonical lesson route and encoded section anchor. It never links
to reviews, pending lesson requests, private files or unreleased teaching. Multiple
available origin declarations produce an explicit ambiguity state rather than a guess.
Older or removed declarations have no available origin link. Unreleased declarations
expose no source association, title, id or count. Malformed source state shows a
specific error and requires **Retry loading teaching sources** after correction.
Source discovery and navigation are read-only; they do not run a teacher.

## Prerequisite lesson navigation

Keep using the optional `studens-course-map` block in `MISSION.md` documented in
[MISSION-FORMAT.md](MISSION-FORMAT.md). A lesson whose released objective explicitly
`builds-on` another lesson's released objective shows a **Builds on** lesson link.
`from` is the dependent objective; `to` is its prerequisite. Related edges and upcoming
intentions do not become lesson prerequisites. Numbered lessons link backward in their
authored numbering. For unnumbered lessons the explicit relationship is authoritative.
The link opens the owning lesson, not a guessed section or quiz. No matching-text,
chronology-only or model-guess inference creates an edge.

A broken course-map source displays its file error and **Retry loading lesson links**;
correct it explicitly. Pretest gates, lesson/review identities and private route guards
remain authoritative. Legacy missions without structured connections add no links.

## Authoring callers

Filesystem authoring reads this contract through the scaffold's authoring steps.
The dedicated typed service producer receives this complete contract inline with the
lesson HTML request. It returns these declarations in `lesson_html`; no new response
field, filesystem access or glossary write is needed. The host validates the saved
HTML and the four canonical publication inputs before checking and publication.
