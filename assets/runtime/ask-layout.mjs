/** Keep passage panels in reading order in the DOM, beside prose when space permits. */
const entries = new Map();
const wide = matchMedia("(min-width: 1100px)");
let frame;
const observer = new ResizeObserver(schedule);
function schedule() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(layout);
}
function layout() {
  let bottom = 0;
  const visible = [...entries].filter(([panel]) => panel.isConnected && !panel.hidden);
  visible.sort((a, b) => a[1].getBoundingClientRect().top - b[1].getBoundingClientRect().top);
  for (const [panel] of entries) {
    const root = panel.closest(".cl-lesson-shell") ?? panel.closest("main") ?? document.body;
    const fits = wide.matches && root.getBoundingClientRect().right + 336 <= innerWidth;
    panel.classList.toggle("cl-card-docked", fits && panel.isConnected);
    if (!fits) {
      panel.style.removeProperty("top");
      panel.style.removeProperty("left");
    }
  }
  if (!wide.matches) return;
  for (const [panel, anchor] of visible) {
    if (!panel.classList.contains("cl-card-docked")) continue;
    const root = panel.closest(".cl-lesson-shell") ?? panel.closest("main") ?? document.body;
    const rootBox = root.getBoundingClientRect();
    const parent = panel.offsetParent;
    const parentBox = parent?.getBoundingClientRect() ?? { top: -scrollY, left: -scrollX };
    const top = Math.max(anchor.getBoundingClientRect().top, bottom);
    panel.style.top = `${top - parentBox.top + (parent?.scrollTop ?? 0)}px`;
    panel.style.left = `${rootBox.right + 16 - parentBox.left + (parent?.scrollLeft ?? 0)}px`;
    bottom = top + panel.offsetHeight + 16;
  }
}
export function anchorPanel(panel, anchor) {
  entries.set(panel, anchor);
  observer.observe(panel);
  observer.observe(document.body);
  schedule();
}
export function releasePanel(panel) {
  entries.delete(panel);
  observer.unobserve(panel);
  schedule();
}
export function refreshPanels() {
  schedule();
}
wide.addEventListener("change", schedule);
window.addEventListener("resize", schedule);
