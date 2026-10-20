import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { makeFixture } from "./helpers.ts";
import {
  seedExport,
  exportSvg,
  inlineSvgLabel,
  mediaSvgLabel,
  nestedSvgLabel,
} from "./export-fixture.ts";
import { projectClassroom, exportMarkdown, exportPrint } from "../src/classroom-export.ts";
import { exportAnki } from "../src/export-anki.ts";
import {
  portableMarkdown,
  safeContent,
  expectedReading,
  contentTree,
  nodeText,
  svgMedia,
} from "../src/export-content.ts";
import * as server from "../src/server.ts";
import { Marked } from "marked";
import type { ContentNode } from "../src/export-content.ts";
let f: ReturnType<typeof makeFixture>;
beforeEach(() => {
  f = makeFixture();
  seedExport(f);
});
afterEach(async () => {
  await server.close();
  f.cleanup();
});
const publicOnly = (bytes: string) => {
  expect(bytes).not.toMatch(/PRIVATE_|GATED_|UNLOCKED_EXPECTED|studens-course-map/);
};
it("exports saved public content and media without private or unreleased bytes or writes", () => {
  const before = fs.readdirSync(f.root, { recursive: true }).map((p) => {
    const file = path.join(f.root, String(p));
    return fs.statSync(file).isFile() ? fs.readFileSync(file).toString("hex") : p;
  });
  const data = projectClassroom("rust")!;
  publicOnly(JSON.stringify(data));
  const md = exportMarkdown(data),
    html = exportPrint(data);
  publicOnly(md);
  publicOnly(html);
  publicOnly(exportAnki(data).toString("utf8"));
  for (const text of [
    "日本語",
    "public reply",
    "Move and release",
    "const text",
    "flowchart LR",
    "First saved item",
    "Second saved item",
    "Actual saved evidence",
  ]) {
    expect(md).toContain(text);
  }
  expect(data.media).toHaveLength(2);
  expect(md).toContain("data:image/png;base64,");
  expect(md).toContain("\\(x^2\\)");
  expect(html).toContain("<math");
  expect(html).not.toContain("<form");
  expect(md).not.toContain("quiz/key.json");
  expect(
    fs.readdirSync(f.root, { recursive: true }).map((p) => {
      const file = path.join(f.root, String(p));
      return fs.statSync(file).isFile() ? fs.readFileSync(file).toString("hex") : p;
    }),
  ).toEqual(before);
});
it("uses the original expected-answer gate only after deliberate selection", () => {
  expect(JSON.stringify(projectClassroom("rust", false))).not.toContain("UNLOCKED_EXPECTED");
  const data = projectClassroom("rust", true)!;
  expect(JSON.stringify(data)).toContain("UNLOCKED_EXPECTED");
  expect(JSON.stringify(data)).not.toMatch(/PRIVATE_|GATED_/);
});
it("fails closed on changed answer source and malformed publication/history without quoting bytes", () => {
  f.write("rust/001-ownership/quiz/key.json", "{PRIVATE_CORRUPT_KEY");
  expect(() => projectClassroom("rust", true)).toThrow("private rubric changed");
  expect(() => projectClassroom("rust", false)).not.toThrow();
  f.write("rust/.lesson-requests.json", "{PRIVATE_ERROR_CANARY");
  try {
    projectClassroom("rust");
    throw new Error("Expected error");
  } catch (e) {
    expect(String(e)).toContain("publication state");
    expect(String(e)).not.toContain("CANARY");
  }
});
it("guards public symlinks, media traversal, and classroom ancestors", () => {
  const file = path.join(f.root, "rust/001-ownership/media/leak.png");
  fs.symlinkSync(path.join(f.root, "rust/001-ownership/quiz/key.png"), file);
  fs.appendFileSync(
    path.join(f.root, "rust/001-ownership/lesson.html"),
    '<img src="media/leak.png" alt="blocked"><img src="media/../quiz/key.png" alt="blocked"><img src="/c/rust/001-ownership/media/%2e%2e/quiz/key.png" alt="blocked">',
  );
  publicOnly(JSON.stringify(projectClassroom("rust")));
  expect(projectClassroom("rust")!.media).toHaveLength(2);
  fs.symlinkSync(
    path.join(f.root, "rust/001-ownership/quiz/key.json"),
    path.join(f.root, "rust/notes/leak.md"),
  );
  expect(() => projectClassroom("rust")).toThrow("symlinks");
});
it("keeps unchanged note identities across title edits and ignores added private properties", () => {
  const first = projectClassroom("rust")!;
  f.write(
    "rust/001-ownership/lesson.json",
    JSON.stringify({ title: "Changed public title", private: "PRIVATE_METADATA" }),
  );
  const second = projectClassroom("rust")!;
  expect(second.parts.map((p) => p.identity)).toEqual(first.parts.map((p) => p.identity));
  publicOnly(JSON.stringify(second));
});
it("reconstructs inert markup and Markdown with code, optional list endings and unsafe links", () => {
  const html = safeContent(
    '<p onclick="bad()">Read <strong>this</strong><ul><li>one<li>two</ul><script>PRIVATE_SCRIPT</script><img src="javascript:bad" alt="missing"><a href="javascript:bad">safe label</a><pre><code>one\n\nthree `ticks`</code></pre>',
    (v) => (v.startsWith("javascript:") ? null : v),
  );
  expect(html).not.toMatch(/onclick|PRIVATE_|javascript:/);
  const md = portableMarkdown(html);
  expect(md).toContain("- one\n- two");
  expect(md).toContain("one\n\nthree `ticks`");
  expect(md).toContain("**this**");
});
it("keeps public option boundaries while preserving inline reading and dropping source attributes", () => {
  const inline = "<p>Read <em>this</em><strong>now</strong>, <code>a+b</code>! café λ.</p>";
  const label = (type: string, text: string) =>
    `<label class="PRIVATE_CLASS" onclick="bad()"><span><input type="${type}" value="PRIVATE_KEY"></span>${text}</label>`;
  for (const type of ["radio", "checkbox"]) {
    const html = safeContent(
      inline + label(type, "New <em>owner</em> — café λ") + label(type, "Old binding"),
      () => null,
    );
    expect(html).toBe(
      inline +
        "<div><span></span>New <em>owner</em> — café λ</div><div><span></span>Old binding</div>",
    );
    const md = portableMarkdown(html);
    expect(md.startsWith(portableMarkdown(inline))).toBe(true);
    expect(md).toMatch(/New \*owner\* — café λ\n\s*\nOld binding/);
    expect(html).not.toMatch(/label|input|PRIVATE|onclick/);
  }
  // Ordinary labels and inline neighbors are not option blocks.
  expect(safeContent("a<label><em>b</em></label><code>c</code>d", () => null)).toBe(
    "a<em>b</em><code>c</code>d",
  );
  // The standard template already puts labels in list items; retain that structure.
  const listed = safeContent(
    `<ul><li>${label("radio", "One")}</li><li>${label("radio", "Two")}</li></ul>`,
    () => null,
  );
  expect(nodeText(contentTree(listed))).toBe("OneTwo");
  expect(portableMarkdown(listed)).toBe("- One\n- Two\n");
});
it("round-trips question ownership, continuation blocks and nested lists through Markdown", () => {
  const source = `<ol>${Array.from(
    { length: 12 },
    (_, i) =>
      `<li><p>Question ${i + 1} — <em>café</em> <code>a+b</code>?</p><div>First [resource]</div><div>Second *resource*</div>${
        i === 0
          ? "<ul><li><p>Nested lead</p><ol><li>Deep A</li><li>Deep B</li></ol></li></ul>"
          : i === 1
            ? "<ol><li>Left A</li><li>Left B</li></ol>\n<ol><li>Right A</li><li>Right B</li></ol>"
            : i === 9
              ? "<p>Another <strong>paragraph</strong>.</p><pre><code>  alpha &lt;beta&gt;\n\n\nomega `ticks`</code></pre><table><tr><td>A<br>B</td><td>λ &amp; café</td></tr></table>"
              : ""
      }</li>`,
  ).join("")}</ol>`;
  // Parse the portable Markdown as CommonMark/GFM, without lesson-specific TeX extensions.
  const tree = contentTree(
    new Marked({ gfm: true }).parse(portableMarkdown(safeContent(source, () => null)), {
      async: false,
    }) as string,
  );
  const all = (n: ContentNode): ContentNode[] => [n, ...n.children.flatMap(all)];
  const lists = all(tree).filter((n) => n.tag === "ol" || n.tag === "ul");
  const questions = lists[0].children.filter((n) => n.tag === "li");
  expect(questions).toHaveLength(12);
  for (const [i, question] of questions.entries()) {
    const paragraphs = question.children.filter((n) => n.tag === "p");
    expect(paragraphs.slice(0, 3).map(nodeText)).toEqual([
      `Question ${i + 1} — café a+b?`,
      "First [resource]",
      "Second *resource*",
    ]);
    expect(
      all(paragraphs[0])
        .find((n) => n.tag === "em")!
        .children.map(nodeText)
        .join(""),
    ).toBe("café");
    expect(
      all(paragraphs[0])
        .find((n) => n.tag === "code")!
        .children.map(nodeText)
        .join(""),
    ).toBe("a+b");
    expect(nodeText(question)).not.toMatch(new RegExp(`Question (?!${i + 1} —)\\d+`));
  }
  const nested = questions[0].children.find((n) => n.tag === "ul")!;
  expect(
    all(nested)
      .filter((n) => n.tag === "ol")
      .map((n) => n.children.filter((c) => c.tag === "li").map(nodeText)),
  ).toEqual([["Deep A", "Deep B"]]);
  expect(
    questions[1].children
      .filter((n) => n.tag === "ol")
      .map((n) => n.children.filter((c) => c.tag === "li").map(nodeText)),
  ).toEqual([
    ["Left A", "Left B"],
    ["Right A", "Right B"],
  ]);
  expect(questions[9].children.filter((n) => n.tag === "p").map(nodeText)).toContain(
    "Another paragraph.",
  );
  expect(nodeText(all(questions[9]).find((n) => n.tag === "pre")!)).toContain(
    "  alpha <beta>\n\n\nomega `ticks`",
  );
  expect(
    all(questions[9])
      .filter((n) => n.tag === "td")
      .map(nodeText),
  ).toEqual(["AB", "λ & café"]);
});
it("serves separate downloads and rejects invalid/private requests without teacher calls", async () => {
  let calls = 0;
  server.setHooks({
    onAsk() {
      calls++;
    },
    onFollowUp() {
      calls++;
    },
    onQuizSubmit() {
      calls++;
    },
    onReflect() {
      calls++;
    },
  });
  const base = await server.start(0);
  for (const format of ["markdown", "print", "anki"]) {
    const r = await fetch(base + `/api/export?classroom=rust&format=${format}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    if (format === "markdown") {
      const text = await r.clone().text();
      expect(text).toContain(base + "/c/rust/001-ownership");
    }
    const bytes = Buffer.from(await r.arrayBuffer());
    publicOnly(bytes.toString("utf8"));
    if (format === "anki") expect(bytes.subarray(0, 2).toString()).toBe("PK");
  }
  for (const query of [
    "classroom=../rust&format=anki",
    "classroom=rust&format=key.json",
    "classroom=rust&format=anki&answers=all",
    "classroom=rust&format=anki&path=quiz/key.json",
  ]) {
    expect((await fetch(base + "/api/export?" + query)).status).toBe(400);
  }
  expect((await fetch(base + "/api/export?classroom=missing&format=anki")).status).toBe(404);
  expect(calls).toBe(0);
});

it("preserves HTML5 entities, static SVG, tables and exact code line breaks", () => {
  const html = safeContent(
    '<p>&copy; &mdash; &eacute;<svg viewBox="0 0 20 20"><script>PRIVATE_SVG</script><rect width="10" height="10" fill="red"/><text x="0" y="15">λ</text></svg><table><tr><td>one<td>two</table><pre><code>one\n\n\nthree</code></pre>',
    () => null,
  );
  expect(html).toContain("© — é");
  expect(html).toContain('viewBox="0 0 20 20"');
  expect(html).toContain('<rect width="10" height="10" fill="red"></rect>');
  expect(html).toContain('<text x="0" y="15">λ</text>');
  expect(html).not.toContain("PRIVATE_");
  expect(
    safeContent(
      '<textarea hidden class="cl-code-source">PRIVATE_HIDDEN_CODE</textarea><span hidden class="cl-export-math" data-tex="PRIVATE_HIDDEN_MATH">hidden</span>',
      () => null,
    ),
  ).not.toContain("PRIVATE_");
  const md = portableMarkdown(html);
  expect(md).toContain("one\n\n\nthree");
  expect(md).toContain("<table>");
});

it("exports canonical legacy lesson filenames through their guarded public route", () => {
  f.write(
    "rust/004-legacy/lesson-04.html",
    "<html><head><title>Legacy</title></head><body><h1>Legacy page</h1><p>Saved legacy prose.</p></body></html>",
  );
  expect(exportMarkdown(projectClassroom("rust")!)).toContain("Saved legacy prose");
});
it("uses readable original choice, order, match and numeric labels", () => {
  const html =
    '<form data-quiz-id="quiz"><li class="cl-q" data-question-id="q"><p class="cl-q-prompt">Choose the owner</p><label><input type="radio" value="a">New owner</label><label><input type="radio" value="b">Old binding</label><ol class="cl-order"><li data-item="a">Allocate</li><li data-item="b">Release</li></ol><ol class="cl-match-left"><li data-item="l">Resource</li></ol><ol class="cl-match-right"><li data-item="r">Owner</li></ol></li></form>';
  const answer = {
    status: "available" as const,
    type: "choice",
    expected: "a",
    full: "Saved explanation",
    partial: "Saved partial",
    points: 1,
  };
  expect(expectedReading(html, "quiz", "q", answer)).toEqual({
    prompt: "Choose the owner",
    expected: "New owner",
  });
  expect(
    expectedReading(html, "quiz", "q", { ...answer, type: "order", expected: ["a", "b"] }).expected,
  ).toBe("1. Allocate\n2. Release");
  expect(
    expectedReading(html, "quiz", "q", { ...answer, type: "match", expected: { l: "r" } }).expected,
  ).toBe("Resource → Owner");
  expect(
    expectedReading(html, "quiz", "q", {
      ...answer,
      type: "numeric",
      expected: { value: 6, unit: "N", tolerance: 0.1 },
    }).expected,
  ).toBe("6 N (tolerance: ±0.1)");
  expect(() => expectedReading(html, "quiz", "q", { ...answer, expected: "missing" })).toThrow(
    "original answer label",
  );
});

it("uses checked canonical source links in every format while guarding loopback and canonical aliases", async () => {
  const base = await server.start(0),
    canonical = "https://studens-export.invalid:10028";
  server.setLinkBase(canonical);
  const sourceFile = path.join(f.root, "rust/001-ownership/lesson.html");
  fs.appendFileSync(
    sourceFile,
    `<a href="${base}/doc/rust/NOTES.md">Local public note</a><a href="${canonical}/c/rust/001-ownership/quiz/key.json">Blocked key</a><img src="${base}/c/rust/001-ownership/media/pixel.png" alt="Loopback alias image"><img src="${canonical}/c/rust/001-ownership/media/pixel.png" alt="Canonical alias image">`,
  );
  const canonicalLesson = server.urlFor("rust", "001-ownership")!;
  for (const format of ["markdown", "print", "anki"]) {
    const r = await fetch(base + `/api/export?classroom=rust&format=${format}`, {
      headers: {
        Host: "untrusted-host.invalid",
        "X-Forwarded-Host": "untrusted-forward.invalid",
        "X-Forwarded-Proto": "https",
      },
    });
    expect(r.status).toBe(200);
    const bytes = Buffer.from(await r.arrayBuffer()).toString("utf8");
    expect(bytes).toContain(canonicalLesson);
    expect(bytes).toContain(canonical + "/doc/rust/NOTES.md");
    expect(bytes).not.toContain(base + "/c/rust");
    expect(bytes).not.toMatch(/PRIVATE_|GATED_|untrusted-host|untrusted-forward|quiz\/key.json/);
  }
  const data = projectClassroom("rust", false, canonical, [base])!;
  expect(data.media).toHaveLength(2);
  expect(
    data.parts
      .find((p) => p.identity === "001-ownership/lesson.html")!
      .html.match(/studens-media:/g)?.length,
  ).toBe(5);
  server.setLinkBase(null);
  for (const format of ["markdown", "print", "anki"]) {
    const r = await fetch(base + `/api/export?classroom=rust&format=${format}`),
      body = Buffer.from(await r.arrayBuffer()).toString("utf8");
    expect(r.status).toBe(200);
    expect(body).toContain(base + "/c/rust/001-ownership");
    expect(body).not.toContain("quiz/key.json");
  }
  f.write("rust/.lesson-requests.json", "{PRIVATE_CANONICAL_ERROR");
  server.setLinkBase(canonical);
  const r = await fetch(base + "/api/export?classroom=rust&format=print"),
    body = await r.text();
  expect(r.status).toBe(500);
  expect(body).toContain("Retry export");
  expect(body).not.toContain("PRIVATE_CANONICAL_ERROR");
});

it("keeps Markdown metadata and formula text inert in ordinary Markdown renderers", () => {
  f.write(
    "rust/002-gated/lesson.json",
    JSON.stringify({ title: "Gated\n<script>PRIVATE_TITLE_SCRIPT</script>" }),
  );
  const md = exportMarkdown(projectClassroom("rust")!);
  expect(md).not.toContain("<script>");
  const formula = portableMarkdown(
    safeContent("<p>$\\text{&lt;script&gt;alert(1)&lt;/script&gt;}$</p>", () => null),
  );
  expect(formula).toContain("```math");
});

it("preserves SVG text elements and nested positioned Unicode across every portable converter", () => {
  const svg = exportSvg(inlineSvgLabel);
  const safe = safeContent(svg, () => null);
  for (const output of [safe, portableMarkdown(safe), svgMedia(svg)]) {
    expect(output).toContain(`<text x="20" y="35" font-size="22" fill="black">${inlineSvgLabel}`);
    expect(output).toContain(
      `<tspan x="20" y="70"><tspan dx="8" dy="0">${nestedSvgLabel}</tspan></tspan>`,
    );
    expect(output).not.toMatch(/PRIVATE_|foreignObject|script|onload|https:\/\/invalid/);
  }
  expect(nodeText(contentTree(safe))).toBe(
    "Saved labelled diagram" + inlineSvgLabel + nestedSvgLabel,
  );
  // A public document containing only a text-bearing SVG must not be dropped as empty.
  f.write("rust/reference/only-svg.html", `<svg><text>${inlineSvgLabel}</text></svg>`);
  const data = projectClassroom("rust")!;
  expect(data.parts.find((p) => p.identity === "reference/only-svg.html")?.html).toContain(
    inlineSvgLabel,
  );
  const media = data.media.find((m) => m.type === "image/svg+xml")!;
  expect(media.bytes.toString()).toContain(mediaSvgLabel);
  for (const output of [exportPrint(data), exportMarkdown(data), exportAnki(data).toString()]) {
    expect(output).toContain(inlineSvgLabel);
    publicOnly(output);
  }
  expect(() => svgMedia("<p>no svg</p>")).toThrow("Public SVG media has no SVG document");
});
it("reads original SVG question and answer labels without hidden or active SVG content", () => {
  const html = `<form data-quiz-id="quiz"><li class="cl-q" data-question-id="q"><p class="cl-q-prompt"><svg><text>Choose λ<tspan> 日本語</tspan></text><text hidden>PRIVATE_PROMPT</text></svg></p><label><input value="a"><svg><text>Owner<tspan> café</tspan></text><g aria-hidden="true"><text>PRIVATE_LABEL</text></g><foreignObject><p>PRIVATE_FOREIGN</p></foreignObject><script>PRIVATE_SCRIPT</script></svg></label></li></form>`;
  expect(
    expectedReading(html, "quiz", "q", {
      status: "available",
      type: "choice",
      expected: "a",
      full: "Saved",
      partial: "Saved",
      points: 1,
    }),
  ).toEqual({ prompt: "Choose λ 日本語", expected: "Owner café" });
});
