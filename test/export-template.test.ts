import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { makeFixture } from "./helpers.ts";
import {
  gradeTemplateQuiz,
  seedTemplateExport,
  templateReadings,
  templateLesson,
} from "./export-template-fixture.ts";
import { projectClassroom, exportMarkdown, exportPrint } from "../src/classroom-export.ts";
import { expectedAnswers } from "../src/expected-answers.ts";
import { expectedReading } from "../src/export-content.ts";
import { stageLesson } from "../src/pretest.ts";
import { exportAnki } from "../src/export-anki.ts";
import * as server from "../src/server.ts";
let f: ReturnType<typeof makeFixture>;
beforeEach(() => {
  f = makeFixture();
  seedTemplateExport(f);
});
afterEach(async () => {
  await server.close();
  f.cleanup();
});
const snapshot = () =>
  fs
    .readdirSync(f.root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => [
      path.relative(f.root, path.join(e.parentPath, e.name)),
      fs.readFileSync(path.join(e.parentPath, e.name)).toString("hex"),
    ]);
it("uses only released public identities across partial and multiple gates, preserving nested inert templates", () => {
  expect(JSON.stringify(projectClassroom("gates", true))).not.toMatch(
    /Released teaching|key-choice|CANARY/,
  );
  gradeTemplateQuiz("before");
  const s = gradeTemplateQuiz("check"),
    answers = expectedAnswers(s);
  expect(Object.values(answers).map((a) => a.status)).toEqual([
    "available",
    "available",
    "available",
    "available",
    "available",
    "waiting",
    "waiting",
  ]);
  const before = snapshot(),
    data = projectClassroom("gates", true)!;
  const reading = data.parts.filter(
    (p) => p.identity.startsWith("answer/") && p.identity.includes("/check/"),
  );
  expect(reading).toHaveLength(5);
  for (const [i, p] of reading.entries()) expect(p.html).toContain(templateReadings[i]);
  for (const text of [exportMarkdown(data), exportPrint(data), exportAnki(data).toString("utf8")]) {
    expect(text).not.toMatch(/CANARY|key-(?:choice|multi|order|left|right|segment)|731987654/);
    expect(text).toContain("New owner — café λ");
    expect(text).toContain("The released passage 日本語");
  }
  const off = projectClassroom("gates", false)!;
  expect(off.parts.some((p) => p.identity.startsWith("answer/"))).toBe(false);
  expect(snapshot()).toEqual(before);
  gradeTemplateQuiz("later");
  expect(JSON.stringify(projectClassroom("gates", true))).toContain("UNRELEASED_NEIGHBOR_CANARY");
  expect(JSON.stringify(projectClassroom("gates", true))).not.toMatch(
    /INERT_NESTED|NESTED_PRIVATE|ARBITRARY_TEMPLATE|PRIVATE_VARIANT/,
  );
});
it("keeps original identity and ambiguous labels as explicit errors without searching inert templates", () => {
  gradeTemplateQuiz("before");
  const s = gradeTemplateQuiz("check"),
    answer = expectedAnswers(s).choice;
  if (answer.status !== "available") throw new Error("Controlled original answer unavailable");
  const source = fs.readFileSync(path.join(f.root, `gates/${templateLesson}/lesson.html`), "utf8");
  expect(() => expectedReading(source, "check", "choice", answer)).toThrow(
    /original public question identity.*retry explicitly/,
  );
  const staged = stageLesson(source, new Set(["before"])).html;
  expect(expectedReading(staged, "check", "choice", answer).expected).toBe(templateReadings[0]);
  expect(() =>
    expectedReading(
      staged.replace('data-quiz-id="check"', 'data-quiz-id="missing"'),
      "check",
      "choice",
      answer,
    ),
  ).toThrow(/original public question identity.*retry explicitly/);
  expect(() =>
    expectedReading(
      staged.replace('value="key-choice-b"', 'value="key-choice-a"'),
      "check",
      "choice",
      answer,
    ),
  ).toThrow(/label is missing or ambiguous.*retry explicitly/);
  expect(() => expectedReading(staged + staged, "check", "choice", answer)).toThrow(
    /original public question identity.*retry explicitly/,
  );
});
it("rejects invalid nested gates rather than releasing their content", () => {
  const file = path.join(f.root, `gates/${templateLesson}/lesson.html`);
  fs.appendFileSync(
    file,
    '<template data-cl-after-pretest="before"><template data-cl-after-pretest="later">INVALID_NESTED_PRIVATE</template></template>',
  );
  expect(() => projectClassroom("gates", false)).toThrow(
    "invalid saved quiz history or pretest gate",
  );
});
