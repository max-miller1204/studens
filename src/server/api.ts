import type * as http from "node:http";
import { handleAsk, handleDeleteAnnotation, handleFollowUp } from "./annotations.ts";
import { handleEvents } from "./events.ts";
import { handleFolders } from "./folders.ts";
import { sendJson } from "./http.ts";
import { handleDraft, handleGlossary, handleReflect, handleState } from "./learner-state.ts";
import { handleQuizSubmit } from "./quizzes.ts";
import { handleReview } from "./review.ts";
import { handleTeacher } from "./teacher.ts";

export async function handleApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  rest: string[],
  url: URL,
): Promise<void> {
  const route = rest.join("/");
  if (route === "folders") return handleFolders(req, res);
  if (
    (route === "review" && req.method === "GET") ||
    ((route === "review" || route === "review/retry") && req.method === "POST")
  )
    return handleReview(req, res, route, url);
  if ((route === "teacher/chat" || route === "teacher/retry") && req.method === "POST")
    return handleTeacher(req, res, route);
  if (route === "events" && req.method === "GET") return handleEvents(req, res, url);
  if (route === "state" && req.method === "GET") return handleState(res, url);
  if (route === "ask" && req.method === "POST") return handleAsk(req, res);
  if (route === "quiz/submit" && req.method === "POST") return handleQuizSubmit(req, res);
  if (route === "reflect" && req.method === "POST") return handleReflect(req, res);
  if (route === "draft" && req.method === "PUT") return handleDraft(req, res);
  if (route === "glossary" && req.method === "GET") return handleGlossary(res, url);
  if (rest[0] === "annotations" && rest.length === 2 && req.method === "DELETE") {
    return handleDeleteAnnotation(res, rest[1], url);
  }
  if (
    rest[0] === "annotations" &&
    rest.length === 3 &&
    rest[2] === "follow-up" &&
    req.method === "POST"
  ) {
    return handleFollowUp(req, res, rest[1]);
  }

  sendJson(res, { error: `No such endpoint: /api/${route}` }, 404);
}
