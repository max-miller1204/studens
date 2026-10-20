import { afterEach, beforeEach, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { readCourseMap } from "../src/store/course-map.ts";
import * as server from "../src/server.ts";
import { makeFixture, termAnswer, writeGradedAttempt } from "./helpers.ts";
import type { Fixture } from "./helpers.ts";
import { seedCourse } from "./course-map-fixture.ts";

let f: Fixture;
beforeEach(() => {
  f = makeFixture();
  seedCourse(f);
});
afterEach(async () => {
  await server.close();
  f.cleanup();
});

function hashes(dir: string): Record<string, string> {
  return Object.fromEntries(
    fs
      .readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => {
        const file = path.join(e.parentPath, e.name);
        return [
          path.relative(dir, file),
          createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
        ];
      }),
  );
}

it("projects only statements and explicit quiz connections with lesson-local identities", () => {
  const map = readCourseMap("course")!;
  expect(map.lessons.map((l) => l.name)).toEqual([
    "001-values",
    "002-borrow",
    "003-predictions",
    "004-legacy",
  ]);
  expect(map.lessons[0].objectives).toEqual([
    {
      key: "001-values/@objective/ownership",
      statement: expect.stringContaining("Explain who owns"),
      quizzes: [
        { id: "check-1", purpose: "assessment" },
        { id: "recall-1", purpose: "prior-retrieval" },
      ],
    },
  ]);
  expect(map.lessons[2].objectives[0].key).toBe("003-predictions/@objective/ownership");
  expect(map.lessons[1]).toMatchObject({ gated: true, objectives: [] });
  expect(map.lessons[3]).toMatchObject({ missingPlan: true, objectives: [] });
  for (const secret of [
    "PRIVATE_",
    "HIDDEN_",
    "support",
    "application",
    "questions",
    "variants",
    "teaching",
    "retentionDays",
  ])
    expect(JSON.stringify(map)).not.toContain(secret.endsWith("_") ? secret : `"${secret}":`);
});

it("releases gated objectives only after a saved graded pretest, never writes during reads", () => {
  writeGradedAttempt({
    classroom: "course",
    lesson: "002-borrow",
    quizId: "pretest-1",
    kind: "pretest",
    at: 100,
    answers: [termAnswer("q1", "a prediction")],
    correct: { q1: false },
  });
  const before = hashes(f.root);
  const lesson = readCourseMap("course")!.lessons[1];
  expect(lesson.gated).toBe(false);
  expect(lesson.objectives[0]).toMatchObject({
    key: "002-borrow/@objective/ownership",
    statement: expect.stringContaining("HIDDEN_OBJECTIVE"),
    quizzes: [
      { id: "pretest-1", purpose: "prequestion" },
      { id: "check-2", purpose: "assessment" },
    ],
  });
  readCourseMap("course");
  expect(hashes(f.root)).toEqual(before);
});

it("keeps unstructured legacy mission context and missing optional metadata without inventing plans", () => {
  f.write("course/MISSION.md", "I want to debug a CLI with my team. No headings or objective ids.");
  const map = readCourseMap("course")!;
  expect(map.missionHtml).toContain(
    "I want to debug a CLI with my team. No headings or objective ids.",
  );
  expect(map.lessons[3]).toMatchObject({ title: "Earlier notes", missingPlan: true });
  expect(readCourseMap("empty")).toEqual({
    classroom: { name: "empty", title: "New classroom" },
    missionHtml: null,
    upcoming: [],
    connections: [],
    lessons: [],
  });
  expect(readCourseMap("missing")).toBeNull();
  expect(() => readCourseMap("../course")).toThrow("Invalid classroom");
});

it.each(["{SECRET_INVALID_JSON", "null", '{"version":2}', '{"version":1,"objectives":{}}'])(
  "rejects corrupt plans without exposing private JSON: %s",
  (text) => {
    f.write("course/001-values/quiz/plan.json", text);
    expect(() => readCourseMap("course")).toThrow("course/001-values/quiz/plan.json");
    try {
      readCourseMap("course");
    } catch (error) {
      expect(String(error)).not.toContain("SECRET");
    }
  },
);

it("requires the plan promised by the instructional contract", () => {
  fs.unlinkSync(path.join(f.root, "course/001-values/quiz/plan.json"));
  expect(() => readCourseMap("course")).toThrow("file is missing");
});

it("rejects invalid UTF-8 mission bytes and directories instead of pretending the mission is absent", () => {
  const mission = path.join(f.root, "course/MISSION.md");
  fs.writeFileSync(mission, Buffer.from([0xc3, 0x28]));
  expect(() => readCourseMap("course")).toThrow("invalid UTF-8");
  fs.unlinkSync(mission);
  fs.mkdirSync(mission);
  expect(() => readCourseMap("course")).toThrow("expected a file");
});

it.each([
  "MISSION.md",
  "001-values/quiz/plan.json",
  "001-values/lesson.html",
  "001-values/lesson.json",
])("rejects symlinks before reading %s", (relative) => {
  const file = path.join(f.root, "course", relative),
    target = file + ".original";
  fs.renameSync(file, target);
  fs.symlinkSync(target, file);
  expect(() => readCourseMap("course")).toThrow(/symlink/);
});

it("rejects a symlinked classroom and lesson directory", () => {
  fs.symlinkSync(path.join(f.root, "course"), path.join(f.root, "linked"));
  expect(() => readCourseMap("linked")).toThrow(/symlink/);
  fs.symlinkSync(path.join(f.root, "course/001-values"), path.join(f.root, "course/006-linked"));
  expect(() => readCourseMap("course")).toThrow(/symlink/);
});

it("hides unfinished legacy review publication even before its kind metadata exists", () => {
  f.write("course/006-pending/lesson.html", "<title>PRIVATE_UNFINISHED</title>");
  f.write(
    "course/.reviews.json",
    JSON.stringify({
      version: 1,
      requests: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          classroom: "course",
          lesson: "006-pending",
          owner: "service",
          ownerPid: 123,
          at: 1,
          status: "planned",
          items: [{ key: "001-values/@objective/ownership" }],
        },
      ],
    }).replace('"planned"', '"running"'),
  );
  expect(readCourseMap("course")!.lessons.map((l) => l.name)).not.toContain("006-pending");
});

it("fails closed on corrupt review publication or pretest history without leaking snippets", () => {
  f.write("course/.reviews.json", "{PRIVATE_REVIEW_STATE");
  expect(() => readCourseMap("course")).toThrow("invalid review publication state");
  fs.unlinkSync(path.join(f.root, "course/.reviews.json"));
  f.write("course/002-borrow/quiz/submissions/bad.json", "{PRIVATE_SUBMISSION");
  expect(() => readCourseMap("course")).toThrow("invalid pretest gate or saved pretest history");
});

it("does not unlock teaching for an ungraded or unrelated quiz attempt", () => {
  f.write(
    "course/002-borrow/quiz/submissions/pending.json",
    JSON.stringify({
      id: "pending",
      classroom: "course",
      lesson: "002-borrow",
      quizId: "pretest-1",
      kind: "pretest",
      submittedAt: 1,
      answers: [],
    }),
  );
  expect(readCourseMap("course")!.lessons[1].gated).toBe(true);
});

it("guards symlinks in saved pretest history", () => {
  const target = f.write("other.json", JSON.stringify({ secret: "PRIVATE_HISTORY" }));
  fs.mkdirSync(path.join(f.root, "course/002-borrow/quiz/submissions"), { recursive: true });
  fs.symlinkSync(target, path.join(f.root, "course/002-borrow/quiz/submissions/one.json"));
  expect(() => readCourseMap("course")).toThrow("invalid pretest gate or saved pretest history");
});

it("serves an escaped allowlisted page, explicit errors, no private API/static routes and no viewing writes", async () => {
  const base = await server.start(0),
    before = hashes(f.root);
  const page = await fetch(base + "/c/course/course-map"),
    html = await page.text();
  expect(page.status).toBe(200);
  expect(html).toContain("/c/course/001-values");
  expect(html).not.toMatch(/PRIVATE_|HIDDEN_/);
  for (const route of [
    "/c/course/001-values/quiz/plan.json",
    "/c/course/001-values/quiz/key.json",
    "/doc/course/001-values/quiz/plan.json",
    "/c/course/.teacher.json",
    "/static/../../course/001-values/quiz/plan.json",
    "/api/course-map?classroom=course",
    "/c/course%2f..%2fother/course-map",
  ])
    expect((await fetch(base + route)).status, route).toBe(404);
  expect(hashes(f.root)).toEqual(before);
  f.write("course/001-values/quiz/plan.json", "{PRIVATE_JSON_FRAGMENT");
  const failed = await fetch(base + "/c/course/course-map");
  expect(failed.status).toBe(500);
  const error = await failed.text();
  expect(error).toContain("invalid JSON");
  expect(error).toContain('href="/c/course/course-map"');
  expect(error).not.toContain("PRIVATE_JSON_FRAGMENT");
});
