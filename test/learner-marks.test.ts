import { beforeEach, afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { makeFixture, seedClassroom, type Fixture } from "./helpers.ts";
import { learnerMarksFile } from "../src/paths.ts";
import { editLearnerMarks, readLearnerMarks } from "../src/store/learner-marks.ts";
import { createSelector, resolveSelector } from "../assets/runtime/anchor.mjs";
import * as store from "../src/store.ts";
import * as server from "../src/server.ts";

let f: Fixture;
const anchor = { exact: "one owner", prefix: "has ", suffix: ".", occurrence: 0 };
const command = (kind = "note", text = "My own note") => ({
  action: "create",
  id: randomUUID(),
  kind,
  text,
  anchor,
});
beforeEach(() => {
  f = makeFixture();
  seedClassroom(f);
});
afterEach(async () => {
  await server.close();
  f.cleanup();
});

describe("private learner marks", () => {
  it("persists all kinds separately, retries creates without duplication, and rejects stale edits/deletes", () => {
    const note = command();
    editLearnerMarks("rust", "001-ownership", note);
    editLearnerMarks("rust", "001-ownership", command("highlight", ""));
    editLearnerMarks("rust", "001-ownership", command("bookmark", ""));
    expect(editLearnerMarks("rust", "001-ownership", note)).toHaveLength(3);
    expect(store.listAnnotations("rust", "001-ownership")).toEqual([]);
    editLearnerMarks("rust", "001-ownership", {
      action: "edit",
      id: note.id,
      revision: 1,
      text: "Changed",
    });
    expect(() =>
      editLearnerMarks("rust", "001-ownership", {
        action: "edit",
        id: note.id,
        revision: 1,
        text: "Stale",
      }),
    ).toThrow("another tab");
    expect(() =>
      editLearnerMarks("rust", "001-ownership", { action: "delete", id: note.id, revision: 1 }),
    ).toThrow("another tab");
    expect(readLearnerMarks("rust", "001-ownership")[0].text).toBe("Changed");
    editLearnerMarks("rust", "001-ownership", { action: "delete", id: note.id, revision: 2 });
    expect(readLearnerMarks("rust", "001-ownership")).toHaveLength(2);
  });
  it("refuses locks and malformed state without replacing durable bytes", () => {
    const note = command();
    editLearnerMarks("rust", "001-ownership", note);
    const file = learnerMarksFile("rust", "001-ownership"),
      original = fs.readFileSync(file);
    fs.writeFileSync(file + ".lock", "interrupted process");
    expect(() => editLearnerMarks("rust", "001-ownership", command())).toThrow("locked");
    expect(fs.readFileSync(file)).toEqual(original);
    fs.unlinkSync(file + ".lock");
    for (const invalid of ["{", '{"version":2,"marks":[]}', '{"version":1,"marks":[{}]}']) {
      fs.writeFileSync(file, invalid);
      expect(() => readLearnerMarks("rust", "001-ownership")).toThrow();
      expect(() => editLearnerMarks("rust", "001-ownership", command())).toThrow();
      expect(fs.readFileSync(file, "utf8")).toBe(invalid);
      expect(fs.existsSync(file + ".lock")).toBe(false);
    }
  });
  it("rejects invalid identities, limits and private symlink ancestors", () => {
    for (const invalid of [
      null,
      { ...command(), id: "../bad" },
      { ...command(), text: "x".repeat(4001) },
      { ...command(), anchor: { ...anchor, occurrence: 0.5 } },
      { ...command(), anchor: { ...anchor, exact: "x".repeat(2001) } },
      { ...command("highlight"), text: "private" },
    ])
      expect(() => editLearnerMarks("rust", "001-ownership", invalid)).toThrow();
    expect(() => learnerMarksFile("../escape", "001-ownership")).toThrow();
    f.write("outside.json", '{"version":1,"marks":[]}');
    const target = path.join(f.root, "outside.json");
    fs.symlinkSync(target, learnerMarksFile("rust", "001-ownership"));
    expect(() => readLearnerMarks("rust", "001-ownership")).toThrow("symlink");
    expect(() => editLearnerMarks("rust", "001-ownership", command())).toThrow("symlink");
    expect(fs.readFileSync(target, "utf8")).toBe('{"version":1,"marks":[]}');
  });
  it("keeps APIs and static aliases private and wakes zero teacher hooks", async () => {
    let calls = 0;
    const wake = () => {
      calls++;
    };
    server.setHooks({ onAsk: wake, onFollowUp: wake, onReflect: wake, onQuizSubmit: wake });
    const base = await server.start(0),
      url = base + "/api/learner-marks?classroom=rust&lesson=001-ownership";
    const before = fs.readdirSync(path.join(f.root, "rust/001-ownership"));
    expect((await fetch(url)).status).toBe(200);
    expect(fs.readdirSync(path.join(f.root, "rust/001-ownership"))).toEqual(before);
    const note = command("note", "<img src=x onerror=alert(1)>");
    const post = (data: unknown) =>
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    expect((await post(note)).status).toBe(200);
    const concurrent = await Promise.all([post(command()), post(command("bookmark", ""))]);
    expect(concurrent.map((r) => r.status)).toEqual([200, 200]);
    expect(readLearnerMarks("rust", "001-ownership")).toHaveLength(3);
    expect((await post({ ...note, id: "../../x" })).status).toBe(400);
    expect((await post({ action: "edit", id: note.id, revision: 9, text: "no" })).status).toBe(409);
    expect((await fetch(url, { method: "PUT" })).status).toBe(405);
    const media = path.join(f.root, "rust/001-ownership/media");
    fs.mkdirSync(media);
    fs.symlinkSync(learnerMarksFile("rust", "001-ownership"), path.join(media, "notes.json"));
    for (const route of [".learner-marks.json", "media/notes.json", "quiz/key.json"])
      expect((await fetch(base + "/c/rust/001-ownership/" + route)).status).toBe(404);
    expect(store.listAnnotations("rust", "001-ownership")).toEqual([]);
    expect(store.listSubmissions("rust", "001-ownership")).toEqual([]);
    expect(store.listGrades("rust", "001-ownership")).toEqual([]);
    expect(calls).toBe(0);
  });
});

describe("learner text quote resolution", () => {
  it("uses canonical context to distinguish repeats, survives surrounding edits, exposes ties and missing quotes", () => {
    const text = "Drop the value. Move the value. Borrow the value.";
    const start = text.indexOf("the value", text.indexOf("Move"));
    const selected = createSelector(text, start, start + 9);
    expect(resolveSelector(text, selected)).toMatchObject({
      status: "resolved",
      start,
      exact: true,
    });
    expect(resolveSelector("New prose: the value. Changed.", selected)).toMatchObject({
      status: "resolved",
      exact: false,
    });
    expect(resolveSelector("Gone.", selected)).toEqual({ status: "missing" });
    expect(
      resolveSelector("the value / the value", {
        exact: "the value",
        prefix: "",
        suffix: "",
        occurrence: 1,
      }),
    ).toEqual({ status: "ambiguous" });
    expect(
      resolveSelector("#the value# #the value#", {
        exact: "the value",
        prefix: "#",
        suffix: "#",
        occurrence: 1,
      }),
    ).toEqual({ status: "ambiguous" });
  });
});
