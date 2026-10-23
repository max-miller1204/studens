/** Classroom shortcuts reuse the existing durable request controls. */
export function initClassroomProgress() {
  const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const time of document.querySelectorAll("[data-cl-relative-time]")) {
    const at = new Date(time.dateTime);
    const delta = at.getTime() - Number(time.dataset.clock);
    const days = Math.round(delta / 86400000);
    const label =
      Math.abs(delta) < 86400000
        ? relative.format(Math.round(delta / 3600000), "hour")
        : relative.format(days, "day");
    const local = at.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    time.textContent = time.dataset.compact === "true" ? label : `${label} · ${local}`;
    time.setAttribute("aria-label", `${label} · ${local} · Exact UTC: ${time.dateTime}`);
  }
  const up = document.querySelector("[data-cl-up-next]");
  if (!up) return;
  const button = up.querySelector("[data-cl-up-start]");
  const status = up.querySelector("[data-cl-up-status]");
  const target = document.querySelector(
    up.dataset.action === "review" ? "[data-cl-review-start]" : "[data-cl-next-start]",
  );
  const sourceStatus = document.querySelector(
    up.dataset.action === "review" ? "[data-cl-review-status]" : "[data-cl-next-status]",
  );
  if (!target || !sourceStatus) return;
  const position = document.createComment("classroom request status");
  sourceStatus.before(position);
  const sync = () => {
    if (up.dataset.action === "resume") {
      position.before(sourceStatus);
      return;
    }
    status.replaceChildren(sourceStatus);
    button.disabled = target.disabled;
    button.textContent =
      target.textContent === "Start review"
        ? "Review due items"
        : target.textContent === "Next lesson"
          ? "Start next lesson"
          : `Up next: ${target.textContent}`;
  };
  new MutationObserver(sync).observe(target, { childList: true, attributes: true, subtree: true });
  new MutationObserver(sync).observe(up, { attributes: true, attributeFilter: ["data-action"] });
  button.addEventListener("click", () => target.click());
  sync();
}
