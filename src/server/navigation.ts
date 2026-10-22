/** A read-only public projection. Never serialize classroom paths or private state. */
import type * as http from "node:http";
import * as store from "../store.ts";
import { dailyDue } from "../store/daily-review.ts";
import { lessonUrl } from "../paths.ts";
import { sendJson } from "./http.ts";

export function handleNavigation(res: http.ServerResponse): void {
  try {
    const due = dailyDue();
    const classrooms = store.listClassrooms();
    const folders = store.readClassroomFolders();
    sendJson(res, {
      due: Object.values(due).reduce((sum, count) => sum + count, 0),
      classrooms: classrooms.map((c) => ({ name: c.name, title: c.title, due: due[c.name] ?? 0 })),
      folders: folders.map((f) => ({ id: f.id, name: f.name })),
      lessons: classrooms.flatMap((c) =>
        store
          .listLessons(c.name)
          .filter((l) => l.kind === "lesson" && (l.latestScore === null || l.hasUngradedSubmission))
          .map((l) => ({
            url: lessonUrl(c.name, l.name),
            title: l.title,
            classroomTitle: c.title,
          })),
      ),
    });
  } catch (error) {
    sendJson(res, { error: (error as Error).message }, 500);
  }
}
