/** One classroom view, derived from canonical requests. Never starts work on load. */
import { TEACHER_WORKING as working } from "./teacher-status.mjs";

export function initTeacherActivity(classroom) {
  if (
    (!classroom && !/^\/(?:reviews\/daily(?:\/|$)|$)/.test(location.pathname)) ||
    document.querySelector(".cl-teacher-activity")
  )
    return;
  const query = classroom ? `classroom=${encodeURIComponent(classroom)}` : "scope=root";
  const region = document.createElement("section");
  region.className = "cl-teacher-activity";
  region.setAttribute("aria-label", "Teacher activity");
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  const status = document.createElement("span");
  status.setAttribute("role", "status");
  const contents = document.createElement("div");
  const panel = document.createElement("div");
  panel.className = "cl-activity-panel";
  const heading = document.createElement("div");
  heading.className = "cl-activity-heading";
  const title = document.createElement("strong");
  title.textContent = "Teacher activity";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "cl-button cl-button-quiet";
  close.textContent = "Close";
  close.setAttribute("aria-label", "Close teacher activity");
  const dismiss = () => {
    details.open = false;
    summary.focus();
  };
  close.onclick = dismiss;
  heading.append(title, close);
  const identityLine = document.createElement("p");
  identityLine.className = "cl-activity-identity";
  const error = document.createElement("div");
  error.className = "cl-inline-error";
  error.setAttribute("role", "alert");
  error.hidden = true;
  summary.append(status);
  panel.append(heading, identityLine, contents, error);
  details.append(summary, panel);
  region.append(details);
  region.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && details.open) {
      event.preventDefault();
      dismiss();
    }
  });
  document.addEventListener("click", (event) => {
    if (!region.contains(event.target)) details.open = false;
  });
  const header = document.querySelector(".cl-header");
  if (header) header.insertBefore(region, header.querySelector(".cl-header-search"));
  else document.body.prepend(region);
  let stopped = false;
  let pending = false;
  let again = false;
  let last = null;
  let stream;
  let connectionLost = false;
  let busy = false;
  let generation = 0;

  function failed(message) {
    connectionLost = true;
    generation++;
    stream?.close();
    region.dataset.state = "unavailable";
    status.textContent = "Teacher · Unavailable";
    summary.setAttribute("aria-label", "Teacher activity: Unavailable");
    details.open = true;
    contents.replaceChildren();
    error.hidden = false;
    const messageText = document.createElement("p");
    messageText.textContent = message;
    error.replaceChildren(messageText);
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Retry activity status";
    retry.className = "cl-button cl-button-quiet";
    retry.onclick = () => {
      connect();
      refresh();
    };
    error.append(retry);
    last = null;
  }
  async function request(url, body) {
    const response = await fetch(
      url,
      body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : undefined,
    );
    const value = await response.json();
    if (!response.ok)
      throw new Error(
        typeof value.error === "string"
          ? value.error
          : `Teacher activity request failed (${response.status}).`,
      );
    return value;
  }
  function show(data) {
    if (
      !Array.isArray(data.requests) ||
      data.requests.some(
        (r) =>
          !working[r.kind] ||
          !["queued", "running", "planned", "failed"].includes(r.status) ||
          typeof r.url !== "string" ||
          !/^\/(?:c\/|reviews\/daily\/)/.test(r.url) ||
          typeof r.classroom !== "string" ||
          typeof r.retryId !== "string",
      )
    )
      throw new Error("Invalid teacher activity response.");
    const serialized = JSON.stringify(data);
    if (last === serialized) return;
    last = serialized;
    error.hidden = true;
    contents.replaceChildren();
    const rows = data.requests;
    const failures = rows.filter((r) => r.status === "failed").length;
    const queued = rows.filter((r) => r.status === "queued").length;
    const work = (r) =>
      r.kind === "lesson"
        ? {
            writing: "Writing your next lesson",
            checking: "Checking your next lesson",
            publishing: "Publishing your next lesson",
          }[r.phase] || working.lesson
        : working[r.kind];
    const label = (r) =>
      `${r.status === "queued" ? "Queued: " : r.status === "failed" ? "Failed: " : ""}${work(r)}`;
    const teacher = data.teacher;
    const identity = teacher
      ? `${teacher.backend} teacher${teacher.model ? ` (${teacher.model})` : ""}`
      : "Teacher";
    identityLine.textContent = teacher?.switching
      ? `Switching teacher to ${teacher.switching}. Waiting for active work and readiness.`
      : identity;
    const state = rows[0]?.status ?? "idle";
    status.textContent = teacher?.switching
      ? "Teacher · Switching"
      : rows.length
        ? `${state === "failed" ? "Failed" : state === "queued" ? "Queued" : "Working"}${queued && state !== "queued" ? ` · ${queued} queued` : ""}${failures && state !== "failed" ? ` · ${failures} failed` : ""}`
        : "Teacher · Idle";
    summary.setAttribute("aria-label", `Teacher activity: ${status.textContent}`);
    region.dataset.state = state;
    if (!rows.length) {
      const empty = document.createElement("p");
      empty.textContent = "No pending requests";
      contents.append(empty);
      return;
    }
    if (failures) details.open = true;
    const list = document.createElement("ul");
    for (const row of rows) {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = row.url;
      link.textContent = `${label(row)} — ${row.item}`;
      item.append(link);
      if (row.status === "failed") {
        const reason = document.createElement("p");
        reason.textContent = row.error;
        const failureBox = document.createElement("div");
        failureBox.className = "cl-inline-error";
        failureBox.append(reason);
        item.append(failureBox);
        if (row.retry) {
          const retry = document.createElement("button");
          retry.type = "button";
          retry.className = "cl-button cl-button-quiet";
          retry.textContent = "Retry";
          retry.setAttribute("aria-label", `Retry activity: ${work(row)} — ${row.item}`);
          retry.onclick = async () => {
            if (busy) return;
            busy = true;
            retry.disabled = true;
            try {
              const value = await request(
                `/api/${row.retry === "daily" ? "daily-review" : row.retry}/retry`,
                { classroom: row.classroom, id: row.retryId },
              );
              if (value.review?.status === "failed") throw new Error(value.review.error);
              if (value.lesson?.status === "failed") throw new Error(value.lesson.error);
              const group = value.daily?.groups.find((g) => g.classroom === row.classroom);
              if (group?.error) throw new Error(group.error);
              window.dispatchEvent(
                new CustomEvent("cl-activity-retried", {
                  detail: { classroom: row.classroom, kind: row.kind, id: row.retryId },
                }),
              );
              await refresh();
            } catch (failure) {
              reason.textContent = failure.message;
              retry.disabled = false;
            } finally {
              busy = false;
            }
          };
          failureBox.append(retry);
        }
      }
      list.append(item);
    }
    contents.append(list);
  }
  async function refresh() {
    if (stopped || connectionLost) return;
    if (pending) {
      again = true;
      return;
    }
    pending = true;
    const current = generation;
    try {
      const data = await request(`/api/activity?${query}`);
      if (!stopped && !connectionLost && current === generation) show(data);
    } catch (failure) {
      if (current === generation) failed(failure.message);
    } finally {
      pending = false;
      if (again) {
        again = false;
        refresh();
      }
    }
  }
  function connect() {
    stream?.close();
    generation++;
    connectionLost = false;
    stream = new EventSource(`/api/events?${classroom ? `scope=classroom&${query}` : query}`);
    stream.addEventListener("open", refresh);
    stream.addEventListener("activity", refresh);
    stream.addEventListener("error", () => {
      // A disconnected view must not continue to claim that old work is running.
      stream.close();
      connectionLost = true;
      failed(
        "The classroom activity connection was lost. Check the classroom service, then retry status.",
      );
    });
  }
  window.addEventListener("pagehide", () => {
    stopped = true;
    stream?.close();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      stopped = false;
      connect();
      refresh();
    }
  });
  status.textContent = "Checking teacher activity…";
  connect();
  refresh();
}

export function pageClassroom() {
  const match = /^\/(?:c|doc|r)\/([^/]+)(?:\/|$)/.exec(location.pathname);
  return match ? decodeURIComponent(match[1]) : null;
}
