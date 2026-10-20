import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { makeFixture, seedClassroom, type Fixture } from "./helpers.ts";
import { MigrationError, migrateClassrooms } from "../src/migrate.ts";
import { TeacherService } from "../src/teacher-service.ts";
import { readTeacherState } from "../src/service-state.ts";
import { lessonRequests } from "../src/next-lesson.ts";
import { reviewSessions } from "../src/review-session.ts";
import * as store from "../src/store.ts";

let f: Fixture;
const lesson = "001-ownership";
const json = (relative: string) => JSON.parse(fs.readFileSync(path.join(f.root, relative), "utf8"));
const snapshot = () =>
  Object.fromEntries(
    fs
      .readdirSync(f.root, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => {
        const file = path.join(e.parentPath, e.name);
        return [path.relative(f.root, file), fs.readFileSync(file, "utf8")];
      }),
  );
beforeEach(() => {
  f = makeFixture();
  seedClassroom(f);
});
afterEach(() => f.cleanup());

function legacyReview(status: string) {
  const id = randomUUID();
  f.write(
    "rust/.reviews.json",
    JSON.stringify({
      version: 1,
      requests: [
        {
          owner: "pi",
          ownerPid: 1,
          id,
          classroom: "rust",
          lesson: `002-review-${id.slice(0, 8)}`,
          at: 1,
          items: [{ key: `${lesson}/check-1/q1` }],
          status,
        },
      ],
    }),
  );
  return id;
}

it("marks a root once and leaves current data unchanged", () => {
  const before = snapshot();
  expect(migrateClassrooms()).toEqual([]);
  expect(json(".studens-format.json")).toEqual({ version: 1 });
  const after = snapshot();
  delete after[".studens-format.json"];
  expect(after).toEqual(before);
  expect(migrateClassrooms()).toEqual([]);
});

it("refuses an unknown format marker", () => {
  f.write(".studens-format.json", JSON.stringify({ version: 9 }));
  expect(() => migrateClassrooms()).toThrow(MigrationError);
  expect(() => migrateClassrooms()).toThrow("format 9");
});

it.each([
  ["a live-session Pi route", () => f.write(".pi-teach-pi/phone.json", "{}"), "tailnet route"],
  ["an unfinished Pi review", () => legacyReview("failed"), "unfinished live-session Pi review"],
  [
    "an unfinished Pi lesson request",
    () =>
      f.write(
        "rust/.lesson-requests.json",
        JSON.stringify({
          version: 1,
          requests: [{ id: randomUUID(), owner: "pi", status: "queued", ownerPid: 1 }],
        }),
      ),
    "unfinished live-session Pi lesson request",
  ],
  [
    "an unfinished Pi panel request",
    () =>
      f.write(
        "rust/.pi-teacher-resumes.json",
        JSON.stringify([{ id: "resume:s1", status: "running" }]),
      ),
    "unfinished live-session Pi teacher panel request resume:s1",
  ],
  [
    "a partly applied old grading plan",
    () =>
      f.write(
        "rust/.teacher.json",
        JSON.stringify({
          version: 1,
          identity: { backend: "codex" },
          messages: [],
          requests: [
            {
              id: "quiz:s1",
              kind: "quiz",
              status: "planned",
              applied: 1,
              plan: { calls: [{ name: "grade_lesson_quiz", arguments_json: "{}" }] },
            },
          ],
        }),
      ),
    "partly applied grading plan quiz:s1",
  ],
])("stops on %s with a specific error and changes nothing", (_name, seed, error) => {
  seed();
  const before = snapshot();
  expect(() => migrateClassrooms()).toThrow(error);
  expect(snapshot()).toEqual(before);
});

it("upgrades finished live-session Pi work, backs up originals, and is repeatable", () => {
  const id = legacyReview("done");
  const request = randomUUID();
  f.write(
    "rust/.lesson-requests.json",
    JSON.stringify({
      version: 1,
      requests: [
        {
          id: request,
          classroom: "rust",
          lesson: "002-lesson",
          topic: "",
          owner: "pi",
          ownerPid: 1,
          ownerSession: "old",
          at: 1,
          status: "done",
        },
      ],
    }),
  );
  f.write("rust/.pi-teacher-resumes.json", JSON.stringify([{ id: "resume:s1", status: "done" }]));
  const originalReviews = fs.readFileSync(path.join(f.root, "rust/.reviews.json"), "utf8");
  const changed = migrateClassrooms();
  expect(changed.map((file) => path.relative(f.root, file)).sort()).toEqual([
    "rust/.lesson-requests.json",
    "rust/.pi-teacher-resumes.json",
    "rust/.reviews.json",
  ]);
  expect(reviewSessions("rust")[0]).toMatchObject({ id, owner: "service" });
  expect(lessonRequests("rust")[0]).not.toHaveProperty("ownerSession");
  expect(fs.existsSync(path.join(f.root, "rust/.pi-teacher-resumes.json"))).toBe(false);
  expect(fs.readFileSync(path.join(f.root, ".migrations/1/rust/.reviews.json"), "utf8")).toBe(
    originalReviews,
  );
  expect(migrateClassrooms()).toEqual([]);
});

it("drops an unapplied old grading plan so only an explicit retry grades it", async () => {
  const s = store.createSubmission({
    classroom: "rust",
    lesson,
    quizId: "check-1",
    quizTitle: "Check",
    kind: "check",
    answers: [{ questionId: "q1", value: "a" }],
  });
  f.write(
    "rust/.teacher.json",
    JSON.stringify({
      version: 1,
      identity: { backend: "codex" },
      messages: [],
      requests: [
        {
          id: `quiz:${s.id}`,
          classroom: "rust",
          lesson,
          kind: "quiz",
          target: s.id,
          prompt: "saved",
          at: 1,
          status: "planned",
          planValidated: true,
          plan: {
            calls: [{ name: "grade_lesson_quiz", arguments_json: "{}" }],
            message: "",
            learning_record: "",
            notes_markdown: "",
          },
        },
        { id: "chat:old", kind: "chat", status: "done", planVersion: 2 },
      ],
    }),
  );
  migrateClassrooms();
  const [quiz, chat] = readTeacherState("rust")!.requests;
  expect(quiz).toMatchObject({ status: "failed", error: expect.stringContaining("Retry") });
  expect(quiz).not.toHaveProperty("plan");
  expect(chat).not.toHaveProperty("planVersion");
  let runs = 0;
  const teacher = new TeacherService(async () => {
    runs++;
    throw new Error("stop");
  });
  teacher.restore();
  await teacher.idle();
  expect(runs).toBe(0);
  expect(store.listGrades("rust", lesson)).toEqual([]);
  await teacher.stop();
});

it("moves Pi panel history and failed questions into a Pi teacher state", async () => {
  f.write(
    `rust/${lesson}/teacher-messages.json`,
    JSON.stringify([
      { id: "quiz:s1", lesson, role: "teacher", text: "Who owns the moved buffer?", at: 5 },
    ]),
  );
  const annotation = store.createAnnotation({
    classroom: "rust",
    lesson,
    question: "Why?",
    selection: "one owner",
    anchor: { exact: "one owner", prefix: "", suffix: "", occurrence: 0 },
  });
  store.updateAnnotation(annotation.id, { status: "failed", answeredAt: 9 });
  migrateClassrooms();
  expect(fs.existsSync(path.join(f.root, `rust/${lesson}/teacher-messages.json`))).toBe(false);
  const state = readTeacherState("rust")!;
  expect(state.identity.backend).toBe("pi");
  expect(state.messages).toEqual([
    expect.objectContaining({ id: "quiz:s1", sourceBackend: "pi", at: 5 }),
  ]);
  expect(state.requests).toEqual([
    expect.objectContaining({ id: `ask:${annotation.id}`, status: "failed" }),
  ]);
  expect(store.findAnnotation(annotation.id)!.status).toBe("pending");
  let runs = 0;
  const teacher = new TeacherService(async () => {
    runs++;
    return {
      calls: [
        {
          name: "answer_lesson_question",
          arguments_json: JSON.stringify({ annotation_id: annotation.id, answer_markdown: "Hi" }),
        },
      ],
      message: "",
      learning_record: "",
      notes_markdown: "",
    };
  });
  teacher.restore();
  await teacher.idle();
  expect(runs).toBe(0);
  const panel = teacher.publicState("rust", lesson) as any;
  expect(panel.messages[0]).toMatchObject({
    text: "Who owns the moved buffer?",
    sourceBackend: "pi",
  });
  teacher.retry("rust", `ask:${annotation.id}`);
  await teacher.idle();
  expect(runs).toBe(1);
  expect(store.findAnnotation(annotation.id)!.answerMarkdown).toBe("Hi");
  await teacher.stop();
});
