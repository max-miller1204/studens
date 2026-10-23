/** Mark glossary terms and reveal definitions after a recall prompt. */
import { findTerms, firstUses } from "./glossary.mjs";
import { position } from "./lesson-dom.mjs";

export function createGlossary({ config, contentRoot }) {
  /**
   * Mark the first use of each glossary term in each section of the lesson.
   *
   * Recall first: a click asks the learner what the term means before it shows the
   * definition, so each look is a small retrieval attempt rather than a re-read.
   */
  let termPopover = null;
  let termAnchor = null;

  async function initGlossary() {
    const response = await fetch(`/api/glossary?classroom=${encodeURIComponent(config.classroom)}`);
    if (!response.ok) throw new Error(`GET /api/glossary returned ${response.status}`);
    const glossary = await response.json();
    for (const error of glossary.errors) console.error(`[classroom] GLOSSARY.md: ${error}`);
    if (glossary.terms.length === 0) return;

    buildTermPopover();
    for (const section of glossarySections()) markTerms(section, glossary.terms);
  }

  /** Top-level sections of the lesson, or the whole lesson when it has none. */
  function glossarySections() {
    const sections = [...contentRoot.querySelectorAll("section")].filter(
      (section) => !section.parentElement?.closest("section"),
    );
    return sections.length > 0 ? sections : [contentRoot];
  }

  const NO_TERMS =
    "script, style, pre, code, a, button, label, select, h1, h2, h3, h4, h5, h6, " +
    "form.cl-quiz, form.cl-reflect, .cl-lesson-links, .cl-source-notice, .cl-review-progress, [data-review-state], .cl-learner-marks, .cl-selection-actions, .cl-header, .cl-card-panel, .cl-ask-pill, " +
    ".cl-badge-marker, .cl-term, .cl-term-pop, .cl-contract-error, .cl-diagram, .cl-math, mark.cl-hl";

  function markTerms(section, terms) {
    const nodes = [];
    let text = "";
    const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.parentElement?.closest(NO_TERMS)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT;
      },
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      nodes.push({ node, start: text.length });
      text += node.nodeValue;
    }

    const matches = firstUses(
      findTerms(text, terms).filter((match) => {
        const owner = nodes.findLast((entry) => entry.start <= match.start);
        return owner && match.end <= owner.start + owner.node.nodeValue.length;
      }),
    );
    // Last first, so splitting a node cannot move the offsets of an earlier match.
    for (const match of matches.reverse()) {
      const owner = nodes.findLast((entry) => entry.start <= match.start);
      if (!owner || match.end > owner.start + owner.node.nodeValue.length) continue; // spans tags
      let target = owner.node;
      const from = match.start - owner.start;
      const to = match.end - owner.start;
      if (to < target.nodeValue.length) target.splitText(to);
      if (from > 0) target = target.splitText(from);

      const term = document.createElement("span");
      term.className = "cl-term";
      term.tabIndex = 0;
      term.setAttribute("role", "button");
      term.setAttribute("aria-haspopup", "dialog");
      target.parentNode.insertBefore(term, target);
      term.appendChild(target);
      const entry = terms[match.index];
      term.addEventListener("click", (event) => {
        event.stopPropagation();
        openTermPopover(term, entry);
      });
      term.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openTermPopover(term, entry);
        }
      });
    }
  }

  function buildTermPopover() {
    termPopover = document.createElement("div");
    termPopover.className = "cl-term-pop";
    termPopover.setAttribute("role", "dialog");
    termPopover.setAttribute("aria-labelledby", "cl-term-pop-title");
    termPopover.hidden = true;
    termPopover.innerHTML = `
    <p class="cl-term-pop-title" id="cl-term-pop-title" data-cl-term-title></p>
    <p class="cl-term-pop-ask">What does it mean? Say it to yourself first.</p>
    <button type="button" class="cl-button" data-cl-reveal>Show the definition</button>
    <div class="cl-term-pop-definition" data-cl-definition hidden></div>
    <p class="cl-term-pop-avoid" data-cl-avoid hidden></p>
    <div class="cl-term-origin" data-cl-origin hidden></div>
    <button type="button" class="cl-button" data-cl-term-close>Close definition</button>`;
    document.body.appendChild(termPopover);

    termPopover
      .querySelector("[data-cl-term-close]")
      .addEventListener("click", () => closeTermPopover(true));
    window.addEventListener("resize", positionTermPopover);
    document.addEventListener("scroll", positionTermPopover, true);
    termPopover.querySelector("[data-cl-reveal]").addEventListener("click", () => {
      termPopover.querySelector("[data-cl-reveal]").hidden = true;
      termPopover.querySelector(".cl-term-pop-ask").hidden = true;
      termPopover.querySelector("[data-cl-definition]").hidden = false;
      termPopover.querySelector("[data-cl-avoid]").hidden =
        !termPopover.querySelector("[data-cl-avoid]").textContent;
      termPopover.querySelector("[data-cl-origin]").hidden = false;
      const definition = termPopover.querySelector("[data-cl-definition]");
      definition.tabIndex = -1;
      definition.focus();
      positionTermPopover();
    });
    document.addEventListener("mousedown", (event) => {
      if (
        !termPopover.hidden &&
        !termPopover.contains(event.target) &&
        !termAnchor?.contains(event.target)
      )
        closeTermPopover(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !termPopover.hidden) {
        event.preventDefault();
        closeTermPopover(true);
      }
    });
  }

  function closeTermPopover(restoreFocus) {
    termPopover.hidden = true;
    termAnchor?.setAttribute("aria-expanded", "false");
    if (restoreFocus) termAnchor?.focus({ preventScroll: true });
  }

  function positionTermPopover() {
    if (!termPopover || termPopover.hidden || !termAnchor) return;
    const rect = termAnchor.getBoundingClientRect();
    const top = Math.max(
      8,
      Math.min(rect.bottom + 8, window.innerHeight - termPopover.offsetHeight - 8),
    );
    position(termPopover, rect.left, top);
  }

  function openTermPopover(anchor, entry) {
    termAnchor?.setAttribute("aria-expanded", "false");
    termAnchor = anchor;
    anchor.setAttribute("aria-expanded", "true");
    const source = termPopover.querySelector("[data-cl-origin]");
    source.replaceChildren();
    source.hidden = true;
    if (entry.origin?.status === "available") {
      source.append(document.createTextNode("Taught in "));
      const link = document.createElement("a");
      link.href = entry.origin.url;
      link.textContent = entry.origin.title;
      link.addEventListener("click", () => closeTermPopover(false));
      source.appendChild(link);
    } else {
      const note = document.createElement("p");
      note.textContent = entry.origin?.message || "No available teaching origin is recorded.";
      source.appendChild(note);
      if (entry.origin?.status === "error") {
        note.setAttribute("role", "alert");
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "cl-button";
        retry.textContent = "Retry loading teaching sources";
        retry.addEventListener("click", () => location.reload());
        source.appendChild(retry);
      }
    }
    termPopover.querySelector("[data-cl-term-title]").textContent = entry.term;
    // innerHTML is safe here: the definition was rendered to HTML server-side.
    termPopover.querySelector("[data-cl-definition]").innerHTML = entry.definitionHtml;
    termPopover.querySelector("[data-cl-avoid]").textContent =
      entry.avoid.length > 0 ? `Not: ${entry.avoid.join(", ")}` : "";
    termPopover.querySelector("[data-cl-reveal]").hidden = false;
    termPopover.querySelector(".cl-term-pop-ask").hidden = false;
    termPopover.querySelector("[data-cl-definition]").hidden = true;
    termPopover.querySelector("[data-cl-avoid]").hidden = true;
    termPopover.hidden = false;
    positionTermPopover();
    termPopover.querySelector("[data-cl-reveal]").focus();
  }
  return { initGlossary };
}
