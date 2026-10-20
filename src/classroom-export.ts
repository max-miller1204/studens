/** Read-only export projection. Public source files and eligible answer values only. */
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import {
  classroomsRoot,
  isValidSlug,
  privateStatePath,
  safeStaticFile,
  lessonUrl,
  runtimeAssetsDir,
} from "./paths.ts";
import { resolveLessonHtml } from "./store/classrooms.ts";
import { lessonRequests } from "./store/lesson-requests.ts";
import { reviewSessions } from "./review-session.ts";
import { stageLesson } from "./pretest.ts";
import { latestQuizStates } from "./store/quiz-history.ts";
import { CLASSROOM_DOCS } from "./store/records.ts";
import { expectedAnswers } from "./expected-answers.ts";
import {
  markdownContent,
  safeContent,
  portableMarkdown,
  contentTree,
  nodeText,
  svgMedia,
  expectedReading,
} from "./export-content.ts";
import type { ResourceLink } from "./export-content.ts";
import { escapeHtml } from "./markdown.ts";
import { contentTypeFor } from "./server/http.ts";

export interface ExportPart {
  id: string;
  identity: string;
  title: string;
  source: string;
  html: string;
  modified: number;
}
export interface ExportMedia {
  name: string;
  type: string;
  bytes: Buffer;
}
export interface ClassroomExport {
  name: string;
  title: string;
  parts: ExportPart[];
  media: ExportMedia[];
  includeAnswers: boolean;
  omissions: string[];
}
const fail = (label: string, detail: string): never => {
  throw new Error(
    `Cannot export ${label}: ${detail}. Restore the saved source and retry explicitly.`,
  );
};
function guard(relative: string): string {
  try {
    return privateStatePath(relative);
  } catch {
    return fail(relative, "symlinks or unsafe paths are not allowed");
  }
}
function text(relative: string, optional = false): string | null {
  const file = guard(relative);
  try {
    if (!fs.statSync(file).isFile()) return fail(relative, "expected a regular file");
    return new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(file));
  } catch (e) {
    if (optional && (e as NodeJS.ErrnoException).code === "ENOENT") return null;
    return fail(relative, "file is missing, unreadable or not UTF-8");
  }
}
function object(relative: string): Record<string, unknown> | null {
  const value = text(relative, true);
  if (value === null) return null;
  try {
    const raw: unknown = JSON.parse(value);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error();
    return raw as Record<string, unknown>;
  } catch {
    return fail(relative, "invalid JSON object");
  }
}
function names(relative: string): string[] {
  try {
    return fs.readdirSync(guard(relative)).sort();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    return fail(relative, "directory is unreadable");
  }
}
function historyGuard(relative: string): void {
  for (const name of names(relative)) {
    const file = guard(`${relative}/${name}`);
    if (!fs.statSync(file).isFile() || !name.endsWith(".json"))
      fail(relative, "invalid saved quiz history entry");
  }
}
const title = (meta: Record<string, unknown> | null, fallback: string, label: string): string =>
  meta?.title === undefined
    ? fallback
    : typeof meta.title === "string" && meta.title.trim()
      ? meta.title
      : fail(label, "title must be nonempty text");
const hash = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

export function projectClassroom(
  name: string,
  includeAnswers = false,
  origin = "http://127.0.0.1",
  aliases: readonly string[] = [],
): ClassroomExport | null {
  if (!isValidSlug(name)) throw new Error("Invalid classroom for export.");
  const canonicalOrigin = new URL(origin).origin;
  const localOrigins = new Set([canonicalOrigin, ...aliases.map((alias) => new URL(alias).origin)]);
  const dir = guard(name);
  if (!fs.existsSync(dir)) return null;
  if (!fs.statSync(dir).isDirectory()) return fail(name, "expected a classroom directory");
  const meta = object(`${name}/classroom.json`);
  const result: ClassroomExport = {
    name,
    title: title(meta, name, `${name}/classroom.json`),
    parts: [],
    media: [],
    includeAnswers,
    omissions: [
      "Unreleased teaching, private keys, plans, variants, drafts, teacher sessions, recovery and review history are omitted.",
      "Interactive widgets are not portable simulations. Their saved visible prose and code are included where available; use source lessons for controls. Scripts, custom styles, audio/video, and external images are omitted. Diagrams retain Mermaid source in Markdown and render in printable HTML and supported Anki webviews.",
      "Anki contains saved reading cards and public question threads, plus eligible expected answers only when selected. Import adds or updates notes; it does not delete notes removed from a later export or copy Studens progress.",
    ],
  };
  const resources = new Map<string, ExportMedia>();
  if (includeAnswers) {
    guard(`${name}/.teacher.json`);
    guard(`${name}/.review-controls.json`);
    historyGuard(`${name}/quiz/retrieval-checks`);
    // Corrective eligibility derives from all saved quiz evidence in this classroom.
    // Guard only those known directories, never enumerate arbitrary private state.
    for (const candidate of names(name)) {
      if (
        !isValidSlug(candidate) ||
        ["reference", "learning-records", "notes", "assets", "quiz"].includes(candidate)
      )
        continue;
      const p = guard(`${name}/${candidate}`);
      if (!fs.statSync(p).isDirectory()) continue;
      historyGuard(`${name}/${candidate}/quiz/submissions`);
      historyGuard(`${name}/${candidate}/quiz/grades`);
    }
    for (const review of names(`${name}/.reviews`)) {
      if (!/^review-[a-f0-9-]{36}$/.test(review)) continue;
      historyGuard(`${name}/.reviews/${review}/quiz/submissions`);
      historyGuard(`${name}/.reviews/${review}/quiz/grades`);
    }
  }
  const rootUrl = `/c/${encodeURIComponent(name)}`;
  const publicRoutes = new Set<string>();
  const pending = new Set<string>();
  try {
    guard(`${name}/.lesson-requests.json`);
    guard(`${name}/.reviews.json`);
    for (const r of [...lessonRequests(name), ...reviewSessions(name)])
      if (r.status !== "done") pending.add(r.lesson);
  } catch {
    return fail(name, "invalid lesson or review publication state");
  }
  const candidates: {
    relative: string;
    source: string;
    title: string;
    identity?: string;
    html?: string;
  }[] = [];
  for (const doc of CLASSROOM_DOCS)
    if (text(`${name}/${doc}`, true) !== null)
      candidates.push({
        relative: doc,
        source: `/doc/${encodeURIComponent(name)}/${doc}`,
        title: doc,
      });
  for (const sub of ["learning-records", "notes", "reference"])
    for (const file of names(`${name}/${sub}`)) {
      if (file.startsWith(".") || !file.endsWith(sub === "reference" ? ".html" : ".md")) continue;
      candidates.push({
        relative: `${sub}/${file}`,
        source:
          sub === "reference"
            ? `/r/${encodeURIComponent(name)}/${encodeURIComponent(file)}`
            : `/doc/${encodeURIComponent(name)}/${sub}/${encodeURIComponent(file)}`,
        title: file,
      });
    }
  for (const lesson of names(name)) {
    if (
      !isValidSlug(lesson) ||
      ["reference", "learning-records", "notes", "assets", "quiz"].includes(lesson) ||
      pending.has(lesson)
    )
      continue;
    const candidate = guard(`${name}/${lesson}`);
    if (!fs.statSync(candidate).isDirectory()) continue;
    const htmlPath = resolveLessonHtml(candidate);
    if (!htmlPath) continue;
    const relativeHtml = path.relative(dir, htmlPath);
    const html = text(`${name}/${relativeHtml}`)!;
    const lessonMeta = object(`${name}/${lesson}/lesson.json`);
    if (lessonMeta?.kind === "review") continue;
    if (lessonMeta?.kind !== undefined && lessonMeta.kind !== "lesson")
      fail(`${name}/${lesson}/lesson.json`, "unknown lesson kind");
    historyGuard(`${name}/${lesson}/quiz/submissions`);
    historyGuard(`${name}/${lesson}/quiz/grades`);
    let states;
    let staged;
    try {
      states = latestQuizStates(name, lesson);
      staged = stageLesson(
        html,
        new Set(
          states.filter((s) => s.submission.kind === "pretest" && s.grade).map((s) => s.quizId),
        ),
      );
    } catch {
      return fail(`${name}/${lesson}`, "invalid saved quiz history or pretest gate");
    }
    const source = lessonUrl(name, lesson);
    const lessonTitle = title(lessonMeta, lesson, `${name}/${lesson}/lesson.json`);
    candidates.push({
      relative: relativeHtml,
      source,
      title: lessonTitle,
      html: staged.html,
    });
    // Whole thread content can quote gated teaching. Export threads only after all gates release.
    if (!staged.pendingPretests.length) {
      const annotations = text(`${name}/${lesson}/annotations.json`, true);
      if (annotations !== null) {
        let list: unknown;
        try {
          list = JSON.parse(annotations);
        } catch {
          return fail(`${name}/${lesson}/annotations.json`, "invalid question threads");
        }
        if (!Array.isArray(list))
          return fail(`${name}/${lesson}/annotations.json`, "question threads must be an array");
        for (const [i, a] of list.entries()) {
          if (
            !a ||
            typeof a.id !== "string" ||
            typeof a.question !== "string" ||
            typeof a.selection !== "string" ||
            !["answered", "pending", "failed"].includes(a.status) ||
            !Array.isArray(a.followUps ?? [])
          )
            return fail(`${name}/${lesson}/annotations.json`, "invalid public question thread");
          const plain = (value: string) => `<p>${escapeHtml(value).replace(/\n/g, "<br>")}</p>`;
          let thread = `<h3>Question</h3>${plain(a.question)}<h4>Selected passage</h4><blockquote>${plain(a.selection)}</blockquote>`;
          if (a.status === "answered" && typeof a.answerMarkdown === "string")
            thread += `<h4>Reply</h4>${markdownContent(a.answerMarkdown, (v) => v)}`;
          for (const follow of a.followUps ?? []) {
            if (
              typeof follow.question !== "string" ||
              !["answered", "pending", "failed"].includes(follow.status)
            )
              return fail(`${name}/${lesson}/annotations.json`, "invalid follow-up");
            thread += `<h4>Follow-up</h4>${plain(follow.question)}`;
            if (follow.status === "answered" && typeof follow.answerMarkdown === "string")
              thread += markdownContent(follow.answerMarkdown, (v) => v);
          }
          candidates.push({
            relative: `${lesson}/annotations.json`,
            source: source + "#cl-content",
            title: `${lessonTitle} — question ${i + 1}`,
            identity: `thread/${lesson}/${a.id}`,
            html: thread,
          });
        }
      }
    } else
      result.omissions.push(
        `${lessonTitle}: pretest-gated teaching and associated threads omitted.`,
      );
    if (includeAnswers) {
      for (const state of states) {
        let answers;
        try {
          answers = expectedAnswers(state.submission);
        } catch {
          return fail(`${name}/${lesson}`, "saved answer eligibility could not be verified");
        }
        for (const [id, answer] of Object.entries(answers)) {
          if (answer.status === "error")
            return fail(`${name}/${lesson}`, `expected answer ${id}: ${answer.message}`);
          if (answer.status !== "available") {
            result.omissions.push(`${lessonTitle}: expected answer ${id} is not yet available.`);
            continue;
          }
          const reading = expectedReading(staged.html, state.quizId, id, answer);
          candidates.push({
            relative: relativeHtml,
            source,
            title: `${lessonTitle} — ${reading.prompt}`,
            identity: `answer/${lesson}/${state.quizId}/${id}`,
            html:
              `<h3>Expected answer</h3><pre>${escapeHtml(reading.expected)}</pre>` +
              markdownContent(
                `### Full credit (${answer.points} points)\n\n${answer.full}\n\n### Partial credit\n\n${answer.partial}\n\n${(answer.criteria ?? []).map((c) => `- ${c.description} (${c.points} points)`).join("\n")}`,
                (v) => v,
              ),
          });
        }
      }
    }
  }
  for (const c of candidates) publicRoutes.add(c.source.split("#")[0]);
  const linkFor =
    (source: string): ResourceLink =>
    (value, media) => {
      if (value.startsWith("studens-media:")) return resources.has(value.slice(14)) ? value : null;
      if (!value || /[\u0000-\u001f]/.test(value)) return null;
      let url: URL;
      try {
        url = new URL(value, new URL(source, origin));
      } catch {
        return null;
      }
      if (!["http:", "https:"].includes(url.protocol)) return null;
      if (!localOrigins.has(url.origin)) {
        // A stale or unrecognized alias must not turn a private Studens route into
        // an apparently unrelated external link. Never expose private route metadata.
        if (
          new RegExp(`^/(?:c|doc|r)/${name}(?:/|$)`).test(url.pathname) &&
          !publicRoutes.has(url.pathname) &&
          url.pathname !== rootUrl
        )
          return null;
        return media ? null : url.href;
      }
      url = new URL(url.pathname + url.search + url.hash, canonicalOrigin);
      if (url.search) return null;
      let decoded: string;
      try {
        decoded = decodeURIComponent(url.pathname);
      } catch {
        return null;
      }
      let relative: string | null = null;
      if (decoded.startsWith(`/c/${name}/assets/`))
        relative = `assets/${decoded.slice(`/c/${name}/assets/`.length)}`;
      const lessonMedia = new RegExp(`^/c/${name}/([a-z0-9.-]+)/media/(.+)$`).exec(decoded);
      if (lessonMedia && !pending.has(lessonMedia[1]))
        relative = `${lessonMedia[1]}/media/${lessonMedia[2]}`;
      // Relative media is authored next to lesson.html, rather than the extensionless route.
      if (!relative && !value.startsWith("/") && source.startsWith(rootUrl + "/")) {
        const lesson = source.slice(rootUrl.length + 1).split(/[\/#]/)[0];
        if (value.startsWith("media/")) relative = `${lesson}/${value}`;
        if (value.startsWith("../assets/")) relative = value.slice(3);
      }
      if (relative) {
        if (relative.split(/[\\/]/).some((s) => !s || s === "." || s === "..")) return null;
        const file = safeStaticFile(classroomsRoot(), `${name}/${relative}`);
        const type = file ? contentTypeFor(file) : "";
        if (
          !file ||
          !fs.statSync(file).isFile() ||
          !/^image\/(?:png|jpeg|gif|webp|avif|svg\+xml)$/.test(type)
        )
          return null;
        const rawBytes = fs.readFileSync(file);
        const bytes =
            type === "image/svg+xml"
              ? Buffer.from(svgMedia(new TextDecoder("utf-8", { fatal: true }).decode(rawBytes)))
              : rawBytes,
          id = `studens-${hash(bytes)}${path.extname(file).toLowerCase()}`;
        resources.set(id, { name: id, type, bytes });
        return `studens-media:${id}`;
      }
      return !media && (publicRoutes.has(url.pathname) || url.pathname === rootUrl)
        ? url.href
        : null;
    };
  for (const [i, c] of candidates.entries()) {
    const raw = c.html ?? text(`${name}/${c.relative}`)!;
    const link = linkFor(c.source);
    const html =
      c.html !== undefined || c.relative.endsWith(".html")
        ? safeContent(raw, link)
        : markdownContent(raw, link);
    if (!nodeText(contentTree(html)).trim() && !html.includes("<img")) continue;
    result.parts.push({
      id: `part-${i + 1}`,
      identity: c.identity ?? c.relative,
      title: c.title,
      source: new URL(c.source, origin).href,
      html,
      modified: Math.floor(fs.statSync(guard(`${name}/${c.relative}`)).mtimeMs / 1000),
    });
  }
  result.media = [...resources.values()];
  return result;
}
const embed = (html: string, media: ExportMedia[]) =>
  html.replace(/studens-media:([\w.-]+)/g, (_, name: string) => {
    const m = media.find((m) => m.name === name)!;
    return `data:${m.type};base64,${m.bytes.toString("base64")}`;
  });
const markdownLabel = (value: string) =>
  value.replace(/[\r\n]+/g, " ").replace(/([\\`*_{}\[\]<>#+.!|~=\-])/g, "\\$1");
export function exportMarkdown(data: ClassroomExport): string {
  return `# ${markdownLabel(data.title)}\n\n${data.includeAnswers ? "Includes only already-unlocked expected answers." : "Expected answers excluded."}\n\n${data.parts.map((p) => `## ${markdownLabel(p.title)}\n\nSource: <${p.source}>\n\n${portableMarkdown(embed(p.html, data.media))}`).join("\n")}\n## Export omissions\n\n${data.omissions.map((s) => `- ${markdownLabel(s)}`).join("\n")}\n`;
}
export function exportPrint(data: ClassroomExport): string {
  const mermaid = fs
    .readFileSync(path.join(runtimeAssetsDir(), "vendor/mermaid/mermaid.min.js"), "utf8")
    .replace(/<\/script/gi, "<\\/script");
  const mathCss = fs
    .readFileSync(path.join(runtimeAssetsDir(), "vendor/temml/Temml-Local.css"), "utf8")
    .replace(
      /url\([^)]+\)/g,
      `url(data:font/woff2;base64,${fs.readFileSync(path.join(runtimeAssetsDir(), "vendor/temml/Temml.woff2")).toString("base64")})`,
    );
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(data.title)} — printable classroom</title><style>${mathCss}body{font:17px/1.6 Georgia,serif;max-width:900px;margin:2rem auto;padding:0 1.25rem;color:#222;background:white;overflow-wrap:anywhere}a{color:#70401b}h1,h2,h3{line-height:1.2;break-after:avoid}section{margin:3rem 0}pre{white-space:pre-wrap;background:#f4f3ef;padding:1rem}code{font-size:.9em}img,svg{max-width:100%;height:auto}table{border-collapse:collapse}td,th{padding:.4rem;border:1px solid #aaa}blockquote{border-left:3px solid #aaa;padding-left:1rem}nav ul{padding-left:1.5rem}@page{margin:18mm}@media print{body{font-size:11pt;margin:0;max-width:none;padding:0}section{margin:1.5rem 0}pre,img,svg{break-inside:avoid}a{color:inherit}}</style><h1>${escapeHtml(data.title)}</h1><p>${data.includeAnswers ? "Includes only already-unlocked expected answers." : "Expected answers excluded."}</p><nav aria-label="Contents"><h2>Contents</h2><ul>${data.parts.map((p) => `<li><a href="#${p.id}">${escapeHtml(p.title)}</a></li>`).join("")}</ul></nav>${data.parts.map((p) => `<section id="${p.id}"><h2>${escapeHtml(p.title)}</h2><p>Source: <a href="${escapeHtml(p.source)}">${escapeHtml(p.source)}</a></p>${embed(p.html, data.media)}</section>`).join("")}<section><h2>Export omissions</h2><ul>${data.omissions.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul></section><script>${mermaid}</script><script>mermaid.initialize({startOnLoad:false,securityLevel:'strict'});mermaid.run({querySelector:'.mermaid'}).catch(()=>{document.querySelectorAll('.mermaid').forEach(n=>{if(!n.querySelector('svg'))n.insertAdjacentHTML('beforebegin','<p>Diagram could not render; its saved source follows.</p>')});});</script></html>`;
}
