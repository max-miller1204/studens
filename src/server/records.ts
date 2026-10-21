import { appearanceHead } from "../appearance.ts";
import * as fs from "node:fs";
import type * as http from "node:http";
import * as path from "node:path";
import { documentPage, learningRecordsPage } from "../pages.ts";
import { classroomDir, isFile, isValidSlug, safeStaticFile } from "../paths.ts";
import * as store from "../store.ts";
import { sendHtml, sendNotFound } from "./http.ts";
import { uiFontHead } from "../ui-assets.ts";

export function handleDoc(res: http.ServerResponse, rest: string[]): void {
  const [name, ...tail] = rest;
  if (!isValidSlug(name)) return sendNotFound(res, "Unknown classroom");
  const classroom = store.readClassroom(name);
  if (!classroom) return sendNotFound(res, `Unknown classroom: ${name}`);

  // /doc/<classroom>/learning-records — the index of every record.
  if (tail.length === 1 && tail[0] === "learning-records") {
    return sendHtml(res, learningRecordsPage(classroom, store.readLearningRecords(name)));
  }

  // Only the classroom's own markdown is viewable — root-level docs, learning records,
  // and the topic files NOTES.md indexes.
  const relative = tail.join("/");
  // Reason: segments are decoded, so `..%2fMISSION.md` arrives as one segment holding a
  // slash — insist on a plain file name, or it climbs out of the subdirectory.
  const nested =
    tail.length === 2 && tail[1].endsWith(".md") && !/[\\/]/.test(tail[1])
      ? DOC_DIRS[tail[0]]
      : undefined;
  const allowed =
    (tail.length === 1 && (store.CLASSROOM_DOCS as readonly string[]).includes(tail[0])) ||
    nested !== undefined;
  if (!allowed) return sendNotFound(res, "Not found");

  const file = safeStaticFile(classroomDir(name), relative);
  if (!file || !isFile(file)) return sendNotFound(res, `No such document: ${relative}`);
  const parent = nested && {
    label: nested.label,
    href: `/doc/${encodeURIComponent(name)}/${nested.href}`,
  };
  sendHtml(
    res,
    documentPage(classroom, path.basename(file), fs.readFileSync(file, "utf8"), parent),
  );
}

/** Classroom subdirectories of markdown, and the index page each one sits under. */
const DOC_DIRS: Record<string, { label: string; href: string } | undefined> = {
  "learning-records": { label: "Learning records", href: "learning-records" },
  notes: { label: "Notes", href: "NOTES.md" },
};

export function handleReference(res: http.ServerResponse, rest: string[]): void {
  const [name, ...tail] = rest;
  if (!isValidSlug(name)) return sendNotFound(res, "Unknown classroom");
  const classroom = store.readClassroom(name);
  if (!classroom) return sendNotFound(res, `Unknown classroom: ${name}`);

  const file = safeStaticFile(path.join(classroomDir(name), "reference"), tail.join("/"));
  if (!file || !file.endsWith(".html") || !isFile(file)) return sendNotFound(res, "Not found");

  // Reference docs get the stylesheet, the theme bootstrap, the link behaviour, the
  // diagrams, and the math, but not the lesson runtime: there is no quiz to submit and
  // nothing to anchor questions to.
  const html = fs.readFileSync(file, "utf8");
  const head = `<script type="module">import{initTeacherActivity,pageClassroom}from"/static/teacher-activity.mjs";initTeacherActivity(pageClassroom());</script>
${appearanceHead()}
${uiFontHead()}
<script type="module">import{initTheme}from"/static/theme.mjs";initTheme();</script>
<script type="module">import{initLinks}from"/static/links.mjs";initLinks();</script>
<script type="module">import{initDiagrams}from"/static/diagrams.mjs";initDiagrams(document.body);</script>
<script type="module">import{initMath}from"/static/math.mjs";initMath(document.body);</script>`;
  const idx = html.search(/<\/head\s*>/i);
  sendHtml(res, idx === -1 ? head + html : html.slice(0, idx) + head + html.slice(idx));
}
