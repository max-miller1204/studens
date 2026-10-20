/** Native anchors resolve canonical source passages; never guess after an edit. */
function resolve() {
  const card = location.hash.startsWith("#cl-question-");
  if (!card && !location.hash.startsWith("#cl-search-")) return;
  if (card && document.body.dataset.clStateLoaded !== "true") return;
  document.querySelector("[data-cl-search-notice]")?.remove();
  const target = document.getElementById(location.hash.slice(1));
  if (target) {
    target.scrollIntoView({ block: "center" });
    const passage = target.classList.contains("cl-search-anchor") ? target.parentElement : target;
    passage.tabIndex = -1;
    passage.focus({ preventScroll: true });
    return;
  }
  const notice = document.createElement("p");
  notice.dataset.clSearchNotice = "";
  notice.className = "cl-search-notice";
  notice.setAttribute("role", "status");
  notice.textContent = card
    ? "This question card is no longer available. Return to Search for current questions. "
    : "This exact passage is no longer available. The source may have been edited or gated. Read the remaining page or return to Search for current results.";
  const link = document.createElement("a");
  link.href = "/search";
  link.textContent = "Search across classrooms";
  notice.append(" ", link);
  (document.querySelector("main") ?? document.body).prepend(notice);
}
if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", resolve, { once: true });
else resolve();
window.addEventListener("hashchange", resolve);

window.addEventListener("cl:state-loaded", resolve);
