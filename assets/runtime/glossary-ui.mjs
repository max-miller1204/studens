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
    "form.cl-quiz, form.cl-reflect, .cl-header, .cl-card-panel, .cl-ask-pill, " +
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
    termPopover.hidden = true;
    termPopover.innerHTML = `
    <p class="cl-term-pop-title" data-cl-term-title></p>
    <p class="cl-term-pop-ask">What does it mean? Say it to yourself first.</p>
    <button type="button" class="cl-button" data-cl-reveal>Show the definition</button>
    <div class="cl-term-pop-definition" data-cl-definition hidden></div>
    <p class="cl-term-pop-avoid" data-cl-avoid hidden></p>`;
    document.body.appendChild(termPopover);

    termPopover.querySelector("[data-cl-reveal]").addEventListener("click", () => {
      termPopover.querySelector("[data-cl-reveal]").hidden = true;
      termPopover.querySelector(".cl-term-pop-ask").hidden = true;
      termPopover.querySelector("[data-cl-definition]").hidden = false;
      termPopover.querySelector("[data-cl-avoid]").hidden =
        !termPopover.querySelector("[data-cl-avoid]").textContent;
    });
    document.addEventListener("mousedown", (event) => {
      if (!termPopover.hidden && !termPopover.contains(event.target)) termPopover.hidden = true;
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") termPopover.hidden = true;
    });
  }

  function openTermPopover(anchor, entry) {
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
    const rect = anchor.getBoundingClientRect();
    position(termPopover, rect.left, rect.bottom + 8);
    termPopover.querySelector("[data-cl-reveal]").focus();
  }
  return { initGlossary };
}
