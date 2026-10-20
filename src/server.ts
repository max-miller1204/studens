import { handleSearch } from "./server/search.ts";
/**
 * server.ts — the in-process HTTP server behind /classroom.
 *
 * One loopback singleton per process, owned by the shared persistent service
 * for Pi, Claude Code, and Codex.
 * Hooks route browser requests to the owner for each host.
 *
 * Routes:
 *   GET    /                                  landing page
 *   GET    /c/<classroom>                     classroom page
 *   GET    /c/<classroom>/<lesson>            lesson, with the runtime injected
 *   GET    /c/<classroom>/assets/<path>       classroom-local assets
 *   GET    /c/<classroom>/<lesson>/media/<p>  lesson-local media
 *   GET    /doc/<classroom>/<file>.md         markdown document
 *   GET    /doc/<classroom>/learning-records       every learning record, summarised
 *   GET    /doc/<classroom>/learning-records/<file>.md
 *   GET    /doc/<classroom>/notes/<file>.md        a topic file indexed by NOTES.md
 *   GET    /r/<classroom>/<file>.html         reference document
 *   GET    /static/<file>                     bundled runtime assets
 *   POST   /api/ask                           ask a question about a highlight
 *   POST   /api/annotations/<id>/follow-up    ask a follow-up inside an existing card
 *   POST   /api/quiz/submit                   submit quiz answers for grading
 *   POST   /api/reflect                       save a self-explanation (never graded)
 *   PUT    /api/draft                         save or remove one unsent draft
 *   GET    /api/state                         annotations, quiz attempts, reflections, drafts
 *   GET    /api/glossary                      the classroom's GLOSSARY.md, parsed
 *   DELETE /api/annotations/<id>              remove a question
 *   POST   /api/teacher/chat                  reply to the teacher in the lesson's panel
 *   POST   /api/teacher/retry                 run a failed teacher request again
 *   GET    /api/events                        SSE: answer, grade, teacher, reload
 */

import * as http from "node:http";
import * as store from "./store.ts";
import { lessonUrl } from "./paths.ts";
import { readConfig, resolveConfiguredPort } from "./config.ts";
import { completeClosedSubmission } from "./quiz-grading.ts";
import { hooks } from "./server/hooks.ts";
import { closeEvents } from "./server/events.ts";
import { sendJson, sendNotFound, splitPath } from "./server/http.ts";
import { handleDailyPage } from "./server/daily-review.ts";
import { handleApi } from "./server/api.ts";
import {
  handleLanding,
  sendFavicon,
  handleStatic,
  handleClassroomRoute,
} from "./server/classrooms.ts";
import { handleDoc, handleReference } from "./server/records.ts";
export { setHooks, reviewSaved, reviewMiss, gradeSaved } from "./server/hooks.ts";
export type { ServerHooks } from "./server/hooks.ts";
export { pushEvent } from "./server/events.ts";
export { contentTypeFor, splitPath } from "./server/http.ts";

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  owner: http.Server,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const segments = splitPath(url.pathname);
  if (!segments) return sendNotFound(res, "Malformed URL");

  if (
    req.method === "GET" &&
    segments.length === 2 &&
    segments[0] === "api" &&
    segments[1] === "events" &&
    closingServers.has(owner)
  ) {
    res.setHeader("Connection", "close");
    return sendJson(res, { error: "Classroom server is shutting down." }, 503);
  }
  if (segments[0] === "api") return handleApi(req, res, segments.slice(1), url);
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.end("Method not allowed");
    return;
  }

  if (segments.length === 0) return handleLanding(res, url);
  if (
    segments[0] === "search" &&
    (segments.length === 1 || (segments.length === 2 && segments[1] === "source"))
  )
    return handleSearch(res, url);
  // Reason: lessons are plain documents with no <link rel="icon">, so the browser asks
  // for /favicon.ico and logs a 404 in the console on every lesson view.
  if (segments.length === 1 && segments[0] === "favicon.ico") return sendFavicon(res);
  if (segments[0] === "reviews") return handleDailyPage(res, segments.slice(1));
  if (segments[0] === "static") return handleStatic(res, segments.slice(1));
  if (segments[0] === "c") return handleClassroomRoute(res, segments.slice(1), getBaseUrl());
  if (segments[0] === "doc") return handleDoc(res, segments.slice(1));
  if (segments[0] === "r") return handleReference(res, segments.slice(1));

  sendNotFound(res, `No such page: ${url.pathname}`);
}

// A replacement listener may start while the previous one is still draining.
const closingServers = new WeakSet<http.Server>();
let server: http.Server | null = null;
let serverPort: number | null = null;
let starting: Promise<string> | null = null;

/** Start the session server. Reject an occupied configured port. */
export async function start(port?: number): Promise<string> {
  if (server && serverPort) return Promise.resolve(`http://127.0.0.1:${serverPort}`);

  if (starting) return starting;
  const preferredPort = port === undefined ? resolveConfiguredPort(readConfig().port) : port;
  // A process may have stopped between saving a submission and publishing its grade.
  // Its saved allocations are the plan; recovery never reads a changed rubric.
  for (const classroom of store.listClassrooms())
    for (const lesson of store.listLessons(classroom.name))
      for (const submission of store.listSubmissions(classroom.name, lesson.name))
        completeClosedSubmission(submission);

  starting = new Promise((resolve, reject) => {
    const s = http.createServer((req, res) => {
      void handleRequest(req, res, s).catch((err) => {
        console.error("[classroom] request failed", err);
        if (hooks?.delivery === "service" && req.url?.startsWith("/api/") && !res.headersSent) {
          sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500);
          return;
        }
        if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal error");
      });
    });

    s.on("error", (err: NodeJS.ErrnoException) => {
      reject(
        new Error(`Cannot start classroom server on port ${preferredPort}: ${err.message}`, {
          cause: err,
        }),
      );
    });

    s.listen(preferredPort, "127.0.0.1", () => {
      const addr = s.address();
      if (!addr || typeof addr === "string") {
        s.close();
        reject(new Error("Failed to determine server port"));
        return;
      }
      server = s;
      serverPort = addr.port;
      resolve(`http://127.0.0.1:${serverPort}`);
    });
  });
  try {
    return await starting;
  } finally {
    starting = null;
  }
}

export async function close(): Promise<void> {
  if (starting) await starting;
  return new Promise((resolve) => {
    if (!server) return resolve();
    const s = server;
    closingServers.add(s);
    server = null;
    serverPort = null;
    linkBase = null;
    closeEvents();
    s.close(() => resolve());
  });
}

let linkBase: string | null = null;
/** Build links on a checked tailnet base. The server still listens on loopback. */
export function setLinkBase(base: string | null): void {
  linkBase = base;
}

export function getBaseUrl(): string | null {
  return server && serverPort ? `http://127.0.0.1:${serverPort}` : null;
}

export function getPort(): number | null {
  return serverPort;
}

export function isRunning(): boolean {
  return server !== null;
}

/** URL for a classroom, or the landing page when no name is given. */
export function urlFor(classroom?: string, lesson?: string): string | null {
  const local = getBaseUrl();
  if (!local) return null;
  const base = linkBase ?? local;
  if (!classroom) return base;
  if (!lesson) return `${base}/c/${encodeURIComponent(classroom)}`;
  return `${base}${lessonUrl(classroom, lesson)}`;
}
