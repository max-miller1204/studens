/** DOM indexing, source text, and UI helpers shared by lesson features. */
import { normalizeText } from "./anchor.mjs";
import { initMath, swapMathForSource } from "./math.mjs";

/**
 * What the runtime adds to a quiz after hydration: the grade, the verdicts, the
 * footer, the reports, the order buttons. It changes as a quiz is graded, so a
 * highlight never anchors to it. The questions themselves can be highlighted.
 */
const QUIZ_RUNTIME_UI =
  "[data-cl-grade], .cl-practice-feedback, .cl-q-verdict, .cl-quiz-footer, .cl-answer-report, .cl-order-controls, .cl-code-runner, .cl-faded-runtime";

/** Our own UI, never lesson text: a highlight must not anchor into it. */
export const RUNTIME_UI = `script, style, noscript, .cl-header, .cl-card-panel, .cl-ask-pill, .cl-badge-marker, .cl-term-pop, .cl-contract-error, .cl-diagram, .cl-math, .cl-teacher, .cl-teacher-notice, ${QUIZ_RUNTIME_UI}`;

// ── Plain-text index over the DOM ─────────────────────────────────────────────

/**
 * Flatten the content root to plain text, remembering which text node each
 * character came from.
 *
 * Whitespace is collapsed to match `normalizeText`, so an anchor recorded against a
 * reflowed document still resolves. Script/style text and existing card UI are
 * skipped — otherwise a highlight could "match" inside our own markup.
 */
export function buildTextIndex(root) {
  const segments = [];
  let text = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      // The header and card UI are ours, not the lesson's — a highlight must never
      // anchor into them (and a lesson with no <main> makes contentRoot the body).
      if (parent.closest(RUNTIME_UI)) return NodeFilter.FILTER_REJECT;
      return node.nodeValue && node.nodeValue.trim().length > 0
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  let node = walker.nextNode();
  while (node) {
    const raw = node.nodeValue;
    // Collapse whitespace while keeping a map back to offsets in the original node.
    let collapsed = "";
    const offsets = [];
    let lastWasSpace = text.length === 0 || /\s$/.test(text);
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (/\s/.test(ch)) {
        if (lastWasSpace) continue;
        collapsed += " ";
        offsets.push(i);
        lastWasSpace = true;
      } else {
        collapsed += ch;
        offsets.push(i);
        lastWasSpace = false;
      }
    }
    if (collapsed.length > 0) {
      segments.push({ node, start: text.length, length: collapsed.length, offsets });
      text += collapsed;
    }
    node = walker.nextNode();
  }

  return { text, segments };
}

/** Map a plain-text offset back to a { node, offset } DOM position. */
function locate(index, offset) {
  for (const segment of index.segments) {
    if (offset >= segment.start && offset < segment.start + segment.length) {
      return { node: segment.node, offset: segment.offsets[offset - segment.start] };
    }
  }
  const last = index.segments[index.segments.length - 1];
  if (!last) return null;
  return { node: last.node, offset: last.node.nodeValue.length };
}

/** Convert a plain-text span to a DOM Range. */
export function rangeFromOffsets(index, start, end) {
  const from = locate(index, start);
  const to = locate(index, Math.max(start, end - 1));
  if (!from || !to) return null;
  const range = document.createRange();
  try {
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, Math.min(to.offset + 1, to.node.nodeValue.length));
  } catch (err) {
    return null;
  }
  return range;
}

/** Plain-text offsets for a live selection Range, or null if it is outside content. */
export function offsetsFromRange(index, range) {
  const startInfo = offsetOf(index, range.startContainer, range.startOffset);
  const endInfo = offsetOf(index, range.endContainer, range.endOffset);
  if (startInfo === null || endInfo === null || endInfo <= startInfo) return null;
  return { start: startInfo, end: endInfo };
}

function offsetOf(index, node, offset) {
  for (const segment of index.segments) {
    if (segment.node !== node) continue;
    // Find the collapsed position at or after the raw offset.
    for (let i = 0; i < segment.offsets.length; i++) {
      if (segment.offsets[i] >= offset) return segment.start + i;
    }
    return segment.start + segment.length;
  }
  return null;
}

function elementOf(node) {
  return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
}

export function outsideIndex(node) {
  return Boolean(elementOf(node)?.closest(`.cl-diagram, .cl-math, ${QUIZ_RUNTIME_UI}`));
}

/**
 * The quiz and question a highlight sits in, or null for lesson text. The teacher
 * needs it: before grading, an answer about a quiz question must not solve it.
 */
export function quizRefFor(range) {
  for (const node of [range.startContainer, range.endContainer]) {
    const element = elementOf(node);
    const form = element?.closest("form.cl-quiz");
    if (!form?.dataset.quizId) continue;
    return {
      quizId: form.dataset.quizId,
      questionId: element.closest(".cl-q")?.dataset.questionId ?? null,
    };
  }
  return null;
}

/** Place an absolutely-positioned element at viewport coords, clamped on-screen. */
export function position(element, viewportLeft, viewportTop) {
  const left = Math.max(8, Math.min(viewportLeft, window.innerWidth - element.offsetWidth - 8));
  element.style.left = `${left + window.scrollX}px`;
  element.style.top = `${Math.max(8, viewportTop) + window.scrollY}px`;
}

/**
 * Insert a card into the document flow, just after the block the highlight sits in.
 *
 * Transient UI (the ask pill, the composer) floats over the page; a card does not.
 * A floating card covers the very passage the learner is asking about, which is the
 * one thing it must not do, and lessons are set to a reading measure so there is
 * rarely margin wide enough to escape into. In the flow it never occludes anything,
 * needs no repositioning on scroll or resize, and works the same at every width.
 */
export function placeCardInFlow(panel, mark, contentRoot) {
  // In a quiz, a card goes after the whole question. Inside it, the card's fields
  // would be locked, cleared, and read as answers along with the question's own.
  const question = mark.parentElement?.closest("form.cl-quiz .cl-q");
  const anchor = question ?? blockAncestor(mark, contentRoot) ?? mark;
  if (anchor.parentNode) anchor.after(panel);
  else contentRoot.appendChild(panel);
}

/** Nearest block-level ancestor within the content root, for flow insertion. */
function blockAncestor(node, contentRoot) {
  let el = node instanceof Element ? node : node.parentElement;
  while (el && el !== contentRoot) {
    if (getComputedStyle(el).display !== "inline") return el;
    el = el.parentElement;
  }
  return null;
}

/** Draw the TeX in a quote. The teacher reads the TeX; the learner sees the formula. */
export function drawQuoteMath(quote) {
  initMath(quote).catch((err) => console.error("[classroom] quote math failed", err));
}

/** Show markup errors where they are, so nobody mistakes a broken quiz for a working one. */
export function showErrors(container, heading, errors, before = null) {
  const box = document.createElement("div");
  box.className = "cl-contract-error";
  box.setAttribute("role", "alert");
  const title = document.createElement("p");
  title.className = "cl-contract-error-title";
  title.textContent = heading;
  const list = document.createElement("ul");
  for (const error of errors) {
    const item = document.createElement("li");
    item.textContent = error;
    list.appendChild(item);
    console.error(`[classroom] ${heading} ${error}`);
  }
  box.append(title, list);
  if (before) container.insertBefore(box, before);
  else container.prepend(box);
}

/** The text of a lesson element, with each formula as its TeX. */
export function textOf(element) {
  if (!element) return "";
  const restore = swapMathForSource(element);
  try {
    return normalizeText(element.textContent);
  } finally {
    restore();
  }
}

export function setQuizStatus(form, html, isHtml = false) {
  const status = form.querySelector("[data-cl-quiz-status]");
  if (!status) return;
  if (isHtml) status.innerHTML = html;
  else status.textContent = html;
}

export function showDraftError(container, text) {
  const line = container.querySelector("[data-cl-draft-error]");
  line.textContent = text;
  line.hidden = !text;
}

export function escapeText(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

/** CSS.escape with a fallback for the handful of browsers that lack it. */
export function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
  return String(value).replace(/["\\\]\[]/g, "\\$&");
}

/** Remove the card markers inside an element. Returns a function that restores them. */
export function detachMarkers(element) {
  const markers = [...element.querySelectorAll(".cl-badge-marker")].map((marker) => ({
    marker,
    parent: marker.parentNode,
    next: marker.nextSibling,
  }));
  for (const { marker } of markers) marker.remove();
  return () => {
    for (const { marker, parent, next } of markers.reverse()) parent.insertBefore(marker, next);
  };
}

/** Promise-based modal confirm; resolves false on cancel, Escape, or backdrop click. */
export function askConfirm({ title, body, confirmLabel, cancelLabel = "Cancel" }) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "cl-confirm";
    dialog.innerHTML = `
      <h2 class="cl-confirm-title"></h2>
      <p class="cl-confirm-body"></p>
      <div class="cl-confirm-actions">
        <button type="button" class="cl-button cl-button-quiet" data-cl-cancel></button>
        <button type="button" class="cl-button cl-button-danger" data-cl-confirm></button>
      </div>`;
    dialog.querySelector(".cl-confirm-title").textContent = title;
    dialog.querySelector(".cl-confirm-body").textContent = body;
    const cancelButton = dialog.querySelector("[data-cl-cancel]");
    const confirmButton = dialog.querySelector("[data-cl-confirm]");
    cancelButton.textContent = cancelLabel;
    confirmButton.textContent = confirmLabel;

    let answered = false;
    const settle = (value) => {
      if (answered) return;
      answered = true;
      resolve(value);
      dialog.close();
    };

    cancelButton.addEventListener("click", () => settle(false));
    confirmButton.addEventListener("click", () => settle(true));
    // Escape fires `cancel`; a click on the backdrop lands on the dialog element itself.
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      settle(false);
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) settle(false);
    });
    dialog.addEventListener("close", () => {
      settle(false);
      dialog.remove();
    });

    document.body.appendChild(dialog);
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", ""); // very old browsers: still usable, just not modal
    cancelButton.focus();
  });
}
