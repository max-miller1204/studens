import { randomUUID } from "node:crypto";
import { isValidSlug, reflectionsFile } from "../paths.ts";
import { readJson, writeJson } from "./json.ts";

/** A self-explanation the learner wrote in a `form.cl-reflect`. It is never graded. */
export interface Reflection {
  id: string;
  classroom: string;
  lesson: string;
  reflectId: string;
  prompt: string;
  text: string;
  savedAt: number;
}

/** Every saved reflection in a lesson, oldest first. Each save is kept. */
export function listReflections(classroom: string, lesson: string): Reflection[] {
  if (!isValidSlug(classroom) || !isValidSlug(lesson)) return [];
  return readJson<Reflection[]>(reflectionsFile(classroom, lesson), "array") ?? [];
}

export function createReflection(input: Omit<Reflection, "id" | "savedAt">): Reflection {
  const list = listReflections(input.classroom, input.lesson);
  const last = list.length > 0 ? list[list.length - 1].savedAt : 0;
  const reflection: Reflection = {
    ...input,
    id: randomUUID(),
    savedAt: Math.max(Date.now(), last + 1),
  };
  list.push(reflection);
  writeJson(reflectionsFile(input.classroom, input.lesson), list);
  return reflection;
}

/** The latest save of each reflection in a lesson. */
export function latestReflections(classroom: string, lesson: string): Reflection[] {
  const latest = new Map<string, Reflection>();
  for (const reflection of listReflections(classroom, lesson)) {
    latest.set(reflection.reflectId, reflection);
  }
  return [...latest.values()];
}
