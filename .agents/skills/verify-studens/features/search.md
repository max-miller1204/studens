# Search across classrooms

Find public lesson passages, question threads, glossary terms, and learning records across classrooms, then open the exact source.

## Sub-features

- Literal Unicode, HTML5 named entities and code-punctuation queries; escaped snippets and highlighted matches without double decoding.
- Four source types, deterministic ordering, counts, and explicit pagination.
- Canonical passage anchors, question-card links, accepted glossary term views, and record passages.
- Honest context for orphaned questions and unavailable edited/deleted sources.
- Private file exclusion, pretest/publication gates, read-only projection, and specific source errors with explicit retry.

## How to get to it (user POV)

1. Open Classrooms and select Search across classrooms.
2. Enter a word or phrase and select Search.
3. Select a result to read its passage, card, term, or learning record.
4. Use Back to return to the saved query.

## Driving it with playwright-cli

The browser suite invokes `scripts/e2e-search-browser.ts` through `npm run verify -- browser --artifacts /tmp/studens-search`.

Use the shared launch and doctor instructions. Search uses a labelled searchbox and a Search button. `.cl-search-results h2 a` opens each exact source; native `#cl-search-…` anchors identify canonical source text, while `#cl-question-…` identifies a saved card. Inspect the search folder's `result.json`, `*-hashes.json`, destinations and desktop/mobile light/dark screenshots.

The harness checks all four domains in two classrooms, keyboard entry and Back/query preservation, literal Unicode/code punctuation and rendered math, safe snippets and glossary sources, empty/no-results, 40/40/10 pagination and clearing, private exact queries, malformed glossary/error/explicit retry, symlink/traversal guards including published-review pretest history, changed repeated passages, deleted cards and unavailable sources. Legacy HTML with optional paragraph/body/html, nested list, and table end tags must serve successfully and open eight separate exact passages, including HTML5 named entities and literal encoded markup without double decoding; compare visible text because injected scripts can be children of an unclosed final paragraph. Search-only reads must leave classroom hashes unchanged and make no teacher calls or write requests. It also submits a real pretest through a fixture grading boundary and follows the released search passage, then exercises ordinary Ask and graded-quiz persistence.

`npx vitest run test/search.test.ts` checks the source projection contracts, malformed content, canonical repeated-text identity, publication/version gates, and private-file guards.

## Gotchas

Fixture teacher and grade callbacks prove browser, HTTP and stored-state behavior, not model answers. No search index is persisted. A malformed source fails the whole query with an explicit retry; no partial index or automatic retry hides it. An edit to the public passage sequence invalidates its repeated-text anchors so a stale result cannot jump to another occurrence. Query text is preserved, including a private-canary string supplied by the tester; it must produce no private hit or private metadata.

Extraction uses parse5 as an inert HTML tree parser, never a DOM or code runner. Authored HTML is preserved; parser locations only insert anchors, while canonical visible text defines identity. Parser/bootstrap dependency changes also require the clean production-launcher recipe in [teacher.md](teacher.md), actual installed versions and production audit.
