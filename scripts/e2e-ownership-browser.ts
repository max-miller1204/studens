/** Public MCP and browser paths with a controlled dedicated-teacher boundary. */
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { makeFixture, seedClassroom, lessonHtml } from "../test/helpers.ts";
import { TeacherService } from "../src/teacher-service.ts";
import { McpSession, LearnerInbox } from "../src/mcp.ts";
import { openingBackend } from "../src/teacher-host.ts";
import { readTeacherState, saveTeacherState } from "../src/service-state.ts";
import type { Backend, RunTeacher } from "../src/teacher.ts";
import * as server from "../src/server.ts";
import * as store from "../src/store.ts";
import { playwright, playwrightCode } from "./playwright.ts";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
export async function verifyOwnershipBrowser(artifacts: string): Promise<void> {
  fs.mkdirSync(artifacts, { recursive: true });
  const fixture = makeFixture();
  const session = `studens-ownership-${process.pid}`;
  const events: unknown[] = [];
  const active = gate(),
    release = gate(),
    preparing = gate(),
    readyRelease = gate();
  let holdActive = true,
    holdReady = true;
  let failClassroom: string | undefined;
  let sessionSequence = 0;
  let browserOpen = false;
  const evidence = (name: string, data: unknown) =>
    fs.writeFileSync(path.join(artifacts, `${name}.json`), JSON.stringify(data, null, 2));
  const run: RunTeacher = async (identity, prompt, cwd, save, _signal, _contract, raw, model) => {
    const classroom = path.basename(cwd);
    const readiness = prompt.startsWith("Readiness check only.");
    events.push({ classroom, readiness, identity: { ...identity } });
    if (readiness && classroom === failClassroom) throw new Error("Fixture authentication denied");
    if (readiness && holdReady) {
      preparing.resolve();
      await readyRelease.promise;
      holdReady = false;
    }
    save(identity.sessionId ?? `fixture-${identity.backend}-${++sessionSequence}`);
    model?.(identity.requestedModel ?? `${identity.backend}-configured-default`);
    if (!readiness && holdActive) {
      active.resolve();
      await release.promise;
      holdActive = false;
    }
    const quiz = /submission_id: "([^"]+)"/.exec(prompt);
    const plan = {
      calls: quiz
        ? [
            {
              name: "grade_quiz_answers",
              arguments_json: JSON.stringify({
                submission_id: quiz[1],
                feedback_markdown: "Trace the owner.",
                questions: [
                  { question_id: "q1", correct: false, feedback: "The owner releases the value." },
                ],
              }),
            },
          ]
        : [],
      message: readiness ? "Ready." : "Explain the next ownership change.",
      learning_record: "",
      notes_markdown: "",
    };
    if (!readiness) raw?.(plan);
    return plan;
  };
  let teacher = new TeacherService(run);
  let seq = 0;
  const client = (backend?: Backend) =>
    new McpSession(new LearnerInbox(), {
      tools: [],
      async open(classroom, requested) {
        await teacher.open(classroom, openingBackend(backend, requested));
        return server.urlFor(classroom ?? undefined)!;
      },
    });
  async function open(backend: Backend | undefined, classroom?: string, requested?: Backend) {
    return client(backend).handle({
      jsonrpc: "2.0",
      id: ++seq,
      method: "tools/call",
      params: { name: "open_classroom", arguments: { classroom, teacher_backend: requested } },
    });
  }
  function check(value: unknown, message: string): asserts value {
    if (!value) throw new Error(message);
  }
  function success(result: any) {
    check(
      result?.result?.isError === false &&
        result.result.content[0].text.includes("[Open classroom]"),
      JSON.stringify(result),
    );
  }
  function failure(result: any, cause: string) {
    check(
      result?.result?.isError === true &&
        result.result.content[0].text.includes(cause) &&
        !result.result.content[0].text.includes("[Open classroom]"),
      JSON.stringify(result),
    );
  }
  async function browser(name: string, code: string) {
    const data = await playwrightCode(
      session,
      fixture.root,
      `async page => { ${code}; return {url:page.url(),snapshot:await page.locator('body').ariaSnapshot()}; }`,
    );
    evidence(name, data);
  }
  const shot = (name: string) =>
    `await page.screenshot({path:${JSON.stringify(path.join(artifacts, `${name}.png`))},fullPage:true});`;
  try {
    seedClassroom(fixture);
    seedClassroom(fixture, { classroom: "biology" });
    fixture.write(
      "rust/001-ownership/lesson.html",
      lessonHtml(
        "Ownership handoff",
        '<p>Every value has one owner.</p><form class="cl-quiz" data-quiz-id="check-1" data-title="Ownership"><ol class="cl-questions"><li class="cl-q" data-question-id="q1" data-type="term"><p class="cl-q-prompt">Who releases the value?</p><input type="text"></li></ol></form>',
      ),
    );
    fixture.write("rust/001-ownership/quiz/key.json", '{"q1":"The owner"}');
    for (const [classroom, backend] of [
      ["rust", "claude"],
      ["biology", "pi"],
    ] as const)
      saveTeacherState(classroom, {
        version: 1,
        identity: { backend, sessionId: `saved-${backend}`, requestedModel: `${backend}-selected` },
        requests: [],
        messages: [],
      });
    teacher.connect();
    await server.start(0);
    teacher.restore();
    await teacher.idle();
    const url = server.urlFor("rust", "001-ownership")!;
    await playwright(session, fixture.root, "open", url);
    browserOpen = true;
    await browser("before", `await page.locator('[data-cl-content]').waitFor(); ${shot("before")}`);
    await browser(
      "submit",
      `await page.locator('.cl-quiz input[type=text]').fill('Nobody'); await page.locator('.cl-quiz button[type=submit]').click();`,
    );
    await active.promise;
    const opening = open("codex", "rust");
    // A public status read observes the handoff boundary before the active turn ends.
    const deadline = Date.now() + 5000;
    while (
      !(
        await (
          await fetch(`${server.getBaseUrl()}/api/state?classroom=rust&lesson=001-ownership`)
        ).json()
      ).teacher.switching
    ) {
      if (Date.now() > deadline) throw new Error("Switch boundary was not visible");
      await new Promise((r) => setTimeout(r, 20));
    }
    await browser(
      "switching",
      `await page.locator('.cl-teacher-identity').filter({hasText:'Switching teacher to codex'}).waitFor(); ${shot("switching")}`,
    );
    await browser(
      "queued-during-active",
      `await page.locator('.cl-teacher textarea').fill('Explain another example.'); await page.locator('.cl-teacher button[type=submit]').click();`,
    );
    release.resolve();
    await preparing.promise;
    check(
      readTeacherState("rust")!.identity.backend === "claude",
      "Ownership changed before readiness",
    );
    await browser(
      "ready-boundary",
      `await page.locator('.cl-quiz [data-cl-grade]').waitFor(); ${shot("ready-boundary")}`,
    );
    readyRelease.resolve();
    success(await opening);
    await teacher.idle();
    await browser(
      "after",
      `await page.locator('.cl-teacher-identity').filter({hasText:'codex teacher'}).waitFor(); ${shot("after")}`,
    );
    const firstState = readTeacherState("rust")!;
    check(
      store.listGrades("rust", "001-ownership").length === 1,
      "Grade was not saved exactly once",
    );
    check(
      firstState.requests[0].originatingIdentity?.backend === "claude" &&
        firstState.requests[1].originatingIdentity?.backend === "codex",
      "Queued work crossed the boundary",
    );
    evidence("active-boundary", {
      events,
      state: firstState,
      grades: store.listGrades("rust", "001-ownership"),
    });
    const sameSession = firstState.identity.sessionId;
    success(await open("codex", "rust"));
    check(
      readTeacherState("rust")!.identity.sessionId === sameSession,
      "Same-adapter open replaced its session",
    );
    failure(await open("codex", "rust", "claude"), "conflicts with opening host");
    failure(await open(undefined, "rust"), "initiating host is unknown");
    failClassroom = "rust";
    const failed = await open("pi", "rust");
    failure(failed, "Fixture authentication denied");
    check(readTeacherState("rust")!.identity.backend === "codex", "Failed startup changed owner");
    evidence("failed-open", failed);
    const failedList = await open("claude");
    failure(failedList, "Fixture authentication denied");
    check(
      readTeacherState("biology")!.identity.backend === "pi" &&
        readTeacherState("rust")!.identity.backend === "codex",
      "List failure partially changed ownership",
    );
    evidence("failed-list", failedList);
    failClassroom = undefined;
    const competing = await Promise.all([
      open("pi"),
      open("claude", "rust"),
      open("codex", "rust"),
    ]);
    competing.forEach(success);
    evidence("concurrent-opens", competing);
    check(
      readTeacherState("biology")!.identity.backend === "pi" &&
        readTeacherState("rust")!.identity.backend === "codex",
      "Concurrent open order changed",
    );
    for (const candidate of [
      "/c/rust/.teacher.json",
      "/c/rust/assets/.teacher-ownership.json",
      "/c/rust/.teacher-migrations/test.json",
      "/.teacher-ownership.json",
    ])
      check(
        (await fetch(`${server.getBaseUrl()}${candidate}`)).status === 404,
        `Private route exposed: ${candidate}`,
      );
    const saved = readTeacherState("rust")!;
    const callsBefore = events.filter((e: any) => !e.readiness).length;
    await teacher.stop();
    await server.close();
    teacher = new TeacherService(run);
    teacher.connect();
    await server.start(0);
    teacher.restore();
    await teacher.idle();
    check(
      events.filter((e: any) => !e.readiness).length === callsBefore,
      "Restart repeated learner inference",
    );
    check(
      readTeacherState("rust")!.identity.sessionId === saved.identity.sessionId,
      "Startup migrated owner",
    );
    check(store.listGrades("rust", "001-ownership").length === 1, "Restart duplicated grading");
    await browser(
      "reloaded",
      `await page.goto(${JSON.stringify(server.urlFor("rust", "001-ownership"))}); await page.locator('[data-cl-content]').waitFor(); ${shot("reloaded")}`,
    );
    evidence("result", {
      verdict: "PASS",
      method: "Public MCP dispatcher, live HTTP and browser, controlled RunTeacher boundary",
      events,
      state: readTeacherState("rust"),
      grades: store.listGrades("rust", "001-ownership"),
    });
  } catch (error) {
    evidence("failure", { message: String(error), error, events, state: readTeacherState("rust") });
    throw error;
  } finally {
    release.resolve();
    readyRelease.resolve();
    await teacher.stop();
    await server.close();
    if (browserOpen) await playwright(session, fixture.root, "close");
    fixture.cleanup();
  }
}
