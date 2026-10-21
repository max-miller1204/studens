/** Optional explicit course intentions in the canonical mission; never infer links. */
import { marked } from "marked";
import type { Token, Tokens } from "marked";
import { isContractId, parseReviewKey } from "../assets/runtime/quiz.mjs";
import { createMarkdown, escapeHtml } from "./markdown.ts";

const COURSE_MAP_FENCE = "studens-course-map";

/** Cards and classroom heroes use prose tokens, never fenced metadata. Markdown
 * fences may interrupt a paragraph without a blank line and may use tildes.
 */
export function missionSummary(mission: string | null): string | null {
  if (!mission) return null;
  const tokens = marked.lexer(mission);
  const start = tokens.findIndex(
    (token) =>
      token.type === "heading" && token.depth === 2 && token.text.trim().toLowerCase() === "why",
  );
  if (start < 0) return null;
  const inlineText = (items: Token[]): string =>
    items
      .map((token) => {
        if (token.type === "html" || token.type === "code") return "";
        if ("tokens" in token && Array.isArray(token.tokens)) return inlineText(token.tokens);
        return "text" in token && typeof token.text === "string" ? token.text : " ";
      })
      .join("");
  const prose = (items: Token[]): string | null => {
    for (const token of items) {
      if (token.type === "code" || token.type === "html") continue;
      if (token.type === "paragraph" || token.type === "text") {
        const text = inlineText(
          "tokens" in token && Array.isArray(token.tokens) ? token.tokens : [token],
        )
          .replace(/\s+/g, " ")
          .trim();
        if (text) return text;
      }
      if (token.type === "blockquote" && Array.isArray(token.tokens)) {
        const text = prose(token.tokens);
        if (text) return text;
      }
      if (token.type === "list" && Array.isArray(token.items)) {
        for (const item of token.items) {
          const text = prose(item.tokens);
          if (text) return text;
        }
      }
    }
    return null;
  };
  const section: Token[] = [];
  for (const token of tokens.slice(start + 1)) {
    if (token.type === "heading" && token.depth <= 2) break;
    section.push(token);
  }
  const text = prose(section);
  return text && text.length > 220 ? text.slice(0, 217).trimEnd() + "…" : text;
}
export interface MissionCoursePlan {
  version: 1;
  upcoming: { id: string; statement: string }[];
  connections: { from: string; to: string; kind: "builds-on" | "related" }[];
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error(`${label} has an unknown field.`);
}
function reference(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.startsWith("@upcoming/")) return isContractId(value.slice("@upcoming/".length));
  const parsed = parseReviewKey(value);
  return parsed?.quizId === "@objective";
}

export function parseMissionCoursePlan(mission: string): MissionCoursePlan | null {
  const blocks: Tokens.Code[] = [];
  marked.walkTokens(marked.lexer(mission), (token) => {
    if (token.type === "code" && token.lang?.split(/\s/)[0] === COURSE_MAP_FENCE)
      blocks.push(token as Tokens.Code);
  });
  if (!blocks.length) return null;
  if (blocks.length !== 1) throw new Error("Mission needs at most one course-map block.");
  const block = blocks[0];
  const fence = /^ {0,3}(`{3,}|~{3,})/.exec(block.raw)?.[1];
  if (
    block.lang !== COURSE_MAP_FENCE ||
    !fence ||
    !new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*$`).test(
      block.raw.trimEnd().split("\n").at(-1)!,
    )
  )
    throw new Error("Mission course-map block needs an exact language and closing fence.");
  let raw: unknown;
  try {
    raw = JSON.parse(block.text);
  } catch (error) {
    throw new Error("Mission course-map block contains invalid JSON.", { cause: error });
  }
  const plan = object(raw, "Mission course map");
  exactKeys(plan, ["version", "upcoming", "connections"], "Mission course map");
  if (plan.version !== 1 || !Array.isArray(plan.upcoming) || !Array.isArray(plan.connections))
    throw new Error("Mission course map needs version 1, upcoming and connections arrays.");
  const upcoming: MissionCoursePlan["upcoming"] = [];
  const ids = new Set<string>();
  for (const [index, value] of plan.upcoming.entries()) {
    const goal = object(value, `Upcoming objective ${index + 1}`);
    exactKeys(goal, ["id", "statement"], `Upcoming objective ${index + 1}`);
    if (!isContractId(goal.id) || typeof goal.statement !== "string" || !goal.statement.trim())
      throw new Error(`Upcoming objective ${index + 1} needs a valid id and nonempty statement.`);
    if (ids.has(goal.id)) throw new Error(`Upcoming objective ${index + 1} duplicates an id.`);
    ids.add(goal.id);
    upcoming.push({ id: goal.id, statement: goal.statement });
  }
  const connections: MissionCoursePlan["connections"] = [];
  const seen = new Set<string>();
  for (const [index, value] of plan.connections.entries()) {
    const edge = object(value, `Connection ${index + 1}`);
    exactKeys(edge, ["from", "to", "kind"], `Connection ${index + 1}`);
    if (
      !reference(edge.from) ||
      !reference(edge.to) ||
      !["builds-on", "related"].includes(String(edge.kind))
    )
      throw new Error(
        `Connection ${index + 1} needs valid objective references and a builds-on or related kind.`,
      );
    if (edge.from === edge.to)
      throw new Error(`Connection ${index + 1} connects an objective to itself.`);
    const pair = edge.kind === "related" ? [edge.from, edge.to].sort() : [edge.from, edge.to];
    const key = JSON.stringify([edge.kind, ...pair]);
    if (seen.has(key)) throw new Error(`Connection ${index + 1} duplicates a connection.`);
    seen.add(key);
    connections.push({ from: edge.from, to: edge.to, kind: edge.kind as "builds-on" | "related" });
  }
  return { version: 1, upcoming, connections };
}

/** Validate against all stored objectives before redacting unreleased ones. */
export function validateMissionConnections(
  plan: MissionCoursePlan,
  objectives: ReadonlySet<string>,
): void {
  const nodes = new Set([...objectives, ...plan.upcoming.map((goal) => `@upcoming/${goal.id}`)]);
  const next = new Map<string, string[]>();
  for (const [index, edge] of plan.connections.entries()) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to))
      throw new Error(
        `Connection ${index + 1} names an unknown or unpublished objective. Update stale references explicitly.`,
      );
    if (edge.kind === "builds-on") next.set(edge.from, [...(next.get(edge.from) ?? []), edge.to]);
  }
  const visiting = new Set<string>(),
    visited = new Set<string>();
  const visit = (key: string): void => {
    if (visiting.has(key))
      throw new Error("Mission builds-on connections contain a prerequisite cycle.");
    if (visited.has(key)) return;
    visiting.add(key);
    for (const to of next.get(key) ?? []) visit(to);
    visiting.delete(key);
    visited.add(key);
  };
  for (const key of nodes) visit(key);
}

/** Mission prose is public; metadata must not disclose references to gated objectives.
 * Render readable Markdown with escaped HTML, safe links, and no remote images/scripts.
 */
export function renderMission(mission: string, headingOffset = 0): string {
  const missionMarkdown = createMarkdown({
    html({ text }) {
      return escapeHtml(text);
    },
    heading({ tokens, depth }) {
      const level = Math.min(depth + headingOffset, 6);
      return `<h${level}>${this.parser.parseInline(tokens)}</h${level}>`;
    },
    code({ text, lang }) {
      return lang?.split(/\s/)[0] === COURSE_MAP_FENCE
        ? ""
        : `<pre><code>${escapeHtml(text)}</code></pre>`;
    },
    image({ text }) {
      return escapeHtml(text);
    },
    link({ href, tokens }) {
      const text = this.parser.parseInline(tokens);
      try {
        if (!["http:", "https:"].includes(new URL(href, "http://127.0.0.1").protocol)) return text;
      } catch {
        return text;
      }
      return `<a href="${escapeHtml(href)}">${text}</a>`;
    },
  });
  return missionMarkdown.parse(mission, { async: false }) as string;
}
