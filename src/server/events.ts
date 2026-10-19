import type * as http from "node:http";
import { lessonParams, sendJson } from "./http.ts";

/** Keyed by `<classroom>/<lesson>` so an event only reaches the page it concerns. */
const sseClients = new Map<string, Set<http.ServerResponse>>();

function lessonKey(classroom: string, lesson: string): string {
  return `${classroom}/${lesson}`;
}

function addClient(key: string, res: http.ServerResponse): void {
  if (!sseClients.has(key)) sseClients.set(key, new Set());
  sseClients.get(key)!.add(res);
}

function removeClient(key: string, res: http.ServerResponse): void {
  const set = sseClients.get(key);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) sseClients.delete(key);
}

/** Push an event to every browser currently viewing a lesson. */
export function pushEvent(
  classroom: string,
  lesson: string,
  event: "answer" | "grade" | "reload" | "teacher",
  data: unknown,
): void {
  const clients = sseClients.get(lessonKey(classroom, lesson));
  if (!clients || clients.size === 0) return;
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of [...clients]) {
    try {
      res.write(frame);
    } catch {
      clients.delete(res);
    }
  }
}

export function handleEvents(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
  const params = lessonParams(url);
  if (!params) return sendJson(res, { error: "classroom and lesson are required" }, 400);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(": connected\n\n");

  const key = lessonKey(params.classroom, params.lesson);
  addClient(key, res);
  req.on("close", () => removeClient(key, res));
}

export function closeEvents(): void {
  // End the SSE streams first: an open event-stream keeps close() pending forever.
  for (const clients of sseClients.values()) {
    for (const res of clients) {
      try {
        res.end();
      } catch {
        /* already gone */
      }
    }
  }
  sseClients.clear();
}
