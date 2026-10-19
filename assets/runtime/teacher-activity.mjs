/** One classroom view, derived from canonical requests. Never starts work on load. */
const working = {
  ask: "Answering your question",
  "follow-up": "Answering your follow-up",
  quiz: "Grading your quiz",
  reflect: "Reading your explanation",
  chat: "Replying to you",
  review: "Preparing your review",
  resume: "Resuming your check",
  refill: "Preparing future review questions",
};

export function initTeacherActivity(classroom) {
  if (!classroom || document.querySelector(".cl-teacher-activity")) return;
  const region = document.createElement("section");
  region.className = "cl-teacher-activity";
  region.setAttribute("aria-label", "Teacher activity");
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const contents = document.createElement("div");
  const error = document.createElement("p");
  error.setAttribute("role", "alert");
  error.hidden = true;
  region.append(status, contents, error);
  const header = document.querySelector(".cl-header");
  if (header) header.append(region);
  else document.body.prepend(region);
  let stopped = false;
  let pending = false;
  let again = false;
  let last = null;
  let stream;
  let connectionLost = false;
  let busy = false;

  function failed(message) {
    region.dataset.state = "unavailable";
    status.textContent = "Teacher activity unavailable";
    contents.replaceChildren();
    error.hidden = false;
    error.textContent = message + " ";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Retry activity status";
    retry.className = "cl-button";
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
          !r.url.startsWith("/c/"),
      )
    )
      throw new Error("Invalid teacher activity response.");
    const serialized = JSON.stringify(data);
    if (last === serialized) return;
    const wasOpen = contents.querySelector("details")?.open;
    last = serialized;
    error.hidden = true;
    contents.replaceChildren();
    const rows = data.requests;
    const failures = rows.filter((r) => r.status === "failed").length;
    const queued = rows.filter((r) => r.status === "queued").length;
    const label = (r) =>
      `${r.status === "queued" ? "Queued: " : r.status === "failed" ? "Failed: " : ""}${working[r.kind]}`;
    status.textContent = rows.length
      ? label(rows[0]) +
        (queued && rows[0].status !== "queued" ? ` · ${queued} queued` : "") +
        (failures && rows[0].status !== "failed" ? ` · ${failures} failed` : "")
      : "Teacher: no pending requests";
    region.dataset.state = rows[0]?.status ?? "idle";
    if (!rows.length) return;
    const details = document.createElement("details");
    details.open = failures > 0 || wasOpen === true;
    const summary = document.createElement("summary");
    summary.textContent = `View teacher activity (${rows.length})`;
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
        item.append(reason);
        if (row.retry) {
          const retry = document.createElement("button");
          retry.type = "button";
          retry.className = "cl-button";
          retry.textContent = "Retry activity";
          retry.setAttribute("aria-label", `Retry activity: ${working[row.kind]} — ${row.item}`);
          retry.onclick = async () => {
            if (busy) return;
            busy = true;
            retry.disabled = true;
            try {
              const value = await request(
                row.retry === "review" ? "/api/review/retry" : "/api/teacher/retry",
                { classroom, id: row.retry === "review" ? row.id.slice("review:".length) : row.id },
              );
              if (value.review?.status === "failed") throw new Error(value.review.error);
              await refresh();
            } catch (failure) {
              error.textContent = failure.message;
              error.hidden = false;
              retry.disabled = false;
            } finally {
              busy = false;
            }
          };
          item.append(retry);
        }
      }
      list.append(item);
    }
    details.append(summary, list);
    contents.append(details);
  }
  async function refresh() {
    if (stopped || connectionLost) return;
    if (pending) {
      again = true;
      return;
    }
    pending = true;
    try {
      const data = await request(`/api/activity?classroom=${encodeURIComponent(classroom)}`);
      if (!stopped && !connectionLost) show(data);
    } catch (failure) {
      failed(failure.message);
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
    connectionLost = false;
    stream = new EventSource(
      `/api/events?scope=classroom&classroom=${encodeURIComponent(classroom)}`,
    );
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
