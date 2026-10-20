/** Inert, allowlisted HTML for portable classroom content. Never copy source attributes. */
import { parse } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";
import { escapeHtml } from "./markdown.ts";
import { Marked } from "marked";
import temml from "../assets/runtime/vendor/temml/temml.mjs";

export interface ContentNode {
  kind: "text" | "element" | "root";
  tag: string;
  text: string;
  attrs: Map<string, string>;
  children: ContentNode[];
}
const voids = new Set(
  "area base br col embed hr img input link meta param source track wbr".split(" "),
);
const dropped = new Set(
  "script style template head iframe object embed button input textarea select option noscript".split(
    " ",
  ),
);
const allowed = new Set(
  "p h1 h2 h3 h4 h5 h6 ul ol li dl dt dd blockquote pre code strong em b i s del a img br hr table thead tbody tfoot tr th td caption details summary sub sup span div section article main figure figcaption".split(
    " ",
  ),
);

/** Use HTML5 parsing so entities, omitted end tags, raw text and tables match the browser. */
export function contentTree(source: string): ContentNode {
  const convert = (node: DefaultTreeAdapterMap["node"]): ContentNode => ({
    kind: node.nodeName === "#text" ? "text" : "tagName" in node ? "element" : "root",
    tag: "tagName" in node ? node.tagName : node.nodeName,
    text: "value" in node ? node.value : "",
    attrs: new Map("attrs" in node ? node.attrs.map((a) => [a.name, a.value]) : []),
    children: "childNodes" in node ? node.childNodes.map(convert) : [],
  });
  return convert(parse(source));
}
export function nodeText(node: ContentNode): string {
  return node.kind === "text" ? node.text : node.children.map(nodeText).join("");
}
export type ResourceLink = (value: string, media: boolean) => string | null;
export function safeContent(source: string, link: ResourceLink): string {
  const render = (n: ContentNode, literal = false): string => {
    if (n.kind === "text") return literal ? escapeHtml(n.text) : mathText(n.text);
    if (n.attrs.has("hidden") || n.attrs.get("aria-hidden") === "true") return "";
    if (n.attrs.get("class") === "cl-export-math" && n.attrs.has("data-tex"))
      return mathText(n.attrs.get("data-tex")!);
    if (
      n.tag === "textarea" &&
      (n.attrs.get("class") ?? "").split(/\s+/).includes("cl-code-source")
    )
      return `<pre><code class="language-js">${escapeHtml(nodeText(n))}</code></pre>`;
    if (dropped.has(n.tag)) return "";
    const children = () =>
      n.children.map((c) => render(c, literal || ["code", "pre"].includes(n.tag))).join("");
    const classes = (n.attrs.get("class") ?? "").split(/\s+/);
    if (classes.includes("mermaid")) return `<pre class="mermaid">${escapeHtml(nodeText(n))}</pre>`;
    if (n.attrs.has("data-cl-stepper") || classes.includes("cl-stepper"))
      return `<p><em>Interactive widget omitted. Open the source lesson to use its controls.</em></p>`;
    if (n.tag === "svg") return staticSvg(n);
    if (!allowed.has(n.tag)) return children();
    if (n.tag === "a") {
      const href = link(n.attrs.get("href") ?? "", false);
      return href ? `<a href="${escapeHtml(href)}">${children()}</a>` : children();
    }
    if (n.tag === "img") {
      const src = link(n.attrs.get("src") ?? "", true),
        alt = n.attrs.get("alt") ?? "";
      return src
        ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`
        : `<em>[Image unavailable: ${escapeHtml(alt)}]</em>`;
    }
    const math = n.attrs.get("data-latex");
    if (math) return escapeHtml(`\\(${math}\\)`);
    const language = n.tag === "code" ? classes.find((c) => /^language-[\w-]+$/.test(c)) : null;
    return `<${n.tag}${language ? ` class="${language}"` : ""}>${children()}${voids.has(n.tag) ? "" : `</${n.tag}>`}`;
  };
  return render(contentTree(source));
}
export function portableMarkdown(source: string): string {
  const tree = contentTree(source);
  const escape = (s: string) => s.replace(/([\\`*_{}\[\]<>#+.!|~=\-])/g, "\\$1");
  const render = (n: ContentNode, depth = 0): string => {
    const body = () => n.children.map((c) => render(c, depth)).join("");
    if (n.kind === "text") return escape(n.text);
    if (n.attrs.get("class") === "cl-export-math") {
      const tex = n.attrs.get("data-tex") ?? "";
      if (/[<>]/.test(tex)) {
        const fence = "`".repeat(
          Math.max(3, ...[...tex.matchAll(/`+/g)].map((m) => m[0].length + 1)),
        );
        return `\n\n${fence}math\n${tex}\n${fence}\n\n`;
      }
      return tex;
    }
    if (n.tag === "pre") {
      const text = nodeText(n);
      const fence = "`".repeat(
        Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)),
      );
      const language =
        n.attrs.get("class") === "mermaid"
          ? "mermaid"
          : (n.children[0]?.attrs.get("class")?.replace(/^language-/, "") ?? "");
      return `\n\n${fence}${language}\n${text}\n${fence}\n\n`;
    }
    if (n.tag === "code") {
      const text = nodeText(n),
        fence = "`".repeat(Math.max(1, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)));
      return `${fence} ${text} ${fence}`;
    }
    if (/^h[1-6]$/.test(n.tag)) return `\n\n${"#".repeat(Number(n.tag[1]))} ${body()}\n\n`;
    if (n.tag === "a")
      return `[${body()}](<${n.attrs.get("href")!.replace(/[<>\n\r]/g, encodeURIComponent)}>)`;
    if (n.tag === "img") return `![${escape(n.attrs.get("alt") ?? "")}](<${n.attrs.get("src")!}>)`;
    if (["strong", "b"].includes(n.tag)) return `**${body()}**`;
    if (["em", "i"].includes(n.tag)) return `*${body()}*`;
    if (n.tag === "blockquote")
      return `\n\n${body()
        .trim()
        .split("\n")
        .map((l) => "> " + l)
        .join("\n")}\n\n`;
    if (["ul", "ol"].includes(n.tag))
      return (
        "\n\n" +
        n.children
          .filter((c) => c.tag === "li")
          .map(
            (c, i) =>
              `${"  ".repeat(depth)}${n.tag === "ol" ? `${i + 1}.` : "-"} ${c.children
                .map((x) => render(x, depth + 1))
                .join("")
                .trim()
                .replace(/\n/g, "\n  ")}`,
          )
          .join("\n") +
        "\n\n"
      );
    if (n.tag === "br") return "  \n";
    if (n.tag === "hr") return "\n\n---\n\n";
    if (n.tag === "svg") return `\n\n${staticSvg(n)}\n\n`;
    if (n.tag === "table") return `\n\n${sourceTable(n)}\n\n`;
    return [
      "p",
      "div",
      "section",
      "article",
      "main",
      "figure",
      "figcaption",
      "dl",
      "dt",
      "dd",
      "details",
      "summary",
    ].includes(n.tag)
      ? `\n\n${body()}\n\n`
      : body();
  };
  // Inert table HTML preserves spans and multiline cells without inventing a lossy table.
  const sourceTable = (n: ContentNode): string =>
    n.kind === "text"
      ? escapeHtml(n.text)
      : `<${n.tag}>${n.children.map(sourceTable).join("")}</${n.tag}>`;
  return render(tree).trim() + "\n";
}
export function markdownContent(markdown: string, link: ResourceLink): string {
  const parser = new Marked({
    gfm: true,
    extensions: [
      {
        name: "exportMath",
        level: "inline",
        start(src: string) {
          return src.search(/\$|\\[([]/);
        },
        tokenizer(src: string) {
          const m =
            /^(?:\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$(?![\s$])[^$\n]+?(?<!\s)\$(?!\d))/.exec(
              src,
            );
          if (m) return { type: "exportMath", raw: m[0] };
        },
        renderer(token) {
          return escapeHtml(token.raw);
        },
      },
    ],
    renderer: {
      html({ text }) {
        return escapeHtml(text);
      },
      code({ text, lang }) {
        return lang?.split(/\s/)[0] === "studens-course-map"
          ? ""
          : `<pre${lang === "mermaid" ? ' class="mermaid"' : ""}><code${lang && /^[\w-]+$/.test(lang) ? ` class="language-${lang}"` : ""}>${escapeHtml(text)}</code></pre>`;
      },
    },
  });
  return safeContent(parser.parse(markdown, { async: false }) as string, link);
}

/** Only trusted Temml output is active markup; retain exact source notation for Markdown. */
function mathText(text: string): string {
  const pattern =
    /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$(?![\s$])([^$\n]+?)(?<!\s)\$(?!\d)/g;
  let cursor = 0,
    output = "";
  for (const m of text.matchAll(pattern)) {
    output += escapeHtml(text.slice(cursor, m.index));
    const tex = m[1] ?? m[2] ?? m[3] ?? m[4];
    try {
      output += `<span class="cl-export-math" data-tex="${escapeHtml(m[0])}">${temml.renderToString(tex, { displayMode: m[1] !== undefined || m[2] !== undefined, throwOnError: true })}</span>`;
    } catch {
      output += escapeHtml(m[0]);
    }
    cursor = m.index! + m[0].length;
  }
  return output + escapeHtml(text.slice(cursor));
}

const svgTags = new Set(
  "svg g path rect circle ellipse line polyline polygon text tspan defs marker lineargradient radialgradient stop title desc use".split(
    " ",
  ),
);
const svgAttrs = new Set(
  "viewBox width height x y dx dy rotate textLength lengthAdjust x1 x2 y1 y2 cx cy r rx ry d points fill stroke stroke-width stroke-linecap stroke-linejoin opacity fill-opacity stroke-opacity transform text-anchor font-size font-family id marker-start marker-mid marker-end refX refY markerWidth markerHeight orient offset stop-color stop-opacity xmlns href".split(
    " ",
  ),
);
/** Static SVG primitives only; discard scripts, foreignObject, styles and external references. */
export function staticSvg(node: ContentNode): string {
  if (node.kind === "text") return escapeHtml(node.text);
  if (node.attrs.has("hidden") || node.attrs.get("aria-hidden") === "true") return "";
  if (!svgTags.has(node.tag.toLowerCase())) return "";
  const attrs = [...node.attrs]
    .filter(
      ([name, value]) =>
        svgAttrs.has(name) &&
        (!["href"].includes(name) || /^#[\w.-]+$/.test(value)) &&
        (!/url\s*\(/i.test(value) || /^url\(#[\w.-]+\)$/.test(value)),
    )
    .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
    .join("");
  return `<${node.tag}${attrs}>${node.children.map(staticSvg).join("")}</${node.tag}>`;
}
export function svgMedia(source: string): string {
  const tree = contentTree(source);
  const find = (n: ContentNode): ContentNode | undefined =>
    n.tag === "svg" ? n : n.children.map(find).find(Boolean);
  const svg = find(tree);
  if (!svg) throw new Error("Public SVG media has no SVG document.");
  return staticSvg(svg);
}

/** Translate key identities through the same original public question labels as the lesson UI. */
export function expectedReading(
  html: string,
  quizId: string,
  questionId: string,
  answer: Extract<import("./expected-answers.ts").ExpectedAnswer, { status: "available" }>,
): { prompt: string; expected: string } {
  const descendants = (node: ContentNode): ContentNode[] => [
    node,
    ...node.children.flatMap(descendants),
  ];
  const forms = descendants(contentTree(html)).filter(
    (n) => n.tag === "form" && n.attrs.get("data-quiz-id") === quizId,
  );
  const questions = forms
    .flatMap(descendants)
    .filter(
      (n) =>
        (n.attrs.get("class") ?? "").split(/\s+/).includes("cl-q") &&
        n.attrs.get("data-question-id") === questionId,
    );
  if (forms.length !== 1 || questions.length !== 1)
    throw new Error(
      "Cannot export expected answer: original public question identity is unavailable. Restore the original lesson and retry explicitly.",
    );
  const question = questions[0],
    nodes = descendants(question),
    classes = (n: ContentNode, c: string) => (n.attrs.get("class") ?? "").split(/\s+/).includes(c);
  const visibleText = (n: ContentNode): string => {
    if (n.kind === "text") return n.text;
    if (dropped.has(n.tag) || n.attrs.has("hidden") || n.attrs.get("aria-hidden") === "true")
      return "";
    if (n.tag === "svg") return nodeText(contentTree(staticSvg(n)));
    return n.children.map(visibleText).join("");
  };
  const label = (list: string, attribute: string, id: string): string => {
    const matches =
      list === "option"
        ? nodes.filter(
            (n) =>
              n.tag === "label" &&
              descendants(n).some((c) => c.tag === "input" && c.attrs.get("value") === id),
          )
        : list === "segment"
          ? nodes.filter((n) => n.attrs.get(attribute) === id)
          : nodes
              .filter((n) => classes(n, list))
              .flatMap((n) => n.children)
              .filter((n) => n.tag === "li" && n.attrs.get(attribute) === id);
    if (matches.length !== 1 || !visibleText(matches[0]).trim())
      throw new Error(
        "Cannot export expected answer: an original answer label is missing or ambiguous. Restore the original lesson and retry explicitly.",
      );
    return visibleText(matches[0]).trim();
  };
  const key = answer.expected;
  let expected: string;
  if (typeof key === "string")
    expected = answer.type === "choice" ? label("option", "value", key) : key;
  else if (Array.isArray(key)) {
    expected =
      answer.type === "multi"
        ? key.map((k) => label("option", "value", k)).join("; ")
        : answer.type === "order"
          ? key.map((k, i) => `${i + 1}. ${label("cl-order", "data-item", k)}`).join("\n")
          : answer.type === "locate"
            ? key.map((k) => label("segment", "data-segment", k)).join("; ")
            : key.join(" or ");
  } else if (answer.type === "numeric")
    expected = `${key.value}${key.unit ? ` ${key.unit}` : ""} (tolerance: ±${key.tolerance ?? 0})`;
  else if (answer.type === "match")
    expected = Object.entries(key)
      .map(
        ([left, right]) =>
          `${label("cl-match-left", "data-item", left)} → ${label("cl-match-right", "data-item", String(right))}`,
      )
      .join("\n");
  else
    expected = Object.entries(key)
      .map(
        ([blank, values]) =>
          `Blank ${blank}: ${Array.isArray(values) ? values.join(" or ") : values}`,
      )
      .join("\n");
  return {
    prompt: visibleText(nodes.find((n) => classes(n, "cl-q-prompt")) ?? question).trim(),
    expected,
  };
}
