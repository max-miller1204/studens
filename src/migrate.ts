/**
 * One-time upgrade of a classrooms root to the formats this package writes.
 *
 * The service runs it under its ownership lock before reading any classroom. It never
 * grades, answers or authors. Unfinished live-session Pi work stops the upgrade with a
 * specific error; the previous package finishes it. Every rewritten file is copied
 * first to `.migrations/<version>/` under the root. A durable plan precedes
 * conversion, and an atomic marker is written last so interruption repeats safely.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { classroomsRoot, isValidSlug, isStoredReview, privateStatePath } from "./paths.ts";
import { askPrompt, followUpPrompt } from "./prompts.ts";
import type { Annotation } from "./store.ts";
import type { TeacherRequest, TeacherState } from "./service-state.ts";

export const FORMAT_VERSION = 1;
const MARKER = ".studens-format.json";
const JOURNAL = `.migrations/${FORMAT_VERSION}/.plan.json`;
const PREVIOUS =
  "Reopen the previous Studens package, finish or explicitly retry that request, then stop its server before starting this version. No saved data was changed.";

export class MigrationError extends Error {}

function readJson(file: string, root: string): any {
  privateStatePath(path.relative(root, file), root);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new MigrationError(
      `Cannot read ${file} for the format upgrade: ${(error as Error).message}`,
    );
  }
}

interface Change {
  file: string;
  value: unknown;
}

/** Upgrade the root once. Returns the files it changed. */
export function migrateClassrooms(root = classroomsRoot()): string[] {
  try {
    return upgrade(root);
  } catch (error) {
    if (error instanceof MigrationError) throw error;
    throw new MigrationError(
      `Cannot upgrade classrooms root ${root}: ${(error as Error).message} Restore the saved state, then restart explicitly.`,
    );
  }
}

function upgrade(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  root = privateStatePath(".", root);
  const guard = (file: string) => privateStatePath(path.relative(root, file), root);
  const read = (file: string) => readJson(file, root);
  const atomicWrite = (file: string, content: string) => {
    fs.writeFileSync(guard(`${file}.migrate.tmp`), content, { mode: 0o600 });
    fs.renameSync(guard(`${file}.migrate.tmp`), guard(file));
  };
  const marker = read(path.join(root, MARKER));
  if (marker !== undefined) {
    if (marker?.version === FORMAT_VERSION) return [];
    throw new MigrationError(
      `${path.join(root, MARKER)} records format ${JSON.stringify(marker?.version)}. This package reads format ${FORMAT_VERSION}. Use the package that wrote it.`,
    );
  }
  const finish = (plan: { version: number; changes: Change[]; removals: string[] }) => {
    if (
      plan?.version !== FORMAT_VERSION ||
      !Array.isArray(plan.changes) ||
      !Array.isArray(plan.removals) ||
      plan.changes.some((c) => !c || typeof c.file !== "string" || !("value" in c)) ||
      plan.removals.some((file) => typeof file !== "string")
    )
      throw new MigrationError(`Invalid format upgrade plan ${path.join(root, JOURNAL)}.`);
    const target = (relative: string) => privateStatePath(relative, root);
    // Preflight every destination before changing any saved state, including on recovery.
    for (const file of [...plan.changes.map((c) => c.file), ...plan.removals, MARKER]) {
      target(file);
      target(`${file}.migrate.tmp`);
    }
    for (const { file, value } of plan.changes)
      atomicWrite(target(file), JSON.stringify(value, null, 2));
    for (const file of plan.removals) fs.rmSync(target(file), { force: true });
    atomicWrite(target(MARKER), JSON.stringify({ version: FORMAT_VERSION }) + "\n");
    return [...new Set([...plan.changes.map((c) => target(c.file)), ...plan.removals.map(target)])];
  };
  const journal = read(path.join(root, JOURNAL));
  if (journal !== undefined) return finish(journal);
  const legacyRoute = path.join(root, ".pi-teach-pi", "phone.json");
  if (fs.existsSync(guard(legacyRoute)))
    throw new MigrationError(
      `A live-session Pi tailnet route is still recorded at ${legacyRoute}. Stop that server with the previous Studens package before starting this version. No route or saved data was replaced.`,
    );

  const changes: Change[] = [];
  const change = (file: string, value: unknown) => {
    if (!changes.some((c) => c.file === file)) changes.push({ file, value });
  };
  const removals: string[] = [];
  const classrooms = fs
    .readdirSync(root)
    .filter((name) => isValidSlug(name) && fs.statSync(guard(path.join(root, name))).isDirectory());
  const reviews = new Map(
    classrooms.map((c) => [c, read(path.join(root, c, ".reviews.json"))?.requests ?? []]),
  );

  const daily = read(path.join(root, ".daily-reviews.json"));
  if (
    daily?.requests?.some(
      (r: any) => r.owner === "pi" || r.groups?.some((g: any) => g.plan?.owner === "pi"),
    )
  ) {
    for (const request of daily.requests)
      for (const group of request.groups ?? []) {
        if (group.plan?.owner !== "pi") continue;
        const session =
          reviews.get(group.classroom)?.find((r: any) => r.id === group.plan.id) ?? group.plan;
        if (!group.empty && session.status !== "done")
          throw new MigrationError(
            `Daily review ${request.id} has unfinished live-session Pi work for ${group.classroom}. ${PREVIOUS}`,
          );
        group.plan.owner = "service";
      }
    for (const request of daily.requests) if (request.owner === "pi") request.owner = "service";
    change(path.join(root, ".daily-reviews.json"), daily);
  }

  for (const classroom of classrooms) {
    const dir = path.join(root, classroom);
    const unfinished = (what: string, id: string) =>
      new MigrationError(
        `Classroom ${classroom} has unfinished live-session Pi ${what} ${id}. ${PREVIOUS}`,
      );

    const lessons = read(path.join(dir, ".lesson-requests.json"));
    const teacherFile = path.join(dir, ".teacher.json");
    let state: TeacherState | undefined = read(teacherFile);
    let stateChanged = false;
    for (const r of lessons?.requests ?? []) {
      if (r.owner === "pi" && r.delivery !== "service" && r.status !== "done")
        throw unfinished("lesson request", r.id);
      if (!("delivery" in r) && !("ownerSession" in r)) continue;
      delete r.delivery;
      delete r.ownerSession;
      change(path.join(dir, ".lesson-requests.json"), lessons);
    }

    const sessions = reviews.get(classroom)!;
    if (sessions.some((r: any) => r.owner === "pi")) {
      for (const r of sessions) {
        if (r.owner !== "pi") continue;
        if (r.status !== "done") throw unfinished("review", r.id);
        r.owner = "service";
      }
      change(path.join(dir, ".reviews.json"), { version: 1, requests: sessions });
    }

    const refills = read(path.join(dir, ".review-refills.json"));
    if (refills?.requests?.some((r: any) => r.owner === "pi")) {
      for (const r of refills.requests) {
        if (r.owner !== "pi") continue;
        if (r.status !== "done") throw unfinished("review refill", r.id);
        r.owner = "service";
      }
      change(path.join(dir, ".review-refills.json"), refills);
    }

    const resumesFile = path.join(dir, ".pi-teacher-resumes.json");
    const resumes = read(resumesFile);
    if (resumes !== undefined) {
      const open = Array.isArray(resumes) ? resumes.find((r: any) => r?.status !== "done") : null;
      if (open !== undefined && open !== null) throw unfinished("teacher panel request", open.id);
      if (!Array.isArray(resumes))
        throw new MigrationError(`Invalid live-session Pi resume state ${resumesFile}.`);
      removals.push(resumesFile);
    }

    for (const r of state?.requests ?? []) {
      const request = r as TeacherRequest & { planVersion?: number };
      // Older decoder failures saved raw lesson output only in the teacher state.
      if (request.kind === "lesson" && request.modelOutput !== undefined) {
        const saved = lessons?.requests?.find((l: any) => l.id === request.target);
        if (saved && saved.modelOutput === undefined) {
          saved.modelOutput = request.modelOutput;
          change(path.join(dir, ".lesson-requests.json"), lessons);
        }
      }
      // Quiz plans saved before score-free grading cannot be applied by this package.
      if (
        request.kind === "quiz" &&
        request.plan &&
        request.status !== "done" &&
        request.planVersion === undefined
      ) {
        if (request.applied)
          throw new MigrationError(
            `Classroom ${classroom} has partly applied grading plan ${request.id} from an earlier format. ${PREVIOUS}`,
          );
        delete request.plan;
        delete request.planValidated;
        request.status = "failed";
        request.error =
          "This grading plan was saved in an earlier format. Retry this request for a new plan.";
        stateChanged = true;
      }
      if ("planVersion" in request) {
        if (request.planVersion !== 2)
          throw new MigrationError(
            `${teacherFile} request ${request.id} has unsupported plan version ${request.planVersion}.`,
          );
        delete request.planVersion;
        stateChanged = true;
      }
    }

    // Panel history and failed passage turns written by the live Pi session.
    const lessonDirs = [
      ...fs
        .readdirSync(dir)
        .filter((name) => isValidSlug(name) && !isStoredReview(name))
        .map((name) => ({ name, dir: path.join(dir, name) })),
      ...(fs.existsSync(guard(path.join(dir, ".reviews")))
        ? fs
            .readdirSync(guard(path.join(dir, ".reviews")))
            .filter(isStoredReview)
            .map((name) => ({ name, dir: path.join(dir, ".reviews", name) }))
        : []),
    ].filter((lesson) => fs.statSync(guard(lesson.dir)).isDirectory());
    for (const lesson of lessonDirs) {
      const messagesFile = path.join(lesson.dir, "teacher-messages.json");
      const messages = read(messagesFile);
      if (messages !== undefined) {
        if (!Array.isArray(messages))
          throw new MigrationError(`Invalid live-session Pi panel history ${messagesFile}.`);
        state ??= { version: 1, identity: { backend: "pi" }, requests: [], messages: [] };
        for (const m of messages)
          if (!state.messages.some((saved) => saved.id === m.id && saved.role === m.role))
            state.messages.push({
              id: m.id,
              lesson: lesson.name,
              role: m.role,
              text: m.text,
              at: m.at,
              sourceBackend: "pi",
            });
        state.messages.sort((a, b) => a.at - b.at);
        stateChanged = true;
        removals.push(messagesFile);
      }
      const annotationsFile = path.join(lesson.dir, "annotations.json");
      const annotations: Annotation[] | undefined = read(annotationsFile);
      let annotationsChanged = false;
      for (const a of annotations ?? [])
        for (const turn of [a, ...(a.followUps ?? [])]) {
          if (turn.status !== "failed") continue;
          const followUp =
            turn === a ? null : (turn as NonNullable<Annotation["followUps"]>[number]);
          const id = followUp ? `follow-up:${followUp.id}` : `ask:${a.id}`;
          state ??= { version: 1, identity: { backend: "pi" }, requests: [], messages: [] };
          const existing = state.requests.find((r) => r.id === id);
          if (existing?.status === "done") continue;
          // The service answers only pending turns. Its failed request carries the retry.
          turn.status = "pending";
          delete (turn as { answeredAt?: number }).answeredAt;
          annotationsChanged = true;
          if (existing) continue;
          state.requests.push({
            id,
            classroom,
            lesson: lesson.name,
            kind: followUp ? "follow-up" : "ask",
            target: a.id,
            ...(followUp ? { turn: followUp.id } : {}),
            prompt: followUp ? followUpPrompt(a, followUp, "service") : askPrompt(a, "service"),
            at: a.createdAt,
            status: "failed",
            error:
              "The live Pi session finished this question without an answer. Retry this request.",
          });
          stateChanged = true;
        }
      if (annotationsChanged) change(annotationsFile, annotations);
    }

    if (stateChanged) change(teacherFile, state);
  }

  const backup = path.join(root, ".migrations", String(FORMAT_VERSION));
  // Validate sources, backup paths and temporary files before the first mutation.
  const files = [...changes.map((c) => c.file), ...removals];
  for (const file of [...files, path.join(root, JOURNAL), path.join(root, MARKER)]) {
    guard(file);
    guard(`${file}.migrate.tmp`);
  }
  for (const file of files) {
    const copy = guard(path.join(backup, path.relative(root, file)));
    guard(`${copy}.migrate.tmp`);
  }
  for (const file of files) {
    const copy = guard(path.join(backup, path.relative(root, file)));
    if (fs.existsSync(copy) || !fs.existsSync(guard(file))) continue;
    fs.mkdirSync(guard(path.dirname(copy)), { recursive: true, mode: 0o700 });
    // A crash while copying must not leave a partial backup recorded as complete.
    fs.copyFileSync(guard(file), guard(`${copy}.migrate.tmp`));
    fs.renameSync(guard(`${copy}.migrate.tmp`), guard(copy));
  }
  // Teacher state first: a failed passage request must exist before its turn is pending.
  changes.sort(
    (a, b) => Number(b.file.endsWith(".teacher.json")) - Number(a.file.endsWith(".teacher.json")),
  );
  const plan = {
    version: FORMAT_VERSION,
    changes: changes.map((c) => ({ ...c, file: path.relative(root, c.file) })),
    removals: removals.map((file) => path.relative(root, file)),
  };
  if (!files.length) {
    atomicWrite(path.join(root, MARKER), JSON.stringify({ version: FORMAT_VERSION }) + "\n");
    return [];
  }
  fs.mkdirSync(guard(backup), { recursive: true, mode: 0o700 });
  // Keep the complete immutable plan as the recovery receipt. Never reclassify a
  // partly converted file after delivery/planVersion discriminators were removed.
  atomicWrite(path.join(root, JOURNAL), JSON.stringify(plan, null, 2));
  return finish(plan);
}
