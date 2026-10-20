import { expect, it } from "vitest";
import {
  missionSummary,
  parseMissionCoursePlan,
  renderMission,
  validateMissionConnections,
} from "../src/mission-map.ts";
import type { MissionCoursePlan } from "../src/mission-map.ts";
import { makeFixture } from "./helpers.ts";
import { seedCourse } from "./course-map-fixture.ts";
import { readCourseMap } from "../src/store/course-map.ts";
import { documentPage } from "../src/pages.ts";
import { readClassroom } from "../src/store.ts";
import { renderMarkdown } from "../src/markdown.ts";

const block = (plan: unknown) =>
  "# Mission\n\n## Why\n\nBuild something.\n\n```studens-course-map\n" +
  JSON.stringify(plan) +
  "\n```\n";
const plan = (): MissionCoursePlan => ({
  version: 1,
  upcoming: [{ id: "safe-cli", statement: "Design a safe CLI." }],
  connections: [
    { from: "@upcoming/safe-cli", to: "001-values/@objective/ownership", kind: "builds-on" },
  ],
});

it("round-trips explicit intentions; legacy prose has no inferred goals or links", () => {
  expect(parseMissionCoursePlan(block(plan()))).toEqual(plan());
  expect(parseMissionCoursePlan("Ship a CLI by October.\n- Borrowing next.")).toBeNull();
  expect(() =>
    validateMissionConnections(plan(), new Set(["001-values/@objective/ownership"])),
  ).not.toThrow();
});

it.each([
  [{ ...plan(), version: 2 }, "version 1"],
  [{ ...plan(), extra: "private" }, "unknown field"],
  [{ ...plan(), upcoming: [{ id: "safe-cli", statement: "" }] }, "nonempty statement"],
  [{ ...plan(), upcoming: [{ id: "bad/id", statement: "Bad" }] }, "valid id"],
  [{ ...plan(), upcoming: [...plan().upcoming, ...plan().upcoming] }, "duplicates an id"],
  [
    { ...plan(), connections: [...plan().connections, ...plan().connections] },
    "duplicates a connection",
  ],
  [
    {
      ...plan(),
      connections: [{ from: "@upcoming/safe-cli", to: "@upcoming/safe-cli", kind: "related" }],
    },
    "itself",
  ],
  [
    {
      ...plan(),
      connections: [
        { from: "@upcoming/safe-cli", to: "../elsewhere/@objective/key", kind: "related" },
      ],
    },
    "valid objective references",
  ],
  [
    {
      ...plan(),
      connections: [{ from: "@upcoming/safe-cli", to: "001-values/check-1/q1", kind: "related" }],
    },
    "valid objective references",
  ],
  [
    { ...plan(), connections: [{ ...plan().connections[0], kind: "guessed" }] },
    "builds-on or related",
  ],
])("rejects malformed intentions without guessing or ignoring fields", (value, problem) => {
  expect(() => parseMissionCoursePlan(block(value))).toThrow(String(problem));
});

it("rejects malformed JSON, duplicate blocks and unclosed fences without exposing JSON snippets", () => {
  expect(() => parseMissionCoursePlan("```studens-course-map\n{PRIVATE_FRAGMENT\n```")).toThrow(
    "invalid JSON",
  );
  expect(() => parseMissionCoursePlan(block(plan()) + block(plan()))).toThrow("at most one");
  expect(() => parseMissionCoursePlan("```studens-course-map\n" + JSON.stringify(plan()))).toThrow(
    "closing fence",
  );
});

it("rejects stale targets, reversed related duplicates and prerequisite cycles", () => {
  const p = plan();
  expect(() => validateMissionConnections(p, new Set())).toThrow("unknown or unpublished");
  p.connections.push({
    from: "001-values/@objective/ownership",
    to: "@upcoming/safe-cli",
    kind: "builds-on",
  });
  expect(() => validateMissionConnections(p, new Set(["001-values/@objective/ownership"]))).toThrow(
    "cycle",
  );
  p.connections = p.connections.map((edge) => ({ ...edge, kind: "related" }));
  expect(() => parseMissionCoursePlan(block(p))).toThrow("duplicates a connection");
});

it("projects explicit links and future goals but omits complete connections to gated objectives", () => {
  const f = makeFixture();
  try {
    seedCourse(f);
    const p = plan();
    p.connections.push({
      from: "002-borrow/@objective/ownership",
      to: "@upcoming/safe-cli",
      kind: "related",
    });
    f.write("course/MISSION.md", block(p));
    const map = readCourseMap("course")!;
    expect(map.upcoming).toEqual([{ key: "@upcoming/safe-cli", statement: "Design a safe CLI." }]);
    expect(map.connections).toEqual([p.connections[0]]);
    expect(JSON.stringify(map)).not.toContain("002-borrow/@objective");
    expect(map.missionHtml).toContain("<h3>Mission</h3>");
    expect(map.missionHtml).not.toMatch(/studens-course-map|connections|safe-cli|002-borrow/);
    const document = documentPage(readClassroom("course")!, "MISSION.md", block(p));
    expect(document).not.toMatch(/studens-course-map|002-borrow|builds-on/);
    p.connections[0].to = "004-legacy/@objective/missing";
    f.write("course/MISSION.md", block(p));
    expect(() => readCourseMap("course")).toThrow(
      "Connection 1 names an unknown or unpublished objective",
    );
  } finally {
    f.cleanup();
  }
});

it("renders readable mission headings, lists and safe links without executable HTML, images or metadata", () => {
  const html = renderMission(
    "# Goal\n\n- A goal\n- [Read lesson](/c/course/001-values)\n\n<script>window.leak=true</script>\n\n[bad](javascript:alert(1))\n\n![remote](https://example.invalid/track.png)\n\n" +
      block(plan()),
  );
  expect(html).toContain("<h1>Goal</h1>");
  expect(html).toContain("<ul>");
  expect(html).toContain('href="/c/course/001-values"');
  expect(html).not.toMatch(/<script|href="javascript:|<img|studens-course-map|builds-on/);
});

it.each([
  ["```", "Learn Rust.\n", ""],
  ["~~~", "Learn Rust.\n", ""],
  ["````", "Learn Rust.\n", ""],
  ["~~~~", "Learn Rust.\n", ""],
  ["```", "", ""],
  ["~~~", "", ""],
  ["```", "Learn **Rust**.\n", "   "],
])("keeps adjacent or empty Why summaries free of course metadata (%s)", (fence, why, indent) => {
  const payload = JSON.stringify(
    {
      ...plan(),
      connections: [
        {
          from: "@upcoming/safe-cli",
          to: "002-borrow/@objective/HIDDEN_OWNERSHIP_RULE",
          kind: "related",
        },
      ],
    },
    null,
    2,
  );
  const mission =
    "# Mission\n\n## Why\n\n" +
    why +
    indent +
    fence +
    "studens-course-map\n" +
    payload +
    "\n" +
    indent +
    fence +
    "\n";
  expect(parseMissionCoursePlan(mission)).not.toBeNull();
  const summary = missionSummary(mission);
  expect(summary).toBe(why ? "Learn Rust." : null);
  expect(summary ?? "").not.toMatch(/HIDDEN_|@objective|connections|studens-course-map/);
});

it("handles wrapped metadata, CRLF and supported nested Markdown without leaking into summaries", () => {
  const payload = JSON.stringify(
    {
      ...plan(),
      upcoming: [{ id: "long", statement: "PRIVATE_FUTURE ".repeat(100) }],
      connections: [],
    },
    null,
    2,
  );
  for (const code of [
    "~~~studens-course-map\n" + payload + "\n~~~",
    ("```studens-course-map\n" + payload + "\n```")
      .split("\n")
      .map((line) => "> " + line)
      .join("\n"),
    ("```studens-course-map\n" + payload + "\n```")
      .split("\n")
      .map((line, index) => (index ? "  " + line : "- " + line))
      .join("\n"),
  ]) {
    const mission = ("## Why ###\n\n" + code + "\n\nReadable legacy prose.\n").replace(
      /\n/g,
      "\r\n",
    );
    expect(parseMissionCoursePlan(mission)).not.toBeNull();
    expect(missionSummary(mission)).toBe("Readable legacy prose.");
  }
});

it("preserves canonical inline, display and invalid-formula rendering with private metadata redacted", () => {
  const formulas = String.raw`Inline $x^2$ and \(z+1\).

$$y=mx+b$$

Invalid \(\frac{a\).
`;
  const canonical = renderMarkdown(formulas);
  expect(canonical.match(/<math[ >]/g)).toHaveLength(3);
  expect(canonical).toContain('display="block"');
  expect(canonical).toContain("Math did not render");
  const mission = block(plan()) + "\n" + formulas;
  for (const offset of [0, 2]) {
    const rendered = renderMission(mission, offset);
    expect(rendered).toContain(canonical);
    expect(rendered).toContain(`<h${1 + offset}>Mission</h${1 + offset}>`);
    expect(rendered).not.toMatch(/studens-course-map|001-values\/@objective|safe-cli/);
  }
  const f = makeFixture();
  try {
    seedCourse(f);
    f.write("course/MISSION.md", mission);
    expect(readCourseMap("course")!.missionHtml).toContain(canonical);
    expect(documentPage(readClassroom("course")!, "MISSION.md", mission)).toContain(canonical);
  } finally {
    f.cleanup();
  }
});
