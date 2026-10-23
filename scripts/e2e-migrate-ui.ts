/** Exercise the actual migration CLI and its browser checker in isolated state. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { mechanicalRebuild } from "./migrate-ui.ts";
import { packageRoot } from "../src/paths.ts";

const artifacts = path.resolve(process.argv[2] ?? "");
if (!process.argv[2] || fs.existsSync(artifacts)) throw new Error("Pass a new artifact directory.");
fs.mkdirSync(artifacts, { recursive: true });
const scratch = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "studens-migration-drive-"));
const root = path.join(scratch, "classrooms");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Counting</title></head><body><main data-cl-content><header><h1>Counting</h1><p>Count each item once.</p></header><form class="cl-quiz" data-quiz-id="before" data-kind="pretest"><ol><li class="cl-q" data-question-id="b" data-type="short"><p class="cl-q-prompt">How would you count reliably?</p><textarea aria-label="Your prediction"></textarea></li></ol></form><template data-cl-after-pretest="before"><section id="counting"><p>Count each item once using a fixed order.</p></section><form class="cl-quiz" data-quiz-id="check"><ol><li class="cl-q" data-question-id="q" data-type="short"><p class="cl-q-prompt">Why count each item once?</p><textarea aria-label="Your explanation"></textarea></li></ol></form><details><summary>Counting hint</summary><p>Use a fixed order.</p></details></template></main></body></html>`;
const key = JSON.stringify({
  before: {
    b: {
      expected: "Count each item once.",
      points: 1,
      full: "One per item.",
      partial: "Incomplete.",
    },
  },
  check: {
    q: {
      expected: "Avoid duplicate counts.",
      points: 1,
      full: "No duplicates.",
      partial: "Incomplete explanation.",
    },
  },
});
function write(name: string, bytes: string): void {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}
function snapshot(dir = root): unknown {
  return Object.fromEntries(
    fs
      .readdirSync(dir)
      .sort()
      .map((name) => {
        const file = path.join(dir, name),
          stat = fs.lstatSync(file);
        return [
          name,
          {
            mode: stat.mode,
            mtime: stat.mtimeMs,
            value: stat.isDirectory()
              ? snapshot(file)
              : createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
          },
        ];
      }),
  );
}
function run(name: string, args: string[], expected: number) {
  const result = spawnSync(
    process.execPath,
    [path.join(packageRoot(), "scripts/migrate-ui.ts"), ...args],
    {
      env: { ...process.env, PI_CLASSROOMS_DIR: root },
      cwd: packageRoot(),
      encoding: "utf8",
      timeout: 180_000,
    },
  );
  fs.writeFileSync(
    path.join(artifacts, `${name}.json`),
    JSON.stringify(
      {
        args,
        exitCode: result.status,
        error: result.error?.message,
        stdout: result.stdout,
        stderr: result.stderr,
      },
      null,
      2,
    ),
  );
  assert.equal(result.status, expected, `${name}: ${result.stderr}`);
  return result.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
const apply = ["--apply", "--accept-state-loss", "--classroom", "counts"];
try {
  write("counts/001-count/lesson-old.html", html);
  write("counts/001-count/quiz/key.json", key);
  write("counts/001-count/quiz/submissions/original.json", '{"attempt":"unchanged"}');
  write("counts/001-count/quiz/grades/original.json", '{"grade":"unchanged"}');
  write("counts/.teacher.json", '{"plan":"never replay"}');
  const legacyDiv = html
    .replaceAll('<ol><li class="cl-q"', '<div class="cl-q"')
    .replaceAll("</li></ol>", "</div>");
  write("counts/002-broken/lesson.html", legacyDiv);
  write("counts/002-broken/quiz/key.json", key);
  const review = "review-12345678-1234-1234-1234-123456789012";
  write(`counts/.reviews/${review}/lesson.html`, html);
  write(`counts/.reviews/${review}/quiz/key.json`, key);
  const before = snapshot();
  assert.equal(run("dry-list", [], 0).length, 3);
  assert.deepEqual(snapshot(), before);
  fs.writeFileSync(
    path.join(artifacts, "dry-before-after.json"),
    JSON.stringify({ before, after: snapshot(), unchanged: true }, null, 2),
  );
  const good = path.join(scratch, "good.html"),
    bad = path.join(scratch, "bad.html");
  const candidate = mechanicalRebuild(html);
  fs.writeFileSync(good, candidate);
  fs.writeFileSync(
    bad,
    candidate.replace(
      "</body>",
      '<script>throw new Error("migration authored control failure")</script></body>',
    ),
  );
  assert.equal(
    run("browser-failure", [...apply, "--lesson", "002-broken", "--candidate", bad], 1)[0].status,
    "failed",
  );
  assert.equal(
    fs.readFileSync(path.join(root, "counts/002-broken/lesson.html"), "utf8"),
    legacyDiv,
  );
  assert.equal(
    run("refuse-implicit-retry", [...apply, "--lesson", "002-broken"], 1)[0].status,
    "failed",
  );
  assert.equal(
    run(
      "explicit-corrected-retry",
      [...apply, "--lesson", "002-broken", "--retry", "--candidate", good],
      0,
    )[0].status,
    "migrated",
  );
  assert.equal(
    run("mechanical-browser-success", [...apply, "--lesson", "001-count"], 0)[0].status,
    "migrated",
  );
  assert.equal(
    run("review-browser-success", [...apply, "--lesson", review], 0)[0].status,
    "migrated",
  );
  write(
    "counts/003-structural/lesson.html",
    "<!doctype html><html><body><p>No lesson root.</p></body></html>",
  );
  write("counts/004-working/lesson.html", html);
  write("counts/004-working/quiz/key.json", key);
  const batch = run("batch-continues-after-failure", apply, 1);
  assert.equal(batch.find((r) => r.lesson === "003-structural")?.status, "failed");
  assert.equal(batch.find((r) => r.lesson === "004-working")?.status, "migrated");
  assert.equal(
    fs.readFileSync(path.join(root, "counts/003-structural/lesson.html"), "utf8"),
    "<!doctype html><html><body><p>No lesson root.</p></body></html>",
  );
  const journalFile = path.join(root, "counts/001-count/quiz/ui-migration.json");
  const journal = JSON.parse(fs.readFileSync(journalFile, "utf8"));
  const receipt = JSON.parse(journal.check.stdout);
  assert.equal(receipt.learnerStateChanged, false);
  assert.equal(receipt.initial.contractErrors, 0);
  assert.equal(receipt.initial.quizzes, 1);
  assert.equal(receipt.released.quizzes, 2);
  assert.equal(receipt.released.pageErrors, 0);
  journal.status = "prepared";
  fs.writeFileSync(journalFile, JSON.stringify(journal));
  assert.equal(
    run("recover-committed", [...apply, "--lesson", "001-count", "--retry"], 0)[0].status,
    "recovered",
  );
  assert.equal(
    run("completed-noop", [...apply, "--lesson", "001-count", "--retry"], 0)[0].status,
    "v2",
  );
  assert.equal(fs.readFileSync(path.join(root, "counts/001-count/quiz/key.json"), "utf8"), key);
  assert.equal(
    fs.readFileSync(path.join(root, "counts/001-count/quiz/submissions/original.json"), "utf8"),
    '{"attempt":"unchanged"}',
  );
  assert.equal(
    fs.readFileSync(path.join(root, "counts/001-count/quiz/grades/original.json"), "utf8"),
    '{"grade":"unchanged"}',
  );
  assert.equal(
    fs.readFileSync(path.join(root, "counts/.teacher.json"), "utf8"),
    '{"plan":"never replay"}',
  );
  assert.deepEqual(fs.readdirSync(path.join(root, "counts/001-count/quiz/grades")), [
    "original.json",
  ]);
  fs.writeFileSync(
    path.join(artifacts, "result.json"),
    JSON.stringify(
      {
        verdict: "PASS",
        dryListingUnchanged: true,
        failedOriginalPreserved: true,
        explicitRetry: true,
        reviewChecked: true,
        recoveredWithoutRegrading: true,
        privateBytesUnchanged: true,
      },
      null,
      2,
    ),
  );
  fs.cpSync(root, path.join(artifacts, "classrooms"), { recursive: true });
  console.log(`PASS: ${artifacts}`);
} catch (error) {
  fs.writeFileSync(path.join(artifacts, "failure.txt"), String(error));
  fs.cpSync(root, path.join(artifacts, "classrooms"), { recursive: true });
  throw error;
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
