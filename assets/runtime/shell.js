/** Handle shell navigation, theme controls, and classroom review requests. */

import { wireRetirement } from "./review-controls.mjs";
import { initLinks } from "./links.mjs";
import { initTheme } from "./theme.mjs";

initTheme();
initLinks();

const folderControl = document.querySelector("[data-cl-folders]");
if (folderControl) initFolders(folderControl);

const nextControl = document.querySelector("[data-cl-next-lesson]");
if (nextControl) initNextLesson(nextControl);

const reviewControl = document.querySelector("[data-cl-review]");
if (reviewControl) initReview(reviewControl);
for (const row of document.querySelectorAll("[data-review-item]")) {
  wireRetirement({
    button: row.querySelector("[data-review-retire]"),
    status: row.querySelector("[data-review-item-status]"),
    classroom: location.pathname.split("/")[2],
    item: {
      key: row.dataset.reviewItem,
      revision: Number(row.dataset.revision),
      retiredAt: row.dataset.retired === "true" ? 1 : undefined,
    },
    saved: () => location.reload(),
  });
}

function initReview(control) {
  const classroom = control.dataset.clReview;
  const button = control.querySelector("[data-cl-review-start]");
  const status = control.querySelector("[data-cl-review-status]");
  const link = control.querySelector("[data-cl-review-open]");
  const key = `pi-classroom-review:${classroom}`;
  const size = control.querySelector("[data-cl-review-size]");
  const topic = control.querySelector("[data-cl-review-topic]");
  const early = control.querySelector("[data-cl-review-early]");
  const preferencesKey = `${key}:options`;
  let preferenceError = null;
  const preferences = sessionStorage.getItem(preferencesKey);
  if (preferences) {
    try {
      const saved = JSON.parse(preferences);
      if (
        ![...size.options].some((option) => option.value === String(saved.size)) ||
        ![...topic.options].some((option) => option.value === saved.topic) ||
        typeof saved.early !== "boolean"
      )
        throw new Error("The saved size or topic is no longer available.");
      size.value = String(saved.size);
      topic.value = saved.topic;
      early.checked = saved.early;
    } catch (error) {
      preferenceError = `Cannot read saved review options: ${error.message}`;
    }
  }
  for (const field of [size, topic, early])
    field.addEventListener("change", () => {
      sessionStorage.setItem(
        preferencesKey,
        JSON.stringify({ size: Number(size.value), topic: topic.value, early: early.checked }),
      );
      if (action === "start") show(session);
    });
  let session = null;
  let action = "start";
  let busy = false;
  let openWhenReady = false;
  let timer;

  async function request(url, body) {
    const response = await fetch(
      url,
      body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : undefined,
    );
    const result = await response.json();
    if (!response.ok) {
      if (typeof result.error !== "string")
        throw new Error("Review response has no error description.");
      throw new Error(result.error);
    }
    if (!Object.hasOwn(result, "review")) throw new Error("Review response has no review status.");
    return result.review;
  }
  function show(next) {
    session = next;
    for (const field of [size, topic, early])
      field.disabled = next && (next.status !== "done" || next.resumable);
    link.hidden = !next || next.status !== "done" || next.resumable;
    if (!link.hidden) link.href = next.url;
    if (next?.status === "queued" || next?.status === "running") {
      openWhenReady = true;
      button.disabled = true;
      button.textContent = "Creating review…";
      status.textContent = `Your teacher is creating a review of ${next.count} selected items. You can leave this page and return.`;
      timer = setTimeout(check, 1000);
    } else if (next?.status === "failed") {
      action = "retry";
      button.disabled = false;
      button.textContent = "Retry review";
      status.textContent = next.error;
    } else if (next?.status === "done" && next.resumable) {
      action = "open";
      button.disabled = false;
      button.textContent = "Continue review";
      status.textContent = "Your review is ready.";
      if (openWhenReady) {
        openWhenReady = false;
        window.location.assign(next.url);
      }
    } else {
      action = "start";
      button.textContent = "Start review";
      button.disabled = Number(control.dataset.due) === 0 && !early.checked;
      status.textContent = button.disabled
        ? "No questions are due for review."
        : `Review up to ${size.value} ${early.checked ? "selected" : "due"} items with new examples.`;
    }
  }
  function failed(error) {
    clearTimeout(timer);
    action = "check";
    button.disabled = false;
    button.textContent = "Check review status";
    status.textContent = error.message;
  }
  async function check() {
    clearTimeout(timer);
    if (preferenceError) {
      action = "reset";
      button.disabled = false;
      button.textContent = "Reset review options";
      status.textContent = preferenceError;
      return;
    }
    try {
      show(await request(`/api/review?classroom=${encodeURIComponent(classroom)}`));
    } catch (error) {
      failed(error);
    }
  }
  button.addEventListener("click", async () => {
    if (busy) return;
    if (action === "reset") {
      sessionStorage.removeItem(preferencesKey);
      return location.reload();
    }
    if (action === "open") return window.location.assign(session.url);
    busy = true;
    button.disabled = true;
    try {
      if (action === "check") {
        const next = await request(`/api/review?classroom=${encodeURIComponent(classroom)}`);
        // Reuse the same browser request if its response was lost before it was saved.
        show(next);
      } else {
        let id;
        if (action === "retry") id = session.id;
        else {
          id = sessionStorage.getItem(key) || crypto.randomUUID();
          sessionStorage.setItem(key, id);
        }
        const next = await request(action === "retry" ? "/api/review/retry" : "/api/review", {
          classroom,
          id,
          size: Number(size.value),
          topic: topic.value || undefined,
          early: early.checked,
        });
        sessionStorage.removeItem(key);
        openWhenReady = true;
        show(next);
      }
    } catch (error) {
      failed(error);
    } finally {
      busy = false;
    }
  });
  window.addEventListener("pagehide", () => {
    clearTimeout(timer);
    openWhenReady = false;
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) check();
  });
  check();
}

function initFolders(control) {
  const dialog = control.querySelector("dialog");
  const form = dialog.querySelector("form");
  const title = dialog.querySelector("h2");
  const description = dialog.querySelector("[data-cl-folder-description]");
  const nameLabel = dialog.querySelector("[data-cl-folder-name-label]");
  const selectLabel = dialog.querySelector("[data-cl-folder-select-label]");
  const name = form.elements.name;
  const folder = form.elements.folder;
  const error = dialog.querySelector("[data-cl-folder-error]");
  const save = dialog.querySelector("[data-cl-folder-save]");
  const cancel = dialog.querySelector("[data-cl-folder-cancel]");
  let command;
  let busy = false;

  function open(action, classroom) {
    command = { action, id: control.dataset.folderId || null };
    error.hidden = true;
    error.textContent = "";
    nameLabel.hidden = action !== "create" && action !== "rename";
    name.disabled = nameLabel.hidden;
    selectLabel.hidden = action !== "move";
    folder.disabled = selectLabel.hidden;
    save.classList.toggle("cl-button-danger", action === "delete");
    description.textContent = "";
    if (action === "create") {
      title.textContent = "New folder";
      name.value = "";
      save.textContent = "Create folder";
    } else if (action === "rename") {
      title.textContent = "Rename folder";
      name.value = control.querySelector(".cl-hero h1").textContent;
      save.textContent = "Save name";
    } else if (action === "delete") {
      title.textContent = "Delete folder?";
      description.textContent =
        "Classrooms in this folder will return to Unfiled. Your classrooms and lessons will stay saved.";
      save.textContent = "Delete folder";
    } else if (action === "move") {
      command.classroom = classroom.dataset.clMove;
      title.textContent = `Move ${classroom.dataset.classroomTitle}`;
      folder.value = control.dataset.folderId;
      save.textContent = "Move classroom";
    }
    dialog.showModal();
    if (!name.disabled) {
      name.focus();
      name.select();
    }
  }
  control.querySelector("[data-cl-folder-create]")?.addEventListener("click", () => open("create"));
  control.querySelector("[data-cl-folder-rename]")?.addEventListener("click", () => open("rename"));
  control.querySelector("[data-cl-folder-delete]")?.addEventListener("click", () => open("delete"));
  control.querySelectorAll("[data-cl-move]").forEach((button) => {
    button.addEventListener("click", () => open("move", button));
  });
  cancel.addEventListener("click", () => dialog.close());
  dialog.addEventListener("cancel", (event) => {
    if (busy) event.preventDefault();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    save.disabled = true;
    cancel.disabled = true;
    name.disabled = true;
    folder.disabled = true;
    error.hidden = true;
    const body = { ...command };
    if (command.action === "create" || command.action === "rename") body.name = name.value;
    if (command.action === "move") body.id = folder.value || null;
    try {
      const response = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) {
        if (typeof result.error !== "string")
          throw new Error("Folder response has no error description.");
        throw new Error(result.error);
      }
      if (!Array.isArray(result.folders)) throw new Error("Folder response has no folder list.");
      if (command.action === "delete") window.location.assign("/");
      else window.location.reload();
    } catch (failure) {
      error.textContent = failure.message;
      error.hidden = false;
      save.disabled = false;
      cancel.disabled = false;
      name.disabled = nameLabel.hidden;
      folder.disabled = selectLabel.hidden;
      busy = false;
    }
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) window.location.reload();
  });
}

function initNextLesson(control) {
  const classroom = control.dataset.clNextLesson;
  const button = control.querySelector("[data-cl-next-start]");
  const topic = control.querySelector("textarea");
  const status = control.querySelector("[data-cl-next-status]");
  const link = control.querySelector("[data-cl-next-open]");
  const key = `studens-next-lesson:${classroom}`;
  let current = null,
    busy = false,
    action = "start",
    timer;
  async function request(route, body) {
    const response = await fetch(
      `/api/${route}`,
      body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : undefined,
    );
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        typeof data.error === "string"
          ? data.error
          : "Next lesson response has no error description.",
      );
    if (!Object.hasOwn(data, "lesson"))
      throw new Error("Next lesson response has no lesson status.");
    return data.lesson;
  }
  function show(next) {
    current = next;
    clearTimeout(timer);
    const pending = next && ["queued", "running"].includes(next.status);
    topic.disabled = Boolean(next && next.status !== "done");
    button.disabled = Boolean(pending);
    link.hidden = next?.status !== "done";
    if (next?.status === "done") {
      link.href = next.url;
      action = "start";
      button.textContent = "Next lesson";
      status.textContent = "Your lesson is ready.";
      if (sessionStorage.getItem(key) === next.id) {
        sessionStorage.removeItem(key);
        window.location.assign(next.url);
      }
    } else if (pending) {
      topic.value = next.topic;
      button.textContent = next.status === "queued" ? "Lesson queued…" : "Creating lesson…";
      status.textContent =
        next.status === "queued"
          ? "Your lesson request is queued. You can leave and return."
          : "Your teacher is creating and checking your lesson. You can leave and return.";
      timer = setTimeout(check, 1000);
    } else if (next?.status === "failed") {
      topic.value = next.topic;
      action = "retry";
      button.textContent = "Retry lesson";
      status.textContent = next.error;
    } else {
      action = "start";
      button.textContent = "Next lesson";
      status.textContent =
        "Your teacher will choose the next objective if you leave the topic blank.";
    }
  }
  function fail(error) {
    clearTimeout(timer);
    action = "check";
    button.disabled = false;
    button.textContent = "Check lesson status";
    status.textContent = error.message;
  }
  async function check() {
    try {
      show(await request(`lesson?classroom=${encodeURIComponent(classroom)}`));
    } catch (error) {
      fail(error);
    }
  }
  button.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    try {
      if (action === "check") {
        await check();
        return;
      }
      const id =
        action === "retry" ? current.id : sessionStorage.getItem(key) || crypto.randomUUID();
      sessionStorage.setItem(key, id);
      show(
        await request(action === "retry" ? "lesson/retry" : "lesson", {
          classroom,
          id,
          topic: topic.value,
        }),
      );
    } catch (error) {
      fail(error);
    } finally {
      busy = false;
    }
  });
  window.addEventListener("pagehide", () => clearTimeout(timer));
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) check();
  });
  check();
}
