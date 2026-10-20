/**
 * commands.ts — /classroom and /teach.
 *
 * /classroom manages the local server and reports page links. It never opens a browser.
 * /teach is the entry point to a teaching session, and replaces the old teach skill.
 *
 * Anything here that starts or stops the server also refreshes the status widget, so the
 * "running on port N" line never outlives (or lags behind) the server it describes.
 */

import * as fs from "node:fs";

import { classroomDir, slugify } from "./paths.ts";
import { SERVICE_BRIEF } from "./mcp.ts";
import { reviewStatusText, teachingPrompt } from "./prompts.ts";
import { summarize } from "./review.ts";
import { attachStatusWidget, detachStatusWidget, refreshStatusWidget } from "./status-widget.ts";
import * as store from "./store.ts";
import type { PiServiceClient } from "./pi-service-client.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Minimal shape of the pi API used here, so tests can pass a stub. */
export interface CommandHost {
  registerCommand(name: string, spec: unknown): void;
  sendUserMessage(text: string, options?: { deliverAs?: string }): void;
}

export function registerClassroomCommands(pi: any, client: PiServiceClient): void {
  // ── /classroom ──────────────────────────────────────────────────────────────

  pi.registerCommand("classroom", {
    description:
      "Get a link to your classrooms. Usage: /classroom [start|stop|status|list|open [<name>]]",
    getArgumentCompletions: async (prefix: string) => {
      const verbs = ["start", "stop", "status", "list", "open"];
      const names = store.listClassrooms().map((c) => c.name);
      const matches = [...verbs, ...names].filter((v) => v.startsWith(prefix));
      return matches.length > 0 ? matches.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args: string, ctx: any) => {
      const trimmed = (args ?? "").trim();
      const [verb, ...rest] = trimmed.split(/\s+/).filter(Boolean);
      const argument = rest.join(" ");

      switch (verb) {
        case undefined:
          return handleOpen(ctx, null, client);
        case "start":
          return handleStart(ctx, client);
        case "stop":
          return handleStop(ctx, client);
        case "status":
          return handleStatus(ctx, client);
        case "list":
          return handleList(ctx);
        case "open":
          return handleOpen(ctx, argument || null, client);
        default:
          // A bare name is the common case: /classroom rust-ownership
          return handleOpen(ctx, trimmed, client);
      }
    },
  });

  // ── /teach ──────────────────────────────────────────────────────────────────

  pi.registerCommand("teach", {
    description:
      "Learn something, one short lesson at a time. Usage: /teach [<topic or classroom name>]",
    getArgumentCompletions: async (prefix: string) => {
      const names = store.listClassrooms().map((c) => c.name);
      const matches = names.filter((name) => name.startsWith(prefix));
      return matches.length > 0 ? matches.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args: string, ctx: any) => {
      const topic = (args ?? "").trim();
      const classroom = resolveClassroom(topic);

      const prompt =
        teachingPrompt(topic, classroom, classroom ? classroomReviewText(classroom) : null) +
        "\n\n" +
        SERVICE_BRIEF;
      if (ctx.isIdle()) pi.sendUserMessage(prompt);
      else pi.sendUserMessage(prompt, { deliverAs: "followUp" });

      ctx.ui.notify(
        classroom
          ? `📚 Continuing ${classroom} (run /classroom to open it)`
          : "📚 Starting a new classroom. Expect some questions about why you want to learn this.",
        "info",
      );
    },
  });
}

/**
 * Match free text to an existing classroom.
 *
 * Exact directory name first, then the slugified topic, then a title match — a user
 * typing "/teach rust ownership" should land back in the classroom they already have.
 */
export function resolveClassroom(topic: string): string | null {
  if (!topic) {
    const classrooms = store.listClassrooms();
    return classrooms.length === 1 ? classrooms[0].name : null;
  }

  const classrooms = store.listClassrooms();
  const slug = slugify(topic);
  const byName = classrooms.find((c) => c.name === topic || c.name === slug);
  if (byName) return byName.name;

  const byTitle = classrooms.find((c) => c.title.toLowerCase() === topic.toLowerCase());
  return byTitle?.name ?? null;
}

/** The classroom's spaced-review status, as a section of the teaching brief. */
export function classroomReviewText(classroom: string): string {
  const now = Date.now();
  return reviewStatusText(summarize(store.reviewItems(classroom), now), now);
}

// ── /classroom handlers ───────────────────────────────────────────────────────

async function handleStart(ctx: any, client: PiServiceClient): Promise<void> {
  const result = await client.call("open_classroom", {});
  await attachStatusWidget(ctx.ui);
  ctx.ui.notify(
    `${(result.content[0] as any).text}\nThe persistent service continues after Pi exits.`,
    "info",
  );
}

async function handleStop(ctx: any, client: PiServiceClient): Promise<void> {
  await client.call("classroom_service", { action: "stop" });
  // Stop is asynchronous; clear this UI immediately without claiming another owner stopped.
  detachStatusWidget();
  ctx.ui.notify("Classroom service stop requested for every attached classroom.", "info");
}

async function handleStatus(ctx: any, client: PiServiceClient): Promise<void> {
  const result = await client.call("classroom_service", { action: "status" });
  const status = JSON.parse((result.content[0] as any).text);
  await refreshStatusWidget();
  ctx.ui.notify(
    status.running
      ? `Persistent classroom service running at ${status.url} (process ${status.pid}). It continues after Pi exits.`
      : "Classroom service is not running. Run /classroom to start it.",
    "info",
  );
}

function handleList(ctx: any): void {
  ctx.ui.notify(classroomListText("Run /teach <topic> to start one."), "info");
}

/**
 * Every classroom and its lessons, with scores and pending grading, as markdown.
 *
 * `emptyHint` says how to start a classroom on the host that shows the list.
 */
export function classroomListText(emptyHint: string): string {
  const classrooms = store.listClassrooms();
  if (classrooms.length === 0) return `No classrooms yet. ${emptyHint}`;

  const lines = ["📚 **Classrooms**", ""];
  const now = Date.now();
  for (const classroom of classrooms) {
    const review = summarize(store.reviewItems(classroom.name), now);
    const due = review.due > 0 ? `  ·  ${review.due} due for review` : "";
    lines.push(`${classroom.emoji} **${classroom.title}**  \`${classroom.name}\`${due}`);
    for (const lesson of store.listLessons(classroom.name)) {
      const score = lesson.latestScore !== null ? `  ·  ${Math.round(lesson.latestScore)}%` : "";
      const pending = lesson.hasUngradedSubmission ? "  ·  awaiting grading" : "";
      const review = lesson.kind === "review" ? "  ·  review" : "";
      lines.push(
        `   ${String(lesson.order ?? 0).padStart(3, "0")}  ${lesson.title}${review}${score}${pending}`,
      );
    }
    if (classroom.lessonCount === 0) lines.push("   (no lessons yet)");
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

async function handleOpen(
  ctx: any,
  requested: string | null,
  client: PiServiceClient,
): Promise<void> {
  let target = requested;

  if (target && !fs.existsSync(classroomDir(target))) {
    const resolved = resolveClassroom(target);
    if (!resolved) {
      ctx.ui.notify(`No such classroom: ${target}. Try /classroom list.`, "error");
      return;
    }
    target = resolved;
  }

  // With no argument and several classrooms, let the user pick rather than guessing.
  if (!target && ctx.hasUI) {
    const classrooms = store.listClassrooms();
    if (classrooms.length > 1) {
      const items = [
        "All classrooms",
        ...classrooms.map((c) => `${c.emoji} ${c.title}  (${c.name})`),
      ];
      const selected = await ctx.ui.select("Open which classroom?", items);
      if (!selected) return;
      if (selected !== "All classrooms") {
        target = selected.slice(selected.lastIndexOf("(") + 1, -1);
      }
    }
  }

  const result = await client.call("open_classroom", target ? { classroom: target } : {});
  await attachStatusWidget(ctx.ui);
  ctx.ui.notify((result.content[0] as any).text, "info");
}
