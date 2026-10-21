/** Wire device appearance controls after the before-paint bootstrap. */
const root = document.documentElement;
let change = 0;

function withoutTransitions(apply) {
  const current = ++change;
  root.classList.add("cl-appearance-changing");
  // Resolve the suppression rule before changing any colors.
  getComputedStyle(root).color;
  try {
    apply();
  } finally {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (current === change) root.classList.remove("cl-appearance-changing");
      }),
    );
  }
}

function currentTheme() {
  return (
    root.dataset.theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
  );
}

/** Wire the header toggle and the device-local Settings selectors. */
export function initTheme() {
  const theme = document.querySelector("[data-cl-theme-choice]");
  const accent = document.querySelector("[data-cl-accent-choice]");
  const status = document.querySelector("[data-cl-appearance-status]");
  const sync = () => {
    if (theme) theme.value = root.dataset.theme ?? "system";
    if (accent) accent.value = root.dataset.accent;
  };
  const save = (kind, value) => {
    withoutTransitions(() => {
      try {
        const key = `pi-classroom-${kind}`;
        if (kind === "theme" && value === "system") localStorage.removeItem(key);
        else localStorage.setItem(key, value);
        window.classroomAppearance.read();
        document.querySelector("[data-cl-appearance-error]")?.remove();
        if (status) status.textContent = "Appearance saved on this device.";
      } catch (error) {
        if (status) status.textContent = "";
        window.classroomAppearance.report(error);
      }
      sync();
    });
  };
  sync();
  for (const toggle of document.querySelectorAll("[data-cl-theme-toggle]")) {
    toggle.addEventListener("click", () => {
      save("theme", currentTheme() === "dark" ? "light" : "dark");
    });
  }
  theme?.addEventListener("change", () => save("theme", theme.value));
  accent?.addEventListener("change", () => save("accent", accent.value));
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (!root.hasAttribute("data-theme")) withoutTransitions(() => {});
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== null && !["pi-classroom-theme", "pi-classroom-accent"].includes(event.key))
      return;
    withoutTransitions(() => {
      try {
        window.classroomAppearance.read();
        document.querySelector("[data-cl-appearance-error]")?.remove();
        sync();
      } catch (error) {
        window.classroomAppearance.report(error);
      }
    });
  });
}
