/** Inert source parsing for public search. No DOM, scripts, learner code or file reads. */
import { createHash } from "node:crypto";
import { parse } from "parse5";
import type { DefaultTreeAdapterTypes, ParserError } from "parse5";

export interface SearchPassage {
  id: string;
  text: string;
}
const BLOCKS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "pre",
  "td",
  "th",
  "figcaption",
  "blockquote",
  "dt",
  "dd",
  "div",
  "section",
  "article",
  "main",
  "body",
]);
const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
const EXCLUDED = new Set([
  "head",
  "script",
  "style",
  "noscript",
  "template",
  "button",
  "textarea",
  "select",
  "option",
  "svg",
  "iframe",
  "object",
]);
// End tags the HTML parser may legitimately infer. Preserve the existing required
// block/inert-element guards without turning extraction into an HTML validator.
const OPTIONAL_END = new Set(
  "html head body p li dt dd rt rp optgroup option colgroup caption thead tbody tfoot tr td th".split(
    " ",
  ),
);
const MALFORMED_TOKEN =
  /(?:attribute|eof-in-tag|eof-before-tag-name|eof-in-comment|incorrectly-opened-comment|unexpected-solidus-in-tag|end-tag-with-trailing-solidus)/;
const RUNTIME =
  /(?:^|\s)(?:cl-(?:header|card-panel|ask-pill|badge-marker|term-pop|contract-error|diagram|teacher|teacher-notice|stepper-runtime|faded-runtime|code-runner|practice-feedback|q-verdict|quiz-footer|answer-report|order-controls|expected))(?:\s|$)/;
export function canonicalText(text: string): string {
  return text.replace(/\s+/g, " ").trim().normalize("NFC");
}

/** Assign ids from canonical quoted text + duplicate occurrence, never source offsets.
 * Source indices are used only to insert inert anchors back into the original HTML.
 */
export function searchPassages(html: string): { html: string; passages: SearchPassage[] } {
  interface Segment {
    start: number;
    text: string;
    attributeAt?: number;
  }
  const found: Array<{ start: number; text: string; attribute: boolean }> = [];
  const parseSource = () =>
    parse(html, {
      sourceCodeLocationInfo: true,
      scriptingEnabled: true,
      onParseError(error: ParserError) {
        if (MALFORMED_TOKEN.test(error.code))
          throw new Error("Malformed content tag or attribute.");
      },
    });
  let document = parseSource();
  const removals: Array<{ startOffset: number; endOffset: number }> = [];
  // Only actual generated elements/attributes belong to decoration. Matching
  // bytes inside authored prose, scripts and controls must remain untouched.
  const undecorate = (node: DefaultTreeAdapterTypes.Node): void => {
    if ("tagName" in node) {
      const attrs = new Map(node.attrs.map((a) => [a.name, a.value]));
      const location = node.sourceCodeLocation;
      if (/^cl-search-[a-f0-9]{24}-[0-9]+$/.test(attrs.get("id") ?? "")) {
        if (
          node.tagName === "span" &&
          attrs.get("class") === "cl-search-anchor" &&
          attrs.get("aria-hidden") === "true" &&
          !node.childNodes.length &&
          location?.endTag
        ) {
          removals.push(location);
          return;
        }
        const id = location?.attrs?.id;
        if (id) {
          let startOffset = id.startOffset;
          if (html[startOffset - 1] === " ") startOffset--;
          removals.push({ startOffset, endOffset: id.endOffset });
        }
      }
      if ("content" in node) undecorate(node.content as DefaultTreeAdapterTypes.DocumentFragment);
    }
    if ("childNodes" in node) for (const child of node.childNodes) undecorate(child);
  };
  undecorate(document);
  if (removals.length) {
    for (const r of removals.sort((a, b) => b.startOffset - a.startOffset))
      html = html.slice(0, r.startOffset) + html.slice(r.endOffset);
    document = parseSource();
  }
  const flush = (segment: Segment) => {
    const text = canonicalText(segment.text);
    if (text)
      found.push({
        start: segment.attributeAt ?? segment.start,
        text,
        attribute: segment.attributeAt !== undefined,
      });
    segment.attributeAt = undefined;
    segment.text = "";
  };
  // Validate excluded trees too. A missing template/raw-text close is an error,
  // never a reason to reveal its contents or silently return a partial index.
  const validate = (node: DefaultTreeAdapterTypes.Node): void => {
    if ("tagName" in node) {
      const location = node.sourceCodeLocation;
      if (
        location?.startTag &&
        !location.endTag &&
        (BLOCKS.has(node.tagName) || EXCLUDED.has(node.tagName)) &&
        !VOID.has(node.tagName) &&
        !OPTIONAL_END.has(node.tagName) &&
        !(
          node.namespaceURI !== "http://www.w3.org/1999/xhtml" &&
          /\/\s*>$/.test(html.slice(location.startOffset, location.startTag.endOffset))
        )
      )
        throw new Error("Unclosed content element.");
      if ("content" in node) validate(node.content as DefaultTreeAdapterTypes.DocumentFragment);
    }
    if ("childNodes" in node) for (const child of node.childNodes) validate(child);
  };
  validate(document);
  const walk = (node: DefaultTreeAdapterTypes.Node, segment: Segment): void => {
    if ("value" in node) {
      if (!segment.text) segment.start = node.sourceCodeLocation?.startOffset ?? 0;
      segment.text += node.value;
      return;
    }
    let own = segment;
    if ("tagName" in node) {
      const attrs = new Map(node.attrs.map((a) => [a.name, a.value]));
      if (
        EXCLUDED.has(node.tagName) ||
        RUNTIME.test(attrs.get("class") ?? "") ||
        ["hidden", "data-cl-grade", "data-cl-pretest-pending"].some((a) => attrs.has(a)) ||
        attrs.get("aria-hidden") === "true"
      )
        return;
      if (node.tagName === "br") segment.text += " ";
      if (BLOCKS.has(node.tagName)) {
        flush(segment);
        own = {
          start: node.sourceCodeLocation?.startOffset ?? 0,
          text: "",
          attributeAt:
            !attrs.has("id") && node.sourceCodeLocation?.startTag
              ? node.sourceCodeLocation.startTag.endOffset - 1
              : undefined,
        };
      }
    }
    if ("childNodes" in node) for (const child of node.childNodes) walk(child, own);
    if (own !== segment) flush(own);
  };
  const root: Segment = { start: 0, text: "" };
  walk(document, root);
  flush(root);
  const occurrences = new Map<string, number>();
  const totals = new Map<string, number>();
  for (const p of found) totals.set(p.text, (totals.get(p.text) ?? 0) + 1);
  const sourceIdentity = createHash("sha256")
    .update(found.map((p) => p.text).join("\0"))
    .digest("hex");
  const passages = found
    .sort((a, b) => a.start - b.start)
    .map((p) => {
      const count = occurrences.get(p.text) ?? 0;
      occurrences.set(p.text, count + 1);
      const id = `cl-search-${createHash("sha256")
        .update(
          p.text +
            "\0" +
            totals.get(p.text) +
            ((totals.get(p.text) ?? 0) > 1 ? "\0" + sourceIdentity : ""),
        )
        .digest("hex")
        .slice(0, 24)}-${count}`;
      return { ...p, id };
    });
  let output = html;
  for (const p of [...passages].reverse())
    output =
      output.slice(0, p.start) +
      (p.attribute
        ? ` id="${p.id}"`
        : `<span id="${p.id}" class="cl-search-anchor" aria-hidden="true"></span>`) +
      output.slice(p.start);
  return { html: output, passages: passages.map(({ id, text }) => ({ id, text })) };
}
