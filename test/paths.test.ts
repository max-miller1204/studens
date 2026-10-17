import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { isValidSlug, safeJoin, safeStaticFile, isDir, isFile, slugify } from "../src/paths.ts";

describe("isValidSlug", () => {
  it("accepts the directory names classrooms and lessons actually use", () => {
    for (const slug of ["rust", "rust-ownership", "001-closures", "v1.2-notes"]) {
      expect(isValidSlug(slug)).toBe(true);
    }
  });

  it("rejects anything that could walk out of the classrooms root", () => {
    for (const slug of ["..", ".", "../etc", "a/b", "a\\b", "/abs", "", "A-Capital", "sp ace"]) {
      expect(isValidSlug(slug)).toBe(false);
    }
  });

  it("rejects non-strings and absurd lengths", () => {
    expect(isValidSlug(undefined)).toBe(false);
    expect(isValidSlug(42)).toBe(false);
    expect(isValidSlug("a".repeat(128))).toBe(true);
    expect(isValidSlug("a".repeat(129))).toBe(false);
  });
});

describe("slugify", () => {
  it("turns a topic into a directory name", () => {
    expect(slugify("Rust Ownership & Borrowing")).toBe("rust-ownership-borrowing");
  });

  it("strips accents rather than leaving a trailing separator", () => {
    expect(slugify("Café Culture")).toBe("cafe-culture");
  });

  it("never returns an empty name", () => {
    expect(slugify("!!!")).toBe("classroom");
    expect(slugify("")).toBe("classroom");
  });
});

describe("safeJoin", () => {
  const root = path.resolve("/tmp/classrooms-test");

  it("resolves a path beneath the root", () => {
    expect(safeJoin(root, "lesson/media/diagram.png")).toBe(
      path.join(root, "lesson/media/diagram.png"),
    );
  });

  it("rejects traversal, absolute paths, and null bytes", () => {
    expect(safeJoin(root, "../secrets")).toBeNull();
    expect(safeJoin(root, "a/../../secrets")).toBeNull();
    expect(safeJoin(root, "/etc/passwd")).toBeNull();
    expect(safeJoin(root, "a\0b")).toBeNull();
  });

  it("allows the root itself", () => {
    expect(safeJoin(root, "")).toBe(root);
  });
});

it("caps generated slugs at 64 characters and removes a separator at the cut", () => {
  expect(slugify("a".repeat(80))).toBe("a".repeat(64));
  expect(slugify("a".repeat(63) + " extra")).toBe("a".repeat(63));
});

it("propagates filesystem failures instead of treating them as missing paths", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "studens-path-errors-"));
  try {
    const loop = path.join(root, "loop");
    fs.symlinkSync("loop", loop);
    const inaccessible = path.join(loop, "child");
    for (const read of [
      () => safeStaticFile(inaccessible, "public.txt"),
      () => isDir(inaccessible),
      () => isFile(inaccessible),
    ]) {
      expect(read).toThrow(expect.objectContaining({ code: "ELOOP" }));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
