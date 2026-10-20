/** Private learner marks. No teacher requests, quiz writes, or automatic resends. */
import { resolveSelector } from "./anchor.mjs";
import { buildTextIndex, rangeFromOffsets } from "./lesson-dom.mjs";

export function createLearnerMarks({ config, contentRoot }) {
  const url = `/api/learner-marks?classroom=${encodeURIComponent(config.classroom)}&lesson=${encodeURIComponent(config.lesson)}`;
  const draftKey = `studens-mark-draft:${config.classroom}/${config.lesson}`;
  let marks = [],
    pending = null,
    busy = false,
    loaded = false;
  let panel, list, editor, field, quote, save, error, status, rebase;
  const names = { highlight: "Highlight", note: "Note", bookmark: "Bookmark" };
  function message(text) {
    if (error.textContent !== text) error.textContent = text;
    error.hidden = !text;
    if (text) panel.open = true;
  }
  function announce(text) {
    status.textContent = text;
  }
  function remember() {
    try {
      if (pending)
        sessionStorage.setItem(draftKey, JSON.stringify({ version: 1, command: pending }));
      else sessionStorage.removeItem(draftKey);
    } catch (err) {
      message(`Could not keep this draft through reload: ${err.message}. Keep this page open.`);
    }
  }
  function showEditor() {
    panel.open = true;
    editor.hidden = false;
    quote.textContent =
      pending.anchor?.exact ?? marks.find((m) => m.id === pending.id)?.anchor.exact ?? "Saved note";
    field.hidden = pending.kind !== "note" && pending.action !== "edit";
    field.closest("label").hidden = field.hidden;
    field.value = pending.text ?? "";
    save.textContent = field.hidden ? `Save ${pending.kind}` : "Save note";
    rebase.hidden = true;
  }
  function start(kind, anchor) {
    if (pending) {
      panel.open = true;
      message("You have an unsaved mark. Save it or select Discard draft before starting another.");
      editor.scrollIntoView({ block: "center" });
      return;
    }
    if (!loaded) {
      panel.open = true;
      message("Load saved marks with Refresh saved marks before creating a mark.");
      return;
    }
    if (!anchor || anchor.exact.length > 2000) {
      panel.open = true;
      message("Select between 2 and 2000 characters of lesson text.");
      return;
    }
    pending = { action: "create", id: crypto.randomUUID(), kind, anchor, text: "" };
    remember();
    showEditor();
    if (kind === "note") {
      editor.scrollIntoView({ block: "center" });
      field.focus();
    } else persist();
  }
  async function request(command) {
    const response = await fetch(
      url,
      command
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(command),
          }
        : undefined,
    );
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || `Saved marks request failed (${response.status}).`);
    return result.marks;
  }
  async function refresh() {
    if (busy) return;
    busy = true;
    updateButtons();
    message("");
    announce("Loading saved marks…");
    try {
      marks = await request();
      loaded = true;
      render();
      announce("Saved marks refreshed. Unsaved drafts are kept.");
      rebase.hidden = !(pending?.action === "edit" && marks.some((m) => m.id === pending.id));
    } catch (err) {
      announce("Saved marks could not be refreshed.");
      message(`${err.message} Select Refresh saved marks to try again.`);
    } finally {
      busy = false;
      updateButtons();
    }
  }
  async function persist() {
    if (!pending || busy) return;
    busy = true;
    updateButtons();
    message("");
    announce("Saving mark…");
    try {
      marks = await request(pending);
      loaded = true;
      pending = null;
      editor.hidden = true;
      remember();
      render();
      announce("Mark saved.");
    } catch (err) {
      announce("Mark was not saved.");
      message(`${err.message} Your draft is kept. Select ${save.textContent} to retry.`);
      remember();
    } finally {
      busy = false;
      updateButtons();
    }
  }
  function updateButtons() {
    for (const button of panel.querySelectorAll("button"))
      button.disabled = busy || button.dataset.unresolved === "true";
    field.disabled = busy;
  }
  function locate(mark) {
    const index = buildTextIndex(contentRoot);
    const match = resolveSelector(index.text, mark.anchor);
    return {
      match,
      range: match.status === "resolved" ? rangeFromOffsets(index, match.start, match.end) : null,
    };
  }
  function paint() {
    const groups = { highlight: [], note: [], bookmark: [] };
    for (const mark of marks) {
      const { range } = locate(mark);
      if (range) {
        groups[mark.kind].push(range);
      }
    }
    if (!globalThis.CSS?.highlights || !globalThis.Highlight) {
      message("This browser cannot paint saved marks: CSS Highlights support is required.");
      return;
    }
    for (const [kind, values] of Object.entries(groups))
      CSS.highlights.set(`cl-learner-${kind}`, new Highlight(...values));
  }
  function button(label, action) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", action);
    return b;
  }
  function render() {
    panel.querySelector("summary").textContent = `Saved marks (${marks.length})`;
    list.replaceChildren();
    paint();
    for (const mark of marks) {
      const item = document.createElement("li");
      item.dataset.markId = mark.id;
      const { match, range } = locate(mark);
      const heading = document.createElement("strong");
      heading.textContent = names[mark.kind];
      const passage = document.createElement("blockquote");
      passage.textContent = mark.anchor.exact;
      const note = document.createElement("p");
      note.className = "cl-mark-text";
      note.textContent = mark.text;
      const state = document.createElement("p");
      state.className = "cl-mark-anchor-status";
      state.textContent =
        match.status === "missing"
          ? "Passage not found. The lesson text changed."
          : match.status === "ambiguous"
            ? "Ambiguous passage. More than one match; no location chosen."
            : !match.exact
              ? "Passage found; surrounding text changed."
              : "";
      const actions = document.createElement("div");
      actions.className = "cl-mark-actions";
      const visit = button("Revisit passage", () => {
        const current = locate(mark);
        if (!current.range) {
          render();
          announce("This passage cannot be located.");
          return;
        }
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(current.range);
        current.range.startContainer.parentElement.scrollIntoView({ block: "center" });
      });
      visit.disabled = !range;
      visit.dataset.unresolved = String(!range);
      actions.append(visit);
      if (mark.kind === "note")
        actions.append(
          button("Edit note", () => {
            if (pending) {
              message("Save or discard your current draft before editing another note.");
              return;
            }
            pending = { action: "edit", id: mark.id, revision: mark.revision, text: mark.text };
            remember();
            message("");
            showEditor();
            field.focus();
          }),
        );
      actions.append(
        button("Delete mark", async () => {
          if (busy) return;
          busy = true;
          updateButtons();
          message("");
          try {
            marks = await request({ action: "delete", id: mark.id, revision: mark.revision });
            render();
            announce("Mark deleted.");
          } catch (err) {
            announce("Mark was not deleted.");
            message(`${err.message} Select Delete mark to retry.`);
          } finally {
            busy = false;
            updateButtons();
          }
        }),
      );
      item.append(heading, passage);
      if (mark.kind === "note") item.append(note);
      if (state.textContent) item.append(state);
      item.append(actions);
      list.append(item);
    }
    if (!marks.length) {
      const empty = document.createElement("li");
      empty.textContent = "Select lesson text to highlight, add a note, or bookmark a passage.";
      list.append(empty);
    }
  }
  function init() {
    panel = document.createElement("details");
    panel.className = "cl-learner-marks";
    panel.innerHTML = `<summary>Saved marks</summary><p class="cl-hint">For your own reading. Only Ask sends a question to your teacher.</p><button type="button" data-mark-refresh>Refresh saved marks</button><p role="status" aria-live="polite" data-mark-status></p><p role="alert" data-mark-error hidden></p><form data-mark-editor hidden><p data-mark-quote></p><label>Margin note<textarea data-mark-note maxlength="4000" rows="3"></textarea></label><div class="cl-mark-actions"><button type="submit" data-mark-save>Save note</button><button type="button" data-mark-discard>Discard draft</button><button type="button" data-mark-rebase hidden>Use refreshed revision</button></div></form><ul data-mark-list></ul>`;
    // Never nest note fields in authored quizzes, even when the content root is body.
    document.querySelector(".cl-header").after(panel);
    list = panel.querySelector("[data-mark-list]");
    editor = panel.querySelector("[data-mark-editor]");
    field = panel.querySelector("[data-mark-note]");
    quote = panel.querySelector("[data-mark-quote]");
    save = panel.querySelector("[data-mark-save]");
    error = panel.querySelector("[data-mark-error]");
    status = panel.querySelector("[data-mark-status]");
    rebase = panel.querySelector("[data-mark-rebase]");
    panel.querySelector("[data-mark-refresh]").addEventListener("click", refresh);
    editor.addEventListener("submit", (event) => {
      event.preventDefault();
      persist();
    });
    field.addEventListener("input", () => {
      if (pending && !busy) {
        pending.text = field.value;
        remember();
      }
    });
    field.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        editor.requestSubmit();
      }
    });
    panel.querySelector("[data-mark-discard]").addEventListener("click", () => {
      if (busy) return;
      pending = null;
      editor.hidden = true;
      remember();
      message("");
      announce("Draft discarded.");
    });
    rebase.addEventListener("click", () => {
      const latest = marks.find((m) => m.id === pending?.id);
      if (!latest) {
        message("This note was deleted. Keep or discard your draft.");
        return;
      }
      pending.revision = latest.revision;
      remember();
      rebase.hidden = true;
      announce(
        "Your draft now uses the refreshed revision. Select Save note to replace the saved text.",
      );
    });
    refresh();
    try {
      const saved = sessionStorage.getItem(draftKey);
      if (saved !== null) {
        const draft = JSON.parse(saved);
        if (
          draft.version !== 1 ||
          !draft.command ||
          !["create", "edit"].includes(draft.command.action) ||
          typeof draft.command.id !== "string"
        )
          throw new Error("Invalid saved mark draft.");
        pending = draft.command;
        showEditor();
        announce("Unsent mark draft restored. Save it when ready.");
      }
    } catch (err) {
      message(
        `Could not restore your mark draft: ${err.message}. The saved draft was not removed.`,
      );
    }
    // Recompute after pretest release and glossary/math hydration, without writes.
    new MutationObserver(() => {
      if (loaded) paint();
    }).observe(contentRoot, { childList: true, subtree: true, characterData: true });
  }
  return { init, start };
}
