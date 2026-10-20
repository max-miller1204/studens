/** Probe only through the rendered editor/Run controls. Source strings execute in the browser VM. */
export async function codeBrowserProbes(
  page: any,
  source: string,
  artifacts: string | null = null,
): Promise<unknown> {
  const q = page.locator('[data-question-id="sum"]');
  const editor = q.getByLabel("JavaScript source", { exact: true });
  const rows: unknown[] = [],
    requests: string[] = [];
  const listener = (request: any) => {
    if (request.url().includes("/api/quiz/submit") || request.url().includes("/api/teacher/"))
      requests.push(request.method() + " " + request.url());
  };
  page.on("request", listener);
  async function run(label: string, code: string, assertion: (value: any) => boolean) {
    await editor.fill(code);
    await q.locator("[data-cl-code-run]").click();
    await q.locator('.cl-code-runner:not([data-run-state="running"])').waitFor();
    const value = {
      label,
      state: await q.locator(".cl-code-runner").getAttribute("data-run-state"),
      text: await q.locator(".cl-code-runner").innerText(),
      passed: await q.locator('[data-outcome="passed"]').count(),
      failed: await q.locator('[data-outcome="failed"]').count(),
      errors: await q.locator('[data-outcome="error"]').count(),
    };
    rows.push(value);
    if (artifacts && ["syntax", "timeout", "runaway-output"].includes(label)) {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.screenshot({ path: `${artifacts}/${label}-mobile.png`, fullPage: true });
      await page.setViewportSize({ width: 1280, height: 900 });
    }
    if (!assertion(value)) throw new Error("Code probe failed: " + JSON.stringify(value));
    return value;
  }
  try {
    await run("correct", source, (v) => v.passed === 3);
    await run(
      "incorrect",
      "function sum() { return 42; }",
      (v) => v.failed === 3 && v.passed === 0,
    );
    await run("syntax", "function sum( {", (v) => v.errors === 3 && v.text.includes("SyntaxError"));
    await run(
      "runtime",
      "function sum() { throw new Error('Deliberate error'); }",
      (v) => v.errors === 3 && v.text.includes("Deliberate error"),
    );
    for (const expression of [
      "NaN",
      "Infinity",
      "undefined",
      "1n",
      "()=>1",
      "Promise.resolve(0)",
      "({get value(){return 0}})",
      "(()=>{const x={};x.self=x;return x;})()",
    ])
      await run(
        "invalid-result:" + expression,
        `function sum() { return ${expression}; }`,
        (v) => v.errors === 3 && v.passed === 0,
      );
    await run(
      "timeout",
      "function sum() { while(true) {} }",
      (v) => v.state === "timeout" && v.passed === 0,
    );
    await run("explicit-restart", source, (v) => v.passed === 3);
    await run(
      "runaway-output",
      'function sum(){ for(let i=0;i<10000;i++) console.log("1234567890"); return 0; }',
      (v) => v.state === "error" && v.passed === 0 && v.text.includes("output limit"),
    );
    if (
      await q
        .locator(".cl-code-output")
        .evaluate((el: HTMLElement) => el.clientHeight > 400 || el.scrollHeight <= el.clientHeight)
    )
      throw new Error("Runaway output is not contained in a scrollable panel.");
    await run(
      "memory-limit",
      'function sum(){ return new Array(10000000).fill("memory"); }',
      (v) => v.passed === 0 && (v.errors > 0 || v.state === "error"),
    );
    const denied = [
      "fetch('/api/code-escape-sentinel')",
      "new XMLHttpRequest()",
      "new WebSocket('ws://127.0.0.1/')",
      "new Worker('/static/classroom.js')",
      "new SharedWorker('/static/classroom.js')",
      "new BroadcastChannel('escape')",
      "document.querySelector('body')",
      "window.parent.document",
      "localStorage.getItem('pi-classroom-theme')",
      "indexedDB.open('escape')",
      "navigator.storage.getDirectory()",
      "require('node:fs')",
      "process.mainModule",
      "postMessage({protocol:'studens-code-1',passed:true})",
      "self.postMessage('escape')",
      "Function('return this')().fetch('/api/code-escape-sentinel')",
      "console.log.constructor('return this')().postMessage('escape')",
      "import('/api/code-escape-sentinel')",
    ];
    for (const expression of denied)
      await run(
        "denied:" + expression,
        `function sum() { return ${expression}; }`,
        (v) => v.passed === 0 && v.errors === 3,
      );
    await run(
      "guest-only-globals",
      "function sum(){ return [typeof fetch,typeof Worker,typeof document,typeof window,typeof localStorage,typeof indexedDB,typeof require,typeof process,typeof postMessage]; }",
      (v) =>
        v.passed === 0 &&
        v.text.includes(
          '["undefined","undefined","undefined","undefined","undefined","undefined","undefined","undefined","undefined"]',
        ),
    );
    await run(
      "console-text",
      'function sum(values){console.log("<img src=x onerror=alert(1)>");return values.reduce((a,b)=>a+b,0);}',
      (v) => v.passed === 3 && v.text.includes("<img"),
    );
    if (await q.locator(".cl-code-output img").count()) throw new Error("Output became HTML.");
    await editor.fill("function sum(){while(true){}}");
    await q.locator("[data-cl-code-run]").click();
    await page.getByRole("button", { name: "Submit for grading", exact: true }).click();
    if ((await q.locator("xpath=ancestor::form").getAttribute("data-state")) !== "fresh")
      throw new Error("Submit locked a still-running answer.");
    rows.push({ label: "submit-while-running", refused: true });
    await q.locator("[data-cl-code-stop]").click();
    if ((await q.locator(".cl-code-runner").getAttribute("data-run-state")) !== "stopped")
      throw new Error("Stop failed.");
    if (await q.locator('[data-outcome="passed"]').count())
      throw new Error("Stop retained a pass.");
    rows.push({ label: "stop", text: await q.locator(".cl-code-status").innerText() });
    await q.locator("[data-cl-code-run]").click();
    await editor.fill(source);
    await page.waitForTimeout(2200);
    if (
      (await q.locator(".cl-code-runner").getAttribute("data-run-state")) !== "idle" ||
      (await q.locator(".cl-code-results li").count())
    )
      throw new Error("Edited source retained a stale run.");
    rows.push({ label: "edit-during-run", text: await q.locator(".cl-code-status").innerText() });
    await page.evaluate(() =>
      window.postMessage(
        { protocol: "studens-code-1", run: { status: "complete", passed: true } },
        "*",
      ),
    );
    if (await q.locator(".cl-code-results li").count())
      throw new Error("Window message spoof accepted.");
    rows.push({ label: "window-message-spoof", ignored: true });
    await page.evaluate(() => {
      const Original = Worker;
      (window as any).__codeStaleInjected = false;
      window.Worker = class extends Original {
        postMessage(data: any) {
          super.postMessage(data);
          this.dispatchEvent(
            new MessageEvent("message", {
              data: {
                protocol: data.protocol,
                run: {
                  id: "00000000-0000-0000-0000-000000000000",
                  source: data.source,
                  status: "error",
                  error: "STALE_WORKER_MESSAGE",
                },
              },
            }),
          );
          (window as any).__codeStaleInjected = true;
        }
      } as typeof Worker;
    });
    await run(
      "stale-worker-identity",
      source,
      (v) => v.passed === 3 && !v.text.includes("STALE_WORKER_MESSAGE"),
    );
    if (!(await page.evaluate(() => (window as any).__codeStaleInjected)))
      throw new Error("Stale identity probe did not run.");
    await editor.focus();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("// keyboard revision");
    if (!(await editor.inputValue()).endsWith("// keyboard revision"))
      throw new Error("Keyboard editing failed.");
    await page.keyboard.press("Tab");
    if (await editor.evaluate((e: any) => e === document.activeElement))
      throw new Error("Editor trapped Tab.");
    await run("final-current-source", source, (v) => v.passed === 3);
    if (requests.length)
      throw new Error("Run sent assessment/teacher requests: " + JSON.stringify(requests));
    return { probes: rows, deniedExpressions: denied, runAssessmentRequests: requests };
  } finally {
    page.off("request", listener);
  }
}

/** Disposable authoring checker: execute, revise to a syntax error, then restore the starter. */
export async function checkCodeControls(page: any): Promise<number> {
  let checked = 0;
  for (const question of await page.locator('form.cl-quiz .cl-q[data-type="code"]').all()) {
    const contract = JSON.parse(await question.getAttribute("data-code"));
    const editor = question.locator("textarea.cl-code-source");
    const initial = await editor.inputValue();
    try {
      await editor.fill(`function ${contract.entry}() { return null; }`);
      await question.locator("[data-cl-code-run]").focus();
      await page.keyboard.press("Enter");
      await question.locator('.cl-code-runner[data-run-state="complete"]').waitFor();
      if ((await question.locator(".cl-code-results li").count()) !== contract.tests.length)
        throw new Error("Public code tests did not execute.");
      await editor.fill("function {");
      await question.locator("[data-cl-code-run]").click();
      await question.locator('.cl-code-runner[data-run-state="complete"]').waitFor();
      if ((await question.locator('[data-outcome="error"]').count()) !== contract.tests.length)
        throw new Error("Invalid JavaScript did not report syntax errors.");
      checked++;
    } finally {
      await editor.fill(initial);
    }
  }
  return checked;
}
