/** Expected keys arrive only from the server's current-attempt availability gate. */
import { cssEscape } from "./lesson-dom.mjs";

export function createExpectedAnswers(config) {
  const states = new Map();
  const requests = new WeakMap();
  const failed = new WeakSet();
  function text(element) {
    const copy = element.cloneNode(true);
    for (const control of copy.querySelectorAll("button, input, select, textarea"))
      control.remove();
    return copy.textContent.trim();
  }
  function format(question, answer) {
    const key = answer.expected;
    const label = (selector, attribute, id) => {
      const element = [...question.querySelectorAll(selector)].find(
        (el) => el.getAttribute(attribute) === id,
      );
      if (!element)
        throw new Error(
          `The original answer label ${id} is unavailable. Restore the original lesson and retry explicitly.`,
        );
      return text(element.matches("input") ? element.closest("label") : element);
    };
    const option = (id) => label("input[type=radio], input[type=checkbox]", "value", id);
    const item = (list, id) => label(`.${list} > li`, "data-item", id);
    if (typeof key === "string") {
      if (answer.type === "choice") return option(key);
      return key;
    }
    if (Array.isArray(key)) {
      if (answer.type === "multi") return key.map(option).join("; ");
      if (answer.type === "order")
        return key.map((id, i) => `${i + 1}. ${item("cl-order", id)}`).join("\n");
      if (answer.type === "locate")
        return key.map((id) => label("[data-segment]", "data-segment", id)).join("; ");
      return key.join(" or ");
    }
    if (answer.type === "numeric")
      return `${key.value}${key.unit ? ` ${key.unit}` : ""} (tolerance: ±${key.tolerance ?? 0})`;
    if (answer.type === "match")
      return Object.entries(key)
        .map(([left, right]) => `${item("cl-match-left", left)} → ${item("cl-match-right", right)}`)
        .join("\n");
    if (answer.type === "cloze")
      return Object.entries(key)
        .map(
          ([blank, values]) =>
            `Blank ${blank}: ${Array.isArray(values) ? values.join(" or ") : values}`,
        )
        .join("\n");
    throw new Error("The original expected answer format is unavailable.");
  }
  function render(question, answer, form) {
    const prior = question.querySelector(".cl-expected");
    const signature = JSON.stringify(answer);
    if (prior?.dataset.value === signature) return;
    prior?.remove();
    const section = document.createElement("section");
    section.className = "cl-expected";
    section.dataset.value = signature;
    section.dataset.status = answer.status;
    section.setAttribute("aria-label", "Expected answer and criteria");
    const heading = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = "Expected answer and criteria";
    heading.append(strong);
    section.append(heading);
    const paragraph = (value) => {
      const p = document.createElement("p");
      p.textContent = value;
      section.append(p);
    };
    if (answer.status === "available") {
      try {
        const value = format(question, answer);
        const content = document.createElement(answer.type === "code" ? "pre" : "p");
        content.className = "cl-expected-value";
        content.textContent = value;
        section.append(content);
        paragraph(`Full credit (${answer.points} points): ${answer.full}`);
        paragraph(`Partial credit: ${answer.partial}`);
        if (answer.criteria?.length) {
          const list = document.createElement("ul");
          for (const criterion of answer.criteria) {
            const li = document.createElement("li");
            li.textContent = `${criterion.description} (${criterion.points} points)`;
            list.append(li);
          }
          section.append(list);
        }
      } catch (error) {
        answer = { status: "error", message: error.message };
        section.dataset.status = "error";
      }
    }
    if (answer.status !== "available") {
      paragraph(answer.message);
      const link = document.createElement("a");
      link.href = answer.panelUrl ?? "#cl-teacher";
      link.textContent = "Continue in the lesson’s teacher panel";
      section.append(link);
      if (answer.status === "error") {
        failed.add(form);
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "cl-button";
        retry.textContent = "Retry expected answer";
        retry.addEventListener("click", () => {
          failed.delete(form);
          refresh(form);
        });
        section.append(retry);
      }
    }
    question.append(section);
  }
  async function refresh(form) {
    const state = states.get(form);
    if (!state?.grade || failed.has(form)) return;
    const token = {};
    requests.set(form, token);
    const params = new URLSearchParams({
      classroom: config.classroom,
      lesson: config.lesson,
      quizId: state.submission.quizId,
      submissionId: state.submission.id,
    });
    let questions;
    try {
      const response = await fetch(`/api/quiz/expected?${params}`);
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || `Expected answers returned ${response.status}.`);
      if (body.submissionId !== state.submission.id)
        throw new Error("Expected answers belong to a different saved attempt. Reload the lesson.");
      questions = body.questions;
    } catch (error) {
      questions = Object.fromEntries(
        state.submission.answers.map((a) => [
          a.questionId,
          { status: "error", message: error.message, panelUrl: "#cl-teacher" },
        ]),
      );
    }
    if (requests.get(form) !== token || states.get(form)?.submission.id !== state.submission.id)
      return;
    for (const [id, answer] of Object.entries(questions)) {
      const question = form.querySelector(`.cl-q[data-question-id="${cssEscape(id)}"]`);
      if (question) render(question, answer, form);
    }
  }
  function apply(form, state) {
    const before = states.get(form);
    states.set(form, state);
    if (before?.submission.id !== state.submission.id) {
      failed.delete(form);
      for (const section of form.querySelectorAll(".cl-expected")) section.remove();
    }
    if (state.grade) refresh(form);
  }
  return {
    apply,
    updateTeacher: () => {
      for (const form of states.keys()) refresh(form);
    },
  };
}
