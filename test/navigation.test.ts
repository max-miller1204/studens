import { afterEach, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { makeFixture, seedClassroom } from "./helpers.ts";
import * as server from "../src/server.ts";
import * as store from "../src/store.ts";
let fixture: ReturnType<typeof makeFixture>;
afterEach(async () => {
  await server.close();
  fixture.cleanup();
});
it("projects only published public navigation metadata without writes and rejects corrupt folders", async () => {
  fixture = makeFixture();
  seedClassroom(fixture);
  fixture.write("rust/001-ownership/quiz/private.json", '{"secret":"PRIVATE KEY"}');
  seedClassroom(fixture, { lesson: "003-unpublished" });
  fixture.write(
    "rust/.lesson-requests.json",
    JSON.stringify({
      version: 1,
      requests: [
        {
          id: "00000000-0000-4000-8000-000000000140",
          classroom: "rust",
          lesson: "003-unpublished",
          topic: "Unpublished secret",
          owner: "codex",
          ownerPid: process.pid,
          at: Date.now(),
          status: "failed",
        },
      ],
    }),
  );
  store.editClassroomFolders({ action: "create", name: "Languages" });
  const files = () =>
    Object.fromEntries(
      fs
        .readdirSync(fixture.root, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => {
          const file = path.join(entry.parentPath, entry.name);
          return [path.relative(fixture.root, file), fs.readFileSync(file, "utf8")];
        }),
    );
  const before = files();
  const base = await server.start(0);
  const response = await fetch(base + "/api/navigation");
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.classrooms).toEqual([{ name: "rust", title: "Rust", due: 0 }]);
  expect(result.lessons).toEqual([
    { url: "/c/rust/001-ownership", title: "Ownership", classroomTitle: "Rust" },
  ]);
  expect(result.folders[0].name).toBe("Languages");
  expect(JSON.stringify(result)).not.toContain(fixture.root);
  expect(JSON.stringify(result)).not.toContain("PRIVATE KEY");
  expect(files()).toEqual(before);
  fixture.write(".folders.json", "{");
  const failed = await fetch(base + "/api/navigation");
  expect(failed.status).toBe(500);
  expect((await failed.json()).error).toContain("Cannot read JSON state");
  expect(fs.readFileSync(path.join(fixture.root, ".folders.json"), "utf8")).toBe("{");
});
