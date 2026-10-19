/** Lesson teacher conversation, request progress, explicit retries, and reply drafts. */
import { quizForms } from "./quiz-ui.mjs";
import { draftStatus } from "./drafts.mjs";

export function createTeacherPanel({ config, contentRoot, drafts }) {
  const { scheduleDraft, flushDraft } = drafts;
  /**
   * The conversation with the teacher about this lesson. Quiz feedback, the follow-up
   * question for a missed idea, and the learner's replies all happen here, so the
   * learner never has to go back to the terminal to keep learning.
   *
   * It sits right after the quiz the learner last handed in, because that is where they
   * are looking when the teacher answers. Before any quiz, it sits at the end.
   */
  let teacherPanel = null;
  let teacherReplyId = null;
  /** Teacher messages already shown. Null until the first render. */
  let teacherSeen = null;
  let teacherNotice = null;
  let reteachItems = [];
  let reteachScrolled = false;
  const reteachRequested = new Set();
  const reteachSaved = new Set();

  /** What the panel says while a request runs. Cards show their own progress. */
  const TEACHER_WORKING = {
    resume: "Your teacher is resuming this check.",
    quiz: "Your teacher is grading your quiz…",
    reflect: "Your teacher is reading your explanation…",
    chat: "Your teacher is replying…",
  };

  function renderTeacher(state) {
    if (!state) return;
    const firstRender = !teacherPanel;
    if (firstRender) buildTeacherPanel();
    placeTeacherPanel();
    teacherPanel.querySelector(".cl-teacher-identity").textContent =
      state.identity.backend === "pi"
        ? "Your teacher is the Pi session that opened this classroom."
        : `${state.identity.backend} teacher. Session: ${state.identity.sessionId || "Starts with your first request"}.`;

    for (const request of state.requests) reteachRequested.add(request.id);
    for (const message of state.messages) {
      if (message.role === "teacher") reteachRequested.add(message.id);
      else reteachSaved.add(message.id);
    }
    renderReteach(state.reteach ?? reteachItems);
    const messages = teacherPanel.querySelector(".cl-teacher-messages");
    messages.replaceChildren();
    for (const message of state.messages) {
      const item = document.createElement("div");
      item.className = "cl-teacher-message";
      item.dataset.role = message.role;
      const who = document.createElement("span");
      who.className = "cl-teacher-who";
      who.textContent =
        message.role === "teacher"
          ? message.sourceBackend === "pi"
            ? "Teacher (Pi history)"
            : "Teacher"
          : "You";
      const body = document.createElement("div");
      body.className = "cl-teacher-body";
      // innerHTML is safe here: teacher markdown was rendered server-side. The
      // learner's own text is set as text.
      if (message.role === "teacher" && message.html) body.innerHTML = message.html;
      else body.textContent = message.text;
      item.append(who, body);
      messages.appendChild(item);
    }

    const requests = teacherPanel.querySelector(".cl-teacher-requests");
    requests.replaceChildren();
    for (const request of state.requests.filter((r) => r.status !== "done")) {
      if (request.status !== "failed" && !TEACHER_WORKING[request.kind]) continue;
      const item = document.createElement("p");
      item.className = "cl-teacher-request";
      if (request.status !== "failed") {
        item.innerHTML = '<span class="cl-spinner"></span> ';
        item.append(TEACHER_WORKING[request.kind]);
        requests.appendChild(item);
        continue;
      }
      item.textContent = `Teacher failed: ${request.error}`;
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "cl-button";
      retry.textContent = "Retry request";
      retry.onclick = async () => {
        retry.disabled = true;
        try {
          await teacherPost("retry", { id: request.id });
        } catch (err) {
          teacherPanel.querySelector(".cl-teacher-error").textContent = err.message;
          retry.disabled = false;
        }
      };
      item.appendChild(retry);
      requests.appendChild(item);
    }

    const teacherCount = state.messages.filter((m) => m.role === "teacher").length;
    if (teacherSeen !== null && teacherCount > teacherSeen && !onScreen(teacherPanel)) {
      showTeacherNotice();
    }
    teacherSeen = teacherCount;
    if (firstRender && window.location.hash === "#cl-teacher")
      teacherPanel.scrollIntoView({ block: "start" });
  }

  function buildTeacherPanel() {
    teacherPanel = document.createElement("section");
    teacherPanel.className = "cl-teacher";
    teacherPanel.id = "cl-teacher";
    teacherPanel.setAttribute("aria-label", "Your teacher");
    teacherPanel.innerHTML = `
    <h2>Your teacher</h2>
    <p class="cl-teacher-identity"></p>
    <p class="cl-teacher-hint">Feedback and follow-up questions appear here. Answer them here too.</p>
    <div id="cl-reteach" hidden></div>
    <div class="cl-teacher-messages" aria-live="polite"></div>
    <div class="cl-teacher-requests" aria-live="polite"></div>
    <form>
      <label>Reply to your teacher<textarea required maxlength="8000"></textarea></label>
      <div class="cl-card-form-actions">
        <span class="cl-hint">⌘/Ctrl + Enter to send</span>
        <button class="cl-button" type="submit">Send reply</button>
      </div>
      <p class="cl-teacher-error" role="alert"></p>
    </form>`;
    const form = teacherPanel.querySelector("form");
    const field = teacherPanel.querySelector("textarea");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      teacherReplyId ??= crypto.randomUUID();
      button.disabled = true;
      await flushDraft("teacher");
      try {
        await teacherPost("chat", { text: field.value, id: teacherReplyId });
        field.value = "";
        teacherReplyId = null;
        teacherPanel.querySelector(".cl-teacher-error").textContent = "";
      } catch (err) {
        teacherPanel.querySelector(".cl-teacher-error").textContent = err.message;
      } finally {
        button.disabled = false;
      }
    });
    field.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        form.requestSubmit();
      }
    });
    field.addEventListener("input", () => {
      teacherReplyId = null;
      scheduleDraft(
        "teacher",
        () => (field.value.trim() ? field.value : null),
        draftStatus((text) => {
          teacherPanel.querySelector(".cl-teacher-error").textContent = text;
        }, ""),
      );
    });
  }

  function renderReteach(items) {
    reteachItems = items;
    if (!items.length && !teacherPanel) return;
    if (!teacherPanel) {
      buildTeacherPanel();
      placeTeacherPanel();
    }
    const region = teacherPanel.querySelector("#cl-reteach");
    region.hidden = items.length === 0;
    region.replaceChildren();
    if (!items.length) return;
    const heading = document.createElement("h3");
    heading.textContent = "Try a short re-teach";
    const hint = document.createElement("p");
    hint.textContent =
      "These ideas are paused from review after repeated misses. Your teacher can explain them another way. Your original grades and history stay saved.";
    region.append(heading, hint);
    for (const item of items) {
      const row = document.createElement("div");
      const prompt = document.createElement("p");
      prompt.textContent = `${item.prompt} (${item.misses} misses)`;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cl-button";
      button.textContent = reteachRequested.has(item.id)
        ? "Re-teach requested"
        : reteachSaved.has(item.id)
          ? "Retry short re-teach"
          : "Start short re-teach";
      button.disabled = reteachRequested.has(item.id);
      const error = document.createElement("p");
      error.setAttribute("role", "alert");
      if (reteachSaved.has(item.id) && !reteachRequested.has(item.id))
        error.textContent = "Re-teaching was interrupted before it was queued. Retry to continue.";
      button.onclick = async () => {
        button.disabled = true;
        error.textContent = "";
        try {
          const result = await teacherPost("reteach", { key: item.key });
          reteachRequested.add(result.id);
          renderReteach(reteachItems);
        } catch (err) {
          error.textContent = err.message;
          button.disabled = false;
        }
      };
      row.append(prompt, button, error);
      region.append(row);
    }
    if (!reteachScrolled && window.location.hash === "#cl-reteach") {
      region.scrollIntoView({ block: "start" });
      reteachScrolled = true;
    }
  }

  /** Put the panel after the quiz handed in last, or at the end of the lesson. */
  function placeTeacherPanel() {
    if (!teacherPanel) return;
    const latest = quizForms()
      .filter((form) => form.dataset.submittedAt)
      .sort((a, b) => Number(b.dataset.submittedAt) - Number(a.dataset.submittedAt))[0];
    if (latest) {
      if (latest.nextElementSibling !== teacherPanel) latest.after(teacherPanel);
    } else if (!teacherPanel.isConnected) {
      contentRoot.appendChild(teacherPanel);
    }
    updateTeacherNotice();
  }

  function onScreen(element) {
    const rect = element.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight;
  }

  function updateTeacherNotice() {
    if (!teacherNotice || teacherNotice.hidden) return;
    const above = teacherPanel.getBoundingClientRect().bottom <= 0;
    teacherNotice.textContent = `Your teacher replied ${above ? "↑" : "↓"}`;
  }

  /** A teacher reply arrived out of view. Say so, without moving the page. */
  function showTeacherNotice() {
    if (!teacherNotice) {
      teacherNotice = document.createElement("button");
      teacherNotice.type = "button";
      teacherNotice.className = "cl-teacher-notice";
      teacherNotice.addEventListener("click", () => {
        teacherNotice.hidden = true;
        teacherPanel.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      document.body.appendChild(teacherNotice);
      new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) teacherNotice.hidden = true;
      }).observe(teacherPanel);
      window.addEventListener("scroll", updateTeacherNotice, { passive: true });
      window.addEventListener("resize", updateTeacherNotice);
    }
    teacherNotice.hidden = false;
    updateTeacherNotice();
  }

  async function teacherPost(action, body) {
    const response = await fetch(`/api/teacher/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classroom: config.classroom, lesson: config.lesson, ...body }),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || `Teacher request returned ${response.status}`);
    return result;
  }
  function restoreDraft(value) {
    if (!teacherPanel)
      console.error(
        "[classroom] A teacher reply draft exists, but this page has no teacher panel.",
      );
    else teacherPanel.querySelector("textarea").value = value;
  }
  return { renderTeacher, renderReteach, placeTeacherPanel, restoreDraft };
}
