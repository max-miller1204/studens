# Search across classrooms

Find public lesson passages, question threads, glossary terms, and learning records across classrooms, then open the exact source.

## Sub-features

- Literal Unicode, HTML5 named entities and code-punctuation queries; escaped snippets and highlighted matches without double decoding.
- Four source types, deterministic ordering, counts, and explicit pagination.
- Canonical passage anchors, question-card links, accepted glossary term views, and record passages.
- Honest context for orphaned questions and unavailable edited/deleted sources, including legacy lessons without a main element.
- Private file exclusion, pretest/publication gates, read-only projection, and specific source errors with explicit retry.

## How to get to it (user POV)

1. Open Classrooms and select Search across classrooms.
2. Enter a word or phrase and select Search.
3. Select a result to read its passage, card, term, or learning record.
4. Use Back to return to the saved query.

## Driving it with playwright-cli

Run `npm run verify -- browser --artifacts /tmp/studens-search` (it runs
`scripts/e2e-search-browser.ts`).

Search uses a labelled searchbox and a Search button. `.cl-search-results h2 a` opens
each source; `#cl-search-…` anchors mark passages and `#cl-question-…` marks a card.
The drive covers all four domains in two classrooms, Back with the query kept,
Unicode and code punctuation, math, 40/40/10 pagination, private exact queries,
malformed glossary with explicit retry, symlink and traversal guards, edited and
deleted sources, and legacy HTML with optional end tags. Search reads must leave
hashes unchanged and make no teacher calls. Inspect `result.json`, `*-hashes.json`,
and the captures.

`npx vitest run test/search.test.ts test/launch-runtime.test.ts` covers the source
projection, malformed content, repeated-text identity, gates, private files, and a
partial-install launcher case.

## Gotchas

- No search index is persisted. A malformed source fails the whole query with an
  explicit retry.
- Editing a passage sequence invalidates its repeated-text anchors, so a stale result
  cannot jump to another occurrence.
- Extraction uses parse5 as an inert tree parser. Anchor cleanup touches only
  generated elements, never authored text, scripts, or control values.
- Parser dependency changes also need the production launcher check in [teacher.md](teacher.md).
