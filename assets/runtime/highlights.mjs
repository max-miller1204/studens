/** Selection, question composer, and DOM highlights; anchor.mjs stays DOM-free. */
import { createSelector, findSelector, normalizeText } from "./anchor.mjs";
import { swapMathForSource } from "./math.mjs";
import {
  askConfirm,
  buildTextIndex,
  rangeFromOffsets,
  offsetsFromRange,
  outsideIndex,
  quizRefFor,
  position,
  drawQuoteMath,
  showDraftError,
  RUNTIME_UI,
} from "./lesson-dom.mjs";
import { draftStatus } from "./drafts.mjs";

export function createHighlights({ config, contentRoot, drafts, cards, learnerMarks }) {
  const { scheduleDraft, saveDraftNow, flushDraft } = drafts;
  let askPill = null;
  let selectionActions = null;
  let composer = null;
  /** Range captured when the ask pill was shown, before focus moves to the composer. */
  let pendingRange = null;
  /** Text-quote selector of the open composer's highlight, saved with its draft. */
  let composerAnchor = null;
  /** The saved question draft, held until the glossary has wrapped its terms. */
  let askDraft = null;
  /** The marker at the highlight of a restored question draft, until it is opened. */
  let askMarker = null;
  function buildAskPill() {
    selectionActions = document.createElement("div");
    selectionActions.className = "cl-selection-actions";
    selectionActions.setAttribute("role", "group");
    selectionActions.setAttribute("aria-label", "Selected passage actions");
    selectionActions.hidden = true;
    askPill = document.createElement("button");
    askPill.type = "button";
    askPill.className = "cl-ask-pill";
    askPill.hidden = true;
    askPill.innerHTML = '<span aria-hidden="true">✳</span> Ask';
    askPill.addEventListener("click", () => openComposer());
    selectionActions.appendChild(askPill);
    for (const [kind, label] of [
      ["highlight", "Highlight"],
      ["note", "Note"],
      ["bookmark", "Bookmark"],
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.dataset.markAction = kind;
      button.addEventListener("click", () => {
        const anchor = pendingRange ? selectorFor(pendingRange) : null;
        hideAskPill();
        learnerMarks.start(kind, anchor);
      });
      selectionActions.appendChild(button);
    }
    selectionActions.title = "Selected passage actions (Alt+M to focus)";
    document.body.appendChild(selectionActions);
  }

  function hideAskPill() {
    if (askPill) askPill.hidden = true;
    if (selectionActions) selectionActions.hidden = true;
  }

  function onSelectionSettled() {
    // Deferred so the browser has finished updating the selection after mouseup.
    setTimeout(() => {
      if (composer && !composer.hidden) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return hideAskPill();

      const range = selection.getRangeAt(0);
      if (!contentRoot.contains(range.commonAncestorContainer)) return hideAskPill();
      if (
        range.commonAncestorContainer.parentElement?.closest(
          "form.cl-reflect, .cl-card-panel, .cl-term-pop, .cl-teacher",
        )
      ) {
        return hideAskPill();
      }
      // Text selected inside an answer box belongs to the learner, not the lesson.
      if (document.activeElement?.matches("input, textarea, select")) return hideAskPill();
      // Diagram and math text and runtime UI are not in the text index, so a highlight that
      // starts or ends there could not anchor.
      if (outsideIndex(range.startContainer) || outsideIndex(range.endContainer)) {
        return hideAskPill();
      }
      if (normalizeText(range.toString()).length < 2) return hideAskPill();

      pendingRange = range.cloneRange();
      const rect = range.getBoundingClientRect();
      askPill.hidden = false;
      selectionActions.hidden = false;
      position(
        selectionActions,
        rect.left + rect.width / 2 - selectionActions.offsetWidth / 2,
        rect.top - selectionActions.offsetHeight - 8,
      );
    }, 0);
  }

  function buildComposer() {
    composer = document.createElement("div");
    composer.className = "cl-card-panel cl-card-box";
    composer.hidden = true;
    composer.innerHTML = `
    <div class="cl-card-head">
      <p class="cl-card-quote" data-cl-quote></p>
      <div class="cl-card-actions">
        <button type="button" class="cl-icon-button" data-cl-cancel aria-label="Cancel">✕</button>
      </div>
    </div>
    <div class="cl-card-content">
      <form class="cl-card-form" data-cl-ask-form>
        <textarea class="cl-input" placeholder="What would you like to know about this?" data-cl-question required></textarea>
        <div class="cl-card-form-actions">
          <span class="cl-hint">⌘/Ctrl + Enter to send</span>
          <button type="submit" class="cl-button">Ask your teacher</button>
        </div>
        <p class="cl-draft-error" role="alert" data-cl-draft-error hidden></p>
      </form>
    </div>`;
    document.body.appendChild(composer);

    composer.querySelector("[data-cl-cancel]").addEventListener("click", cancelComposer);
    composer.querySelector("[data-cl-ask-form]").addEventListener("submit", onAskSubmit);
    composer.querySelector("[data-cl-question]").addEventListener("input", saveAskDraft);
    composer.querySelector("[data-cl-question]").addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        composer.querySelector("[data-cl-ask-form]").requestSubmit();
      }
    });
  }

  async function openComposer() {
    if (!pendingRange) return;
    hideAskPill();
    // There is one question draft. A new question must not replace it without asking.
    if (askMarker) {
      const range = pendingRange;
      const discard = await askConfirm({
        title: "Replace your unsent question?",
        body: "You have a question that you did not send. A new question removes it.",
        confirmLabel: "Remove it",
        cancelLabel: "Keep it",
      });
      if (!discard) return;
      removeAskMarker();
      saveDraftNow(
        "ask",
        () => null,
        (err) => {
          if (err) alert(`Could not remove your question draft: ${err.message}`);
        },
      );
      pendingRange = range;
    }
    showComposer("");
    composer.querySelector("[data-cl-question]").focus();
  }

  /** Show the composer at `pendingRange`, holding `text`. */
  function showComposer(text) {
    const rect = pendingRange.getBoundingClientRect();
    const composerQuote = composer.querySelector("[data-cl-quote]");
    composerQuote.textContent = quoteOf(pendingRange, null);
    drawQuoteMath(composerQuote);
    composer.querySelector("[data-cl-question]").value = text;
    composerAnchor = selectorFor(pendingRange);
    composer.hidden = false;
    position(composer, rect.left, rect.bottom + 10);
  }

  function closeComposer() {
    if (composer) composer.hidden = true;
    pendingRange = null;
    composerAnchor = null;
  }

  /** Close the composer and throw its question away. */
  function cancelComposer() {
    if (!composer || composer.hidden) return;
    closeComposer();
    saveDraftNow(
      "ask",
      () => null,
      (err) => {
        if (err) alert(`Could not remove your question draft: ${err.message}`);
      },
    );
  }

  function saveAskDraft() {
    const field = composer.querySelector("[data-cl-question]");
    scheduleDraft(
      "ask",
      () =>
        field.value.trim() && composerAnchor ? { anchor: composerAnchor, text: field.value } : null,
      draftStatus((text) => showDraftError(composer, text), ""),
    );
  }

  /**
   * Put a marker at the highlight of the saved question draft.
   *
   * The draft comes back closed, like a minimised card. An open composer floats, so it
   * would cover the lesson the learner came back to read. A click on the marker opens it.
   */
  function restoreAskDraft() {
    if (!askDraft) return;
    const draft = askDraft;
    askDraft = null;
    const range = rangeForAnchor(draft.anchor);
    if (!range) {
      console.error(
        "[classroom] The saved question draft no longer matches the lesson text.",
        draft,
      );
      return;
    }
    askMarker = document.createElement("button");
    askMarker.type = "button";
    askMarker.className = "cl-badge-marker cl-badge-draft";
    askMarker.textContent = "\u270E\uFE0E"; // the pencil as text, not as an emoji
    askMarker.title = "Open your unsent question";
    askMarker.setAttribute("aria-label", "Open your unsent question");
    askMarker.addEventListener("click", (event) => {
      event.stopPropagation();
      openAskDraft(draft);
    });
    const end = range.cloneRange();
    end.collapse(false);
    end.insertNode(askMarker);
  }

  /** Open the composer with the saved question draft, at its highlight. */
  function openAskDraft(draft) {
    removeAskMarker();
    const range = rangeForAnchor(draft.anchor);
    if (!range) {
      console.error(
        "[classroom] The saved question draft no longer matches the lesson text.",
        draft,
      );
      return;
    }
    pendingRange = range;
    hideAskPill();
    showComposer(draft.text);
    composer.querySelector("[data-cl-question]").focus();
  }

  function removeAskMarker() {
    const parent = askMarker.parentNode;
    askMarker.remove();
    askMarker = null;
    // insertNode split a text node to make room for the marker. Join it again.
    parent.normalize();
  }

  /** The DOM range a text-quote selector names, or null when the lesson text changed. */
  function rangeForAnchor(anchor) {
    const index = buildTextIndex(contentRoot);
    const match = findSelector(index.text, anchor);
    return match ? rangeFromOffsets(index, match.start, match.end) : null;
  }

  /** A text-quote selector for a range, or null when the range is outside the lesson. */
  function selectorFor(range) {
    const index = buildTextIndex(contentRoot);
    const offsets = offsetsFromRange(index, range);
    return offsets ? createSelector(index.text, offsets.start, offsets.end) : null;
  }

  /**
   * The quoted text of a highlight. The anchor skips formulas, so a highlight that
   * covers one quotes it as TeX, and the teacher sees the whole passage.
   */
  function quoteOf(range, selector) {
    const fragment = range.cloneContents();
    if (!fragment.querySelector(".cl-math")) {
      return selector ? selector.exact : normalizeText(range.toString());
    }
    swapMathForSource(fragment);
    for (const element of fragment.querySelectorAll(RUNTIME_UI)) element.remove();
    return normalizeText(fragment.textContent);
  }

  async function onAskSubmit(event) {
    event.preventDefault();
    const submit = composer.querySelector('button[type="submit"]');
    const question = composer.querySelector("[data-cl-question]").value.trim();
    if (!question || !pendingRange || submit.disabled) return;

    const selector = selectorFor(pendingRange);
    if (!selector) {
      closeComposer();
      return;
    }
    const range = pendingRange.cloneRange();
    const quiz = quizRefFor(range);
    submit.disabled = true;
    showDraftError(composer, "");
    try {
      await flushDraft("ask");
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classroom: config.classroom,
          lesson: config.lesson,
          question,
          selection: quoteOf(range, selector),
          anchor: selector,
          quiz,
        }),
      });
      const annotation = await response.json();
      if (!response.ok)
        throw new Error(
          typeof annotation.error === "string"
            ? annotation.error
            : `Question request failed (${response.status}).`,
        );
      closeComposer();
      const answered = cards.get(annotation.id);
      const mark = answered?.mark ?? wrapRange(range, annotation.id);
      // An answer event can arrive before the pending submission response.
      cards.renderCard(answered?.annotation ?? annotation, mark);
    } catch (err) {
      console.error("[classroom] ask failed", err);
      showDraftError(
        composer,
        `${err.message} Your question is kept. Select Ask your teacher to send it again.`,
      );
    } finally {
      submit.disabled = false;
    }
  }

  // ── Highlights ────────────────────────────────────────────────────────────────

  /**
   * Wrap a range in a <mark>, splitting across element boundaries when needed.
   *
   * `surroundContents` throws on a range that crosses tags (a selection spanning a
   * bold word, say), so partially-selected text nodes are wrapped one at a time.
   */
  function wrapRange(range, annotationId) {
    const marks = [];
    const nodes = textNodesInRange(range);

    for (const { node, start, end, formula } of nodes) {
      let target = formula;
      if (!target) {
        target = node;
        if (end < target.nodeValue.length) target.splitText(end);
        if (start > 0) target = target.splitText(start);
      }

      const mark = document.createElement("mark");
      mark.className = "cl-hl cl-hl-pending";
      mark.dataset.annotationId = annotationId;
      target.parentNode.insertBefore(mark, target);
      mark.appendChild(target);
      marks.push(mark);
    }

    for (const mark of marks) {
      mark.addEventListener("click", (event) => {
        event.stopPropagation();
        // A highlight in an option's label opens its card. It does not choose the option.
        if (mark.closest("label")) event.preventDefault();
        cards.toggleCard(annotationId);
      });
    }
    // `marks` is in reverse document order (see textNodesInRange); the caller wants the
    // first one, since that is where the minimised badge goes.
    return marks[marks.length - 1] ?? null;
  }

  /**
   * Text nodes intersecting a range, with the covered slice of each.
   *
   * A formula is one whole item: a mark inside MathML breaks the drawing. A highlight
   * never ends inside a formula, so a formula it touches is inside it. Diagram text is
   * skipped for the same reason.
   */
  function textNodesInRange(range) {
    const out = [];
    const walker = document.createTreeWalker(
      range.commonAncestorContainer.nodeType === Node.TEXT_NODE
        ? range.commonAncestorContainer.parentNode
        : range.commonAncestorContainer,
      NodeFilter.SHOW_TEXT,
      null,
    );

    let node = walker.nextNode();
    while (node) {
      if (range.intersectsNode(node) && node.nodeValue.length > 0) {
        const formula = node.parentElement?.closest(".cl-math");
        if (formula) {
          if (out[out.length - 1]?.formula !== formula) out.push({ formula });
        } else if (!node.parentElement?.closest(".cl-diagram")) {
          const start = node === range.startContainer ? range.startOffset : 0;
          const end = node === range.endContainer ? range.endOffset : node.nodeValue.length;
          if (end > start) out.push({ node, start, end });
        }
      }
      node = walker.nextNode();
    }
    // Reverse so splitText on a later node cannot invalidate an earlier offset.
    return out.reverse();
  }

  /** Re-apply a stored annotation to the current document. */
  function restoreAnnotation(annotation) {
    const index = buildTextIndex(contentRoot);
    const match = findSelector(index.text, annotation.anchor);
    if (!match) return null;
    const range = rangeFromOffsets(index, match.start, match.end);
    if (!range) return null;
    return wrapRange(range, annotation.id);
  }
  function ignoreSelectingClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest("input, select, textarea, button")) return;
    const control = target.closest(
      "form.cl-quiz label, form.cl-quiz .cl-segment, form.cl-practice label, form.cl-practice .cl-segment",
    );
    const selection = window.getSelection();
    if (!control || !selection || selection.isCollapsed || selection.rangeCount === 0) return;
    if (!selection.getRangeAt(0).intersectsNode(control)) return;
    event.preventDefault();
    event.stopPropagation();
  }
  function init() {
    buildAskPill();
    buildComposer();
    document.addEventListener("mouseup", onSelectionSettled);
    window.addEventListener("resize", hideAskPill);
    document.addEventListener("selectionchange", () => {
      if (window.getSelection()?.isCollapsed) hideAskPill();
    });
    document.addEventListener("keyup", (event) => {
      if (event.key === "Shift" || event.key.startsWith("Arrow")) onSelectionSettled();
    });
    document.addEventListener("mousedown", (event) => {
      if (selectionActions && !selectionActions.contains(event.target)) hideAskPill();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") cancelComposer();
      if (event.altKey && event.key.toLowerCase() === "m" && !selectionActions.hidden) {
        event.preventDefault();
        askPill.focus();
      }
    });
    // Highlighting an option's text ends in a click on its label. That click must not
    // also choose the option.
    document.addEventListener("click", ignoreSelectingClick, true);
  }
  return {
    init,
    restoreAnnotation,
    restoreAskDraft,
    restoreDraft: (value) => {
      askDraft = value;
    },
  };
}
