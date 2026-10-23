/** Explicit, offline lesson UI migration. No teacher or learner grading is invoked. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parse } from "parse5";
import type { DefaultTreeAdapterTypes } from "parse5";
import {
  classroomsRoot,
  isValidSlug,
  isStoredReview,
  lessonDir,
  packageRoot,
  privateStatePath,
} from "../src/paths.ts";
import { resolveLessonHtml } from "../src/store/classrooms.ts";
import { validateLessonMarkup } from "../src/lesson-markup.ts";
import { preflightLessonInputs, readLessonInputs, sameLessonInputs } from "./lesson-inputs.ts";
import type { LessonInputs } from "./lesson-inputs.ts";

type Element = DefaultTreeAdapterTypes.Element;
export interface LessonRef {
  classroom: string;
  lesson: string;
}
export interface MigrationResult extends LessonRef {
  status: string;
  detail?: string;
}
interface Journal {
  version: 1;
  htmlFile: string;
  hashes: LessonInputs["hashes"];
  original: string;
  candidate: string;
  status: "prepared" | "complete" | "failed";
  error?: string;
  check?: { stdout: string; stderr: string };
}
const warning =
  "Highlights, threads, drafts and attempt state may stop resolving after migration. Stop classroom writers and back up the classroom first. No learner work will be regraded.";
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const attr = (node: Element, name: string) => node.attrs.find((a) => a.name === name)?.value;
const classes = (node: Element) => (attr(node, "class") ?? "").split(/\s+/).filter(Boolean);
function elements(html: string): Element[] {
  const out: Element[] = [];
  const visit = (node: DefaultTreeAdapterTypes.Node) => {
    if ("tagName" in node) {
      out.push(node);
      if ("content" in node) visit(node.content as DefaultTreeAdapterTypes.DocumentFragment);
    }
    if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  visit(parse(html, { sourceCodeLocationInfo: true }));
  return out;
}
export function mechanicalRebuild(html: string): string {
  const nodes = elements(html);
  const roots = nodes.filter((n) => attr(n, "data-cl-content") !== undefined);
  if (roots.length !== 1 || roots[0].tagName !== "main")
    throw new Error(
      "Expected one main[data-cl-content]; rebuild with docs/MIGRATE-UI-2.md and --candidate.",
    );
  if (nodes.some((n) => attr(n, "data-cl-ui") !== undefined))
    throw new Error(
      "Existing UI marker requires an agent candidate; refusing to replace an authored version.",
    );
  const edits: Array<{ start: number; end: number; text: string }> = [];
  for (const node of nodes) {
    const names = new Set(classes(node));
    const original = [...names].join(" ");
    if (node === roots[0]) names.add("cl-lesson-shell");
    if (["cl-quiz", "cl-practice", "cl-stepper", "cl-faded"].some((n) => names.has(n)))
      names.add("cl-card-box");
    if (
      node.tagName === "ol" &&
      "tagName" in node.parentNode! &&
      ["cl-quiz", "cl-practice"].some((n) => classes(node.parentNode as Element).includes(n))
    )
      names.add("cl-questions");
    if (["input", "textarea", "select"].includes(node.tagName)) {
      const type = (attr(node, "type") ?? "text").toLowerCase();
      if (
        !["hidden", "submit", "button", "reset", "file", "image", "range", "color"].includes(type)
      )
        names.add(["radio", "checkbox"].includes(type) ? "cl-check" : "cl-input");
    }
    if (node.tagName === "details") names.add("cl-disclosure");
    if (node.tagName === "button") names.add("cl-button");
    const loc = node.sourceCodeLocation;
    const insert = loc?.startTag
      ? loc.startTag.endOffset - (html[loc.startTag.endOffset - 2] === "/" ? 2 : 1)
      : 0;
    if (original !== [...names].join(" ")) {
      if (!loc?.startTag) throw new Error("Implicit HTML element needs an agent rebuild.");
      const classLoc = loc.attrs?.class;
      if (classLoc)
        edits.push({
          start: classLoc.startOffset,
          end: classLoc.endOffset,
          text: `class="${[...names].join(" ").replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"`,
        });
      else
        edits.push({
          start: insert,
          end: insert,
          text: ` class="${[...names].join(" ")}"`,
        });
    }
    if (node === roots[0]) {
      if (!loc?.startTag) throw new Error("Missing authored main tag.");
      edits.push({
        start: insert,
        end: insert,
        text: ' data-cl-ui="2"',
      });
    }
  }
  let rebuilt = html;
  for (const edit of edits.sort((a, b) => b.start - a.start))
    rebuilt = rebuilt.slice(0, edit.start) + edit.text + rebuilt.slice(edit.end);
  validateLessonMarkup(rebuilt, true);
  return rebuilt;
}

// Ignore only the additive v2 presentation hooks; assessment content, attributes,
// options, scripts, identities and gates remain bound to the original rubric.
const hooks = new Set([
  "cl-card-box",
  "cl-questions",
  "cl-input",
  "cl-check",
  "cl-disclosure",
  "cl-button",
]);
function assessmentShape(html: string): string {
  // Legacy questions may be divs directly under the form. V2 wraps those same
  // questions in ol.cl-questions and uses li, without changing assessment meaning.
  const children = (node: DefaultTreeAdapterTypes.ParentNode): unknown[] =>
    node.childNodes.flatMap((child) => {
      if (
        "tagName" in child &&
        ["ol", "div"].includes(child.tagName) &&
        "tagName" in node &&
        node.tagName === "form" &&
        classes(node).includes("cl-quiz") &&
        child.attrs.every((a) => a.name === "class" && classes(child).every((c) => hooks.has(c))) &&
        child.childNodes.some((n) => "tagName" in n && classes(n).includes("cl-q")) &&
        child.childNodes.every((n) =>
          "tagName" in n
            ? classes(n).includes("cl-q")
            : n.nodeName === "#text" && "value" in n && !n.value.trim(),
        )
      )
        return children(child);
      return [shape(child)];
    });
  const shape = (node: DefaultTreeAdapterTypes.Node): unknown => {
    if ("tagName" in node)
      return [
        classes(node).includes("cl-q") && ["div", "li"].includes(node.tagName)
          ? "question"
          : node.tagName,
        node.attrs
          .map((a) => [
            a.name,
            a.name === "class"
              ? a.value
                  .split(/\s+/)
                  .filter((c) => c && !hooks.has(c))
                  .sort()
                  .join(" ")
              : a.value,
          ])
          .filter(([name, value]) => name !== "class" || value)
          .sort(),
        children(node),
        "content" in node ? shape(node.content as DefaultTreeAdapterTypes.DocumentFragment) : null,
      ];
    if ("childNodes" in node) return children(node);
    return "value" in node ? node.value : "data" in node ? node.data : node.nodeName;
  };
  return JSON.stringify(
    elements(html)
      .filter(
        (n) => classes(n).includes("cl-quiz") || attr(n, "data-cl-after-pretest") !== undefined,
      )
      .map(shape),
  );
}
function guarded(file: string): string {
  return privateStatePath(path.relative(classroomsRoot(), file));
}
function journalFile(ref: LessonRef): string {
  return guarded(path.join(lessonDir(ref.classroom, ref.lesson), "quiz", "ui-migration.json"));
}
function atomic(file: string, bytes: string | Buffer): void {
  guarded(file);
  const temp = guarded(`${file}.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temp, bytes, { flag: "wx", mode: 0o600, flush: true });
    fs.renameSync(temp, guarded(file));
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
function readJournal(ref: LessonRef): Journal | null {
  const file = journalFile(ref);
  if (!fs.existsSync(file)) return null;
  let value: Journal;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error(
      "Invalid quiz/ui-migration.json; restore it from backup before explicit retry.",
    );
  }
  if (
    !value ||
    value.version !== 1 ||
    typeof value.original !== "string" ||
    typeof value.candidate !== "string" ||
    !value.hashes ||
    !["prepared", "complete", "failed"].includes(value.status) ||
    typeof value.htmlFile !== "string" ||
    path.basename(value.htmlFile) !== value.htmlFile
  )
    throw new Error("Invalid migration journal; restore it from backup before explicit retry.");
  return value;
}

/** Filesystem-first, read-only discovery, including legacy and dedicated reviews. */
export function discoverLessons(classroom?: string, lesson?: string): MigrationResult[] {
  if ((classroom && !isValidSlug(classroom)) || (lesson && (!classroom || !isValidSlug(lesson))))
    throw new Error("Use valid --classroom and --lesson slugs together.");
  const root = guarded(classroomsRoot());
  if (!fs.existsSync(root)) {
    if (classroom)
      return [
        {
          classroom,
          lesson: lesson ?? "*",
          status: "failed",
          detail: "Classrooms root does not exist.",
        },
      ];
    return [];
  }
  const out: MigrationResult[] = [];
  for (const c of classroom ? [classroom] : fs.readdirSync(root).filter(isValidSlug).sort()) {
    try {
      const dir = guarded(path.join(root, c));
      if (!fs.statSync(dir).isDirectory()) continue;
      const reserved = new Set(["reference", "assets", "learning-records", "notes", "quiz"]);
      const names = lesson
        ? [lesson]
        : fs.readdirSync(dir).filter((n) => isValidSlug(n) && !reserved.has(n));
      const reviews = guarded(path.join(dir, ".reviews"));
      if (!lesson && fs.existsSync(reviews))
        names.push(...fs.readdirSync(reviews).filter((n) => /^review-[a-f0-9-]{36}$/.test(n)));
      for (const l of names.sort()) {
        const ref = { classroom: c, lesson: l };
        try {
          const d = guarded(lessonDir(c, l));
          if (!fs.statSync(d).isDirectory()) continue;
          const file = resolveLessonHtml(d);
          if (!file) {
            if (lesson) throw new Error("No lesson HTML found.");
            continue;
          }
          const html = fs.readFileSync(guarded(file), "utf8");
          const markers = elements(html).filter((n) => attr(n, "data-cl-ui") !== undefined);
          const saved = readJournal(ref);
          const v2 = markers.length === 1 && attr(markers[0], "data-cl-ui") === "2";
          out.push({
            ...ref,
            status: saved && saved.status !== "complete" ? "retry-required" : v2 ? "v2" : "legacy",
          });
        } catch (error) {
          out.push({ ...ref, status: "failed", detail: (error as Error).message });
        }
      }
    } catch (error) {
      out.push({
        classroom: c,
        lesson: lesson ?? "*",
        status: "failed",
        detail: (error as Error).message,
      });
    }
  }
  return out;
}

/** Browser checker uses only a disposable copy, never the learner's attempts. */
export function checkCandidate(
  ref: LessonRef,
  inputs: LessonInputs,
  candidate: string,
): { stdout: string; stderr: string } {
  const scratch = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "studens-ui-migration-"));
  try {
    const dest = path.join(
      scratch,
      path.relative(classroomsRoot(), lessonDir(ref.classroom, ref.lesson)),
    );
    fs.mkdirSync(path.join(dest, "quiz"), { recursive: true });
    fs.writeFileSync(path.join(dest, inputs.htmlFile), candidate);
    for (const [name, input] of [
      ["lesson.json", inputs.metadata],
      ["quiz/key.json", inputs.key],
      ["quiz/plan.json", inputs.plan],
    ] as const)
      if (input) fs.writeFileSync(path.join(dest, name), input.bytes);
    const copy = (src: string, target: string): void => {
      guarded(src);
      if (!fs.existsSync(src)) return;
      if (fs.statSync(src).isDirectory()) {
        fs.mkdirSync(target, { recursive: true });
        for (const name of fs.readdirSync(src)) copy(path.join(src, name), path.join(target, name));
      } else fs.copyFileSync(src, target);
    };
    const classroom = path.join(classroomsRoot(), ref.classroom);
    for (const name of [
      "classroom.json",
      "GLOSSARY.md",
      "assets",
      "reference",
      `${isStoredReview(ref.lesson) ? ".reviews/" : ""}${ref.lesson}/media`,
    ])
      copy(path.join(classroom, name), path.join(scratch, ref.classroom, name));
    const result = spawnSync(
      process.execPath,
      [path.join(packageRoot(), "scripts/check-lesson.ts"), ref.classroom, ref.lesson],
      {
        env: { ...process.env, PI_CLASSROOMS_DIR: scratch },
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    if (result.error || result.status !== 0)
      throw new Error(
        `Candidate browser check failed: ${result.error?.message || result.stderr.trim() || `exit ${result.status}`}`,
      );
    return { stdout: result.stdout, stderr: result.stderr };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

export function migrateLesson(
  ref: LessonRef,
  options: { retry?: boolean; candidate?: string; check?: typeof checkCandidate } = {},
): MigrationResult {
  let saved: Journal | null = null;
  let locked = false;
  let committed = false;
  const file = journalFile(ref);
  const lock = guarded(path.join(path.dirname(file), "ui-migration.lock"));
  try {
    saved = readJournal(ref);
    if (saved && saved.status !== "complete" && !options.retry)
      throw new Error("Previous migration is unfinished or failed; use --retry explicitly.");
    const inputs = readLessonInputs(ref.classroom, ref.lesson);
    if (saved?.status === "complete")
      return { ...ref, status: "unchanged", detail: "Migration already completed." };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      fs.closeSync(fs.openSync(lock, "wx", 0o600));
      locked = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      throw new Error(
        "quiz/ui-migration.lock exists; stop its owner, remove the stale lock, then explicitly --retry.",
      );
    }
    if (saved) {
      const original = Buffer.from(saved.original, "base64");
      if (hash(original) !== saved.hashes["lesson.html"])
        throw new Error("Migration original hash does not match its journal.");
      const currentHash = inputs.hashes["lesson.html"];
      if (currentHash !== hash(original) && currentHash !== hash(saved.candidate))
        throw new Error(
          "Lesson changed since migration was prepared; restore the original before explicit retry.",
        );
      if (
        inputs.htmlFile !== saved.htmlFile ||
        ["lesson.json", "quiz/key.json", "quiz/plan.json"].some(
          (n) =>
            inputs.hashes[n as keyof typeof inputs.hashes] !==
            saved!.hashes[n as keyof typeof inputs.hashes],
        )
      )
        throw new Error(
          "Private inputs changed since migration was prepared; restore them before explicit retry.",
        );
      if (currentHash === hash(saved.candidate)) {
        saved.status = "complete";
        delete saved.error;
        atomic(file, JSON.stringify(saved, null, 2));
        return {
          ...ref,
          status: "recovered",
          detail: "Replacement already committed; no checking or grading repeated.",
        };
      }
    }
    const original = saved ? Buffer.from(saved.original, "base64") : inputs.html.bytes;
    const candidate = options.candidate ?? saved?.candidate ?? mechanicalRebuild(inputs.html.text);
    saved = {
      version: 1,
      htmlFile: inputs.htmlFile,
      hashes: saved?.hashes ?? inputs.hashes,
      original: original.toString("base64"),
      candidate,
      status: "prepared",
    };
    atomic(file, JSON.stringify(saved, null, 2)); // Plan before validation or lesson writes.
    validateLessonMarkup(candidate, true);
    if (assessmentShape(original.toString("utf8")) !== assessmentShape(candidate))
      throw new Error(
        "Candidate changes a graded quiz; preserve its content, identities and controls with the original private rubric.",
      );
    preflightLessonInputs(
      { ...inputs, html: { text: candidate, bytes: Buffer.from(candidate) } },
      ref.classroom,
      ref.lesson,
    );
    saved.check = (options.check ?? checkCandidate)(ref, inputs, candidate);
    atomic(file, JSON.stringify(saved, null, 2));
    if (!sameLessonInputs(inputs, readLessonInputs(ref.classroom, ref.lesson)))
      throw new Error("Lesson inputs changed during checking; explicit retry required.");
    atomic(guarded(path.join(lessonDir(ref.classroom, ref.lesson), inputs.htmlFile)), candidate);
    committed = true;
    saved.status = "complete";
    atomic(file, JSON.stringify(saved, null, 2));
    return { ...ref, status: "migrated" };
  } catch (error) {
    const detail = `${committed ? "HTML replacement committed; use --retry to finish its receipt. " : ""}${(error as Error).message}`;
    const status = committed ? "retry-required" : "failed";
    if (locked && saved) {
      saved.status = committed ? "prepared" : "failed";
      saved.error = detail;
      try {
        atomic(file, JSON.stringify(saved, null, 2));
      } catch (journalError) {
        return {
          ...ref,
          status,
          detail: `${detail} Journal save failed: ${(journalError as Error).message}`,
        };
      }
    }
    return { ...ref, status, detail };
  } finally {
    if (locked) fs.unlinkSync(lock);
  }
}

export function main(args = process.argv.slice(2)): number {
  let apply = false,
    retry = false,
    accepted = false;
  let classroom: string | undefined, lesson: string | undefined, candidateFile: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--apply") apply = true;
    else if (arg === "--retry") retry = true;
    else if (arg === "--accept-state-loss") accepted = true;
    else if (
      ["--classroom", "--lesson", "--candidate"].includes(arg) &&
      args[i + 1] &&
      !args[i + 1].startsWith("--")
    ) {
      const value = args[++i];
      if (arg === "--classroom") classroom = value;
      else if (arg === "--lesson") lesson = value;
      else candidateFile = value;
    } else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  if ((retry || accepted || candidateFile) && !apply)
    throw new Error("--retry, --candidate and --accept-state-loss require --apply.");
  if (candidateFile && (!classroom || !lesson))
    throw new Error("--candidate requires one --classroom and --lesson.");
  if (apply && !accepted)
    throw new Error(`${warning} Pass --apply --accept-state-loss to proceed.`);
  if (apply) console.error(warning);
  const refs = discoverLessons(classroom, lesson);
  let failed = false;
  for (const ref of refs) {
    if (!apply && ref.status === "v2") continue;
    const result =
      apply && ref.status !== "failed" && ref.status !== "v2"
        ? migrateLesson(ref, {
            retry,
            candidate: candidateFile ? fs.readFileSync(candidateFile, "utf8") : undefined,
          })
        : ref;
    console.log(JSON.stringify(result));
    if (result.status === "failed" || (apply && result.status === "retry-required")) failed = true;
  }
  return failed ? 1 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
