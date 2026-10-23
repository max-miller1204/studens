/** Shared review chrome. These views never write quiz or daily selection state. */
export function reviewProgress(label) {
  const root = document.createElement("div");
  root.className = "cl-review-progress";
  const text = document.createElement("p");
  text.setAttribute("role", "status");
  text.setAttribute("aria-live", "polite");
  const meter = document.createElement("div");
  meter.className = "cl-meter";
  meter.setAttribute("role", "progressbar");
  meter.setAttribute("aria-label", label);
  meter.setAttribute("aria-valuemin", "0");
  const fill = document.createElement("span");
  meter.append(fill);
  root.append(text, meter);
  return {
    root,
    text,
    update(value, total, message) {
      text.textContent = message;
      meter.setAttribute("aria-valuemax", String(total || 1));
      meter.setAttribute("aria-valuenow", String(value));
      meter.setAttribute("aria-valuetext", `${value} of ${total}`);
      fill.style.width = `${total ? (value / total) * 100 : 0}%`;
    },
  };
}

export function reviewState() {
  const root = document.createElement("div");
  root.hidden = true;
  const title = document.createElement("p");
  const body = document.createElement("p");
  root.append(title, body);
  return {
    root,
    show(kind, heading, message) {
      root.hidden = false;
      root.dataset.reviewState = kind;
      const error = kind === "error" || kind === "stale" || kind === "partial-failure";
      root.className = error ? "cl-inline-error" : "cl-empty";
      root.setAttribute("role", error ? "alert" : "status");
      title.className = error ? "" : "cl-empty-title";
      body.className = error ? "" : "cl-empty-body";
      title.textContent = heading;
      body.textContent = message;
    },
    clear() {
      root.hidden = true;
    },
  };
}
