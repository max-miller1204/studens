/** The lesson entry point: compose feature modules and dispatch saved state and SSE. */
import { initTeacherActivity } from "./teacher-activity.mjs";
import { draftId, draftKind } from "./draft.mjs";
import { initDiagrams } from "./diagrams.mjs";
import { initLinks } from "./links.mjs";
import { initMath } from "./math.mjs";
import { initTheme } from "./theme.mjs";
import { initSteppers } from "./stepper.mjs";
import { initFaded } from "./faded.mjs";
import { createReviewScreen } from "./review-screen.mjs";
import { createCards } from "./cards.mjs";
import { createDrafts } from "./drafts.mjs";
import { createHighlights } from "./highlights.mjs";
import { createLearnerMarks } from "./learner-marks.mjs";
import { createQuizzes } from "./quiz-ui.mjs";
import { createReflections } from "./reflections.mjs";
import { createGlossary } from "./glossary-ui.mjs";
import { createTeacherPanel } from "./teacher-panel.mjs";

const config = readConfig();
function readConfig() {
  const node = document.getElementById("cl-config");
  if (!node) return null;
  try {
    return JSON.parse(node.textContent);
  } catch (err) {
    console.warn("[classroom] bad runtime config", err);
    return null;
  }
}

// Construct every feature before boot or any state/event callback can run.
const contentRoot = resolveContentRoot();
const drafts = createDrafts(config);
const cards = createCards({ config, contentRoot, drafts });
const learnerMarks = createLearnerMarks({ config, contentRoot });
const highlights = createHighlights({ config, contentRoot, drafts, cards, learnerMarks });
const teacher = createTeacherPanel({ config, contentRoot, drafts });
const quizzes = createQuizzes({ config, drafts, placeTeacherPanel: teacher.placeTeacherPanel });
const reflections = createReflections({ config, drafts });
const glossary = createGlossary({ config, contentRoot });
/** A reconnect must not replace what the learner typed since restoration. */
let draftsRestored = false;
let review = null;

function init() {
  document.body.classList.add("cl-lesson-page");

  buildHeader();
  buildLessonLinks();
  window.addEventListener("hashchange", alignTeachingSource);
  initTeacherActivity(config.classroom);
  // After buildHeader: the toggle it wires up is the button the header just created.
  initTheme();
  initLinks();
  // Before anything indexes the text: this swaps each diagram source for its drawing.
  initDiagrams(contentRoot).catch((err) => console.error("[classroom] diagrams failed", err));
  // Also before the text index: each formula becomes a span.cl-math, which it skips.
  initMath(contentRoot).catch((err) => console.error("[classroom] math failed", err));

  initFaded(contentRoot);
  initSteppers(contentRoot);
  learnerMarks.init();
  highlights.init();
  quizzes.hydrateQuizzes();
  review = createReviewScreen({
    config,
    contentRoot,
    placeTeacherPanel: teacher.placeTeacherPanel,
    flagQuestion: teacher.flagQuestion,
  });
  reflections.hydrateReflections();
  // The glossary waits for the saved highlights: they anchor to the lesson text, and
  // must be restored before terms are wrapped. The question draft waits for the
  // glossary: wrapping a term moves text nodes, which would collapse its range.
  loadState()
    .then(() =>
      glossary.initGlossary().catch((err) => console.error("[classroom] glossary failed", err)),
    )
    .then(highlights.restoreAskDraft)
    .then(alignTeachingSource);
  connectEvents();
  // A reload can come before a draft's timer fires. Send what is waiting first.
  window.addEventListener("pagehide", drafts.sendWaitingDrafts);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") drafts.sendWaitingDrafts();
  });
}

/**
 * Give the lesson the same header the rest of the site has.
 *
 * A lesson on disk is a bare document with no navigation, so the way back to the
 * classroom and the theme toggle are added here rather than being something every
 * lesson has to remember to include.
 */
function buildHeader() {
  if (document.querySelector(".cl-header")) return;

  const header = document.createElement("header");
  header.className = "cl-header";
  header.innerHTML = `
    <nav class="cl-breadcrumb">
      <a class="cl-crumb" href="/">Classrooms</a>
      <span class="cl-crumb-sep" aria-hidden="true">/</span>
      <a class="cl-crumb" href="/c/${encodeURIComponent(config.classroom)}"></a>
      <span class="cl-crumb-sep" aria-hidden="true">/</span>
      <span class="cl-crumb cl-crumb-current"></span>
    </nav>
    <button type="button" class="cl-theme-toggle" data-cl-theme-toggle aria-label="Toggle colour theme">
      <span class="cl-theme-icon cl-theme-icon-light" aria-hidden="true">☀</span>
      <span class="cl-theme-icon cl-theme-icon-dark" aria-hidden="true">☾</span>
    </button>`;

  // textContent, not innerHTML: these titles come from files on disk.
  header.querySelectorAll(".cl-crumb")[1].textContent = config.classroomTitle;
  header.querySelector(".cl-crumb-current").textContent = config.lessonTitle;
  document.body.prepend(header);
}

/** Put an explicitly declared teaching destination below the actual sticky header. */
function alignTeachingSource() {
  let id;
  try {
    id = decodeURIComponent(location.hash.slice(1));
  } catch {
    return;
  }
  document.querySelector("[data-cl-source-notice]")?.remove();
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(id) || /^\.+$/.test(id) || id.startsWith("cl-")) return;
  const target = document.getElementById(id);
  if (!target) {
    const notice = document.createElement("p");
    notice.dataset.clSourceNotice = "";
    notice.className = "cl-search-notice cl-source-notice";
    notice.setAttribute("role", "status");
    notice.textContent = "This section is no longer available. The lesson may have been edited. ";
    const retry = document.createElement("a");
    retry.href = location.pathname + location.search + location.hash;
    retry.textContent = "Retry loading source section";
    retry.addEventListener("click", (event) => {
      event.preventDefault();
      location.reload();
    });
    const start = document.createElement("a");
    start.href = location.pathname;
    start.textContent = "Read lesson from start";
    notice.append(retry, " · ", start);
    if (contentRoot === document.body) document.querySelector(".cl-header")?.after(notice);
    else contentRoot.prepend(notice);
    notice.tabIndex = -1;
    notice.focus();
    return;
  }
  if (!target.matches("section, article")) return;
  const header = document.querySelector(".cl-header");
  target.style.scrollMarginTop = `${(header?.getBoundingClientRect().height ?? 0) + 16}px`;
  target.scrollIntoView({ block: "start" });
  target.tabIndex = -1;
  target.focus({ preventScroll: true });
}

function buildLessonLinks() {
  if (!config.prerequisites?.length && !config.prerequisiteError) return;
  const nav = document.createElement("nav");
  nav.className = "cl-lesson-links";
  nav.setAttribute("aria-label", "Lesson prerequisites");
  if (config.prerequisiteError) {
    const error = document.createElement("p");
    error.setAttribute("role", "alert");
    error.textContent = config.prerequisiteError;
    const retry = document.createElement("a");
    retry.href = location.pathname;
    retry.textContent = "Retry loading lesson links";
    nav.append(error, retry);
  } else {
    const label = document.createElement("p");
    label.textContent = "Builds on";
    const list = document.createElement("ul");
    for (const source of config.prerequisites) {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = source.url;
      link.textContent = source.title;
      item.appendChild(link);
      list.appendChild(item);
    }
    nav.append(label, list);
    const note = document.createElement("p");
    note.className = "cl-progress-note";
    note.textContent = "Prerequisites recorded in your course map.";
    nav.appendChild(note);
  }
  const header = document.querySelector(".cl-header");
  if (header) header.after(nav);
  else document.body.prepend(nav);
}

/**
 * The element whose text can be highlighted.
 *
 * Lessons are model-authored, so we cannot rely on a particular wrapper existing.
 * Prefer an explicit opt-in, then the usual semantic containers, then <body>.
 */
function resolveContentRoot() {
  return (
    document.querySelector("[data-cl-content]") ||
    document.querySelector("main") ||
    document.querySelector("article") ||
    document.body
  );
}

async function loadState() {
  try {
    const url = `/api/state?classroom=${encodeURIComponent(config.classroom)}&lesson=${encodeURIComponent(config.lesson)}`;
    const response = await fetch(url);
    const state = await response.json();
    if (!response.ok) throw new Error(state.error || `Saved state returned ${response.status}.`);

    for (const annotation of state.annotations ?? []) {
      const existing = cards.get(annotation.id);
      const mark = existing ? existing.mark : highlights.restoreAnnotation(annotation);
      // An orphaned annotation (the lesson text changed under it) still gets a card,
      // parked at the end of the lesson rather than silently discarded.
      cards.renderCard(annotation, mark);
      if (!mark && location.hash !== `#cl-question-${annotation.id}`)
        cards.minimiseCard(annotation.id);
    }

    for (const quiz of state.quizzes) quizzes.applyQuizState(quiz);
    review?.restore();
    for (const reflection of state.reflections) reflections.applyReflection(reflection);
    if (state.teacher) {
      teacher.renderTeacher(state.teacher);
      quizzes.updateTeacher(state.teacher);
    }
    teacher.renderReteach(state.reteach ?? []);
    if (!draftsRestored) {
      draftsRestored = true;
      restoreDrafts(state.drafts);
    }
    document.body.dataset.clStateLoaded = "true";
    window.dispatchEvent(new Event("cl:state-loaded"));
  } catch (err) {
    review?.loadFailed(err);
    console.warn("[classroom] could not load lesson state", err);
  }
}

function connectEvents() {
  const url = `/api/events?classroom=${encodeURIComponent(config.classroom)}&lesson=${encodeURIComponent(config.lesson)}`;
  const source = new EventSource(url);

  source.addEventListener("answer", (event) => {
    const annotation = JSON.parse(event.data);
    const existing = cards.get(annotation.id);
    cards.renderCard(annotation, existing?.mark ?? highlights.restoreAnnotation(annotation));
  });

  source.addEventListener("grade", (event) => {
    const payload = JSON.parse(event.data);
    teacher.renderReteach(payload.reteach ?? []);
    quizzes.applyQuizState({
      submission: payload.submission,
      grade: payload.grade,
      history: payload.history,
      attempts: payload.submission.attempt ?? 1,
    });
    review?.refresh();
  });

  source.addEventListener("teacher", (event) => {
    const state = JSON.parse(event.data);
    teacher.renderTeacher(state);
    quizzes.updateTeacher(state);
  });
  source.addEventListener("open", () => {
    if (config.delivery === "service" && !review?.failed) loadState();
  });
  source.addEventListener("reload", () => location.reload());
}

function restoreDrafts(saved) {
  for (const [key, value] of Object.entries(saved)) {
    const id = draftId(key);
    switch (draftKind(key)) {
      case "quiz":
        quizzes.restoreDraft(id, value);
        break;
      case "reflect":
        reflections.restoreDraft(id, value);
        break;
      case "followup":
        cards.restoreDraft(id, value);
        break;
      case "teacher":
        teacher.restoreDraft(value);
        break;
      case "ask":
        highlights.restoreDraft(value);
        break;
    }
  }
}

if (config) init();
