import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { makeFixture, seedClassroom, lessonHtml, writeGradedAttempt } from "./helpers.ts";
import type { Fixture } from "./helpers.ts";
import { searchClassrooms, searchGlossarySource } from "../src/store/search.ts";
import { searchPassages } from "../src/search-passages.ts";
import { saveLessonRequests } from "../src/store/lesson-requests.ts";

let f: Fixture;
beforeEach(() => {
  f = makeFixture();
  seedClassroom(f);
  seedClassroom(f, { classroom: "math", title: "Mathematics" });
});
afterEach(() => f.cleanup());
function publicSources() {
  f.write(
    "rust/001-ownership/lesson.html",
    lessonHtml(
      "Ownership",
      '<p>Borrow checker uses café λ Vec&lt;T&gt;.</p><p>Borrow checker repeated.</p><p>Borrow checker repeated.</p><script>globalThis.SCRIPT_CANARY = "do not index";</script><style>STYLE_CANARY{}</style><p data-x="ATTR_CANARY">Visible.</p><button>BUTTON_CANARY</button>',
    ),
  );
  f.write(
    "math/001-ownership/lesson.html",
    lessonHtml("Vectors", "<p>Borrow checker analogy for λ.</p>"),
  );
  f.write("rust/GLOSSARY.md", "**Borrow checker**:\nValidates café λ references.\n");
  f.write(
    "rust/learning-records/0001-borrow.md",
    "# Borrow checker reflection\n\nI reasoned about λ and Vec<T>.\n",
  );
  const id = randomUUID();
  f.write(
    "rust/001-ownership/annotations.json",
    JSON.stringify([
      {
        id,
        classroom: "rust",
        lesson: "001-ownership",
        status: "answered",
        question: "Why does the borrow checker reject café?",
        selection: "Borrow checker",
        anchor: { exact: "Borrow checker", prefix: "", suffix: "", occurrence: 0 },
        answerMarkdown: "The borrow checker keeps references valid.",
        answerHtml: "PRIVATE_UNUSED_HTML",
        createdAt: 1,
        answeredAt: 2,
        private: "PRIVATE_UNUSED_FIELD",
        followUps: [
          {
            id: randomUUID(),
            status: "answered",
            question: "And λ?",
            answerMarkdown: "Borrow checker again.",
            answerHtml: null,
            askedAt: 3,
            answeredAt: 4,
          },
        ],
      },
    ]),
  );
  return id;
}
describe("public classroom search", () => {
  it("searches all four domains and classrooms with canonical repeat anchors", () => {
    const id = publicSources(),
      r = searchClassrooms("Borrow checker");
    expect(r.counts).toEqual({
      Lesson: 4,
      "Question thread": 1,
      "Glossary term": 1,
      "Learning record": 1,
    });
    expect(r.results.some((x) => x.classroom === "Mathematics")).toBe(true);
    expect(r.results.find((x) => x.kind === "Question thread")?.url).toContain(
      `#cl-question-${id}`,
    );
    const repeats = r.results.filter((x) => x.text === "Borrow checker repeated.");
    expect(new Set(repeats.map((x) => x.url)).size).toBe(2);
    expect(searchClassrooms("café").total).toBeGreaterThan(0);
    expect(searchClassrooms("Vec<T>").total).toBe(1);
    expect(searchClassrooms("λ").counts["Question thread"]).toBe(1);
  });
  it("never reads private text or runtime/attribute content, even for exact secret queries", () => {
    publicSources();
    for (const relative of [
      "quiz/key.json",
      "quiz/plan.json",
      "quiz/privatevariants.json",
      "drafts.json",
      "teacher-messages.json",
      "quiz/submissions/raw.json",
    ]) {
      f.write(`rust/001-ownership/${relative}`, "PRIVATE_CANARY");
    }
    f.write("rust/.teacher.json", "PRIVATE_CANARY");
    for (const q of [
      "PRIVATE_CANARY",
      "SCRIPT_CANARY",
      "STYLE_CANARY",
      "ATTR_CANARY",
      "BUTTON_CANARY",
      "PRIVATE_UNUSED_HTML",
      "PRIVATE_UNUSED_FIELD",
    ])
      expect(searchClassrooms(q).total).toBe(0);
  });
  it("withholds gated lessons and their cards then uses the actual saved pretest projection", () => {
    publicSources();
    f.write(
      "rust/001-ownership/lesson.html",
      lessonHtml(
        "Gate",
        '<form class="cl-quiz" data-quiz-id="predict" data-kind="pretest"><p>Predict first.</p></form><template data-cl-after-pretest="predict"><p>GATED_CANARY</p></template>',
      ),
    );
    expect(searchClassrooms("GATED_CANARY").total).toBe(0);
    expect(searchClassrooms("café").counts["Question thread"]).toBe(0);
    writeGradedAttempt({ at: 1, kind: "pretest", quizId: "predict", answers: [], correct: {} });
    expect(searchClassrooms("GATED_CANARY").total).toBe(1);
  });
  it("withholds unfinished publications and their metadata", () => {
    publicSources();
    saveLessonRequests("rust", [
      {
        id: randomUUID(),
        classroom: "rust",
        lesson: "001-ownership",
        owner: "pi",
        ownerPid: process.pid,
        at: 1,
        topic: "PRIVATE_CANARY",
        status: "failed",
        document: {
          title: "PRIVATE_CANARY",
          summary: "PRIVATE_CANARY",
          lesson_html: "PRIVATE_CANARY",
          rubric_json: "PRIVATE_CANARY",
          teaching_plan_json: "PRIVATE_CANARY",
        },
      },
    ]);
    const r = searchClassrooms("Borrow checker");
    expect(
      r.results.filter((x) => x.kind === "Lesson").every((x) => x.classroom === "Mathematics"),
    ).toBe(true);
    expect(r.counts["Question thread"]).toBe(0);
    expect(searchClassrooms("PRIVATE_CANARY").total).toBe(0);
  });
  it("fails specifically without echoing malformed bytes", () => {
    publicSources();
    for (const [file, bytes, detail] of [
      ["rust/001-ownership/annotations.json", "{PRIVATE_CANARY", "invalid question thread"],
      ["rust/GLOSSARY.md", "**PRIVATE_CANARY**\nMissing colon.", "invalid glossary format"],
      ["rust/learning-records/0001-borrow.md", "<p>PRIVATE_CANARY", "malformed public content"],
    ]) {
      const target = path.join(f.root, file),
        original = fs.readFileSync(target);
      f.write(file, bytes);
      expect(() => searchClassrooms("Borrow")).toThrow(detail);
      try {
        searchClassrooms("Borrow");
      } catch (e) {
        expect(String(e)).not.toContain("PRIVATE_CANARY");
      }
      fs.writeFileSync(target, original);
    }
  });
  it("guards symlink files and ancestors and rejects traversal source navigation", () => {
    publicSources();
    const secret = f.write("rust/001-ownership/quiz/key.json", "PRIVATE_CANARY");
    fs.symlinkSync(secret, path.join(f.root, "rust/learning-records/leak.md"));
    expect(() => searchClassrooms("PRIVATE_CANARY")).toThrow(/symlink/);
    expect(searchGlossarySource("../rust", "Borrow checker")).toBeNull();
  });
  it("uses accepted rendered glossary content without indexing Markdown link attributes or scripts", () => {
    f.write(
      "rust/GLOSSARY.md",
      "**Safe term**:\nA [public label](https://example.com/ATTRIBUTE_CANARY) <script>SCRIPT_CANARY</script> café.\n",
    );
    expect(searchClassrooms("ATTRIBUTE_CANARY").total).toBe(0);
    expect(searchClassrooms("SCRIPT_CANARY").total).toBe(0);
    expect(searchClassrooms("public label").counts["Glossary term"]).toBe(1);
    expect(searchGlossarySource("rust", "Safe term")).not.toContain("<script>");
  });
  it("refuses unsupported public lesson contract versions", () => {
    publicSources();
    for (const contract of [
      "instructionalContract",
      "assessmentContract",
      "criterionContract",
      "reviewVariantContract",
    ]) {
      f.write(
        "rust/001-ownership/lesson.json",
        JSON.stringify({ title: "Ownership", [contract]: 99 }),
      );
      expect(() => searchClassrooms("Borrow checker")).toThrow(
        "unsupported lesson contract version",
      );
    }
  });
  it("keeps empty queries empty, literal punctuation, deterministic complete pagination", () => {
    publicSources();
    expect(searchClassrooms("   ").total).toBe(0);
    expect(searchClassrooms(".*").total).toBe(0);
    expect(searchClassrooms("NO_MATCH").total).toBe(0);
    f.write(
      "math/learning-records/many.md",
      Array.from({ length: 90 }, (_, i) => `Paragraph ${i} with pagination needle.\n\n`).join(""),
    );
    const all = [1, 2, 3].map((p) => searchClassrooms("pagination needle", p));
    expect(all.map((r) => r.results.length)).toEqual([40, 40, 10]);
    expect(new Set(all.flatMap((r) => r.results.map((x) => x.url))).size).toBe(90);
    expect(searchClassrooms("pagination needle", 999).page).toBe(3);
    expect(() => searchClassrooms("x".repeat(201))).toThrow("200");
  });
});
describe("inert canonical source anchors", () => {
  it("excludes scripts even with fake tags and preserves inline punctuation", () => {
    const html =
      '<p>Before<script>"</p><p>SECRET"</script> after <code>Vec&lt;T&gt;</code> &#955;.</p>';
    expect(searchPassages(html).passages.map((x) => x.text)).toEqual(["Before after Vec<T> λ."]);
  });
  it("indexes mixed direct prose but excludes dynamic expected answers and runtime controls", () => {
    const p = searchPassages(
      '<main>Direct café.<p>Nested λ.</p>After code.<div class="cl-expected"><p>PRIVATE_EXPECTED_CANARY</p></div><p title=" hidden ">Visible title attributes.</p></main>',
    ).passages;
    expect(p.map((p) => p.text)).toEqual([
      "Direct café.",
      "Nested λ.",
      "After code.",
      "Visible title attributes.",
    ]);
  });
  it("invalidates repeated-text links after same-count context changes", () => {
    const a = searchPassages(
      "<p>First context.</p><p>Repeat.</p><p>Other context.</p><p>Repeat.</p>",
    );
    const b = searchPassages(
      "<p>Other context.</p><p>Repeat.</p><p>First context.</p><p>Repeat.</p>",
    );
    expect(
      a.passages
        .filter((p) => p.text === "Repeat.")
        .some((p) => b.passages.some((q) => q.id === p.id)),
    ).toBe(false);
  });
  it("rejects malformed attributes instead of indexing their bytes as prose", () => {
    expect(() => searchPassages('<p title="ATTRIBUTE_CANARY>Visible.</p>')).toThrow(
      "Malformed content tag or attribute",
    );
    expect(() => searchPassages("<!-- ATTRIBUTE_CANARY")).toThrow(
      "Malformed content tag or attribute",
    );
  });
  it("keeps trailing direct prose after its preceding nested passage", () => {
    const result = searchPassages("<main><p>First.</p>Tail.</main>");
    expect(result.passages.map((p) => p.text)).toEqual(["First.", "Tail."]);
  });
  it("places anchors on existing text blocks without changing their children", () => {
    const result = searchPassages("<p data-math-prose>A move costs \\(O(1)\\) time.</p>");
    expect(result.html).toContain('data-math-prose id="cl-search-');
    expect(result.html).not.toContain("<span");
  });
  it("is idempotent and keeps unique passage identity after unrelated source edits", () => {
    const a = searchPassages("<p>Unique.</p><p>Other.</p>");
    expect(searchPassages(a.html)).toEqual(a);
    expect(searchPassages("<p>Unrelated.</p><p>Unique.</p>").passages[1].id).toBe(a.passages[0].id);
  });
  it("invalidates ambiguous duplicate links after removal rather than jumping to another occurrence", () => {
    const a = searchPassages("<p>Repeat.</p><p>Repeat.</p>"),
      b = searchPassages("<p>Repeat.</p>");
    expect(a.passages.some((p) => p.id === b.passages[0].id)).toBe(false);
  });
});
