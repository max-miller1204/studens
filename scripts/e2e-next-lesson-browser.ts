import { hooks } from "../src/server/hooks.ts";
/** Browser authoring, isolated page validation, publication conflict and explicit retry. */
import * as fs from "node:fs";
import * as path from "node:path";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { lessonRequests, updateLessonRequest } from "../src/next-lesson.ts";
import { readTeacherState } from "../src/service-state.ts";
import { TeacherService } from "../src/teacher-service.ts";
import * as server from "../src/server.ts";
import * as store from "../src/store.ts";
import { makeFixture, seedClassroom, seedPreparedReviewSource } from "../test/helpers.ts";
import { nextLessonDocument } from "../test/next-lesson-fixture.ts";
import { playwright, playwrightCode } from "./playwright.ts";

export async function verifyNextLessonBrowser(artifacts: string | null): Promise<void> {
  for (const host of ["pi", "claude", "codex"] as const) {
    const fixture = makeFixture();
    seedClassroom(fixture);
    seedPreparedReviewSource(fixture.root);
    const document = nextLessonDocument(fixture.root);
    const original = fs.readFileSync(
      path.join(fixture.root, "rust/001-ownership/lesson.html"),
      "utf8",
    );
    const evidence = artifacts ? path.join(artifacts, host) : fixture.root;
    fs.mkdirSync(evidence, { recursive: true });
    const session = `next-${host}-${process.pid}`;
    let runs = 0;
    let conflict = true,
      badPage = false;
    const output = () =>
      badPage
        ? {
            ...document,
            lesson_html: document.lesson_html.replace(
              "</body>",
              '<script>throw new Error("Fixture authored control failed");</script></body>',
            ),
          }
        : document;
    let teacher = new TeacherService(async (_identity, _prompt, _cwd, save, _signal, contract) => {
      assert.equal(contract.research, true);
      assert.deepEqual(contract.operations, ["publish_lesson"]);
      save(`fixture-${host}`);
      runs++;
      const request = lessonRequests("rust").at(-1)!;
      if (conflict) fixture.write(`rust/${request.lesson}/lesson.html`, "conflicting publication");
      return {
        calls: [{ name: "publish_lesson", arguments_json: JSON.stringify(output()) }],
        message: "Your lesson is ready.",
        learning_record: "",
        notes_markdown: "",
      };
    });
    let opened = false;
    try {
      teacher.connect();
      teacher.attach("rust", host);
      const base = await server.start(0);
      await playwright(session, fixture.root, "open", `${base}/c/rust`);
      opened = true;
      for (const [label, width, height] of [
        ["desktop", 1440, 1000],
        ["mobile", 390, 844],
      ] as const)
        await playwrightCode(
          session,
          fixture.root,
          `async page=>{await page.setViewportSize({width:${width},height:${height}}); await page.locator('[data-cl-next-start]').waitFor({state:'visible'}); await page.screenshot({path:${JSON.stringify(path.join(evidence, `after-${label}.png`))},fullPage:true}); return true;}`,
        );
      await playwrightCode(
        session,
        fixture.root,
        `async page=>{
        await page.getByLabel('What would you like to learn next?').fill('Track moves between scopes');
        await page.getByRole('button',{name:'Next lesson',exact:true}).click();
        await page.getByRole('button',{name:'Retry lesson',exact:true}).waitFor({timeout:120000});
        if(!(await page.locator('[data-cl-next-status]').innerText()).includes('publication conflicts')) throw new Error('Missing concrete publication error');
        await page.screenshot({path:${JSON.stringify(path.join(evidence, "failed.png"))},fullPage:true});
        await page.reload(); await page.getByRole('button',{name:'Retry lesson',exact:true}).waitFor(); return true;
      }`,
      );
      const saved = lessonRequests("rust").at(-1)!;
      assert.equal(runs, 1);
      assert.ok(saved.document);
      assert.ok(saved.pageCheck);
      const checked = JSON.parse(saved.pageCheck.report);
      assert.equal(checked.preflight.version, 1);
      assert.equal(Object.keys(checked.preflight.inputHashes).length, 4);
      assert.ok(
        Object.values(checked.preflight.inputHashes).every((hash) => typeof hash === "string"),
      );
      assert.equal(saved.status, "failed");
      assert.equal(saved.topic, "Track moves between scopes");
      assert.equal(store.readLesson("rust", saved.lesson), null);
      // A durable receipt must bind the actual private publication bytes, not just HTML.
      for (const [name, text] of Object.entries({
        "lesson.html": document.lesson_html,
        "quiz/key.json": document.rubric_json,
        "quiz/plan.json": document.teaching_plan_json,
      }))
        assert.equal(
          checked.preflight.inputHashes[name],
          createHash("sha256").update(text).digest("hex"),
        );
      assert.equal((await fetch(`${base}/c/rust/${saved.lesson}`)).status, 404);
      assert.equal((await fetch(`${base}/c/rust/${saved.lesson}/media/foo`)).status, 404);
      assert.equal(
        (
          await fetch(`${base}/api/quiz/submit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ classroom: "rust", lesson: saved.lesson, quizId: "pretest-1" }),
          })
        ).status,
        404,
      );
      const originalHooks = hooks!;
      server.setHooks({ ...originalHooks, lessonOwner: () => (host === "pi" ? "claude" : "pi") });
      assert.equal((await fetch(`${base}/api/lesson?classroom=rust`)).status, 409);
      assert.equal(
        (
          await fetch(`${base}/api/lesson/retry`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ classroom: "rust", id: saved.id }),
          })
        ).status,
        409,
      );
      await playwrightCode(
        session,
        fixture.root,
        `async page=>{await page.reload();await page.getByRole('button',{name:'Check lesson status',exact:true}).waitFor();if(!(await page.locator('[data-cl-next-status]').innerText()).includes('belongs to')) throw new Error('Missing owner error');return true;}`,
      );
      server.setHooks(originalHooks);
      await playwrightCode(
        session,
        fixture.root,
        `async page=>{await page.reload();await page.getByRole('button',{name:'Retry lesson',exact:true}).waitFor();return true;}`,
      );
      assert.equal(lessonRequests("rust").at(-1)!.status, "failed");
      const duplicate = await fetch(`${base}/api/lesson`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classroom: "rust", id: randomUUID(), topic: "other topic" }),
      });
      assert.equal((await duplicate.json()).lesson.id, saved.id);
      assert.equal(runs, 1);
      assert.equal(lessonRequests("rust").length, 1);
      assert.equal(
        (
          await fetch(`${base}/api/lesson`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ classroom: "rust", id: randomUUID(), topic: "x".repeat(2001) }),
          })
        ).status,
        400,
      );
      // Historical HTML-only receipts are rechecked on explicit saved-plan retry.
      updateLessonRequest(saved, {
        pageCheck: {
          hash: saved.pageCheck.hash,
          report: JSON.stringify({ initial: checked.initial, released: checked.released }),
        },
      });
      {
        await teacher.stop();
        teacher = new TeacherService(async () => {
          runs++;
          if (conflict) throw new Error("Recovery must not request another model turn.");
          return {
            calls: [{ name: "publish_lesson", arguments_json: JSON.stringify(output()) }],
            message: "Ready",
            learning_record: "",
            notes_markdown: "",
          };
        });
        teacher.connect();
        teacher.attach("rust", host);
        await teacher.idle();
        assert.equal(lessonRequests("rust").at(-1)!.status, "failed");
      }
      fs.unlinkSync(path.join(fixture.root, "rust", saved.lesson, "lesson.html"));
      await playwrightCode(
        session,
        fixture.root,
        `async page=>{await page.locator('.cl-teacher-activity').getByRole('button',{name:/^Retry activity:/}).click();await page.waitForURL('**/${saved.lesson}',{timeout:120000});await page.waitForFunction(()=>document.querySelector('form.cl-quiz')?.dataset.state==='fresh');await page.screenshot({path:${JSON.stringify(path.join(evidence, "opened.png"))},fullPage:true});await page.reload();return {quizzes:await page.locator('form.cl-quiz').count()};}`,
      );
      assert.equal(runs, 1);
      assert.equal(lessonRequests("rust").at(-1)!.status, "done");
      const recoveredReceipt = JSON.parse(lessonRequests("rust").at(-1)!.pageCheck!.report);
      assert.equal(recoveredReceipt.preflight.version, 1);
      for (const [name, hash] of Object.entries(recoveredReceipt.preflight.inputHashes))
        assert.equal(
          hash,
          createHash("sha256")
            .update(fs.readFileSync(path.join(fixture.root, "rust", saved.lesson, name)))
            .digest("hex"),
        );
      assert.equal(store.listSubmissions("rust", saved.lesson).length, 0);
      assert.equal(store.listGrades("rust", saved.lesson).length, 0);
      assert.equal(
        fs.readFileSync(path.join(fixture.root, "rust/001-ownership/lesson.html"), "utf8"),
        original,
      );
      for (const route of [
        `/c/rust/${saved.lesson}/quiz/key.json`,
        `/c/rust/${saved.lesson}/quiz/plan.json`,
        `/c/rust/.lesson-requests.json`,
        `/c/rust/assets/../.lesson-requests.json`,
      ])
        assert.equal((await fetch(base + route)).status, 404);
      conflict = false;
      badPage = true;
      await playwrightCode(
        session,
        fixture.root,
        `async page=>{await page.goto(${JSON.stringify(base)}+'/c/rust');await page.getByRole('button',{name:'Next lesson',exact:true}).click();await page.getByRole('button',{name:'Retry lesson',exact:true}).waitFor({timeout:120000});if(!(await page.locator('[data-cl-next-status]').innerText()).includes('Fixture authored control failed')) throw new Error('Missing concrete headless error');await page.screenshot({path:${JSON.stringify(path.join(evidence, "page-check-failed.png"))},fullPage:true});return true;}`,
      );
      const rejected = lessonRequests("rust").at(-1)!;
      assert.equal(rejected.status, "failed");
      assert.equal(rejected.pageCheckFailed, true);
      assert.equal(rejected.pageCheck, undefined);
      assert.ok(rejected.document);
      assert.equal(store.readLesson("rust", rejected.lesson), null);
      assert.equal(fs.existsSync(path.join(fixture.root, "rust", rejected.lesson)), false);
      badPage = false;
      await playwrightCode(
        session,
        fixture.root,
        `async page=>{await page.getByRole('button',{name:'Retry lesson',exact:true}).click();await page.waitForURL('**/${rejected.lesson}',{timeout:120000});return true;}`,
      );
      const corrected = lessonRequests("rust").at(-1)!;
      assert.equal(corrected.status, "done");
      assert.equal(corrected.rejectedDocuments?.length, 1);
      assert.equal(corrected.failedAttempts?.length, 1);
      assert.equal(runs, 3);
      assert.equal(store.listSubmissions("rust", corrected.lesson).length, 0);
      const state = readTeacherState("rust");
      {
        assert.equal(state?.identity.sessionId, `fixture-${host}`);
        assert.equal(state?.requests.filter((r) => r.kind === "lesson").length, 2);
      }
      fs.writeFileSync(
        path.join(evidence, "result.json"),
        JSON.stringify(
          {
            host,
            runs,
            request: lessonRequests("rust").at(-1),
            teacher: state,
            submissions: store.listSubmissions("rust", saved.lesson),
          },
          null,
          2,
        ),
      );
    } finally {
      if (opened) await playwright(session, fixture.root, "close");
      await teacher.stop();
      await server.close();
      fixture.cleanup();
    }
  }
}
