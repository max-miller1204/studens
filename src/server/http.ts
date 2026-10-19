import * as fs from "node:fs";
import type * as http from "node:http";
import * as path from "node:path";
import { notFoundPage } from "../pages.ts";
import { isValidSlug } from "../paths.ts";

export function sendHtml(res: http.ServerResponse, html: string, status = 200): void {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(html);
}

export function sendJson(res: http.ServerResponse, value: unknown, status = 200): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
}

export function sendNotFound(res: http.ServerResponse, message: string, wantsJson = false): void {
  if (wantsJson) return sendJson(res, { error: message }, 404);
  sendHtml(res, notFoundPage(message), 404);
}

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".pdf": "application/pdf",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
};

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

export function sendFile(res: http.ServerResponse, file: string): void {
  let body: Buffer;
  try {
    body = fs.readFileSync(file);
  } catch {
    return sendNotFound(res, `File not found: ${path.basename(file)}`);
  }
  res.writeHead(200, {
    "Content-Type": contentTypeFor(file),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

/** Read and JSON-parse a request body, with a cap so a stray client cannot exhaust memory. */
export function readJsonBody(req: http.IncomingMessage, limit = 256 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

/** Decoded, non-empty path segments; null when the path is malformed. */
export function splitPath(pathname: string): string[] | null {
  try {
    return pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
}

export function lessonParams(url: URL): { classroom: string; lesson: string } | null {
  const classroom = url.searchParams.get("classroom") ?? "";
  const lesson = url.searchParams.get("lesson") ?? "";
  if (!isValidSlug(classroom) || !isValidSlug(lesson)) return null;
  return { classroom, lesson };
}
