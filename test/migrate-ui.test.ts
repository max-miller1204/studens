import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { makeFixture } from "./helpers.ts";
import type { Fixture } from "./helpers.ts";
import { discoverLessons, mechanicalRebuild, migrateLesson } from "../scripts/migrate-ui.ts";

let fixture: Fixture;
const ref = { classroom: "counts", lesson: "001-count" };
const prefix = "counts/001-count/";
const html = `<!doctype html><html><head><title>Counting</title></head><body><main data-cl-content><h1>Count things</h1><p>Count each item once.</p><form class="cl-quiz" data-quiz-id="check"><ol><li class="cl-q" data-question-id="q" data-type="short"><p class="cl-q-prompt">Explain counting.</p><textarea></textarea></li></ol></form><details><summary>More</summary>Use each item once.</details></main></body></html>`;
const check = vi.fn();
function file(name: string) {
  return path.join(fixture.root, prefix, name);
}
function journal() {
  return JSON.parse(fs.readFileSync(file("quiz/ui-migration.json"), "utf8"));
}
function snapshot(dir = fixture.root): unknown {
  return Object.fromEntries(
    fs
      .readdirSync(dir)
      .sort()
      .map((name) => {
        const p = path.join(dir, name),
          stat = fs.lstatSync(p);
        return [
          name,
          [
            stat.mode,
            stat.mtimeMs,
            stat.isDirectory() ? snapshot(p) : fs.readFileSync(p).toString("base64"),
          ],
        ];
      }),
  );
}
beforeEach(() => {
  fixture = makeFixture();
  fixture.write(prefix + "lesson.html", html);
  fixture.write(
    prefix + "quiz/key.json",
    JSON.stringify({
      check: {
        q: { expected: "Count each once.", points: 1, full: "All items.", partial: "Some items." },
      },
    }),
  );
  fixture.write(prefix + "quiz/submissions/saved.json", '{"attempt":1}');
  fixture.write(prefix + "quiz/grades/saved.json", '{"score":1}');
  fixture.write("counts/.teacher.json", '{"savedPlan":"never replay"}');
  check.mockReset();
});
afterEach(() => fixture.cleanup());

it("dry CLI discovery leaves all file bytes, modes and modification times unchanged", () => {
  fixture.write("counts/002-new/lesson.html", mechanicalRebuild(html));
  fixture.write(
    "counts/003-alt/lesson-003.html",
    html.replace("<main", '<!-- data-cl-ui="2" --><main'),
  );
  fixture.write("counts/.reviews/review-12345678-1234-1234-1234-123456789012/lesson.html", html);
  fixture.write("counts/reference/guide.html", html);
  fixture.write("counts/assets/demo.html", html);
  const before = snapshot();
  const result = spawnSync(process.execPath, ["scripts/migrate-ui.ts"], {
    env: { ...process.env, PI_CLASSROOMS_DIR: fixture.root },
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  const rows = result.stdout
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
  expect(rows.map((r) => r.lesson).sort()).toEqual([
    "001-count",
    "003-alt",
    "review-12345678-1234-1234-1234-123456789012",
  ]);
  expect(snapshot()).toEqual(before);
});
it("requires explicit apply and loss acknowledgement before any write", () => {
  const before = snapshot();
  const result = spawnSync(process.execPath, ["scripts/migrate-ui.ts", "--apply"], {
    env: { ...process.env, PI_CLASSROOMS_DIR: fixture.root },
    encoding: "utf8",
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("--accept-state-loss");
  expect(snapshot()).toEqual(before);
});
it("adds hooks inside inert gates without changing scripts or existing attributes", () => {
  const source = html.replace(
    "</main>",
    '<template data-cl-after-pretest="before"><input type="text" /><button type="button">Try</button></template><script>const x = "<main>";</script></main>',
  );
  const rebuilt = mechanicalRebuild(source);
  expect(rebuilt).toContain('<input type="text"  class="cl-input"/>');
  expect(rebuilt).toContain('const x = "<main>";');
  expect(rebuilt).toContain('data-cl-ui="2"');
});
it("saves the plan before checking and preserves every original private file", () => {
  const privateBefore = snapshot(file("quiz"));
  check.mockImplementation(() => {
    expect(journal().status).toBe("prepared");
    expect(fs.readFileSync(file("lesson.html"), "utf8")).toBe(html);
  });
  expect(migrateLesson(ref, { check }).status).toBe("migrated");
  expect(journal().status).toBe("complete");
  expect(Buffer.from(journal().original, "base64").toString()).toBe(html);
  fs.unlinkSync(file("quiz/ui-migration.json"));
  // Directory mtime changes for the journal; original private files do not.
  expect(snapshot(file("quiz"))).toEqual(privateBefore);
  expect(fs.readFileSync(path.join(fixture.root, "counts/.teacher.json"), "utf8")).toBe(
    '{"savedPlan":"never replay"}',
  );
});
it("retains the original on browser failure, refuses automatic retry, then uses saved output", () => {
  check.mockImplementationOnce(() => {
    throw new Error("Broken authored control");
  });
  expect(migrateLesson(ref, { check })).toMatchObject({
    status: "failed",
    detail: "Broken authored control",
  });
  expect(fs.readFileSync(file("lesson.html"), "utf8")).toBe(html);
  expect(journal().status).toBe("failed");
  expect(discoverLessons()[0].status).toBe("retry-required");
  expect(migrateLesson(ref, { check }).detail).toContain("--retry");
  expect(check).toHaveBeenCalledTimes(1);
  expect(migrateLesson(ref, { retry: true, check }).status).toBe("migrated");
  expect(check).toHaveBeenCalledTimes(2);
});
it("recovers a committed replacement without checking or grading a second time", () => {
  const privateBefore = snapshot(file("quiz"));
  expect(migrateLesson(ref, { check }).status).toBe("migrated");
  const saved = journal();
  saved.status = "prepared"; // Interrupted after atomic HTML rename, before completion receipt.
  fixture.write(prefix + "quiz/ui-migration.json", JSON.stringify(saved));
  check.mockClear();
  expect(migrateLesson(ref, { retry: true, check }).status).toBe("recovered");
  expect(migrateLesson(ref, { retry: true, check }).status).toBe("unchanged");
  expect(check).not.toHaveBeenCalled();
  fs.unlinkSync(file("quiz/ui-migration.json"));
  expect(snapshot(file("quiz"))).toEqual(privateBefore);
});
it("resumes a prepared candidate before replacement with unchanged private grading state", () => {
  check.mockImplementationOnce(() => {
    throw new Error("Interrupted check");
  });
  migrateLesson(ref, { check });
  const saved = journal();
  saved.status = "prepared";
  fixture.write(prefix + "quiz/ui-migration.json", JSON.stringify(saved));
  expect(migrateLesson(ref, { retry: true, check }).status).toBe("migrated");
  expect(fs.readFileSync(file("quiz/grades/saved.json"), "utf8")).toBe('{"score":1}');
});
it("rejects a candidate that changes question content instead of regenerating private keys", () => {
  const result = migrateLesson(ref, {
    candidate: mechanicalRebuild(html).replace("Explain counting.", "Different question."),
    check,
  });
  expect(result.detail).toContain("changes a graded quiz");
  expect(check).not.toHaveBeenCalled();
  expect(fs.readFileSync(file("lesson.html"), "utf8")).toBe(html);
});
it("rejects changed private inputs and source conflicts during explicit recovery", () => {
  check.mockImplementationOnce(() => {
    throw new Error("Interrupted check");
  });
  migrateLesson(ref, { check });
  fixture.write(prefix + "quiz/key.json", "{}");
  expect(migrateLesson(ref, { retry: true, check }).detail).toContain("Private inputs changed");
  fixture.write(prefix + "lesson.html", html + "<!-- manual edit -->");
  expect(migrateLesson(ref, { retry: true, check }).detail).toContain("Lesson changed");
});
it("rejects a source edit made while checking before replacement", () => {
  check.mockImplementationOnce(() => fixture.write(prefix + "lesson.html", html + "<!-- edit -->"));
  expect(migrateLesson(ref, { check }).detail).toContain("changed during checking");
  expect(fs.readFileSync(file("lesson.html"), "utf8")).toBe(html + "<!-- edit -->");
});
it("reports a failed lesson and continues discovery, rejecting symlinks", () => {
  fixture.write("counts/002-other/lesson.html", html);
  fs.symlinkSync(file("lesson.html"), path.join(fixture.root, "counts/002-other/other.html"));
  // Canonical source itself is guarded even when discovery finds the symlink.
  fs.unlinkSync(path.join(fixture.root, "counts/002-other/lesson.html"));
  const results = discoverLessons();
  expect(results.find((r) => r.lesson === "001-count")?.status).toBe("legacy");
  expect(results.find((r) => r.lesson === "002-other")).toMatchObject({
    status: "failed",
    detail: expect.stringContaining("symlink"),
  });
});
it("refuses an existing lock and leaves original and lock in place", () => {
  fixture.write(prefix + "quiz/ui-migration.lock", "owned");
  expect(migrateLesson(ref, { check }).detail).toContain("lock exists");
  expect(fs.readFileSync(file("quiz/ui-migration.lock"), "utf8")).toBe("owned");
  expect(fs.readFileSync(file("lesson.html"), "utf8")).toBe(html);
});

it("keeps the original-containing migration journal off public HTTP routes", async () => {
  // The byte-preservation sentinels above are deliberately not valid learner records.
  fs.rmSync(file("quiz/submissions"), { recursive: true });
  fs.rmSync(file("quiz/grades"), { recursive: true });
  expect(migrateLesson(ref, { check }).status).toBe("migrated");
  const server = await import("../src/server.ts");
  try {
    const base = await server.start(0);
    const response = await fetch(`${base}/c/counts/001-count/quiz/ui-migration.json`);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("candidate");
  } finally {
    await server.close();
  }
});

it("preserves machine rubrics and metadata while enforcing their private criteria", () => {
  const source = html
    .replace('data-type="short"', 'data-type="numeric"')
    .replace("<textarea></textarea>", '<input type="number" class="cl-number">');
  fixture.write(prefix + "lesson.html", source);
  const key = JSON.stringify({
    check: {
      q: {
        expected: { value: 2, tolerance: 0 },
        points: 1,
        full: "Two.",
        partial: "No count.",
        criteria: [{ id: "count", description: "Correct count.", points: 1 }],
      },
    },
  });
  const metadata = '{"assessmentContract":1,"criterionContract":1}';
  fixture.write(prefix + "quiz/key.json", key);
  fixture.write(prefix + "lesson.json", metadata);
  expect(migrateLesson(ref, { check }).status).toBe("migrated");
  expect(fs.readFileSync(file("quiz/key.json"), "utf8")).toBe(key);
  expect(fs.readFileSync(file("lesson.json"), "utf8")).toBe(metadata);
});
it("rejects a private contract defect before browser work without replacing the original", () => {
  fixture.write(prefix + "lesson.json", '{"assessmentContract":1}');
  fs.unlinkSync(file("quiz/key.json"));
  expect(migrateLesson(ref, { check }).detail).toContain("Missing required private rubric");
  expect(check).not.toHaveBeenCalled();
  expect(fs.readFileSync(file("lesson.html"), "utf8")).toBe(html);
});
it("refuses to remove original gated teaching in an agent candidate", () => {
  const source = html
    .replace("<details>", '<template data-cl-after-pretest="before"><details>')
    .replace("</details>", "</details></template>");
  fixture.write(prefix + "lesson.html", source);
  const candidate = mechanicalRebuild(source)
    .replace('<template data-cl-after-pretest="before">', "")
    .replace("</template>", "");
  expect(migrateLesson(ref, { candidate, check }).status).toBe("failed");
  expect(check).not.toHaveBeenCalled();
  expect(fs.readFileSync(file("lesson.html"), "utf8")).toBe(source);
});

it("accepts an explicit agent candidate that wraps unchanged legacy div questions in the v2 list", () => {
  const legacy = html
    .replace('<ol><li class="cl-q"', '<div class="cl-q"')
    .replace("</li></ol>", "</div>");
  fixture.write(prefix + "lesson.html", legacy);
  expect(migrateLesson(ref, { candidate: mechanicalRebuild(html), check }).status).toBe("migrated");
  expect(fs.readFileSync(file("quiz/key.json"), "utf8")).toContain("Count each once.");
});
