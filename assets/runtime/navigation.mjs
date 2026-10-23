/** Shared chrome for server-built pages and saved lesson documents. */
import { icon } from "./icons.mjs";
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const link = (url, label, symbol, extra = "") =>
  `<a href="${escape(url)}" class="cl-nav-link" title="${escape(label)}">${icon(symbol)}<span class="cl-nav-label">${escape(label)}</span>${extra}</a>`;

export function navigationChrome(breadcrumb) {
  return `<a class="cl-skip" href="#cl-page-content">Skip to content</a>
<header class="cl-header cl-app-header">
<button type="button" class="cl-icon-button" data-cl-nav-toggle aria-label="Open navigation" aria-controls="cl-sidebar" aria-expanded="false">${icon("library")}</button>
<a class="cl-brand" href="/" aria-label="Studens">${icon("book-open")}<span>Studens</span></a>
<nav class="cl-breadcrumb" aria-label="Breadcrumb">${breadcrumb}</nav>
<a class="cl-header-search cl-icon-button" href="/search" aria-label="Search classrooms">${icon("search")}</a>
<button type="button" class="cl-theme-toggle" data-cl-theme-toggle aria-label="Toggle colour theme"><span class="cl-theme-icon cl-theme-icon-light" aria-hidden="true">${icon("sun")}</span><span class="cl-theme-icon cl-theme-icon-dark" aria-hidden="true">${icon("moon")}</span></button>
</header>
<div class="cl-nav-backdrop" data-cl-nav-backdrop hidden></div>
<aside class="cl-sidebar" id="cl-sidebar" aria-label="App navigation">
<button type="button" class="cl-icon-button cl-drawer-close" data-cl-nav-close aria-label="Close navigation">${icon("x")}</button>
<nav aria-label="Main navigation">
${link("/", "Today", "book-open", '<span class="cl-nav-due" data-cl-total-due hidden></span>')}
${link("/reviews/daily", "Review", "rotate-ccw")}
${link("/search", "Search", "search")}
<div data-cl-nav-data><p class="cl-nav-label cl-nav-status" role="status">Loading navigation…</p></div>
</nav>
<footer class="cl-sidebar-footer">
<a class="cl-nav-link" data-cl-nav-settings hidden title="Settings">${icon("settings")}<span class="cl-nav-label">Settings</span></a>
<label class="cl-nav-accent"><span class="cl-nav-label">Accent</span><select data-cl-accent-choice aria-label="Sidebar accent"><option value="indigo">Indigo</option><option value="copper">Copper</option><option value="green">Green</option><option value="neutral">Neutral</option></select></label>
</footer>
</aside>`;
}

export function initNavigation(config = null, contentRoot = null) {
  const lesson = Boolean(config?.lesson);
  if (!document.querySelector(".cl-app-header")) {
    document.body.insertAdjacentHTML(
      "afterbegin",
      navigationChrome(
        `<a class="cl-crumb" href="/c/${encodeURIComponent(config.classroom)}">${escape(config.classroomTitle)}</a><span aria-hidden="true">/</span><span class="cl-crumb cl-crumb-current">${escape(config.lessonTitle)}</span>`,
      ),
    );
  }
  document.body.classList.add("cl-app");
  const main = document.querySelector("main");
  if (main) {
    main.id ||= "cl-page-content";
    main.tabIndex = -1;
  }
  document.querySelector(".cl-skip").hidden = !main;
  document.querySelector(".cl-skip").href = `#${main?.id || "cl-page-content"}`;
  const sidebar = document.querySelector(".cl-sidebar");
  const toggle = document.querySelector("[data-cl-nav-toggle]");
  const backdrop = document.querySelector("[data-cl-nav-backdrop]");
  const close = document.querySelector("[data-cl-nav-close]");
  const mobile = matchMedia("(max-width: 760px)");
  const storageKey = "studens-lesson-navigation";
  let expanded = false,
    drawer = false;
  function report(error, retry) {
    let box = document.querySelector("[data-cl-navigation-error]");
    if (!box) {
      box = document.createElement("div");
      box.dataset.clNavigationError = "";
      box.className = "cl-nav-error";
      box.setAttribute("role", "alert");
      document.querySelector(".cl-header").append(box);
    }
    const message = document.createElement("span");
    message.textContent = `Navigation failed: ${error.message}`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cl-button cl-button-quiet";
    button.textContent = "Retry navigation";
    button.addEventListener("click", () => {
      box.remove();
      retry();
    });
    box.replaceChildren(message, button);
  }
  function readPreference() {
    try {
      const value = localStorage.getItem(storageKey);
      if (value !== null && !["expanded", "collapsed"].includes(value))
        throw Error("Invalid saved lesson navigation preference.");
      expanded = value === "expanded";
      render();
    } catch (error) {
      report(error, readPreference);
    }
  }
  function render() {
    document.body.classList.toggle("cl-nav-rail", lesson && !expanded);
    document.body.classList.toggle("cl-nav-open", drawer);
    sidebar.inert = mobile.matches && !drawer;
    if (drawer) sidebar.setAttribute("aria-modal", "true");
    else sidebar.removeAttribute("aria-modal");
    if (drawer) sidebar.setAttribute("role", "dialog");
    else sidebar.removeAttribute("role");
    backdrop.hidden = !drawer;
    toggle.setAttribute("aria-expanded", String(mobile.matches ? drawer : !lesson || expanded));
    toggle.setAttribute(
      "aria-label",
      mobile.matches
        ? "Open navigation"
        : expanded || !lesson
          ? "Collapse navigation"
          : "Expand navigation",
    );
    // Non-lesson pages always keep the full desktop sidebar.
    toggle.hidden = !mobile.matches && !lesson;
  }
  function setDrawer(open) {
    drawer = open;
    render();
    for (const element of document.body.children) {
      if (
        [sidebar, backdrop].includes(element) ||
        ["SCRIPT", "LINK", "STYLE"].includes(element.tagName)
      )
        continue;
      if (open) {
        if (!element.inert) {
          element.dataset.clNavInert = "";
          element.inert = true;
        }
      } else if (element.hasAttribute("data-cl-nav-inert")) {
        element.inert = false;
        element.removeAttribute("data-cl-nav-inert");
      }
    }
    if (open) {
      getComputedStyle(sidebar).visibility;
      close.focus();
    } else if (mobile.matches || lesson) toggle.focus();
    else main?.focus();
  }
  toggle.addEventListener("click", () => {
    if (mobile.matches) return setDrawer(!drawer);
    try {
      localStorage.setItem(storageKey, expanded ? "collapsed" : "expanded");
      expanded = !expanded;
      render();
    } catch (error) {
      report(error, readPreference);
    }
  });
  close.addEventListener("click", () => setDrawer(false));
  backdrop.addEventListener("click", () => setDrawer(false));
  sidebar.addEventListener("keydown", (event) => {
    if (!drawer) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setDrawer(false);
    }
    if (event.key === "Tab") {
      const items = [...sidebar.querySelectorAll("a[href],button,select")].filter(
        (el) => !el.hidden && el.getClientRects().length && !el.disabled,
      );
      const first = items[0],
        last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  mobile.addEventListener("change", () => {
    if (drawer) setDrawer(false);
    render();
  });
  readPreference();
  render();
  const data = document.querySelector("[data-cl-nav-data]");
  function current() {
    for (const a of sidebar.querySelectorAll("a[href]")) {
      const url = new URL(a.href);
      const active = url.pathname === location.pathname && url.search === location.search;
      const parent =
        (url.pathname.startsWith("/c/") && location.pathname.startsWith(url.pathname + "/")) ||
        (url.pathname === "/reviews/daily" && location.pathname.startsWith("/reviews/daily/")) ||
        (url.pathname === "/search" && location.pathname === "/search");
      if (active || parent) a.setAttribute("aria-current", active ? "page" : "location");
      else a.removeAttribute("aria-current");
      a.classList.toggle(
        "cl-nav-classroom-active",
        lesson && url.pathname === `/c/${encodeURIComponent(config.classroom)}`,
      );
    }
    document.body.classList.toggle(
      "cl-nav-location-shown",
      Boolean(sidebar.querySelector('[aria-current="page"]')) || location.pathname === "/search",
    );
  }
  async function load() {
    const restoreFocus = data.contains(document.activeElement);
    try {
      const response = await fetch("/api/navigation");
      const result = await response.json();
      if (!response.ok)
        throw Error(
          typeof result.error === "string"
            ? result.error
            : "Navigation response has no error description.",
        );
      if (
        !Array.isArray(result.classrooms) ||
        !Array.isArray(result.folders) ||
        !Array.isArray(result.lessons) ||
        !Number.isSafeInteger(result.due)
      )
        throw Error("Navigation response has no valid public navigation data.");
      data.innerHTML = `<h2 class="cl-nav-label">Classrooms</h2>${result.classrooms.map((c) => link(`/c/${encodeURIComponent(c.name)}`, c.title, "library", `<span class="cl-nav-due" ${c.due ? "" : "hidden"}>${c.due}<span class="cl-sr-only"> due</span></span>`)).join("")}<h2 class="cl-nav-label">Folders</h2>${result.folders.map((f) => link(`/?folder=${encodeURIComponent(f.id)}`, f.name, "folder")).join("")}`;
      const badge = document.querySelector("[data-cl-total-due]");
      badge.hidden = !result.due;
      badge.textContent = `${result.due} due`;
      const classroom =
        config?.classroom ||
        location.pathname.match(/^\/(?:c|doc|r)\/([^/]+)/)?.[1] ||
        result.classrooms[0]?.name;
      const settings = document.querySelector("[data-cl-nav-settings]");
      settings.hidden = !classroom;
      if (classroom) settings.href = `/c/${encodeURIComponent(classroom)}/settings`;
      current();
      if (restoreFocus) sidebar.querySelector("a").focus();
      remember(result.lessons);
    } catch (error) {
      data.replaceChildren();
      const message = document.createElement("p");
      message.className = "cl-nav-status";
      message.setAttribute("role", "alert");
      message.textContent = error.message;
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "cl-button cl-button-quiet";
      retry.textContent = "Retry loading navigation";
      retry.addEventListener("click", load);
      data.append(message, retry);
      if (restoreFocus) retry.focus();
    }
  }
  function remember(lessons) {
    const key = "studens-recent-lessons";
    function read() {
      const history = JSON.parse(localStorage.getItem(key) || "[]");
      if (
        !Array.isArray(history) ||
        history.some((h) => !h || typeof h.url !== "string" || typeof h.point !== "string")
      )
        throw Error("Invalid saved reading history.");
      return history;
    }
    try {
      if (lesson && !config.reviewScreen) {
        const url = `/c/${encodeURIComponent(config.classroom)}/${encodeURIComponent(config.lesson)}`;
        const save = () => {
          const points = [...(contentRoot?.querySelectorAll("[id]") ?? [])].filter(
            (el) =>
              el.getClientRects().length &&
              /^[A-Za-z][\w.-]*$/.test(el.id) &&
              (/^cl-search-[a-f0-9]{24}-[0-9]+$/.test(el.id) ||
                (!el.id.startsWith("cl-") && el.matches("h1,h2,h3,section,p"))),
          );
          let target = points[0];
          for (const candidate of points) {
            if (candidate.getBoundingClientRect().top <= 160) target = candidate;
          }
          // A generated passage inside an authored anchor should retain that public anchor.
          const parent = target?.classList.contains("cl-search-anchor")
            ? target.parentElement
            : null;
          const point = parent?.id && !parent.id.startsWith("cl-") ? parent.id : target?.id || "";
          localStorage.setItem(
            key,
            JSON.stringify([{ url, point }, ...read().filter((h) => h.url !== url)].slice(0, 50)),
          );
        };
        save();
        window.addEventListener("pagehide", () => {
          try {
            save();
          } catch (error) {
            report(error, () => remember(lessons));
          }
        });
      }
      const upNext = document.querySelector("[data-cl-up-next]");
      if (upNext) {
        const rows = [...document.querySelectorAll("[data-cl-lesson-url]")];
        const history = read();
        for (const row of rows) {
          if (row.dataset.complete === "true") continue;
          if (history.some((h) => h.url === row.dataset.clLessonUrl)) {
            row.dataset.inProgress = "true";
            row.querySelector("[data-cl-lesson-status]").textContent = "In progress";
          }
        }
        const recent = history.find((h) =>
          rows.some((r) => r.dataset.clLessonUrl === h.url && r.dataset.complete !== "true"),
        );
        const row =
          rows.find((r) => r.dataset.clLessonUrl === recent?.url) ||
          rows.find((r) => r.dataset.inProgress === "true" && r.dataset.complete !== "true");
        if (row) {
          upNext.dataset.action = "resume";
          const resume = upNext.querySelector("[data-cl-up-resume]");
          resume.hidden = false;
          resume.href =
            row.dataset.clLessonUrl + (recent?.point ? `#${encodeURIComponent(recent.point)}` : "");
          upNext.querySelector("[data-cl-up-start]").hidden = true;
          upNext.querySelector("[data-cl-up-description]").textContent =
            row.querySelector(".cl-lesson-title").textContent;
        }
      }
      const control = document.querySelector("[data-cl-continue]");
      if (!control) return;
      const recent = read()
        .map((h) => ({ ...h, lesson: lessons.find((l) => l.url === h.url) }))
        .find((h) => h.lesson);
      if (!recent) return;
      control.hidden = false;
      control.querySelector("h2").textContent = recent.lesson.title;
      control.querySelector("p").textContent = recent.lesson.classroomTitle;
      control.querySelector("a").href =
        recent.url + (recent.point ? `#${encodeURIComponent(recent.point)}` : "");
    } catch (error) {
      report(error, () => remember(lessons));
    }
  }
  current();
  load();
}
