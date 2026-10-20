/** Inert source parsing for public search. No DOM, scripts, learner code or file reads. */
import { createHash } from "node:crypto";
import { decodeHtmlAttribute, htmlAttributes, TAG_ATTRIBUTES } from "./authoring-html.ts";

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
const RUNTIME =
  /(?:^|\s)(?:cl-(?:header|card-panel|ask-pill|badge-marker|term-pop|contract-error|diagram|teacher|teacher-notice|stepper-runtime|faded-runtime|code-runner|practice-feedback|q-verdict|quiz-footer|answer-report|order-controls|expected))(?:\s|$)/;
export function canonicalText(text: string): string {
  return decodeHtmlAttribute(text)
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFC");
}

/** Assign ids from canonical quoted text + duplicate occurrence, never source offsets.
 * Source indices are used only to insert inert anchors back into the original HTML.
 */
export function searchPassages(html: string): { html: string; passages: SearchPassage[] } {
  html = html.replace(
    /<span id="cl-search-[a-f0-9]{24}-[0-9]+" class="cl-search-anchor" aria-hidden="true"><\/span>/g,
    "",
  );
  html = html.replace(/ id="cl-search-[a-f0-9]{24}-[0-9]+"/g, "");
  interface Node {
    tag: string;
    start: number;
    skip: boolean;
    text: string;
    block: boolean;
    attributeAt?: number;
  }
  const root: Node = { tag: "@root", start: 0, skip: false, text: "", block: true };
  const stack: Node[] = [root],
    found: Array<{ start: number; text: string; attribute: boolean }> = [];
  const tokens = new RegExp(
    `<!--[\\s\\S]*?-->|<script\\b${TAG_ATTRIBUTES}>[\\s\\S]*?<\\/script\\s*>|<style\\b${TAG_ATTRIBUTES}>[\\s\\S]*?<\\/style\\s*>|<![^>]*>|<\\/?([a-z][\\w:-]*)\\b${TAG_ATTRIBUTES}>`,
    "gi",
  );
  let cursor = 0;
  const flush = (node: Node) => {
    const text = canonicalText(node.text);
    if (text && !node.skip) {
      found.push({
        start: node.attributeAt ?? node.start,
        text,
        attribute: node.attributeAt !== undefined,
      });
    }
    node.attributeAt = undefined;
    node.text = "";
  };
  const add = (text: string, offset: number) => {
    if (stack.some((n) => n.skip)) return;
    if (/<!--|<\/?[a-z][\w:-]*(?:\s|>|\/)/i.test(text))
      throw new Error("Malformed content tag or attribute.");
    const node = [...stack].reverse().find((n) => n.block)!;
    if (!node.text) node.start = offset;
    node.text += text;
  };
  for (const token of html.matchAll(tokens)) {
    add(html.slice(cursor, token.index), cursor);
    cursor = token.index + token[0].length;
    if (!token[1]) continue;
    const tag = token[1].toLowerCase();
    if (token[0].startsWith("</")) {
      const index = stack.map((n) => n.tag).lastIndexOf(tag);
      if (index < 1) continue;
      for (const node of stack.splice(index)) if (node.block) flush(node);
    } else {
      const attrs = htmlAttributes(token[0]);
      const skip =
        stack.some((n) => n.skip) ||
        EXCLUDED.has(tag) ||
        RUNTIME.test(decodeHtmlAttribute(attrs.get("class") ?? "")) ||
        /(?:\s)(?:hidden|data-cl-grade|data-cl-pretest-pending)(?=\s|=|\/?>)/i.test(
          token[0].replace(/"[^"]*"|'[^']*'/g, '""'),
        ) ||
        attrs.get("aria-hidden") === "true";
      const block = BLOCKS.has(tag);
      if (block && !skip) flush([...stack].reverse().find((n) => n.block)!);
      if (tag === "br") add(" ", cursor);
      if (!VOID.has(tag) && !token[0].endsWith("/>"))
        stack.push({
          tag,
          start: cursor,
          skip,
          text: "",
          block,
          attributeAt: block && !attrs.has("id") ? cursor - 1 : undefined,
        });
    }
  }
  add(html.slice(cursor), cursor);
  if (stack.slice(1).some((n) => n.block || n.skip)) throw new Error("Unclosed content element.");
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
