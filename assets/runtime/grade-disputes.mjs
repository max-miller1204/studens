/** Learner disputes remain beside the locked answer; snapshots never enter the browser. */
import { escapeText, cssEscape } from "./lesson-dom.mjs";
import { questionGradeLabel } from "./grade.mjs";

export function createGradeDisputes(config) {
  let saved = [];
  const states = new Map();
  function disputeFragment() {
    try {
      const id = decodeURIComponent(location.hash.slice(1));
      return id.startsWith("cl-dispute-") ? id : null;
    } catch {
      return null;
    }
  }
  let pendingFragment = disputeFragment();
  function revealFragment() {
    if (!pendingFragment) return;
    const target = document.getElementById(pendingFragment);
    if (!target?.classList.contains("cl-dispute")) return;
    // The browser could not scroll before the saved history arrived. Consume
    // this navigation once; normal state refreshes must leave the reader alone.
    pendingFragment = null;
    const disclosure = target.closest("details");
    if (disclosure) disclosure.open = true;
    target.scrollIntoView({ block: "center" });
  }
  window.addEventListener("hashchange", () => {
    pendingFragment = disputeFragment();
    revealFragment();
  });
  function updateTeacher(teacher) {
    saved = teacher?.disputes ?? [];
    for (const [form, state] of states) render(form, state);
  }
  async function post(route, body) {
    const response = await fetch(`/api/${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classroom: config.classroom, lesson: config.lesson, ...body }),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || `Request failed (${response.status}).`);
    return value;
  }
  function render(form, state) {
    states.set(form, state);
    const { submission, grade } = state;
    if (!grade || config.delivery !== "service") return;
    for (const q of grade.questions) {
      const verdict = form.querySelector(
        `.cl-q[data-question-id="${cssEscape(q.questionId)}"] .cl-q-verdict`,
      );
      if (!verdict) continue;
      let section = verdict.querySelector(".cl-disputes");
      if (!section) {
        section = document.createElement("section");
        section.className = "cl-disputes";
        section.setAttribute("aria-label", "Grade dispute");
        verdict.append(section);
      }
      let history = section.querySelector(".cl-dispute-history");
      if (!history) {
        history = document.createElement("details");
        const toggle = document.createElement("summary");
        toggle.textContent = "Dispute history";
        history.append(toggle);
        history.className = "cl-dispute-history";
        history.setAttribute("aria-live", "polite");
        section.append(history);
      }
      const linked = saved.filter(
        (d) => d.submissionId === submission.id && d.questionId === q.questionId,
      );
      const historyToggle = history.querySelector("summary");
      history.replaceChildren(historyToggle);
      history.hidden = linked.length === 0;
      for (const d of linked) {
        const item = document.createElement("div");
        item.className = "cl-dispute";
        item.dataset.disputeId = d.id;
        item.id = `cl-dispute-${d.id}`;
        const title = document.createElement("p");
        const labels = {
          accepted: "Credit revised",
          declined: "Grade unchanged",
          "authoring-defect": "Question flagged · grade unchanged",
        };
        title.textContent = `${labels[d.decision] || (d.status === "failed" ? "Dispute failed" : "Teacher reviewing dispute")} · Grade from ${new Date(d.gradedAt).toLocaleString()}`;
        const reason = document.createElement("p");
        reason.textContent = `Your reasoning: ${d.reason}`;
        item.append(title, reason);
        if (d.response) {
          const response = document.createElement("p");
          response.className = "cl-dispute-response";
          response.textContent = d.response;
          item.append(response);
        }
        if (d.error) {
          const error = document.createElement("p");
          error.setAttribute("role", "alert");
          error.textContent = d.error;
          item.append(error);
        }
        history.append(item);
      }
      const already = linked.some((d) => d.gradedAt === grade.gradedAt);
      let composer = section.querySelector("details.cl-dispute-compose");
      if (already) {
        composer?.remove();
        continue;
      }
      if (composer) continue;
      composer = document.createElement("details");
      composer.className = "cl-dispute-compose";
      const toggle = document.createElement("summary");
      toggle.textContent = "I think this deserves credit";
      const label = document.createElement("label");
      label.textContent = "Why does your original answer deserve credit?";
      const field = document.createElement("textarea");
      field.maxLength = 8000;
      field.rows = 3;
      label.append(field);
      const hint = document.createElement("p");
      hint.textContent =
        "Your submitted answer stays locked. Explain how it meets the question's criteria.";
      const send = document.createElement("button");
      send.type = "button";
      send.className = "cl-button";
      send.textContent = "Send grade dispute";
      const error = document.createElement("p");
      error.setAttribute("role", "alert");
      const id = crypto.randomUUID();
      const submit = async () => {
        if (send.disabled) return;
        if (!field.value.trim()) {
          error.textContent = "Explain why your original answer deserves credit.";
          field.focus();
          return;
        }
        send.disabled = true;
        field.disabled = true;
        error.textContent = "";
        try {
          await post("quiz/dispute", {
            id,
            quizId: submission.quizId,
            submissionId: submission.id,
            questionId: q.questionId,
            gradedAt: grade.gradedAt,
            reason: field.value.trim(),
          });
          // Refresh only dispute state; reconnects must not overwrite other unsent reasons.
          const response = await fetch(
            `/api/state?classroom=${encodeURIComponent(config.classroom)}&lesson=${encodeURIComponent(config.lesson)}`,
          );
          const next = await response.json();
          if (!response.ok) throw new Error(next.error || "Could not read the saved dispute.");
          updateTeacher(next.teacher);
        } catch (err) {
          error.textContent = err.message;
          send.disabled = false;
          field.disabled = false;
        }
      };
      send.addEventListener("click", submit);
      field.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          submit();
        }
      });
      composer.append(toggle, hint, label, send, error);
      section.append(composer);
    }
    revealFragment();
  }
  function history(form, grades = []) {
    form.querySelector(".cl-grade-history")?.remove();
    if (!grades.length) return;
    const details = document.createElement("details");
    details.className = "cl-grade-history";
    const summary = document.createElement("summary");
    summary.textContent = `Grade history (${grades.length})`;
    details.append(summary);
    for (const [i, grade] of grades.entries()) {
      const entry = document.createElement("section");
      const title = document.createElement("h3");
      title.textContent = `${i === 0 ? "Original grade" : "Regrade"} · ${Math.round(grade.score)}% · ${new Date(grade.gradedAt).toLocaleString()}`;
      entry.append(title);
      const feedback = document.createElement("div");
      feedback.innerHTML = grade.feedbackHtml || escapeText(grade.feedbackMarkdown);
      entry.append(feedback);
      for (const q of grade.questions) {
        const item = document.createElement("div");
        item.innerHTML = `<p><strong>${escapeText(q.questionId)} · ${escapeText(questionGradeLabel(q))}</strong></p><div>${q.feedbackHtml || escapeText(q.feedback)}</div>`;
        for (const c of q.criteria ?? []) {
          const criterion = document.createElement("p");
          criterion.textContent = `${c.description}: ${c.pointsEarned}/${c.pointsPossible} points. ${c.feedback}`;
          item.append(criterion);
        }
        entry.append(item);
      }
      details.append(entry);
    }
    form.querySelector("[data-cl-grade]")?.append(details);
  }
  return { render, history, updateTeacher };
}
