/** One durable quiz per card; grades and teacher replies keep their existing contracts. */
import { wireRetirement } from "./review-controls.mjs";

export function createReviewScreen({ config, contentRoot, placeTeacherPanel, flagQuestion }) {
  if (!config.reviewScreen) return null;
  document.body.classList.add("cl-review-page");
  const forms = [...contentRoot.querySelectorAll("form.cl-quiz")];
  let active = null;
  let failed = false;
  const progress = document.createElement("p");
  progress.className = "cl-review-progress";
  progress.setAttribute("role", "status");
  progress.textContent = "Loading review…";
  const navigation = document.createElement("nav");
  navigation.className = "cl-review-navigation";
  navigation.setAttribute("aria-label", "Review questions");
  const previous = document.createElement("button");
  previous.type = "button";
  previous.className = "cl-button";
  previous.textContent = "Previous question";
  previous.addEventListener("click", () => {
    const index = forms.indexOf(active);
    if (index > 0) show(forms[index - 1]);
  });
  const next = document.createElement("button");
  next.type = "button";
  next.className = "cl-button";
  next.textContent = "Next question";
  const history = document.createElement("a");
  history.href = `/c/${encodeURIComponent(config.classroom)}/reviews`;
  history.textContent = "Review history";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "cl-button";
  retry.textContent = "Retry review state";
  retry.hidden = true;
  retry.addEventListener("click", () => location.reload());
  previous.hidden = true;
  next.disabled = true;
  navigation.append(previous, next, retry, history);
  forms[0].before(progress);
  forms.at(-1).after(navigation);
  const actions = document.createElement("section");
  actions.className = "cl-review-actions";
  actions.setAttribute("aria-label", "Review item controls");
  const retire = document.createElement("button");
  retire.type = "button";
  retire.className = "cl-button";
  retire.textContent = "Loading item…";
  retire.disabled = true;
  const flag = document.createElement("button");
  flag.type = "button";
  flag.className = "cl-button";
  flag.textContent = "Flag bad question";
  flag.disabled = true;
  const itemStatus = document.createElement("p");
  itemStatus.setAttribute("role", "status");
  const retryItem = document.createElement("button");
  retryItem.type = "button";
  retryItem.className = "cl-button";
  retryItem.textContent = "Retry item state";
  retryItem.hidden = true;
  actions.append(retire, flag, retryItem, itemStatus);
  navigation.before(actions);
  let items = null;
  flag.addEventListener("click", () => {
    const question = active.querySelector("[data-review-of]");
    try {
      flagQuestion({
        key: question.dataset.reviewOf,
        prompt: question.querySelector(".cl-q-prompt").textContent,
        quizId: active.dataset.quizId,
        questionId: question.dataset.questionId,
      });
    } catch (error) {
      itemStatus.textContent = error.message;
    }
  });
  function refreshItem() {
    if (!active || !items) return;
    const key = active.querySelector("[data-review-of]").dataset.reviewOf;
    const item = items.find((item) => item.key === key);
    if (!item) {
      itemStatus.textContent = `No saved review item: ${key}`;
      retire.disabled = true;
      return;
    }
    retire.disabled = false;
    itemStatus.textContent =
      item.retiredAt === undefined
        ? "Active review item."
        : "Retired item. Its saved evidence and this published review remain available.";
    wireRetirement({
      button: retire,
      status: itemStatus,
      classroom: config.classroom,
      item,
      saved: (next) => {
        items = items.map((current) => (current.key === next.key ? next : current));
      },
    });
  }
  async function loadItems() {
    retryItem.hidden = true;
    try {
      const response = await fetch(
        `/api/review/items?classroom=${encodeURIComponent(config.classroom)}`,
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || `Review items returned ${response.status}.`);
      if (!Array.isArray(result.items)) throw new Error("Review items returned no item list.");
      items = result.items;
      refreshItem();
    } catch (error) {
      itemStatus.textContent = error.message;
      retire.disabled = true;
      retryItem.hidden = false;
    }
  }
  retryItem.addEventListener("click", loadItems);
  loadItems();
  next.addEventListener("click", () => {
    const index = forms.indexOf(active);
    if (active?.dataset.state !== "graded" || index === forms.length - 1) return;
    show(forms[index + 1]);
    active.scrollIntoView({ block: "start" });
    active.querySelector(".cl-quiz-title").focus({ preventScroll: true });
  });

  function show(form) {
    active = form;
    for (const item of forms) {
      item.hidden = item !== active;
      item.dataset.reviewActive = String(item === active);
    }
    window.history.replaceState(null, "", `#${active.dataset.quizId}`);
    refresh();
  }
  function restore() {
    // The URL keeps the feedback card on reload. A different browser resumes the
    // first unanswered card from server state, without resubmitting earlier answers.
    const requested = forms.find((form) => `#${form.dataset.quizId}` === location.hash);
    const firstUnfinished = forms.find((form) => form.dataset.state !== "graded");
    const allowed =
      requested &&
      forms.slice(0, forms.indexOf(requested)).every((form) => form.dataset.state === "graded");
    show(allowed ? requested : (firstUnfinished ?? forms.at(-1)));
  }
  function refresh() {
    if (!active) return;
    flag.disabled = false;
    const index = forms.indexOf(active);
    const complete = forms.every((form) => form.dataset.state === "graded");
    progress.textContent = complete
      ? `Review complete · ${forms.length} of ${forms.length} answered`
      : `Question ${index + 1} of ${forms.length} · ${forms.filter((form) => form.dataset.state === "graded").length} answered`;
    previous.hidden = index === 0;
    next.hidden = index === forms.length - 1;
    next.disabled = active.dataset.state !== "graded";
    placeTeacherPanel();
    refreshItem();
  }
  for (const form of forms) {
    form.querySelector(".cl-quiz-title")?.setAttribute("tabindex", "-1");
    form.querySelector(".cl-quiz-kind")?.remove();
  }
  function loadFailed(error) {
    failed = true;
    progress.textContent = `Could not load review: ${error.message}`;
    progress.setAttribute("role", "alert");
    retry.hidden = false;
    next.disabled = true;
    flag.disabled = true;
    retire.disabled = true;
  }
  return {
    restore,
    refresh,
    loadFailed,
    get failed() {
      return failed;
    },
  };
}
