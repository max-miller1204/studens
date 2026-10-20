/** Explicit teaching declarations in public HTML, never inferred from term mentions. */
import { parse } from "parse5";
import type { DefaultTreeAdapterTypes } from "parse5";
import { isContractId } from "../assets/runtime/quiz.mjs";

export interface TeachingSource {
  term: string;
  anchor: string;
}
/** Read actual elements, including gated teaching, without running authored scripts. */
function parseSources(html: string): { sources: TeachingSource[]; anchors: string[] } {
  const document = parse(html);
  const ids = new Map<string, number>();
  const sources: TeachingSource[] = [];
  const terms = new Set<string>();
  const anchors: string[] = [];
  const walk = (node: DefaultTreeAdapterTypes.Node, excluded = false): void => {
    if ("tagName" in node) {
      const attrs = new Map(node.attrs.map((a) => [a.name, a.value]));
      excluded ||=
        [
          "head",
          "script",
          "style",
          "noscript",
          "svg",
          "math",
          "form",
          "pre",
          "code",
          "details",
        ].includes(node.tagName) ||
        attrs.has("hidden") ||
        attrs.has("inert") ||
        attrs.get("aria-hidden") === "true" ||
        (node.tagName === "template" && !attrs.has("data-cl-after-pretest"));
      const id = attrs.get("id");
      if (id) ids.set(id, (ids.get(id) ?? 0) + 1);
      if (
        id &&
        !excluded &&
        ["section", "article"].includes(node.tagName) &&
        isContractId(id) &&
        !/^\.+$/.test(id) &&
        !id.startsWith("cl-")
      )
        anchors.push(id);
      if (attrs.has("data-cl-teaches")) {
        const term = attrs.get("data-cl-teaches")!;
        if (excluded || !["section", "article"].includes(node.tagName))
          throw new Error(
            "Teaching origin must be a section or article outside assessments, code and generated content.",
          );
        if (!isContractId(id) || /^\.+$/.test(id) || id.startsWith("cl-"))
          throw new Error("Teaching origin needs a safe, stable section id.");
        if (!term.trim() || term !== term.trim() || term.length > 200 || /[\r\n]/.test(term))
          throw new Error(
            "Teaching origin needs one nonempty canonical term of at most 200 characters.",
          );
        const key = term.normalize("NFC").toLowerCase();
        if (terms.has(key))
          throw new Error(
            "A lesson declares the same teaching origin twice. Keep repeated mentions unmarked.",
          );
        terms.add(key);
        sources.push({ term, anchor: id });
      }
      if ("content" in node)
        walk(node.content as DefaultTreeAdapterTypes.DocumentFragment, excluded);
    }
    if ("childNodes" in node) for (const child of node.childNodes) walk(child, excluded);
  };
  walk(document);
  if (sources.some((source) => ids.get(source.anchor) !== 1))
    throw new Error("Teaching origin section id must occur exactly once in the lesson.");
  return { sources, anchors: anchors.filter((id) => ids.get(id) === 1) };
}
export function teachingSources(html: string): TeachingSource[] {
  return parseSources(html).sources;
}
/** Visible ordinary sections can also be named by existing validated prequestion mappings. */
export function teachingAnchors(html: string): ReadonlySet<string> {
  return new Set(parseSources(html).anchors);
}
