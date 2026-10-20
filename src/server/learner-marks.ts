import type * as http from "node:http";
import { lessonParams, readJsonBody, sendJson } from "./http.ts";
import { MarkError, editLearnerMarks, readLearnerMarks } from "../store/learner-marks.ts";
import { readLesson } from "../store.ts";
import { reviewSessions } from "../review-session.ts";
import { learnerMarksFile } from "../paths.ts";
import { readPublicState } from "../public-state-errors.ts";
import { stateReadError } from "../state-errors.ts";

/** Learner-owned data never touches question hooks, grading, or service requests. */
export async function handleLearnerMarks(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): Promise<void> {
  if (req.method !== "GET" && req.method !== "POST")
    return sendJson(res, { error: "Use GET or POST for learner marks." }, 405);
  const params = lessonParams(url);
  if (!params) return sendJson(res, { error: "A valid classroom and lesson are required." }, 400);
  try {
    learnerMarksFile(params.classroom, params.lesson); // Guard ancestors before lesson discovery.
    if (
      !readPublicState("learner marks lesson metadata", () =>
        readLesson(params.classroom, params.lesson),
      )
    )
      return sendJson(res, { error: "Unknown lesson." }, 404);
    if (
      reviewSessions(params.classroom).some(
        (s) => s.lesson === params.lesson && s.status !== "done",
      )
    )
      return sendJson(res, { error: "This review is not ready." }, 409);
    if (req.method === "GET")
      return sendJson(res, {
        marks: readPublicState("learner marks (.learner-marks.json)", () =>
          readLearnerMarks(params.classroom, params.lesson),
        ),
      });
    let body: unknown;
    try {
      body = await readJsonBody(req, 32 * 1024);
    } catch (error) {
      return sendJson(
        res,
        { error: `Invalid learner mark request: ${(error as Error).message}` },
        400,
      );
    }
    const marks = editLearnerMarks(params.classroom, params.lesson, body);
    sendJson(res, { marks });
  } catch (error) {
    sendJson(
      res,
      {
        error:
          error instanceof MarkError
            ? error.message
            : stateReadError("learner marks save (.learner-marks.json)", error).message,
      },
      error instanceof MarkError ? error.status : 500,
    );
  }
}
