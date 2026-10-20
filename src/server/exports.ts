/** Separate read-only export route: no hooks, queue, grading or history writes. */
import type * as http from "node:http";
import { projectClassroom, exportMarkdown, exportPrint } from "../classroom-export.ts";
import { exportAnki } from "../export-anki.ts";
import { urlFor } from "../server.ts";
import { isValidSlug } from "../paths.ts";
import { escapeHtml } from "../markdown.ts";
import { sendHtml, sendNotFound } from "./http.ts";
export function handleExport(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
  const classroom = url.searchParams.get("classroom") ?? "",
    format = url.searchParams.get("format"),
    answers = url.searchParams.get("answers");
  if (
    req.method !== "GET" ||
    !isValidSlug(classroom) ||
    !["markdown", "print", "anki"].includes(format ?? "") ||
    (answers !== null && answers !== "1") ||
    [...url.searchParams.keys()].some(
      (k) => !["classroom", "format", "answers", "download"].includes(k),
    )
  ) {
    sendHtml(res, "Invalid classroom export request.", 400);
    return;
  }
  try {
    const data = projectClassroom(
      classroom,
      answers === "1",
      urlFor() ?? `http://127.0.0.1:${req.socket.localPort}`,
      [`http://127.0.0.1:${req.socket.localPort}`],
    );
    if (!data) return sendNotFound(res, "Unknown classroom");
    const body =
      format === "anki"
        ? exportAnki(data)
        : format === "markdown"
          ? exportMarkdown(data)
          : exportPrint(data);
    const ext = format === "anki" ? "apkg" : format === "markdown" ? "md" : "html";
    res.writeHead(200, {
      "Content-Type":
        format === "anki"
          ? "application/octet-stream"
          : format === "markdown"
            ? "text/markdown; charset=utf-8"
            : "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...(format !== "print" || url.searchParams.get("download") === "1"
        ? { "Content-Disposition": `attachment; filename="studens-${classroom}.${ext}"` }
        : {}),
    });
    res.end(body);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Cannot export saved classroom content. Retry explicitly.";
    const retry = `/api/export?${url.searchParams}`;
    sendHtml(
      res,
      `<!doctype html><html lang="en"><meta charset="utf-8"><title>Cannot export classroom</title><h1>Cannot export classroom</h1><p role="alert">${escapeHtml(message)}</p><p><a href="${escapeHtml(retry)}">Retry export</a> · <a href="/c/${classroom}">Back to classroom</a></p></html>`,
      500,
    );
  }
}
