/** Read device appearance before the stylesheet can paint. */
(() => {
  const root = document.documentElement;
  const themes = ["light", "dark"];
  const accents = ["indigo", "copper", "green", "neutral"];
  function read() {
    const theme = localStorage.getItem("pi-classroom-theme");
    const accent = localStorage.getItem("pi-classroom-accent");
    if (theme !== null && !themes.includes(theme))
      throw new Error(`Invalid saved theme: ${JSON.stringify(theme)}. Select a theme in Settings.`);
    if (accent !== null && !accents.includes(accent))
      throw new Error(
        `Invalid saved accent: ${JSON.stringify(accent)}. Select an accent in Settings.`,
      );
    if (theme === null) root.removeAttribute("data-theme");
    else root.dataset.theme = theme;
    root.dataset.accent = accent === null ? "indigo" : accent;
  }
  function report(error) {
    let box = document.querySelector("[data-cl-appearance-error]");
    if (!box) {
      box = document.createElement("div");
      box.className = "cl-appearance-error";
      box.dataset.clAppearanceError = "";
      box.setAttribute("role", "alert");
      document.body.prepend(box);
    }
    const message = document.createElement("span");
    message.textContent = `Appearance settings failed: ${error.message}`;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "cl-button cl-button-quiet";
    retry.textContent = "Retry appearance";
    retry.addEventListener("click", () => {
      try {
        read();
        location.reload();
      } catch (error) {
        report(error);
      }
    });
    box.replaceChildren(message, retry);
  }
  window.classroomAppearance = { read, report };
  try {
    read();
  } catch (error) {
    document.addEventListener("DOMContentLoaded", () => report(error), { once: true });
  }
})();
