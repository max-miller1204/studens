import { isValidSlug, panelMessagesFile } from "../paths.ts";
import { readJson, writeJson } from "./json.ts";

/**
 * One turn of the teacher panel conversation on a lesson page. Pi writes these; the
 * persistent service keeps the same shape in its own state file.
 */
export interface PanelMessage {
  id: string;
  lesson: string;
  role: "learner" | "teacher";
  text: string;
  at: number;
}

export function listPanelMessages(classroom: string, lesson: string): PanelMessage[] {
  if (!isValidSlug(classroom) || !isValidSlug(lesson)) return [];
  return readJson<PanelMessage[]>(panelMessagesFile(classroom, lesson), "array") ?? [];
}

/** Append a message. A repeated id and role is a resend, so it is not stored twice. */
export function addPanelMessage(
  classroom: string,
  input: Omit<PanelMessage, "at">,
): { message: PanelMessage; added: boolean } {
  const list = listPanelMessages(classroom, input.lesson);
  const existing = list.find((m) => m.id === input.id && m.role === input.role);
  if (existing) return { message: existing, added: false };
  const last = list.length > 0 ? list[list.length - 1].at : 0;
  const message: PanelMessage = {
    ...input,
    at: Math.max(Date.now(), last + 1),
  };
  list.push(message);
  writeJson(panelMessagesFile(classroom, input.lesson), list);
  return { message, added: true };
}
