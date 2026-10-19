/** Select lesson text with mouse actions. DOM reads provide the text coordinates. */
export async function highlightText(page: any, selector: string, phrase: string): Promise<void> {
  // Keep the drag away from viewport edges, where Chromium autoscrolls the text.
  await page
    .locator(selector)
    .evaluate((element: Element) =>
      element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }),
    );
  const box = await page.locator(selector).evaluate((element: Element, text: string) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const start = node.textContent!.indexOf(text);
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + text.length);
      const rect = range.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }
    throw new Error(`No lesson text matches ${text}.`);
  }, phrase);
  await page.mouse.move(box.x + 0.5, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 0.5, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  if ((await page.evaluate(() => getSelection()!.toString())) !== phrase)
    throw new Error(`Mouse selection did not select ${phrase}.`);
}

/** Keep a restored locate answer selected during the authoring evaluation. */
export async function selectLocateAnswer(segment: {
  getAttribute(name: string): Promise<string | null>;
  click(): Promise<void>;
}): Promise<void> {
  if ((await segment.getAttribute("aria-pressed")) !== "true") await segment.click();
}

/** Exercise public local practice with arbitrary answers, without submitting assessment work. */
export async function checkPractice(page: any): Promise<number> {
  const writes: string[] = [];
  const record = (request: any) => {
    if (!["GET", "HEAD"].includes(request.method())) writes.push(request.url());
  };
  page.on("request", record);
  let checked = 0;
  try {
    for (const form of await page.locator("form.cl-practice").all()) {
      if ((await form.getAttribute("data-state")) !== "fresh")
        throw new Error("Practice controls are not ready.");
      for (const question of await form.locator(".cl-q").all()) {
        const type = await question.getAttribute("data-type");
        if (type === "choice" || type === "multi") await question.locator("input").first().check();
        if (type === "term") await question.locator("input").fill("practice answer");
        if (type === "numeric") {
          await question.locator(".cl-number").fill("2");
          const unit = question.locator(".cl-unit");
          if (await unit.count()) {
            if ((await unit.evaluate((el: any) => el.tagName)) === "SELECT")
              await unit.selectOption({ index: 1 });
            else await unit.fill("units");
          }
        }
        if (type === "cloze")
          for (const blank of await question.locator("[data-blank]").all())
            await blank.fill("practice answer");
        if (type === "match")
          for (const select of await question.locator(".cl-match-select").all())
            await select.selectOption({ index: 1 });
        if (type === "order")
          await question.getByRole("button", { name: "Move down" }).first().click();
        if (type === "locate") {
          await question.locator(".cl-segment").first().focus();
          await page.keyboard.press("Space");
        }
      }
      await form.getByRole("button", { name: "Check answer", exact: true }).focus();
      await page.keyboard.press("Enter");
      if (
        (await form.locator(".cl-practice-feedback").count()) !==
        (await form.locator(".cl-q").count())
      )
        throw new Error("Practice did not show feedback for every answer.");
      if ((await form.getAttribute("data-state")) !== "fresh")
        throw new Error("Practice locked after feedback.");
      checked++;
    }
    if (writes.length) throw new Error("Practice wrote server state: " + writes.join(", "));
    return checked;
  } finally {
    page.off("request", record);
  }
}
