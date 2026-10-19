/** Re-teaching is a request for help, never new assessment evidence. */
import { createHash } from "node:crypto";
import type { ReviewItem } from "./review.ts";
import * as store from "./store.ts";

export function reteachId(item: ReviewItem): string {
  return `reteach:${createHash("sha256").update(`${item.key}:${item.lastAt}`).digest("hex")}`;
}

/** Publish only the information needed to offer help on the original lesson page. */
export function reteachOffers(classroom: string, lesson: string) {
  return store
    .reviewItems(classroom)
    .filter((item) => item.lesson === lesson && item.needsReteach)
    .map((item) => ({
      key: item.key,
      prompt: item.prompt,
      misses: item.misses,
      id: `chat:${reteachId(item)}`,
    }));
}

export function prepareReteach(classroom: string, lesson: string, key: string) {
  const item = store
    .reviewItems(classroom)
    .find((item) => item.key === key && item.lesson === lesson);
  if (!item?.needsReteach)
    throw new Error("This item does not need re-teaching. Reload its current progress.");
  return {
    id: reteachId(item),
    text: `Please give me a short re-teach of “${item.prompt}”. I have missed this idea ${item.misses} times. Use another explanation and a short worked example, then ask one small question I can answer here.`,
  };
}

/** Private request instructions; keep implementation details out of the learner message. */
export function reteachPrompt(text: string): string {
  return `${text}\n\nThis is a request for help, not a learner answer. Give a short explanation and worked example, then one question. Do not grade, write learning records, record retrieval checks, change notes, or reset history. A re-teach is assisted study, not delayed retention. Keep the explanation and learner reply in this lesson teacher panel.`;
}
