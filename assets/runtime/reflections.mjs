/** Save ungraded self-explanations and restore their saved text and drafts. */
import { isContractId } from "./quiz.mjs";
import { showErrors, textOf, setQuizStatus } from "./lesson-dom.mjs";
import { draftStatus } from "./drafts.mjs";

export function createReflections({ config, drafts }) {
  const { scheduleDraft, flushDraft } = drafts;
  function reflectForms() {
    return [...document.querySelectorAll("form.cl-reflect")];
  }

  function hydrateReflections() {
    const seen = new Set();
    for (const form of reflectForms()) {
      const errors = [];
      const id = form.dataset.reflectId;
      if (!id) errors.push("The self-explanation has no data-reflect-id.");
      else if (!isContractId(id)) errors.push(`The data-reflect-id "${id}" is not valid.`);
      else if (seen.has(id)) errors.push(`Two self-explanations use the data-reflect-id "${id}".`);
      if (id) seen.add(id);
      if (!form.querySelector(".cl-reflect-prompt")) errors.push("It has no .cl-reflect-prompt.");
      if (form.querySelectorAll("textarea").length !== 1)
        errors.push("It needs exactly 1 textarea.");

      const footer = document.createElement("div");
      footer.className = "cl-quiz-footer";
      const save = document.createElement("button");
      save.type = "submit";
      save.className = "cl-button";
      save.textContent = "Save";
      const status = document.createElement("span");
      status.className = "cl-quiz-status";
      status.dataset.clQuizStatus = "";
      footer.append(save, status);
      form.appendChild(footer);

      if (errors.length > 0) {
        showErrors(form, "This self-explanation has errors.", errors);
        save.disabled = true;
        for (const field of form.querySelectorAll("textarea")) field.disabled = true;
        continue;
      }
      form.addEventListener("submit", (event) => onReflectSubmit(event, form));
      const field = form.querySelector("textarea");
      field.addEventListener("input", () => {
        form.dataset.clDraft = "true";
        scheduleDraft(
          `reflect:${id}`,
          () => (field.value.trim() ? field.value : null),
          draftStatus(
            (text) => setQuizStatus(form, text),
            "Draft saved. Click Save to send it to your teacher.",
          ),
        );
      });
    }
  }

  async function onReflectSubmit(event, form) {
    event.preventDefault();
    const field = form.querySelector("textarea");
    const text = field.value.trim();
    if (!text) {
      setQuizStatus(form, "Write your explanation first.");
      return;
    }
    const save = form.querySelector('button[type="submit"]');
    save.disabled = true;
    await flushDraft(`reflect:${form.dataset.reflectId}`);
    try {
      const response = await fetch("/api/reflect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classroom: config.classroom,
          lesson: config.lesson,
          reflectId: form.dataset.reflectId,
          prompt: textOf(form.querySelector(".cl-reflect-prompt")),
          text,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(body.error);
      }
      const reflection = await response.json();
      delete form.dataset.clDraft;
      setQuizStatus(
        form,
        `Saved ${new Date(reflection.savedAt).toLocaleString()}. Your teacher will read it.`,
      );
    } catch (err) {
      console.error("[classroom] reflection failed", err);
      setQuizStatus(form, `Could not save: ${err.message}`);
    } finally {
      save.disabled = false;
    }
  }

  function applyReflection(reflection) {
    const form = reflectForms().find((f) => f.dataset.reflectId === reflection.reflectId);
    if (!form) {
      console.error(
        `[classroom] A saved self-explanation belongs to "${reflection.reflectId}", which is not on this page.`,
      );
      return;
    }
    // A reconnect loads the state again. It must not replace text the learner has not saved.
    if (form.dataset.clDraft === "true") return;
    form.querySelector("textarea").value = reflection.text;
    setQuizStatus(form, `Saved ${new Date(reflection.savedAt).toLocaleString()}.`);
  }
  function restoreDraft(id, value) {
    const form = reflectForms().find((f) => f.dataset.reflectId === id);
    if (!form) {
      console.error(
        `[classroom] A draft belongs to self-explanation "${id}", which is not on this page.`,
      );
      return;
    }
    form.querySelector("textarea").value = value;
    form.dataset.clDraft = "true";
    setQuizStatus(form, "Draft restored. Click Save to send it to your teacher.");
  }
  return { hydrateReflections, applyReflection, restoreDraft };
}
