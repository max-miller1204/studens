import type { LessonMeta } from "./store/classrooms.ts";

/** Contract versions are promises; an unsupported promise is never legacy data. */
export function validateLessonContractVersions(
  meta: LessonMeta | null,
  classroom: string,
  lesson: string,
): void {
  if (meta?.instructionalContract !== undefined && meta.instructionalContract !== 1)
    throw new Error(`Unknown instructional contract for ${classroom}/${lesson}.`);
  if (meta?.criterionContract !== undefined && meta.criterionContract !== 1)
    throw new Error("Unsupported criterion contract version.");
  if (meta?.assessmentContract !== undefined && meta.assessmentContract !== 1)
    throw new Error("Unsupported assessment contract version.");
  if (meta?.reviewVariantContract !== undefined && meta.reviewVariantContract !== 1)
    throw new Error("Unsupported review variant contract version.");
}
