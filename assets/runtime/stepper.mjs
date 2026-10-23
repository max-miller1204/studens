/** Public teaching traces and a bounded, deterministic prefix-sum simulation. No I/O. */
import { initDiagrams } from "./diagrams.mjs";
import { initMath } from "./math.mjs";
import { showErrors } from "./lesson-dom.mjs";

function fields(value, required, optional, path) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${path} must be an object.`);
  const unknown = Object.keys(value).filter((key) => ![...required, ...optional].includes(key));
  if (unknown.length || required.some((key) => !Object.hasOwn(value, key)))
    throw new Error(
      `${path} needs ${required.join(", ")}; unsupported fields: ${unknown.join(", ") || "none"}.`,
    );
}
function text(value, path) {
  if (typeof value !== "string" || !value.trim() || value.length > 12000)
    throw new Error(`${path} needs 1–12000 characters of nonblank text.`);
}
function values(input) {
  if (
    !Array.isArray(input) ||
    input.length < 1 ||
    input.length > 12 ||
    input.some((n) => typeof n !== "number" || !Number.isSafeInteger(n) || Math.abs(n) > 100)
  )
    throw new Error("values must contain 1–12 integers from -100 to 100.");
  return input;
}
export function validateStepper(config) {
  fields(config, ["version", "title", "domain", "mode"], ["steps", "values"], "Stepper");
  if (config.version !== 1) throw new Error("Stepper version must be 1.");
  text(config.title, "title");
  if (!["process", "state-machine", "pipeline", "algorithm"].includes(config.domain))
    throw new Error("domain must be process, state-machine, pipeline, or algorithm.");
  if (config.mode === "trace") {
    if (Object.hasOwn(config, "values"))
      throw new Error("Authored traces cannot declare computed values.");
    if (!Array.isArray(config.steps) || config.steps.length < 2 || config.steps.length > 64)
      throw new Error("steps must contain 2–64 ordered state snapshots.");
    config.steps.forEach((step, i) => {
      const path = `steps[${i}]`;
      fields(step, ["title", "state", "transition", "explanation"], ["mermaid"], path);
      for (const key of ["title", "state", "transition", "explanation"])
        text(step[key], `${path}.${key}`);
      if (Object.hasOwn(step, "mermaid")) text(step.mermaid, `${path}.mermaid`);
    });
  } else if (config.mode === "prefix-sum") {
    if (config.domain !== "algorithm" || Object.hasOwn(config, "steps"))
      throw new Error("prefix-sum requires domain algorithm and values, without authored steps.");
    values(config.values);
  } else throw new Error("mode must be trace or prefix-sum.");
  return config;
}
export function parseStepperInput(input) {
  if (typeof input !== "string" || !/^-?\d+(?:\s*,\s*-?\d+)*$/.test(input.trim()))
    throw new Error("Enter comma-separated integers from -100 to 100, with no blank items.");
  return values(input.trim().split(",").map(Number));
}
/** Every computed frame is derived here; no author-supplied result is accepted. */
export function prefixSumSteps(input) {
  values(input);
  let sum = 0;
  const steps = [
    {
      title: "Start",
      state: `Input: ${input.join(", ")}\nConsumed: 0\nSum: 0`,
      transition: "Initialize the accumulator",
      explanation: "No values have been consumed. The empty prefix has sum \\(0\\).",
    },
  ];
  input.forEach((value, i) => {
    const before = sum;
    sum += value;
    steps.push({
      title: `Consume item ${i + 1}`,
      state: `Input: ${input.join(", ")}\nConsumed: ${i + 1}\nSum: ${sum}`,
      transition: `Add ${value} to ${before}`,
      explanation: `The next item is ${value}. Only the consumed prefix contributes: \\(${before} + (${value}) = ${sum}\\).`,
      mermaid: `flowchart LR\nA["Previous sum: ${before}"] -->|"add ${value}"| B["Current sum: ${sum}"]`,
    });
  });
  return steps;
}
const initialized = new WeakSet();
function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}
function button(label, action) {
  const node = element("button", "cl-button cl-button-secondary", label);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}
export function initSteppers(root) {
  const widgets = [...root.querySelectorAll(".cl-stepper")];
  for (const widget of widgets) {
    if (initialized.has(widget)) continue;
    initialized.add(widget);
    const id = widget.dataset.stepperId;
    try {
      if (!id || !/^[\w.-]+$/.test(id))
        throw new Error("data-stepper-id needs a unique identifier.");
      if (widgets.filter((w) => w.dataset.stepperId === id).length !== 1)
        throw new Error(`Duplicate data-stepper-id: ${id}.`);
      if (
        widget.closest("form") ||
        widget.parentElement?.closest(".cl-stepper, .cl-faded") ||
        widget.querySelector("form, .cl-stepper, .cl-faded")
      )
        throw new Error("Steppers must be outside forms and cannot nest widgets or forms.");
      const scripts = widget.querySelectorAll('script[type="application/json"][data-cl-stepper]');
      if (scripts.length !== 1)
        throw new Error("Needs exactly one public data-cl-stepper JSON script.");
      let config;
      try {
        config = JSON.parse(scripts[0].textContent);
      } catch (error) {
        throw new Error(`Invalid stepper JSON: ${error.message}`);
      }
      mount(widget, validateStepper(config));
    } catch (error) {
      widget.dataset.state = "broken";
      showErrors(widget, `Stepper ${id ?? "(missing id)"} cannot start.`, [error.message]);
    }
  }
}
function mount(widget, config) {
  let steps = config.mode === "trace" ? config.steps : prefixSumSteps(config.values);
  let index = 0,
    timer = null,
    playing = false,
    generation = 0,
    disposed = false,
    failed = false;
  let drawing = new AbortController();
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const host = element("div", "cl-stepper-runtime cl-card-box");
  host.append(element("h3", "", config.title));
  host.append(
    element(
      "p",
      "cl-stepper-note",
      config.mode === "trace"
        ? "Authored trace · ordered snapshots supplied by the author; not a computed simulation."
        : "Computed simulation · prefix sum calculated from the displayed input.",
    ),
  );
  host.append(element("p", "cl-stepper-note", "Ungraded exploration. Reload starts over."));
  const controls = element("div", "cl-stepper-controls");
  const back = button("Back", () => move(index - 1));
  const next = button("Next", () => move(index + 1));
  const reset = button("Reset", () => move(0));
  const play = button("Play", () => {
    if (playing) pause();
    else if (!failed && !motion.matches && index < steps.length - 1) {
      playing = true;
      play.textContent = "Pause";
      update();
      schedule();
    }
  });
  controls.append(back, next, reset, play);
  host.append(controls);
  const motionNote = element("p", "cl-stepper-note");
  host.append(motionNote);
  const status = element("p", "cl-stepper-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  const view = element("div", "cl-stepper-view");
  if (config.mode === "prefix-sum") {
    const label = element("label", "", "Values (1–12 integers, -100 to 100)");
    const input = element("input", "cl-input");
    input.type = "text";
    input.value = config.values.join(", ");
    label.append(input);
    const error = element("p", "cl-stepper-input-error");
    error.setAttribute("role", "alert");
    const recompute = button("Recompute", () => {
      pause();
      try {
        steps = prefixSumSteps(parseStepperInput(input.value));
        input.removeAttribute("aria-invalid");
        error.textContent = "";
        failed = false;
        index = 0;
        render();
      } catch (cause) {
        failed = true;
        generation++;
        drawing.abort();
        input.setAttribute("aria-invalid", "true");
        error.textContent = cause.message;
        view.replaceChildren();
        status.textContent = "Input rejected. Correct the values and select Recompute.";
        widget.dataset.state = "invalid-input";
        update();
      }
    });
    // Editing never changes the run: an explicit recompute commits the new input.
    input.addEventListener("input", () => {
      pause();
      error.textContent =
        "Input edited; select Recompute to start a new run. The displayed run uses the previous values.";
    });
    host.append(label, recompute, error);
  }
  host.append(status, view);
  widget.append(host);
  function update() {
    back.disabled = failed || index === 0;
    next.disabled = failed || index === steps.length - 1;
    reset.disabled = failed;
    play.disabled = failed || motion.matches || index === steps.length - 1;
    play.setAttribute("aria-pressed", String(playing));
    motionNote.textContent = motion.matches
      ? "Reduced motion: use Back and Next; automatic play is disabled."
      : "Play advances every 1.5 seconds and stops at the final state. Back, Next, Reset, or leaving the page pauses it.";
  }
  function pause() {
    playing = false;
    clearTimeout(timer);
    timer = null;
    play.textContent = "Play";
    update();
  }
  function schedule() {
    clearTimeout(timer);
    if (playing && !failed && !disposed)
      timer = setTimeout(async () => {
        if (!widget.isConnected || document.hidden) {
          pause();
          return;
        }
        index++;
        await render();
        if (index === steps.length - 1) pause();
        else schedule();
      }, 1500);
  }
  function move(to) {
    pause();
    if (failed || to < 0 || to >= steps.length) return;
    index = to;
    render();
  }
  async function render() {
    const current = ++generation;
    drawing.abort();
    drawing = new AbortController();
    const step = steps[index];
    widget.dataset.step = String(index);
    widget.dataset.state = "rendering";
    const frame = element("div", "cl-stepper-frame");
    frame.append(element("h4", "", step.title));
    frame.append(
      element(
        "p",
        "cl-stepper-transition",
        `${index === 0 ? "Start" : `${steps[index - 1].title} → ${step.title}`}: ${step.transition}`,
      ),
    );
    frame.append(element("p", "cl-stepper-state", step.state));
    frame.append(element("p", "cl-stepper-explanation", step.explanation));
    if (step.mermaid) {
      const diagram = element("pre", "mermaid", step.mermaid);
      diagram.setAttribute("aria-label", `${config.title}: ${step.title}. ${step.transition}`);
      frame.append(diagram);
    }
    view.replaceChildren(frame);
    status.textContent = `Step ${index + 1} of ${steps.length}. ${step.title}. ${step.transition}. ${step.state}`;
    update();
    await Promise.all([
      initDiagrams(frame, { signal: drawing.signal }),
      initMath(frame),
      initMath(status),
    ]);
    if (current !== generation || disposed || !widget.isConnected) return;
    if (frame.querySelector(".cl-contract-error") || status.querySelector(".cl-contract-error")) {
      failed = true;
      pause();
      widget.dataset.state = "broken";
      status.textContent = `Step ${index + 1} could not render. Read the specific error below; reload after the author repairs the content.`;
    } else widget.dataset.state = "ready";
  }
  function visibility() {
    if (document.hidden) pause();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    pause();
    generation++;
    drawing.abort();
    observer.disconnect();
    motion.removeEventListener("change", pause);
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("pagehide", pause);
  }
  const observer = new MutationObserver(() => {
    if (!widget.isConnected) dispose();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  motion.addEventListener("change", pause);
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", pause);
  render();
}
