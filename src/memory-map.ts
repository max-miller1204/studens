/** Read-only presentation of replayed evidence. Dates are not predicted completions. */
import { escapeHtml } from "./markdown.ts";
import { lessonUrl } from "./paths.ts";
import { DAY_MS, RETENTION_SPAN_DAYS, RETENTION_SUCCESSES } from "./review.ts";
import type { ReviewItem } from "./review.ts";

const STRENGTH: Record<ReviewItem["progress"], string> = {
  "context-unknown": "Evidence context missing",
  "needs-practice": "More practice needed",
  "immediate-success": "Independent success · more evidence needed",
  "delayed-success": "Delayed recall observed",
  "transfer-needed": "Recall observed · transfer still needed",
  "retained-evidence": "Retained evidence",
};
const CONTEXT: Record<ReviewItem["context"], string> = {
  unknown: "Help or task context was not recorded",
  assisted: "Answered with support or help",
  "immediate-independent": "Independent answer · less than 24 hours after practice",
  "delayed-retrieval": "Independent recall · at least 24 hours after practice",
  "delayed-transfer": "Independent transfer · at least 24 hours after practice",
};

export interface ForecastDay {
  at: number;
  /** Today includes all older due dates; later days contain only new arrivals. */
  count: number;
}
export function memoryForecast(items: ReviewItem[], now: number): ForecastDay[] {
  if (!Number.isFinite(now) || Math.abs(now) > 8e15) throw new Error("Invalid memory map clock.");
  const start = Math.floor(now / DAY_MS) * DAY_MS;
  const days = Array.from({ length: 14 }, (_, index) => ({ at: start + index * DAY_MS, count: 0 }));
  for (const item of items) {
    if (!Number.isFinite(item.dueAt) || Math.abs(item.dueAt) > 8e15)
      throw new Error(`Invalid memory map due time for ${item.key}.`);
    if (item.retiredAt !== undefined || item.needsReteach) continue;
    const index = Math.max(0, Math.floor((item.dueAt - start) / DAY_MS));
    if (index < days.length) days[index].count++;
  }
  return days;
}

function memoryGap(item: ReviewItem): string {
  if (item.needsReteach) return "Repeated misses · review paused for a short re-teach";
  if (item.gapOpen)
    return item.lastCredit > 0 && item.lastCredit < 1
      ? "Partly answered · revisit the incomplete idea"
      : "Earlier miss still needs an independent correct answer";
  if ((item.misses ?? 0) > 0) return "Earlier answer gap resolved · history kept";
  return "No current answer gap recorded";
}

function date(at: number): string {
  return new Date(at).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
export function memoryTime(at: number, now: number, compact = false): string {
  const iso = new Date(at).toISOString();
  const days = Math.ceil(Math.abs(at - now) / DAY_MS);
  const relative = at <= now ? (days === 0 ? "Just now" : `${days} days ago`) : `In ${days} days`;
  return `<time datetime="${iso}" tabindex="0" title="${iso}" data-exact-time="${iso}" data-cl-relative-time data-clock="${now}"${compact ? ' data-compact="true"' : ""}>${relative}</time>`;
}

function memoryItem(classroom: string, item: ReviewItem, now: number): string {
  const original = lessonUrl(classroom, item.lesson);
  const due =
    item.retiredAt !== undefined
      ? "Retired · not scheduled"
      : item.needsReteach
        ? "Paused · re-teach"
        : item.dueAt <= now
          ? "Due now"
          : memoryTime(item.dueAt, now, true);
  const credit = Math.round(item.lastCredit * 100);
  const evidence = `${item.delayedSuccesses} qualifying delayed independent ${item.delayedSuccesses === 1 ? "success" : "successes"} · ${item.delayedTransfers} qualifying delayed transfers · ${item.evidenceSpanDays.toFixed(1)}-day evidence span`;
  return `<li class="cl-memory-item" data-memory-key="${escapeHtml(item.key)}">
    <details class="cl-memory-row"><summary><span class="cl-memory-objective">${escapeHtml(item.objective?.statement ?? item.prompt)}</span><span class="cl-badge cl-memory-state">${escapeHtml(STRENGTH[item.progress])}</span><span class="cl-memory-due">${due}</span></summary>
    <div class="cl-memory-heading"><span class="cl-memory-tag">${item.objective ? "Saved objective" : "Older question · objective not recorded"}${item.retiredAt === undefined ? "" : " · Retired"}</span></div>
    <dl class="cl-memory-facts">
      <div><dt>Strength of evidence</dt><dd>${item.lastAt > now ? "Saved evidence is dated in the future" : STRENGTH[item.progress]}</dd></div>
      <div><dt>Last evidence</dt><dd>${memoryTime(item.lastAt, now)}<small>${escapeHtml(CONTEXT[item.context])} · ${credit}% credit${item.lastAt > now ? " · saved time is in the future" : ""}</small></dd></div>
      <div><dt>Open gaps</dt><dd>${escapeHtml(memoryGap(item))}${item.progress === "transfer-needed" ? "<small>Try a new application without help.</small>" : !item.delayedSuccesses ? "<small>Delayed independent evidence is still needed.</small>" : ""}</dd></div>
      <div><dt>Next due</dt><dd>${due}${item.dueAt <= now || item.needsReteach || item.retiredAt !== undefined ? ` · ${memoryTime(item.dueAt, now)}` : ""}</dd></div>
    </dl>
    <details class="cl-memory-why"><summary>Why is this due?</summary>
      <p>${escapeHtml(item.scheduleReason)}</p>
      ${item.retiredAt !== undefined || item.needsReteach ? "<p>This saved due date is excluded while the item is retired or paused.</p>" : ""}
      <p>${escapeHtml(evidence)}. ${item.attempts} saved ${item.attempts === 1 ? "exposure" : "exposures"}; probes from the same attempt count together.</p>
      <p>Qualifying delayed successes follow an earlier independent success. Retained evidence needs ${RETENTION_SUCCESSES} qualifying delayed successes, with at least ${RETENTION_SPAN_DAYS} days from the first independent success to the latest delayed one. Application objectives also need delayed transfer.</p>
      <p>Scheduling estimates: stability ${item.stability.toFixed(2)} days; difficulty ${item.difficulty.toFixed(2)} / 10. These estimates are not measured retention or a recall probability. Confidence and self-ratings do not change the schedule.</p>
      <p>Latest answer: ${memoryTime(item.lastAt, now)}. Feedback/check boundary: ${memoryTime(item.lastFeedbackAt, now)}. Grade revisions keep the original attempt and first feedback time.</p>
      <p class="cl-memory-feedback">${escapeHtml(item.lastFeedback)}</p>
      <p><a href="${escapeHtml(original)}">Open original lesson</a> · ${escapeHtml(item.quizId)} / ${escapeHtml(item.questionId)}${item.learningRecord ? ` · <a href="/doc/${encodeURIComponent(classroom)}/learning-records/${encodeURIComponent(item.learningRecord)}">Read linked learning record</a>` : ""}</p>
    </details>
    </details>
  </li>`;
}

export function memoryMapSection(classroom: string, items: ReviewItem[], now: number): string {
  const days = memoryForecast(items, now);
  const maximum = Math.max(1, ...days.map((day) => day.count));
  const dueNow = items.filter(
    (i) => i.retiredAt === undefined && !i.needsReteach && i.dueAt <= now,
  ).length;
  return `<section class="cl-section cl-memory-map" aria-label="Review next 14 days">
    <section class="cl-memory-forecast" aria-labelledby="memory-forecast-title">
      <div class="cl-memory-forecast-heading"><h2 class="cl-section-title" id="memory-forecast-title">Review next 14 days</h2><span>${dueNow} due now</span></div>
      <p id="memory-forecast-note">Saved due dates · UTC. Today includes overdue work.</p>
      <ol class="cl-memory-bars" aria-hidden="true">${days.map((day, index) => `<li><span>${day.count}</span><div><i style="height:${Math.round((day.count / maximum) * 100)}%"></i></div><span>${index === 0 ? "Today" : new Date(day.at).toISOString().slice(8, 10)}</span></li>`).join("")}</ol>
      <details><summary>Read forecast as a table</summary><table class="cl-memory-table"><caption>Saved due items by UTC date, including today's backlog</caption><thead><tr><th scope="col">Date (UTC)</th><th scope="col">Due items</th></tr></thead><tbody>${days.map((day) => `<tr><th scope="row">${date(day.at)}</th><td>${day.count}</td></tr>`).join("")}</tbody></table></details>
    </section>
  </section>`;
}

export function memoryMapItems(classroom: string, items: ReviewItem[], now: number): string {
  return items.length
    ? `<ol class="cl-memory-items" aria-label="Objective and question evidence">${items.map((item) => memoryItem(classroom, item, now)).join("")}</ol>`
    : '<p class="cl-memory-empty">No saved answer evidence yet. Complete a lesson check to begin your memory map. Reading, notes and pretests do not add review evidence.</p>';
}
