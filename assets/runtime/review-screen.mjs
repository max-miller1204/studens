/** One durable quiz per card; grades and teacher replies keep their existing contracts. */
export function createReviewScreen({ config, contentRoot, placeTeacherPanel }) {
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
    const index = forms.indexOf(active);
    const complete = forms.every((form) => form.dataset.state === "graded");
    progress.textContent = complete
      ? `Review complete · ${forms.length} of ${forms.length} answered`
      : `Question ${index + 1} of ${forms.length} · ${forms.filter((form) => form.dataset.state === "graded").length} answered`;
    previous.hidden = index === 0;
    next.hidden = index === forms.length - 1;
    next.disabled = active.dataset.state !== "graded";
    placeTeacherPanel();
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
