/** Public, local worked-example practice. No storage, network, or assessment lifecycle. */
import { practiceEntry, practiceFeedback } from "./practice.mjs";
import { parseNumber } from "./quiz.mjs";
import { showErrors } from "./lesson-dom.mjs";

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function fields(value, allowed, path) {
  if (!object(value)) throw new Error(`${path} must be an object.`);
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length) throw new Error(`${path} has unsupported fields: ${extra.join(", ")}.`);
}
function text(value, path) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${path} needs nonempty text.`);
}

/** Deliberately small contract: plain text; exact term/numeric or unscored comparison. */
export function validateFaded(value) {
  fields(value, ["version", "title", "steps", "rounds"], "Faded example");
  if (value.version !== 1) throw new Error("Faded example version must be 1.");
  text(value.title, "title");
  if (!Array.isArray(value.steps) || value.steps.length < 2 || value.steps.length > 6)
    throw new Error("steps must contain 2 to 6 ordered steps.");
  value.steps.forEach((step, i) => {
    fields(step, ["title", "principle"], `steps[${i}]`);
    text(step.title, `steps[${i}].title`);
    text(step.principle, `steps[${i}].principle`);
  });
  if (!Array.isArray(value.rounds) || value.rounds.length !== value.steps.length + 1)
    throw new Error("rounds must contain one worked case, then one new case per handed-over step.");
  const situations = new Set();
  value.rounds.forEach((round, r) => {
    const path = `rounds[${r}]`;
    fields(round, ["situation", "steps"], path);
    text(round.situation, `${path}.situation`);
    const normalized = round.situation.trim().replace(/\s+/g, " ").toLowerCase();
    if (situations.has(normalized)) throw new Error(`${path} needs a different situation.`);
    situations.add(normalized);
    if (!Array.isArray(round.steps) || round.steps.length !== value.steps.length)
      throw new Error(`${path}.steps must match the ordered steps.`);
    round.steps.forEach((step, s) => {
      const at = `${path}.steps[${s}]`;
      fields(step, ["prompt", "solution", "response"], at);
      text(step.prompt, `${at}.prompt`);
      text(step.solution, `${at}.solution`);
      const response = step.response;
      fields(response, ["type", "expected", "correct", "incorrect"], `${at}.response`);
      if (response.type === "compare") {
        if (Object.keys(response).length !== 1)
          throw new Error(`${at}: compare accepts only type; it cannot claim correctness.`);
      } else {
        if (!["term", "numeric"].includes(response.type))
          throw new Error(`${at}: response.type must be term, numeric, or compare.`);
        const { type, ...entry } = response;
        if (type === "numeric")
          fields(entry.expected, ["value", "tolerance", "unit"], `${at}.expected`);
        try {
          practiceEntry(type, entry);
        } catch (error) {
          throw new Error(`${at}: ${error.message}`);
        }
      }
    });
  });
  return value;
}

const initialized = new WeakSet();
function element(tag, className, textValue) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textValue !== undefined) node.textContent = textValue;
  return node;
}
function button(label, action) {
  const node = element("button", "cl-button cl-button-secondary", label);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}

/** Called only on served content: pending pretest templates are withheld by the server. */
export function initFaded(root) {
  const widgets = [...root.querySelectorAll(".cl-faded")];
  for (const widget of widgets) {
    if (initialized.has(widget)) continue;
    initialized.add(widget);
    const id = widget.dataset.fadedId;
    try {
      if (!id || !/^[\w.-]+$/.test(id)) throw new Error("data-faded-id needs a unique identifier.");
      if (widgets.filter((w) => w.dataset.fadedId === id).length !== 1)
        throw new Error(`Duplicate data-faded-id: ${id}.`);
      if (
        widget.closest("form") ||
        widget.parentElement?.closest(".cl-faded") ||
        widget.querySelector("form, .cl-faded")
      )
        throw new Error("Faded examples must be outside forms and cannot nest widgets or forms.");
      const scripts = widget.querySelectorAll('script[type="application/json"][data-cl-faded]');
      if (scripts.length !== 1)
        throw new Error("Needs exactly one public data-cl-faded JSON script.");
      let value;
      try {
        value = JSON.parse(scripts[0].textContent);
      } catch (error) {
        throw new Error(`Invalid faded example JSON: ${error.message}`);
      }
      mount(widget, validateFaded(value));
      widget.dataset.state = "ready";
    } catch (error) {
      widget.dataset.state = "broken";
      showErrors(widget, `Faded example ${id ?? "(missing id)"} cannot start.`, [error.message]);
    }
  }
}

function mount(widget, config) {
  const host = element("div", "cl-faded-runtime cl-card-box");
  widget.append(host);
  const count = config.steps.length;
  let round = 0;
  // Reset and revisit clear answers, but never erase exposure during this page visit.
  const visited = new Set();
  const exposed = new Set();
  let completed = false;

  function render(focus = false) {
    const revisit = visited.has(round);
    visited.add(round);
    completed = false;
    host.replaceChildren();
    widget.dataset.round = String(round);
    const heading = element("h3", "", config.title);
    heading.tabIndex = -1;
    host.append(heading);
    const phase =
      round === 0
        ? "Study the worked example"
        : round === count
          ? "All steps for you"
          : `Your turn: last ${round} ${round === 1 ? "step" : "steps"}`;
    host.append(element("p", "cl-faded-progress", `${round + 1} / ${count + 1} · ${phase}`));
    host.append(
      element(
        "p",
        "cl-faded-note",
        "Local practice only. No saved answers, score, mastery, or review credit. Reload returns to study; repeated cases are not fresh retrieval evidence.",
      ),
    );
    if (revisit || exposed.has(round))
      host.append(
        element(
          "p",
          "cl-faded-note",
          "Revisited case. Previous answers are cleared; any earlier solution exposure still counts as assistance.",
        ),
      );
    host.append(element("p", "cl-faded-situation", config.rounds[round].situation));
    const list = element("ol", "cl-faded-steps");
    const active = [];
    const status = element("p", "cl-faded-status", "");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    let next;
    const update = () => {
      completed = active.every((item) => item.checked);
      if (next) next.disabled = !completed;
    };
    config.steps.forEach((step, s) => {
      const content = config.rounds[round].steps[s];
      const item = element("li", "cl-faded-step");
      item.append(element("h4", "", step.title));
      const provided = s < count - round;
      item.dataset.support = provided ? "worked" : "attempt";
      item.append(element("p", "cl-faded-step-kind", provided ? "Worked step" : "Your step"));
      if (provided) {
        item.append(element("p", "cl-faded-solution", content.solution));
        item.append(element("p", "cl-faded-principle", step.principle));
        exposed.add(round);
      } else {
        const label = element("label", "cl-faded-label", content.prompt);
        const input = element("textarea", "cl-input");
        input.rows = content.response.type === "compare" ? 3 : 2;
        input.autocomplete = "off";
        input.spellcheck = content.response.type === "compare";
        label.append(input);
        item.append(label);
        if (content.response.type === "term")
          item.append(
            element(
              "p",
              "cl-faded-note",
              "This text check ignores case, leading/trailing spaces, and repeated spaces. Compare with the solution if you use other equivalent wording or an equivalent expression.",
            ),
          );
        let unit = null;
        if (content.response.type === "numeric" && content.response.expected.unit) {
          const unitLabel = element("label", "cl-faded-label", "Unit");
          unit = element("input", "cl-input");
          unit.type = "text";
          unit.autocomplete = "off";
          unitLabel.append(unit);
          item.append(unitLabel);
        }
        const feedback = element("p", "cl-faded-feedback");
        feedback.setAttribute("role", "status");
        const state = {
          input,
          unit,
          feedback,
          content,
          checked: false,
          compared: false,
          revealed: false,
        };
        active.push(state);
        const clear = () => {
          state.checked = false;
          state.compared = false;
          feedback.textContent = state.revealed
            ? "Solution already exposed for this case; this remains assisted practice."
            : "";
          delete feedback.dataset.correct;
          status.textContent = "Response changed. Check or compare it again before continuing.";
          update();
        };
        input.addEventListener("input", clear);
        unit?.addEventListener("input", clear);
        item.append(
          button("Compare with solution", () => {
            if (!input.value.trim()) {
              feedback.textContent = "Write an attempt before comparing with the solution.";
              input.focus();
              return;
            }
            exposed.add(round);
            state.compared = true;
            state.revealed = true;
            state.checked = true;
            delete feedback.dataset.correct;
            feedback.textContent = `Solution comparison · assisted practice. ${content.solution} ${step.principle} Compare your reasoning; this does not establish correctness.`;
            update();
          }),
        );
        item.append(feedback);
      }
      list.append(item);
    });
    host.append(list);
    if (round === 0) {
      const label = element(
        "label",
        "cl-faded-label",
        "Explain the method: choose a principle question above and answer it in your own words.",
      );
      const input = element("textarea", "cl-input");
      input.rows = 3;
      input.autocomplete = "off";
      label.append(input);
      host.append(label);
      active.push({ input, checked: false });
      input.addEventListener("input", () => {
        active[0].checked = Boolean(input.value.trim());
        update();
      });
    } else {
      host.append(
        button("Check my work", () => {
          for (const state of active) {
            const { input, unit, content, feedback } = state;
            if (!input.value.trim()) {
              status.textContent = "Write an attempt for every step before checking.";
              input.focus();
              return;
            }
            if (content.response.type === "numeric" && parseNumber(input.value) === null) {
              status.textContent = `“${input.value}” is not a finite number. Use a number without its unit; enter any unit separately.`;
              input.focus();
              return;
            }
          }
          for (const state of active) {
            const { content, input, unit, feedback } = state;
            if (content.response.type === "compare") {
              if (!state.compared)
                feedback.textContent =
                  "Open reasoning has no automatic correctness check. Use Compare with solution, then review the principle.";
              state.checked = state.compared;
            } else {
              const { type, ...entry } = content.response;
              const result = practiceFeedback(
                { type, value: input.value, unit: unit?.value ?? "" },
                entry,
              );
              feedback.dataset.correct = String(result.correct);
              feedback.textContent = `${state.revealed ? "Solution previously exposed · assisted practice. " : ""}${result.correct ? "Matches the public practice key." : "Does not match the public practice key."} ${result.feedback}`;
              // Either result can advance: practicing and reviewing is not an awarded grade.
              state.checked = true;
            }
          }
          status.textContent = exposed.has(round)
            ? "Checked as local practice with worked support or a solution comparison. No learning credit is recorded."
            : "Checked locally against public practice keys. This is not independent retrieval evidence or a grade.";
          update();
        }),
      );
    }
    host.append(status);
    const controls = element("div", "cl-faded-controls");
    if (round > 0)
      controls.append(
        button("Revisit previous case", () => {
          round--;
          render(true);
        }),
      );
    if (round < count) {
      next = button(round === 0 ? "Try the next case" : "Hand over one more step", () => {
        if (!completed) return;
        round++;
        render(true);
      });
      next.classList.remove("cl-button-secondary");
      next.disabled = true;
      controls.append(next);
    } else {
      next = button("Finish local practice", () => {
        if (!completed) return;
        status.textContent =
          "Practice complete for this page visit. No score or learning credit was saved. A separate graded check uses different cases.";
      });
      next.disabled = true;
      controls.append(next);
    }
    controls.append(
      button("Reset to worked example", () => {
        round = 0;
        render(true);
      }),
    );
    host.append(controls);
    update();
    if (focus) heading.focus();
  }
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    round = 0;
    render();
  });
  render();
}
