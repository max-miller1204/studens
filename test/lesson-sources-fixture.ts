import type { Fixture } from "./helpers.ts";
import { seedCourse, addCourseIntentions } from "./course-map-fixture.ts";
import * as fs from "node:fs";
/** Explicit fixture provenance, distinct from real model authoring evidence. */
export function seedSourceCourse(f: Fixture): void {
  seedCourse(f);
  addCourseIntentions(f);
  f.write(
    "course/GLOSSARY.md",
    "# Rust glossary\n\n**Ownership**:\nA rule that assigns each value one owner.\n\n**Borrowing**:\nTemporary access to a value.\n",
  );
  const file = "course/001-values/lesson.html";
  f.write(
    file,
    fs
      .readFileSync(f.root + "/" + file, "utf8")
      .replace(
        "<p>Every value has an owner.</p>",
        '<section id="ownership" data-cl-teaches="Ownership"><p>Every value has an owner.</p></section>',
      ),
  );
  const lesson = "course/003-predictions/lesson.html";
  f.write(
    lesson,
    fs
      .readFileSync(f.root + "/" + lesson, "utf8")
      .replace("<main data-cl-content>", '<main class="cl-lesson-shell" data-cl-content>')
      .replace(
        "<h1>Next questions</h1>",
        "<h1>Next questions</h1><section><h2>Reason across boundaries</h2><p>Ownership helps you follow values through a program. Predict who can use a value after a call.</p></section><section><h2>Explain your choice</h2><p>Ownership also helps when reviewing a change.</p></section>",
      ),
  );
  const mission = "course/MISSION.md";
  f.write(
    mission,
    fs
      .readFileSync(f.root + "/" + mission, "utf8")
      .replace('"kind": "related"', '"kind": "builds-on"'),
  );
}
