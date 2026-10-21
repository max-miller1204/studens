import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { makeFixture, seedClassroom, type Fixture } from "./helpers.ts";
import { MigrationError, migrateClassrooms } from "../src/migrate.ts";
import { TeacherService } from "../src/teacher-service.ts";
import { readTeacherState } from "../src/service-state.ts";
import { lessonRequests } from "../src/next-lesson.ts";
import { reviewSessions } from "../src/review-session.ts";
import { dailyReviews } from "../src/store/daily-review.ts";
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

// Inject process interruption before/after each filesystem mutation, including
// backup/journal/marker publication. Disable injection while inspecting recovery.
const fault = vi.hoisted(() => ({ active: false, at: 0, stop: -1, after: false }));
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  const wrapped = { ...fs };
  for (const name of [
    "mkdirSync",
    "writeFileSync",
    "copyFileSync",
    "renameSync",
    "rmSync",
  ] as const) {
    (wrapped as any)[name] = (...args: any[]) => {
      const stop = fault.active && ++fault.at === fault.stop;
      if (stop && !fault.after) throw new Error("simulated interruption");
      if (stop && fault.after && name === "writeFileSync") {
        fs.writeFileSync(args[0], String(args[1]).slice(0, 3), args[2]);
        throw new Error("simulated interruption");
      }
      if (stop && fault.after && name === "copyFileSync") {
        fs.writeFileSync(args[1], fs.readFileSync(args[0]).subarray(0, 3));
        throw new Error("simulated interruption");
      }
      const result = (fs[name] as Function)(...args);
      if (stop) throw new Error("simulated interruption");
      return result;
    };
  }
  return wrapped;
});

function interruptedFixture(applied: number) {
  f.write(
    "rust/.teacher.json",
    JSON.stringify({
      version: 1,
      identity: { backend: "pi" },
      messages: [],
      requests: [
        {
          id: "quiz:current",
          kind: "quiz",
          status: "planned",
          planVersion: 2,
          applied,
          planValidated: true,
          plan: { calls: [{ name: "grade_quiz_answers", arguments_json: "{}" }] },
        },
      ],
    }),
  );
  f.write(
    "rust/.lesson-requests.json",
    JSON.stringify({
      version: 1,
      requests: [
        {
          id: randomUUID(),
          classroom: "rust",
          lesson: "002-service-lesson",
          topic: "",
          at: 1,
          ownerPid: 1,
          owner: "pi",
          delivery: "service",
          status: "failed",
          ownerSession: "initiator",
        },
      ],
    }),
  );
  f.write(
    `rust/${lesson}/teacher-messages.json`,
    JSON.stringify([{ id: "old", role: "teacher", text: "Saved feedback", at: 1 }]),
  );
  const a = store.createAnnotation({
    classroom: "rust",
    lesson,
    question: "Why?",
    selection: "one owner",
    anchor: { exact: "one owner", prefix: "", suffix: "", occurrence: 0 },
  });
  const file = `rust/${lesson}/annotations.json`;
  const annotations = json(file);
  annotations.find((saved: any) => saved.id === a.id).status = "failed";
  f.write(file, JSON.stringify(annotations));
}

it.each([0, 1])(
  "recovers every mutation boundary without losing current plans (applied %s)",
  (applied) => {
    interruptedFixture(applied);
    fault.at = 0;
    fault.stop = -1;
    fault.active = true;
    try {
      migrateClassrooms();
    } finally {
      fault.active = false;
    }
    const count = fault.at;
    expect(count).toBeGreaterThan(10);
    for (const after of [false, true])
      for (let stop = 1; stop <= count; stop++) {
        f.cleanup();
        f = makeFixture();
        seedClassroom(f);
        interruptedFixture(applied);
        const original = snapshot();
        Object.assign(fault, { active: true, at: 0, stop, after });
        try {
          expect(() => migrateClassrooms()).toThrow("simulated interruption");
        } finally {
          fault.active = false;
        }
        migrateClassrooms();
        const state = json("rust/.teacher.json");
        expect(state.requests[0]).toMatchObject({
          status: "planned",
          applied,
          planValidated: true,
          plan: { calls: [{ name: "grade_quiz_answers" }] },
        });
        expect(state.messages.filter((m: any) => m.id === "old")).toHaveLength(1);
        expect(state.requests.filter((r: any) => r.kind === "ask")).toHaveLength(1);
        expect(json("rust/.lesson-requests.json").requests[0].status).toBe("failed");
        expect(json(".studens-format.json")).toEqual({ version: 1 });
        expect(fs.readFileSync(path.join(f.root, ".migrations/1/rust/.teacher.json"), "utf8")).toBe(
          original["rust/.teacher.json"],
        );
        const completed = snapshot();
        expect(migrateClassrooms()).toEqual([]);
        expect(snapshot()).toEqual(completed);
        expect(store.listGrades("rust", lesson)).toEqual([]);
      }
  },
);

it("converts empty daily groups even when their saved plan is unfinished", () => {
  const id = randomUUID();
  f.write(
    ".daily-reviews.json",
    JSON.stringify({
      version: 1,
      requests: [
        {
          id,
          owner: "pi",
          at: 1,
          groups: [
            {
              classroom: "rust",
              title: "Rust",
              empty: true,
              plan: {
                id: randomUUID(),
                classroom: "rust",
                owner: "pi",
                ownerPid: 1,
                at: 1,
                lesson: "002-review",
                items: [{ key: `${lesson}/check-1/q1` }],
                status: "failed",
              },
            },
          ],
        },
      ],
    }),
  );
  migrateClassrooms();
  expect(dailyReviews()[0]).toMatchObject({
    id,
    owner: "service",
    groups: [{ empty: true, plan: { owner: "service", status: "failed" } }],
  });
});

it.each(["classroom", "lesson", "reviews", "source", "backup", "temporary", "marker", "journal"])(
  "rejects a symlink at the %s boundary before touching outside data",
  (boundary) => {
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "studens-migration-outside-"));
    const outside = {
      root: outsideRoot,
      write: (name: string, content: string) =>
        fs.writeFileSync(path.join(outsideRoot, name), content),
      cleanup: () => fs.rmSync(outsideRoot, { recursive: true, force: true }),
    };
    try {
      outside.write("sentinel", "private original");
      outside.write("teacher-messages.json", "[]");
      outside.write(".teacher.json", "{}");
      interruptedFixture(1);
      const link = (relative: string, target: string) => {
        const file = path.join(f.root, relative);
        fs.rmSync(file, { recursive: true, force: true });
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.symlinkSync(path.join(outside.root, target), file);
      };
      if (boundary === "classroom") link("rust", ".");
      if (boundary === "lesson") link(`rust/${lesson}`, ".");
      if (boundary === "reviews") link("rust/.reviews", ".");
      if (boundary === "source") link("rust/.teacher.json", ".teacher.json");
      if (boundary === "backup") link(".migrations", ".");
      if (boundary === "temporary") link("rust/.teacher.json.migrate.tmp", "sentinel");
      if (boundary === "marker") link(".studens-format.json.migrate.tmp", "sentinel");
      if (boundary === "journal") link(".migrations/1/.plan.json.migrate.tmp", "sentinel");
      const before = fs
        .readdirSync(outside.root)
        .map((file) => [file, fs.readFileSync(path.join(outside.root, file), "utf8")]);
      expect(() => migrateClassrooms()).toThrow("symlink");
      expect(
        fs
          .readdirSync(outside.root)
          .map((file) => [file, fs.readFileSync(path.join(outside.root, file), "utf8")]),
      ).toEqual(before);
      expect(fs.existsSync(path.join(f.root, ".studens-format.json"))).toBe(false);
    } finally {
      outside.cleanup();
    }
  },
);

it.each([false, true])("recovers an interrupted fresh-root marker (partial write: %s)", (after) => {
  for (const stop of [1, 2]) {
    f.cleanup();
    f = makeFixture();
    seedClassroom(f);
    Object.assign(fault, { active: true, at: 0, stop, after });
    try {
      expect(() => migrateClassrooms()).toThrow("simulated interruption");
    } finally {
      fault.active = false;
    }
    expect(migrateClassrooms()).toEqual([]);
    expect(json(".studens-format.json")).toEqual({ version: 1 });
  }
});

it("preflights recovery destinations again before replaying the saved plan", () => {
  f.write(
    ".migrations/1/.plan.json",
    JSON.stringify({
      version: 1,
      changes: [{ file: "rust/.teacher.json", value: { private: "new" } }],
      removals: [],
    }),
  );
  const outside = f.write("original.json", "private original");
  fs.symlinkSync(outside, path.join(f.root, "rust/.teacher.json"));
  const before = snapshot();
  expect(() => migrateClassrooms()).toThrow("symlink");
  expect(snapshot()).toEqual(before);
  expect(fs.readFileSync(outside, "utf8")).toBe("private original");
});

it("keeps the migration journal separate from a classroom named plan.json", () => {
  seedClassroom(f, { classroom: "plan.json" });
  f.write(
    "plan.json/001-ownership/teacher-messages.json",
    JSON.stringify([{ id: "old", role: "teacher", text: "Saved", at: 1 }]),
  );
  migrateClassrooms();
  expect(json("plan.json/.teacher.json").messages).toHaveLength(1);
  expect(json(".migrations/1/plan.json/001-ownership/teacher-messages.json")).toHaveLength(1);
  expect(json(".migrations/1/.plan.json").version).toBe(1);
});
