/** Annotation threads, follow-ups, minimised cards, and deletion. */
import { askConfirm, drawQuoteMath, placeCardInFlow, showDraftError } from "./lesson-dom.mjs";
import { draftStatus } from "./drafts.mjs";

export function createCards({ config, contentRoot, drafts }) {
  const { scheduleDraft, flushDraft } = drafts;
  /** annotationId → { annotation, mark, badge, panel } */
  const cards = new Map();
  const MINIMISED_KEY = `pi-classroom-minimised:${location.pathname}`;
  function loadMinimised() {
    try {
      return new Set(JSON.parse(localStorage.getItem(MINIMISED_KEY) || "[]"));
    } catch (err) {
      return new Set();
    }
  }
  function saveMinimised(set) {
    try {
      localStorage.setItem(MINIMISED_KEY, JSON.stringify([...set]));
    } catch (err) {
      /* ignore */
    }
  }
  const minimised = loadMinimised();
  function renderCard(annotation, mark) {
    const existing = cards.get(annotation.id);
    const marks = document.querySelectorAll(`mark[data-annotation-id="${annotation.id}"]`);
    const anchorMark = mark ?? marks[0] ?? null;
    const panel = existing?.panel ?? createPanel(annotation.id, anchorMark);
    const badge = existing?.badge ?? createBadge(annotation.id, anchorMark);

    const turns = threadTurns(annotation);
    const pending = turns.some((turn) => turn.status === "pending");
    for (const m of marks) m.classList.toggle("cl-hl-pending", pending);

    const quote = panel.querySelector("[data-cl-quote]");
    quote.textContent = annotation.selection;
    drawQuoteMath(quote);
    renderThread(panel.querySelector("[data-cl-thread]"), turns);

    // Following up needs something to follow up on, and the server refuses a follow-up on
    // a card whose first question is still spinning.
    const form = panel.querySelector("[data-cl-followup-form]");
    form.hidden = annotation.status === "pending";

    cards.set(annotation.id, { annotation, panel, badge, mark: anchorMark });

    // A freshly asked question opens; a restored one respects the saved state.
    if (minimised.has(annotation.id)) minimiseCard(annotation.id);
    else openCard(annotation.id);
  }

  function createPanel(annotationId, mark) {
    const panel = document.createElement("div");
    panel.className = "cl-card-panel cl-card-inline";
    panel.dataset.annotationId = annotationId;
    panel.hidden = true;
    panel.innerHTML = `
    <div class="cl-card-head">
      <p class="cl-card-quote" data-cl-quote></p>
      <div class="cl-card-actions">
        <button type="button" class="cl-icon-button" data-cl-minimise aria-label="Minimise">–</button>
        <button type="button" class="cl-text-button cl-text-button-danger" data-cl-delete>Delete</button>
      </div>
    </div>
    <div class="cl-card-content">
      <div class="cl-card-thread" data-cl-thread></div>
    </div>
    <!-- Outside cl-card-content on purpose: the thread scrolls, the composer stays put. -->
    <form class="cl-card-form cl-card-followup" data-cl-followup-form hidden>
      <textarea rows="2" placeholder="Ask a follow-up…" data-cl-followup required></textarea>
      <div class="cl-card-form-actions">
        <span class="cl-hint">⌘/Ctrl + Enter to send</span>
        <button type="submit" class="cl-button">Ask</button>
      </div>
      <p class="cl-draft-error" role="alert" data-cl-draft-error hidden></p>
    </form>`;

    if (mark) placeCardInFlow(panel, mark, contentRoot);
    else contentRoot.appendChild(panel); // orphaned annotation — park it at the end

    panel
      .querySelector("[data-cl-minimise]")
      .addEventListener("click", () => minimiseCard(annotationId));
    panel
      .querySelector("[data-cl-delete]")
      .addEventListener("click", () => confirmDeleteCard(annotationId));

    const form = panel.querySelector("[data-cl-followup-form]");
    form.addEventListener("submit", (event) => onFollowUpSubmit(event, annotationId));
    const field = form.querySelector("[data-cl-followup]");
    field.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        form.requestSubmit();
      }
    });
    field.addEventListener("input", () =>
      scheduleDraft(
        `followup:${annotationId}`,
        () => (field.value.trim() ? field.value : null),
        draftStatus((text) => showDraftError(form, text), ""),
      ),
    );
    return panel;
  }

  /** A card is a thread: the original question, then each follow-up, oldest first. */
  function threadTurns(annotation) {
    return [
      {
        question: annotation.question,
        status: annotation.status,
        answerHtml: annotation.answerHtml,
      },
      ...(annotation.followUps ?? []).map((followUp) => ({
        question: followUp.question,
        status: followUp.status,
        answerHtml: followUp.answerHtml,
        followUp: true,
      })),
    ];
  }

  function renderThread(container, turns) {
    container.textContent = "";
    for (const turn of turns) container.appendChild(renderTurn(turn));
  }

  function renderTurn(turn) {
    const wrapper = document.createElement("div");
    wrapper.className = turn.followUp ? "cl-card-turn cl-card-turn-followup" : "cl-card-turn";

    const question = document.createElement("p");
    question.className = "cl-card-question";
    question.textContent = turn.question; // textContent: this is the learner's own text

    const answer = document.createElement("div");
    answer.className = "cl-card-answer";
    // innerHTML is safe here: the markdown was rendered to HTML server-side.
    if (turn.status === "answered" && turn.answerHtml) {
      answer.innerHTML = turn.answerHtml;
    } else if (turn.status === "failed") {
      answer.innerHTML = '<p class="cl-card-status">Your teacher could not answer this one.</p>';
    } else {
      answer.innerHTML =
        '<p class="cl-card-status"><span class="cl-spinner"></span> Asking your teacher…</p>';
    }

    wrapper.append(question, answer);
    return wrapper;
  }

  /** Ask a follow-up in an existing card, continuing the same thread. */
  async function onFollowUpSubmit(event, annotationId) {
    event.preventDefault();
    const form = event.currentTarget;
    const field = form.querySelector("[data-cl-followup]");
    const submit = form.querySelector('button[type="submit"]');
    const question = field.value.trim();
    if (!question) return;

    submit.disabled = true;
    await flushDraft(`followup:${annotationId}`);
    try {
      const response = await fetch(
        `/api/annotations/${encodeURIComponent(annotationId)}/follow-up`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            classroom: config.classroom,
            lesson: config.lesson,
            question,
          }),
        },
      );
      if (!response.ok) throw new Error(await response.text());
      const annotation = await response.json();
      field.value = "";
      renderCard(annotation, cards.get(annotationId)?.mark ?? null);
    } catch (err) {
      console.error("[classroom] follow-up failed", err);
      alert(
        "Could not reach your teacher. Is the session that started the classroom still running?",
      );
    } finally {
      submit.disabled = false;
    }
  }

  /** The small marker left in the text when a card is minimised. */
  function createBadge(annotationId, mark) {
    const badge = document.createElement("button");
    badge.type = "button";
    badge.className = "cl-badge-marker";
    badge.dataset.annotationId = annotationId;
    badge.hidden = true;
    badge.textContent = "?";
    badge.setAttribute("aria-label", "Reopen your question");
    badge.addEventListener("click", (event) => {
      event.stopPropagation();
      openCard(annotationId);
    });

    const anchorMark = mark ?? document.querySelector(`mark[data-annotation-id="${annotationId}"]`);
    if (anchorMark?.parentNode) anchorMark.parentNode.insertBefore(badge, anchorMark.nextSibling);
    else document.body.appendChild(badge);
    return badge;
  }

  function openCard(annotationId) {
    const card = cards.get(annotationId);
    if (!card) return;
    card.panel.hidden = false;
    card.badge.hidden = true;
    minimised.delete(annotationId);
    saveMinimised(minimised);
    for (const m of document.querySelectorAll(`mark[data-annotation-id="${annotationId}"]`)) {
      m.classList.add("cl-hl-active");
    }
  }

  function minimiseCard(annotationId) {
    const card = cards.get(annotationId);
    if (!card) return;
    card.panel.hidden = true;
    card.badge.hidden = false;
    minimised.add(annotationId);
    saveMinimised(minimised);
    for (const m of document.querySelectorAll(`mark[data-annotation-id="${annotationId}"]`)) {
      m.classList.remove("cl-hl-active");
    }
  }

  function toggleCard(annotationId) {
    const card = cards.get(annotationId);
    if (!card) return;
    if (card.panel.hidden) openCard(annotationId);
    else minimiseCard(annotationId);
  }

  /**
   * Deleting a question is permanent, so it always goes through a modal confirmation —
   * a stray click on the card head must never destroy an answer.
   */
  async function confirmDeleteCard(annotationId) {
    const card = cards.get(annotationId);
    if (!card) return;
    const confirmed = await askConfirm({
      title: "Delete this question?",
      body: "The question and your teacher's answer will be removed from this lesson for good.",
      confirmLabel: "Delete question",
    });
    if (confirmed) await deleteCard(annotationId);
  }

  async function deleteCard(annotationId) {
    const card = cards.get(annotationId);
    if (!card) return;
    const button = card.panel.querySelector("[data-cl-delete]");
    button.disabled = true;
    card.panel.querySelector(".cl-card-delete-error")?.remove();
    try {
      const response = await fetch(
        `/api/annotations/${encodeURIComponent(annotationId)}?classroom=${encodeURIComponent(config.classroom)}&lesson=${encodeURIComponent(config.lesson)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const body = await response.text();
        let detail = body;
        try {
          detail = JSON.parse(body).error ?? body;
        } catch {}
        throw new Error(`Could not delete this question (${response.status}): ${detail}`);
      }
    } catch (err) {
      const error = document.createElement("p");
      error.className = "cl-card-delete-error";
      error.setAttribute("role", "alert");
      error.textContent = `${err.message} Select Delete to retry.`;
      card.panel.appendChild(error);
      return;
    } finally {
      button.disabled = false;
    }

    card.panel.remove();
    card.badge.remove();
    cards.delete(annotationId);
    minimised.delete(annotationId);
    saveMinimised(minimised);

    // Unwrap the highlight, leaving the lesson text as it was.
    for (const mark of document.querySelectorAll(`mark[data-annotation-id="${annotationId}"]`)) {
      const parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      mark.remove();
      parent.normalize();
    }
  }
  function restoreDraft(id, value) {
    const card = cards.get(id);
    if (!card)
      console.error(
        `[classroom] A draft belongs to question card "${id}", which is not on this page.`,
      );
    else card.panel.querySelector("[data-cl-followup]").value = value;
  }
  return { get: (id) => cards.get(id), renderCard, minimiseCard, toggleCard, restoreDraft };
}
