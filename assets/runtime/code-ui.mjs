/** Runnable question UI; engine assets load only when the learner explicitly runs code. */
import {
  CODE_ENGINE,
  CODE_PROTOCOL,
  CODE_SOURCE_LIMIT,
  CODE_OUTPUT_LIMIT,
  CODE_WATCHDOG_MS,
  parseCodeExercise,
  parseCodeRun,
} from "./code.mjs";

const controllers = new WeakMap();
export function enhanceCode(question) {
  const exercise = parseCodeExercise(question.getAttribute("data-code"));
  let displayedExercise = exercise;
  const editor = question.querySelector("textarea.cl-code-source");
  editor.spellcheck = false;
  editor.autocapitalize = "off";
  editor.setAttribute("autocorrect", "off");
  if (!editor.hasAttribute("aria-label")) editor.setAttribute("aria-label", "JavaScript source");
  editor.maxLength = CODE_SOURCE_LIMIT;
  const panel = document.createElement("div");
  panel.className = "cl-code-runner cl-no-highlight cl-card-box";
  const note = document.createElement("p");
  note.className = "cl-quiz-status";
  note.textContent =
    "JavaScript · Public tests run in an isolated browser interpreter. Run gives debugging feedback; Submit saves your source for rubric grading.";
  const tests = document.createElement("details");
  const summary = document.createElement("summary");
  const cases = document.createElement("pre");
  tests.append(summary, cases);
  const actions = document.createElement("div");
  actions.className = "cl-code-actions";
  const button = document.createElement("button");
  button.className = "cl-button";
  button.type = "button";
  button.dataset.clCodeRun = "";
  button.textContent = "Run code";
  const stop = document.createElement("button");
  stop.className = "cl-button cl-button-quiet";
  stop.type = "button";
  stop.dataset.clCodeStop = "";
  stop.textContent = "Stop";
  stop.disabled = true;
  const status = document.createElement("p");
  status.className = "cl-code-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const results = document.createElement("ol");
  results.className = "cl-code-results";
  results.setAttribute("aria-label", "Public test results");
  const output = document.createElement("pre");
  output.className = "cl-code-output";
  output.setAttribute("aria-label", "Code output");
  output.tabIndex = 0;
  output.hidden = true;
  actions.append(button, stop);
  panel.append(note, tests, actions, status, results, output);
  editor.closest("label")?.after(panel);
  if (!panel.isConnected) editor.after(panel);
  let run,
    active,
    worker,
    timer,
    locked = false;

  function dispose() {
    active = undefined;
    worker?.terminate();
    worker = undefined;
    clearTimeout(timer);
    stop.disabled = true;
    button.disabled = locked;
  }
  function render(message) {
    summary.textContent = `Public tests (${displayedExercise.tests.length})`;
    cases.textContent = displayedExercise.tests
      .map(
        (test) =>
          `${test.id}: ${displayedExercise.entry}(${test.args.map((v) => JSON.stringify(v)).join(", ")}) → ${JSON.stringify(test.expected)}`,
      )
      .join("\n");
    panel.dataset.runState = active ? "running" : (run?.status ?? "idle");
    status.textContent =
      message ??
      (run
        ? run.status === "complete"
          ? `${run.results.filter((r) => r.outcome === "passed").length}/${displayedExercise.tests.length} public tests passed. Browser feedback; submit when ready.`
          : `${run.error} Use Run again to start a new execution.`
        : "Not run for this source.");
    results.replaceChildren();
    for (const [index, result] of (run?.results ?? []).entries()) {
      const row = document.createElement("li");
      row.dataset.outcome = result.outcome;
      row.textContent = `${result.id} · ${result.outcome === "passed" ? "Passed" : result.outcome === "failed" ? "Failed" : "Error"}\n${result.error ?? `Expected ${JSON.stringify(displayedExercise.tests[index].expected)}; received ${result.actual}`}`;
      results.append(row);
    }
    output.hidden = !run?.output;
    output.textContent = run?.output
      ? `Console output (limit ${CODE_OUTPUT_LIMIT} characters)\n${run.output}`
      : "";
    button.textContent = run ? "Run again" : "Run code";
  }
  function failed(status, error) {
    if (!active) return;
    run = {
      id: active.id,
      source: active.source,
      engine: CODE_ENGINE,
      status,
      results: [],
      output: "",
      error,
    };
    dispose();
    render();
  }
  editor.addEventListener("input", () => {
    dispose();
    run = undefined;
    displayedExercise = exercise;
    render(
      "Source changed. Previous results are no longer current. Run code to check this version.",
    );
  });
  stop.addEventListener("click", () => failed("stopped", "Execution stopped."));
  button.addEventListener("click", () => {
    if (locked || active || editor.disabled) return;
    const source = editor.value;
    run = undefined;
    if (!source.trim() || source.length > CODE_SOURCE_LIMIT) {
      render(`Enter 1–${CODE_SOURCE_LIMIT} characters of JavaScript source.`);
      return;
    }
    active = { id: crypto.randomUUID(), source };
    button.disabled = true;
    stop.disabled = false;
    render("Running public tests… You can stop or revise the source.");
    try {
      worker = new Worker(new URL("./code-worker.mjs", import.meta.url), {
        type: "module",
        name: "studens-code",
      });
      worker.onmessage = ({ data }) => {
        if (
          !active ||
          editor.value !== active.source ||
          data?.protocol !== CODE_PROTOCOL ||
          data.run?.id !== active.id ||
          data.run?.source !== active.source
        )
          return;
        try {
          run = parseCodeRun(data.run, active.source, exercise);
        } catch (error) {
          failed("error", `Runner returned invalid feedback: ${error.message}`);
          return;
        }
        dispose();
        render();
      };
      worker.onerror = (event) => {
        event.preventDefault();
        failed(
          "error",
          `JavaScript runner failed: ${event.message || "Unable to load the packaged interpreter."}`.slice(
            0,
            1000,
          ),
        );
      };
      timer = setTimeout(
        () => failed("timeout", "Runner time limit exceeded (including interpreter startup)."),
        CODE_WATCHDOG_MS,
      );
      worker.postMessage({ protocol: CODE_PROTOCOL, ...active, exercise });
    } catch (error) {
      failed("error", `Cannot start JavaScript runner: ${error.message}`.slice(0, 1000));
    }
  });
  controllers.set(question, {
    collect() {
      if (active)
        return { invalid: "Stop the running code or wait for its results before submitting." };
      if (!editor.value.trim()) return { missing: true };
      if (editor.value.length > CODE_SOURCE_LIMIT)
        return { invalid: `Code exceeds ${CODE_SOURCE_LIMIT} characters.` };
      return {
        value: editor.value,
        code: { exercise, ...(run && run.source === editor.value ? { run } : {}) },
      };
    },
    restore(answer) {
      dispose();
      editor.value = answer.value;
      displayedExercise = answer.code?.exercise ?? exercise;
      run = answer.code?.run;
      render(run ? undefined : "No browser run was saved for this source.");
    },
    lock(value) {
      locked = value;
      dispose();
      render();
    },
  });
  window.addEventListener("pagehide", dispose, { once: true });
  render();
}

export function collectCode(question) {
  return controllers.get(question).collect();
}
export function restoreCode(question, answer) {
  controllers.get(question)?.restore(answer);
}
export function lockCode(question, locked) {
  controllers.get(question)?.lock(locked);
}
