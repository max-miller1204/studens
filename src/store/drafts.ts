import { draftsFile } from "../paths.ts";
import { readJson, writeJson } from "./json.ts";

/**
 * Text and answers the learner typed but has not sent, keyed by the place on the page
 * (see assets/runtime/draft.mjs). Drafts are never shown to the teacher.
 */
export type Drafts = Record<string, unknown>;

export function readDrafts(classroom: string, lesson: string): Drafts {
  return readJson<Drafts>(draftsFile(classroom, lesson)) ?? {};
}

/** Save one draft. The caller validates `value` with `draftErrors` first. */
export function saveDraft(classroom: string, lesson: string, key: string, value: unknown): void {
  const drafts = readDrafts(classroom, lesson);
  drafts[key] = value;
  writeJson(draftsFile(classroom, lesson), drafts);
}

/** Remove one draft, after the learner sends it or throws it away. */
export function clearDraft(classroom: string, lesson: string, key: string): void {
  const drafts = readDrafts(classroom, lesson);
  if (!Object.hasOwn(drafts, key)) return;
  delete drafts[key];
  writeJson(draftsFile(classroom, lesson), drafts);
}
