import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { classroomsRoot, isValidSlug } from "../paths.ts";
import { readClassroom } from "./classrooms.ts";
import { readJson, writeJson } from "./json.ts";

/** Folder membership does not change classroom paths or lesson URLs. */
export interface ClassroomFolder {
  id: string;
  name: string;
  classrooms: string[];
}

export class FolderInputError extends Error {}

export class FolderBusyError extends Error {}

function folderName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80)
    throw new FolderInputError("Folder names must contain 1 to 80 characters.");
  return value.trim();
}

export function readClassroomFolders(): ClassroomFolder[] {
  const file = path.join(classroomsRoot(), ".folders.json");
  const data = readJson<{ folders?: unknown }>(file);
  if (data === null) return [];
  if (!Array.isArray(data.folders)) throw new Error(`Invalid folder state in ${file}.`);
  const ids = new Set<string>();
  const names = new Set<string>();
  const members = new Set<string>();
  for (const folder of data.folders) {
    if (
      !folder ||
      !isValidSlug(folder.id) ||
      ids.has(folder.id) ||
      typeof folder.name !== "string" ||
      !folder.name.trim() ||
      folder.name.trim() !== folder.name ||
      folder.name.length > 80 ||
      names.has(folder.name.toLowerCase()) ||
      !Array.isArray(folder.classrooms)
    )
      throw new Error(`Invalid folder state in ${file}.`);
    ids.add(folder.id);
    names.add(folder.name.toLowerCase());
    for (const classroom of folder.classrooms) {
      if (!isValidSlug(classroom) || members.has(classroom))
        throw new Error(`Invalid folder membership in ${file}.`);
      members.add(classroom);
    }
  }
  return data.folders as ClassroomFolder[];
}

/** Read the latest state for each edit. Replace the file as one write. */
export function editClassroomFolders(input: unknown): ClassroomFolder[] {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new FolderInputError("Invalid folder request.");
  const root = classroomsRoot();
  fs.mkdirSync(root, { recursive: true });
  const lock = path.join(root, ".folders.lock");
  let descriptor: number;
  try {
    descriptor = fs.openSync(lock, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new FolderBusyError(
        `Another server has locked folder edits. Retry after it finishes. If a server stopped during a save, remove ${lock} before retrying.`,
      );
    throw error;
  }
  try {
    fs.writeFileSync(descriptor, `${process.pid}\n`);
    return applyClassroomFolderEdit(input as Record<string, unknown>);
  } finally {
    fs.closeSync(descriptor);
    fs.unlinkSync(lock);
  }
}

function applyClassroomFolderEdit(command: Record<string, unknown>): ClassroomFolder[] {
  const folders = readClassroomFolders();
  if (command.action === "create" || command.action === "rename") {
    const name = folderName(command.name);
    if (
      folders.some(
        (f) =>
          f.name.toLowerCase() === name.toLowerCase() &&
          (command.action === "create" || f.id !== command.id),
      )
    )
      throw new FolderInputError("A folder with this name already exists.");
    if (command.action === "create") {
      folders.push({ id: randomUUID(), name, classrooms: [] });
    } else {
      const folder = folders.find((f) => f.id === command.id);
      if (!folder) throw new FolderInputError("This folder no longer exists. Reload the page.");
      folder.name = name;
    }
  } else if (command.action === "delete") {
    const index = folders.findIndex((f) => f.id === command.id);
    if (index === -1) throw new FolderInputError("This folder no longer exists. Reload the page.");
    folders.splice(index, 1);
  } else if (command.action === "move") {
    const classroom = command.classroom;
    if (!isValidSlug(classroom) || !readClassroom(classroom))
      throw new FolderInputError("This classroom no longer exists. Reload the page.");
    const target = folders.find((f) => f.id === command.id);
    if (command.id !== null && !target)
      throw new FolderInputError("This folder no longer exists. Reload the page.");
    for (const folder of folders)
      folder.classrooms = folder.classrooms.filter((c) => c !== classroom);
    if (target) target.classrooms.push(classroom);
  } else {
    throw new FolderInputError("Unknown folder action.");
  }
  const file = path.join(classroomsRoot(), ".folders.json");
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeJson(temporary, { folders });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return folders;
}
