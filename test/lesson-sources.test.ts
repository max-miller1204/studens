import { afterEach, beforeEach, expect, it } from "vitest";
import { teachingSources, teachingAnchors } from "../src/lesson-sources.ts";
import { glossaryWithOrigins, lessonPrerequisites } from "../src/store/lesson-sources.ts";
import { parseGlossary } from "../src/glossary.ts";
import { makeFixture } from "./helpers.ts";
import type { Fixture } from "./helpers.ts";
import { seedCourse, addCourseIntentions } from "./course-map-fixture.ts";
import { applyGrade } from "../src/quiz-grading.ts";
import * as store from "../src/store.ts";
import * as fs from "node:fs";
import { saveLessonRequests } from "../src/store/lesson-requests.ts";
let f: Fixture;
beforeEach(() => {
  f = makeFixture();
  seedCourse(f);
  addCourseIntentions(f);
});
afterEach(() => f.cleanup());
const glossary = () =>
  parseGlossary("**Ownership**:\nEach value has an owner.\n\n**Borrowing**:\nTemporary access.\n");
const annotate = (lesson = "001-values", term = "Ownership", id = "ownership") => {
  const file = `course/${lesson}/lesson.html`;
  f.write(
    file,
    fs
      .readFileSync(f.root + "/" + file, "utf8")
      .replace(
        "</main>",
        `<section id="${id}" data-cl-teaches="${term}"><p>A worked teaching example.</p></section></main>`,
      ),
  );
};
it("uses only explicit teaching declarations and preserves source files during repeated reads", () => {
  const before = fs.readFileSync(f.root + "/course/001-values/lesson.html", "utf8");
  expect(glossaryWithOrigins("course", glossary()).terms[0].origin?.status).toBe("unavailable");
  annotate();
  for (let n = 0; n < 2; n++)
    expect(glossaryWithOrigins("course", glossary()).terms[0].origin).toEqual({
      status: "available",
      title: "Values and ownership",
      url: "/c/course/001-values#ownership",
    });
  expect(fs.readFileSync(f.root + "/course/001-values/lesson.html", "utf8")).toBe(
    before.replace(
      "</main>",
      '<section id="ownership" data-cl-teaches="Ownership"><p>A worked teaching example.</p></section></main>',
    ),
  );
  expect(store.listSubmissions("course", "001-values")).toEqual([]);
  expect(store.listGrades("course", "001-values")).toEqual([]);
  expect(fs.existsSync(f.root + "/course/learning-records")).toBe(false);
});
it("keeps origin identity separate from matching terms, old term routes and lesson order", () => {
  annotate("004-legacy", "Ownership", "old-section");
  annotate("003-predictions", "Borrowing", "borrow-section");
  const result = glossaryWithOrigins("course", glossary());
  expect(result.terms.map((t) => t.origin)).toEqual([
    { status: "available", title: "Legacy", url: "/c/course/004-legacy#old-section" },
    {
      status: "available",
      title: "Next questions",
      url: "/c/course/003-predictions#borrow-section",
    },
  ]);
  // Removing the declaration never guesses a new source from remaining mentions.
  f.write(
    "course/004-legacy/lesson.html",
    '<main><section id="old-section">Ownership</section></main>',
  );
  expect(glossaryWithOrigins("course", glossary()).terms[0].origin?.status).toBe("unavailable");
});
it("reports conflicting declarations without choosing first, latest or first mention", () => {
  annotate();
  annotate("003-predictions");
  const result = glossaryWithOrigins("course", glossary()).terms[0].origin!;
  expect(result.status).toBe("unavailable");
  expect("url" in result).toBe(false);
  expect("message" in result && result.message).toContain("More than one");
});
it("never associates an unreleased pretest, review or unfinished lesson with a term", () => {
  const file = "course/002-borrow/lesson.html";
  f.write(
    file,
    fs
      .readFileSync(f.root + "/" + file, "utf8")
      .replace('id="teach-borrow"', 'id="teach-borrow" data-cl-teaches="Borrowing"'),
  );
  annotate("005-review");
  f.write(
    "course/006-unfinished/lesson.html",
    '<main><section id="secret-section" data-cl-teaches="Ownership">PRIVATE_TEACHING</section></main>',
  );
  saveLessonRequests("course", [
    {
      id: "00000000-0000-4000-8000-000000000031",
      lesson: "006-unfinished",
      classroom: "course",
      owner: "claude",
      ownerPid: process.pid,
      status: "queued",
      at: 1,
      topic: "",
    },
  ]);
  const initial = glossaryWithOrigins("course", glossary());
  expect(initial.terms.every((t) => t.origin?.status === "unavailable")).toBe(true);
  expect(JSON.stringify(initial)).not.toMatch(
    /teach-borrow|secret-section|005-review|006-unfinished|HIDDEN_|PRIVATE_/,
  );
  const submission = store.createSubmission({
    classroom: "course",
    lesson: "002-borrow",
    quizId: "pretest-1",
    quizTitle: "Diagnostic",
    kind: "pretest",
    answers: [{ questionId: "q1", type: "short", value: "My prediction" }],
  });
  applyGrade(submission, {
    score: 0,
    feedbackMarkdown: "Read the lesson.",
    questions: [{ questionId: "q1", correct: false, feedback: "Diagnostic." }],
  });
  expect(glossaryWithOrigins("course", glossary()).terms[1].origin).toEqual({
    status: "available",
    title: "Borrowing",
    url: "/c/course/002-borrow#teach-borrow",
  });
});
it("rejects malformed, duplicate, orphan, private and URL-like anchors before publication", () => {
  for (const html of [
    '<section data-cl-teaches="Ownership">No anchor</section>',
    '<section id="origin" data-cl-teaches=" "></section>',
    '<section id="../keys" data-cl-teaches="Ownership"></section>',
    '<section id="https://evil.test" data-cl-teaches="Ownership"></section>',
    '<section id=".." data-cl-teaches="Ownership"></section>',
    '<section id="cl-config" data-cl-teaches="Ownership"></section>',
    '<section id="same" data-cl-teaches="Ownership"></section><p id="same">duplicate</p>',
    '<section id="a" data-cl-teaches="Ownership"></section><section id="b" data-cl-teaches="ownership"></section>',
    '<form><section id="a" data-cl-teaches="Ownership"></section></form>',
    '<template><section id="a" data-cl-teaches="Ownership"></section></template>',
    '<section hidden><section id="a" data-cl-teaches="Ownership"></section></section>',
  ])
    expect(() => teachingSources(html)).toThrow(/Teaching origin|teaching origin/);
  expect(
    teachingSources(
      '<!-- <section data-cl-teaches="Fake"> --> <script>"data-cl-teaches"</script><section id="real" data-cl-teaches="Ownership &amp; moves">Examples</section>',
    ),
  ).toEqual([{ term: "Ownership & moves", anchor: "real" }]);
  expect(
    teachingSources(
      '<main><template data-cl-after-pretest="pre"><section id="real" data-cl-teaches="Ownership">Teaching</section></template></main>',
    ),
  ).toEqual([{ term: "Ownership", anchor: "real" }]);
});
it("keeps definitions usable with a specific source error, without accepting unsafe content", () => {
  annotate();
  f.write("course/001-values/lesson.html", '<section data-cl-teaches="Ownership">orphan</section>');
  const term = glossaryWithOrigins("course", glossary()).terms[0];
  expect(term.definition).toBe("Each value has an owner.");
  expect(term.origin?.status).toBe("error");
  expect("message" in term.origin! && term.origin.message).toContain(
    "course/001-values/lesson.html",
  );
  expect("url" in term.origin!).toBe(false);
});
it("refuses symlink origin reads instead of following private targets", () => {
  annotate();
  fs.symlinkSync(f.root + "/course/001-values", f.root + "/course/006-linked");
  const result = glossaryWithOrigins("course", glossary());
  expect(result.terms[0].origin?.status).toBe("error");
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE_KEY|PRIVATE_STRATEGY/);
  f.write("outside-review-state.json", "[]");
  fs.symlinkSync(f.root + "/outside-review-state.json", f.root + "/course/.reviews.json");
  expect(lessonPrerequisites("course", "003-predictions").error).toContain(".reviews.json");
});
it("uses only explicit backward builds-on edges, preserving related/upcoming/gate semantics", () => {
  expect(lessonPrerequisites("course", "003-predictions").links).toEqual([]);
  const file = "course/MISSION.md",
    mission = fs.readFileSync(f.root + "/" + file, "utf8");
  f.write(file, mission.replace('"kind": "related"', '"kind": "builds-on"'));
  expect(lessonPrerequisites("course", "003-predictions").links).toEqual([
    { title: "Values and ownership", url: "/c/course/001-values" },
  ]);
  expect(lessonPrerequisites("course", "002-borrow").links).toEqual([]);
  expect(lessonPrerequisites("course", "005-review").links).toEqual([]);
  f.write(
    file,
    mission.replace("001-values/@objective/ownership", "https://private/@objective/key"),
  );
  expect(lessonPrerequisites("course", "003-predictions").error).toContain("MISSION.md");
  f.write(file, "Legacy prose. Ownership and borrowing.");
  expect(lessonPrerequisites("course", "003-predictions").links).toEqual([]);
});

it("uses released existing teaching targets without inventing a section for legacy objectives", () => {
  const missionFile = "course/MISSION.md",
    mission = fs.readFileSync(f.root + "/" + missionFile, "utf8");
  f.write(
    missionFile,
    mission.replace(
      '"connections": [',
      '"connections": [{"from":"003-predictions/@objective/ownership","to":"002-borrow/@objective/ownership","kind":"builds-on"},',
    ),
  );
  expect(lessonPrerequisites("course", "003-predictions").links).toEqual([]);
  const submission = store.createSubmission({
    classroom: "course",
    lesson: "002-borrow",
    quizId: "pretest-1",
    quizTitle: "Diagnostic",
    kind: "pretest",
    answers: [{ questionId: "q1", type: "short", value: "Prediction" }],
  });
  applyGrade(submission, {
    score: 0,
    feedbackMarkdown: "Read teaching",
    questions: [{ questionId: "q1", correct: false, feedback: "Diagnostic" }],
  });
  expect(lessonPrerequisites("course", "003-predictions").links).toEqual([
    { title: "Borrowing", url: "/c/course/002-borrow#teach-borrow" },
  ]);
  expect([
    ...teachingAnchors(
      '<section id="safe">Teaching</section><section id="dup"></section><p id="dup"></p><section hidden id="hidden"></section><article id="../unsafe"></article>',
    ),
  ]).toEqual(["safe"]);
});
