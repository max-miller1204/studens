import * as fs from "node:fs";
import * as path from "node:path";
import type { Glossary } from "../glossary.ts";
import { parseGlossary } from "../glossary.ts";
import { classroomDir, isDir, isFile, safeStaticFile } from "../paths.ts";

/** The classroom's GLOSSARY.md, parsed. A classroom with no glossary has no terms. */
export function readGlossary(classroom: string): Glossary {
  const file = path.join(classroomDir(classroom), "GLOSSARY.md");
  if (!isFile(file)) return { terms: [], errors: [] };
  return parseGlossary(fs.readFileSync(file, "utf8"));
}

// ── Classroom documents (MISSION.md and friends) ──────────────────────────────

/** Markdown documents a classroom may carry, in the order the UI shows them. */
export const CLASSROOM_DOCS = ["MISSION.md", "RESOURCES.md", "GLOSSARY.md", "NOTES.md"] as const;

export function listClassroomDocs(classroom: string): string[] {
  const dir = classroomDir(classroom);
  return CLASSROOM_DOCS.filter((doc) => isFile(path.join(dir, doc)));
}

export function listLearningRecords(classroom: string): string[] {
  const root = classroomDir(classroom);
  const dir = path.join(root, "learning-records");
  if (!isDir(dir)) return [];
  if (!safeStaticFile(root, "learning-records"))
    throw new Error("Learning records directory must not be a symlink.");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((file) => {
      if (!safeStaticFile(root, `learning-records/${file}`))
        throw new Error(`Learning record must not be a symlink: ${file}.`);
      return file;
    })
    .sort();
}

/** Every learning record with its contents, oldest first. */
export function readLearningRecords(classroom: string): Array<{ file: string; markdown: string }> {
  const dir = path.join(classroomDir(classroom), "learning-records");
  return listLearningRecords(classroom).map((file) => ({
    file,
    markdown: fs.readFileSync(path.join(dir, file), "utf8"),
  }));
}

export function listReferenceDocs(classroom: string): string[] {
  const dir = path.join(classroomDir(classroom), "reference");
  if (!isDir(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".html"))
    .sort();
}
