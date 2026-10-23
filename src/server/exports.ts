/** Separate read-only export route: no hooks, queue, grading or history writes. */
import type * as http from "node:http";
import { projectClassroom, exportMarkdown, exportPrint } from "../classroom-export.ts";
import { exportAnki } from "../export-anki.ts";
import { urlFor } from "../server.ts";
import { isValidSlug } from "../paths.ts";
import { escapeHtml } from "../markdown.ts";
import { shell } from "../pages.ts";
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
      shell({
        title: "Cannot export classroom",
        bodyClass: "cl-shell cl-workspace-page",
        breadcrumb: `<a class="cl-crumb" href="/c/${encodeURIComponent(classroom)}">Back to classroom</a><span class="cl-crumb-sep" aria-hidden="true">/</span><span class="cl-crumb cl-crumb-current">Export</span>`,
        body: `<div class="cl-hero"><h1>Cannot export classroom</h1><p class="cl-lede">Correct the saved source, then retry this export.</p></div><div class="cl-inline-error" role="alert"><span>${escapeHtml(message)}</span><a class="cl-button cl-button-secondary" href="${escapeHtml(retry)}">Retry export</a></div>`,
      }),
      500,
    );
  }
}
