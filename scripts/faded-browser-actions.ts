/** Exercise any authored faded widget through its supported controls, using comparison. */
export async function checkFaded(page: any): Promise<number> {
  const writes: string[] = [];
  const record = (request: any) => {
    if (!["GET", "HEAD"].includes(request.method())) writes.push(request.url());
  };
  page.on("request", record);
  try {
    const widgets = page.locator(".cl-faded");
    for (const widget of await widgets.all()) {
      await widget.locator(".cl-faded-runtime").waitFor();
      if ((await widget.getAttribute("data-state")) !== "ready")
        throw new Error("Faded worked example is not ready.");
      await widget
        .getByLabel("Explain the method:", { exact: false })
        .fill("I apply the stated principle to preserve the relationship at each step.");
      await widget.getByRole("button", { name: "Try the next case", exact: true }).click();
      const total = await widget.locator(".cl-faded-step").count();
      for (let r = 1; r <= total; r++) {
        if (Number(await widget.getAttribute("data-round")) !== r)
          throw new Error("Faded practice did not advance one case.");
        const active = widget.locator('[data-support="attempt"]');
        if (
          (await active.count()) !== r ||
          (await widget.locator(".cl-faded-solution").count()) !== total - r
        )
          throw new Error("Faded practice did not hand over exactly one more step.");
        for (const step of await active.all()) {
          await step.locator("textarea").fill("My practice reasoning for comparison.");
          await step.getByRole("button", { name: "Compare with solution", exact: true }).click();
          if (!(await step.getByRole("status").innerText()).includes("assisted practice"))
            throw new Error("A solution comparison did not disclose assistance.");
        }
        const next = widget.getByRole("button", {
          name: r === total ? "Finish local practice" : "Hand over one more step",
          exact: true,
        });
        await next.focus();
        await page.keyboard.press("Enter");
      }
      await widget.getByRole("button", { name: "Reset to worked example", exact: true }).click();
      if (
        Number(await widget.getAttribute("data-round")) !== 0 ||
        (await widget.locator("textarea").inputValue())
      )
        throw new Error("Reset did not return to a blank study explanation.");
    }
    if (writes.length) throw new Error("Faded widget wrote server state: " + writes.join(", "));
    return await widgets.count();
  } finally {
    page.off("request", record);
  }
}
