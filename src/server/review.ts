import type * as http from "node:http";
import { isValidSlug } from "../paths.ts";
import type { ReviewSession } from "../review-session.ts";
import {
  currentReview,
  publicReview,
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
  if (route === "review/items" && req.method === "GET") {
    const classroom = url.searchParams.get("classroom");
    if (!isValidSlug(classroom) || !store.readClassroom(classroom))
      return sendJson(res, { error: "Unknown classroom." }, 404);
    try {
      return sendJson(res, {
        items: store.reviewItems(classroom).map((item) => ({
          key: item.key,
          retiredAt: item.retiredAt,
          revision: item.controlRevision ?? 0,
        })),
      });
    } catch (error) {
      return sendJson(res, { error: (error as Error).message }, 409);
    }
  }
  if (route === "review/item" && req.method === "POST") {
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    if (
      !body ||
      !isValidSlug(body.classroom) ||
      typeof body.key !== "string" ||
      typeof body.retired !== "boolean" ||
      !Number.isSafeInteger(body.revision) ||
      (body.revision as number) < 0
    )
      return sendJson(res, { error: "Invalid review item action." }, 400);
    if (!store.readClassroom(body.classroom))
      return sendJson(res, { error: "Unknown classroom." }, 404);
    try {
      const item = store.setReviewRetired(
        body.classroom,
        body.key,
        body.retired,
        body.revision as number,
      );
      return sendJson(res, {
        item: { key: item.key, retiredAt: item.retiredAt, revision: item.controlRevision ?? 0 },
      });
    } catch (error) {
      return sendJson(res, { error: (error as Error).message }, 409);
    }
  }
  if (route === "review" && req.method === "GET") {
    const classroom = url.searchParams.get("classroom");
    if (!isValidSlug(classroom) || !store.readClassroom(classroom))
      return sendJson(res, { error: "Unknown classroom." }, 404);
    try {
      const session = currentReview(classroom);
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
        hooks.onReviewRetry(session);
      } else {
        session = startReview(
          body.classroom,
          body.id,
          hooks.reviewOwner,
          body.size === undefined ? undefined : (body.size as number),
          { topic: body.topic as string | undefined, early: body.early as boolean | undefined },
        ).session;
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
      if (session && (session.status === "queued" || route === "review/retry"))
        updateReview(session, "failed", (err as Error).message);
      if (session)
        return sendJson(res, { review: publicReview(currentReview(body.classroom)) }, 202);
      return sendJson(res, { error: (err as Error).message }, 409);
    }
  }
}
