/** Exercise every authored frame through public controls; no assessment submissions. */
export async function checkSteppers(page: any): Promise<number> {
  const writes: string[] = [];
  const record = (request: any) => {
    if (!["GET", "HEAD"].includes(request.method())) writes.push(request.url());
  };
  page.on("request", record);
  try {
    const widgets = page.locator(".cl-stepper");
    for (const widget of await widgets.all()) {
      await widget.locator(".cl-stepper-runtime").waitFor();
      const ready = async () => {
        await page.waitForFunction(
          (id: string) => {
            const w = [...document.querySelectorAll<HTMLElement>(".cl-stepper")].find(
              (w) => w.dataset.stepperId === id,
            );
            return w && w.dataset.state !== "rendering";
          },
          await widget.getAttribute("data-stepper-id"),
        );
        if ((await widget.getAttribute("data-state")) !== "ready")
          throw new Error("Stepper is not ready: " + (await widget.innerText()));
        if (await widget.locator(".cl-contract-error").count())
          throw new Error("Stepper drawing failed.");
        if (!(await widget.locator(".cl-stepper-state").innerText()))
          throw new Error("Stepper state is blank.");
      };
      await ready();
      let count = 1;
      while (!(await widget.getByRole("button", { name: "Next", exact: true }).isDisabled())) {
        if (++count > 64) throw new Error("Stepper exceeded the bounded trace.");
        await widget.getByRole("button", { name: "Next", exact: true }).focus();
        await page.keyboard.press("Enter");
        await ready();
        if (Number(await widget.getAttribute("data-step")) !== count - 1)
          throw new Error("Stepper skipped a state.");
      }
      await widget.getByRole("button", { name: "Back", exact: true }).click();
      await ready();
      if (Number(await widget.getAttribute("data-step")) !== count - 2)
        throw new Error("Back did not restore the previous snapshot.");
      await widget.getByRole("button", { name: "Reset", exact: true }).click();
      await ready();
      if ((await widget.getAttribute("data-step")) !== "0")
        throw new Error("Reset did not restore the initial state.");
      if (await widget.locator("input").count()) {
        await widget.locator("input").fill("3, -2, 7");
        await widget.getByRole("button", { name: "Recompute", exact: true }).click();
        await ready();
        for (let i = 0; i < 3; i++) {
          await widget.getByRole("button", { name: "Next", exact: true }).click();
          await ready();
        }
        if (!(await widget.locator(".cl-stepper-state").innerText()).includes("Sum: 8"))
          throw new Error("Computed sum did not use the changed input.");
        await widget.getByRole("button", { name: "Reset", exact: true }).click();
        await ready();
      }
    }
    if (writes.length) throw new Error("Stepper wrote server state: " + writes.join(", "));
    return await widgets.count();
  } finally {
    page.off("request", record);
  }
}
