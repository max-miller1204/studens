import type * as http from "node:http";
import { isValidSlug } from "../paths.ts";
import type { ReviewSession } from "../review-session.ts";
import {
  currentReview,
  publicReview,
  requireReviewOwner,
  reviewSessions,
  startReview,
  updateReview,
} from "../review-session.ts";
import * as store from "../store.ts";
import { hooks } from "./hooks.ts";
import { readJsonBody, sendJson } from "./http.ts";

export async function handleReview(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  route: string,
  url: URL,
): Promise<void> {
  if (route === "review" && req.method === "GET") {
    const classroom = url.searchParams.get("classroom");
    if (!isValidSlug(classroom) || !store.readClassroom(classroom))
      return sendJson(res, { error: "Unknown classroom." }, 404);
    const session = currentReview(classroom);
    try {
      if (session && session.status !== "done" && hooks?.reviewOwner)
        requireReviewOwner(session, hooks.reviewOwner);
      return sendJson(res, { review: publicReview(session) });
    } catch (err) {
      return sendJson(res, { error: (err as Error).message }, 409);
    }
  }
  if ((route === "review" || route === "review/retry") && req.method === "POST") {
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    if (
      !body ||
      !isValidSlug(body.classroom) ||
      typeof body.id !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(body.id)
    )
      return sendJson(res, { error: "Invalid review request." }, 400);
    if (!store.readClassroom(body.classroom))
      return sendJson(res, { error: "Unknown classroom." }, 404);
    if (!hooks?.onReview || !hooks.onReviewRetry || !hooks.reviewOwner)
      return sendJson(res, { error: "No review teacher is connected." }, 409);
    let session: ReviewSession | undefined;
    try {
      hooks.canAccept?.(body.classroom);
      if (route === "review/retry") {
        session = reviewSessions(body.classroom).find((s) => s.id === body.id);
        if (!session || session.status !== "failed")
          throw new Error("This review cannot be retried.");
        requireReviewOwner(session, hooks.reviewOwner);
        hooks.onReviewRetry(session);
      } else {
        session = startReview(body.classroom, body.id, hooks.reviewOwner).session;
        if (session.status === "queued") hooks.onReview(session);
      }
      return sendJson(
        res,
        {
          review: publicReview(reviewSessions(body.classroom).find((s) => s.id === session!.id)!),
        },
        202,
      );
    } catch (err) {
      if (
        session &&
        session.owner === hooks.reviewOwner &&
        (session.status === "queued" || route === "review/retry")
      )
        updateReview(session, "failed", (err as Error).message);
      if (session && session.owner === hooks.reviewOwner)
        return sendJson(res, { review: publicReview(currentReview(body.classroom)) }, 202);
      return sendJson(res, { error: (err as Error).message }, 409);
    }
  }
}
