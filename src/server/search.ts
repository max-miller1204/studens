import { StateReadError } from "../state-errors.ts";
import type * as http from "node:http";
import { escapeHtml } from "../markdown.ts";
import { shell } from "../pages.ts";
import { searchClassrooms, searchGlossarySource, SEARCH_PAGE_SIZE } from "../store/search.ts";
import type { SearchResponse } from "../store/search.ts";
import { searchPassages } from "../search-passages.ts";
import { sendHtml, sendNotFound } from "./http.ts";

function form(query: string): string {
  return `<form action="/search" method="get" role="search" class="cl-search-form"><label for="cl-search-query">Search across classrooms</label><div><input id="cl-search-query" name="q" type="search" value="${escapeHtml(query)}" maxlength="200" placeholder="A phrase, term, or question"><button class="cl-button" type="submit">Search</button></div></form>`;
}
function snippet(text: string, query: string): string {
  const index = text.toLowerCase().indexOf(query.toLowerCase()),
    start = Math.max(0, index - 80),
    end = Math.min(text.length, Math.max(index, 0) + query.length + 160);
  const part = text.slice(start, end),
    at = part.toLowerCase().indexOf(query.toLowerCase());
  const safe =
    at < 0
      ? escapeHtml(part)
      : escapeHtml(part.slice(0, at)) +
        `<mark>${escapeHtml(part.slice(at, at + query.length))}</mark>` +
        escapeHtml(part.slice(at + query.length));
  return `${start ? "…" : ""}${safe}${end < text.length ? "…" : ""}`;
}
function resultPage(result: SearchResponse): string {
  const { query, results, total, page, pages, counts } = result;
  const pageLink = (n: number) => `/search?q=${encodeURIComponent(query)}&page=${n}`;
  return shell({
    title: "Search across classrooms",
    breadcrumb:
      '<a class="cl-crumb" href="/">Classrooms</a><span class="cl-crumb-sep" aria-hidden="true">/</span><span class="cl-crumb cl-crumb-current">Search</span>',
    body: `<div class="cl-search"><h1>Search across classrooms</h1><p>Find published lesson passages, saved question threads, glossary terms, and learning records.</p>${form(query)}
${
  !query
    ? '<p role="status">Enter a word or exact phrase to search all classrooms.</p>'
    : `<p role="status">${total ? `${total} matching ${total === 1 ? "result" : "results"}` : "No results"} for “${escapeHtml(query)}”.</p><p class="cl-progress-note">${Object.entries(
        counts,
      )
        .map(([kind, count]) => `${escapeHtml(kind)}: ${count}`)
        .join(
          " · ",
        )}</p>${total ? `<p>Showing ${(page - 1) * SEARCH_PAGE_SIZE + 1}–${Math.min(page * SEARCH_PAGE_SIZE, total)}. Ordered by classroom, lesson, then source passage; question threads follow their lesson. Glossary terms and learning records follow lessons.</p><ol class="cl-search-results" start="${(page - 1) * SEARCH_PAGE_SIZE + 1}">${results.map((r) => `<li><p class="cl-search-source">${escapeHtml(r.classroom)} · ${r.kind}</p><h2><a href="${escapeHtml(r.url)}">${escapeHtml(r.title)}</a></h2><p>${snippet(r.text, query)}</p>${r.context ? `<p class="cl-progress-note">${escapeHtml(r.context)}</p>` : ""}</li>`).join("")}</ol><nav aria-label="Search pages">${page > 1 ? `<a href="${pageLink(page - 1)}">Previous results</a>` : ""} <span>Page ${page} of ${pages}</span> ${page < pages ? `<a href="${pageLink(page + 1)}">Next results</a>` : ""}</nav>` : "<p>Try another word or a shorter phrase. Search matches literal text, including punctuation.</p>"}`
}</div>`,
  });
}
export function handleSearch(res: http.ServerResponse, url: URL): void {
  const query = url.searchParams.get("q") ?? "";
  try {
    if (url.pathname === "/search/source") {
      const classroom = url.searchParams.get("classroom") ?? "",
        term = url.searchParams.get("term") ?? "";
      if (url.searchParams.get("type") !== "glossary")
        return sendNotFound(res, "Unknown search source");
      const source = searchGlossarySource(classroom, term);
      if (source === null)
        return sendNotFound(
          res,
          "This glossary term is no longer available. Return to Search to find its current entry.",
        );
      return sendHtml(
        res,
        shell({
          title: term,
          breadcrumb: `<a class="cl-crumb" href="/search">Search</a><span class="cl-crumb-sep">/</span><a class="cl-crumb" href="/c/${encodeURIComponent(classroom)}">Classroom</a>`,
          body: `<article class="cl-doc"><h1>Glossary term</h1>${searchPassages(source).html}<p><a href="/doc/${encodeURIComponent(classroom)}/GLOSSARY.md">Read full glossary</a></p></article>`,
        }),
      );
    }
    sendHtml(res, resultPage(searchClassrooms(query, Number(url.searchParams.get("page") ?? 1))));
  } catch (error) {
    sendHtml(
      res,
      shell({
        title: "Cannot load search",
        breadcrumb: '<a class="cl-crumb" href="/">Classrooms</a>',
        body: `<div class="cl-search"><h1>Cannot load search</h1>${form(query)}<p role="alert">${escapeHtml(error instanceof StateReadError ? error.message : "Cannot search public sources: unreadable or malformed content. Correct the source, then retry explicitly.")}</p><p>Correct the saved source, then retry. No partial results are shown.</p><a class="cl-button" href="${escapeHtml(url.pathname + url.search)}">Retry search</a></div>`,
      }),
      500,
    );
  }
}
