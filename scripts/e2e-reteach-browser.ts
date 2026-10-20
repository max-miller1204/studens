import { refillRequests } from "../src/review-refill.ts";
/** Drive the learner's repeated-miss handoff through the real lesson controls. */
import * as fs from "node:fs";
import * as path from "node:path";
import { prepareReteach } from "../src/reteach.ts";
import * as server from "../src/server.ts";
import * as store from "../src/store.ts";
import { TeacherService } from "../src/teacher-service.ts";
import { DAY_MS } from "../src/review.ts";
import {
  makeFixture,
  seedClassroom,
  seedPreparedReviewSource,
  termAnswer,
  writeGradedAttempt,
  refillPlan,
} from "../test/helpers.ts";
import { playwright, playwrightCode } from "./playwright.ts";

export function seedReteach(root: string, lesson = "090-reteach") {
  seedPreparedReviewSource(root, "rust", lesson);
  for (let i = 0; i < 3; i++)
    writeGradedAttempt({
      lesson,
      at: Date.now() - (6 - i) * DAY_MS,
      answers: [
        {
          ...termAnswer("q1", "It stays alive forever", { prompt: "Explain ownership." }),
          type: "short",
        },
      ],
      correct: { q1: false },
    });
  return lesson;
}

/** Shared by prescribed real hosts: no teacher substitutes or direct state mutations during drive. */
export async function driveReteach(
  browser: string,
  root: string,
  base: string,
  lesson: string,
  artifacts: string | null,
  expectFailure = false,
) {
  if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
  const before = {
    grades: store.listGrades("rust", lesson),
    submissions: store.listSubmissions("rust", lesson),
    checks: store.listRetrievalChecks("rust"),
    records: store.listLearningRecords("rust"),
  };
  const code = (body: string) =>
    playwrightCode(
      browser,
      root,
      `async page=>{${body}return await page.locator('body').ariaSnapshot();}`,
    );
  const shot = (name: string) =>
    artifacts
      ? `await page.evaluate(()=>window.scrollTo(0,0)); await page.screenshot({path:${JSON.stringify(path.join(artifacts, name + ".png"))},fullPage:true});`
      : "";
  const state = async () =>
    await (await fetch(`${base}/api/state?classroom=rust&lesson=${lesson}`)).json();
  await code(
    `await page.setViewportSize({width:1280,height:900});await page.goto(${JSON.stringify(base + "/c/rust")});await page.getByRole('link',{name:'Open short re-teach',exact:true}).waitFor();${shot("after-desktop")}await page.setViewportSize({width:375,height:812});${shot("after-mobile")}if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Re-teach offer overflows mobile');await page.getByRole('link',{name:'Open short re-teach',exact:true}).click();await page.getByRole('button',{name:'Start short re-teach',exact:true}).waitFor();${shot("offer-mobile")}await page.getByRole('button',{name:'Start short re-teach',exact:true}).click();`,
  );
  async function waitForState(label: string, probe: () => Promise<any>) {
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const result = await probe();
      if (result) return result;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const last = await state();
    if (artifacts)
      fs.writeFileSync(path.join(artifacts, "timeout-state.json"), JSON.stringify(last, null, 2));
    throw new Error(`Timed out waiting for ${label}`);
  }
  const requestId = (await state()).reteach[0].id;
  let saved = await waitForState("durable re-teach result", async () => {
    const s = await state();
    const r = s.teacher.requests.find((r: any) => r.id.startsWith("chat:reteach:"));
    if (r?.status === "failed" && !expectFailure) throw new Error(r.error);
    return (r && ["failed", "done"].includes(r.status)) ||
      s.teacher.messages.some((m: any) => m.id === requestId && m.role === "teacher")
      ? s
      : null;
  });
  if (expectFailure) {
    await code(
      `await page.getByRole('button',{name:'Retry request',exact:true}).waitFor();${shot("failed-mobile")}await page.reload();await page.getByRole('button',{name:'Retry request',exact:true}).waitFor();await page.getByRole('button',{name:'Re-teach requested',exact:true}).waitFor();if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Failed re-teach request overflows mobile');`,
    );
    if (
      (await state()).teacher.requests.filter((r: any) => r.id.startsWith("chat:reteach:"))
        .length !== 1
    )
      throw new Error("Reload duplicated failed re-teach");
    await code(`await page.getByRole('button',{name:'Retry request',exact:true}).click();`);
    saved = await waitForState("explicit re-teach retry", async () => {
      const s = await state();
      const r = s.teacher.requests.find((r: any) => r.id.startsWith("chat:reteach:"));
      if (r?.status === "failed") throw new Error(r.error);
      return r?.status === "done" ||
        s.teacher.messages.some((m: any) => m.id === requestId && m.role === "teacher")
        ? s
        : null;
    });
  }
  if (
    JSON.stringify(store.listGrades("rust", lesson)) !== JSON.stringify(before.grades) ||
    JSON.stringify(store.listRetrievalChecks("rust")) !== JSON.stringify(before.checks) ||
    JSON.stringify(store.listLearningRecords("rust")) !== JSON.stringify(before.records)
  )
    throw new Error("Re-teach request changed assessment or evidence");
  if (!store.reviewItems("rust").some((i) => i.lesson === lesson && i.needsReteach))
    throw new Error("Explanation silently reset review history");
  const request = { id: requestId };
  await code(
    `await page.reload();await page.getByRole('button',{name:'Re-teach requested',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('.cl-teacher-message[data-role="teacher"]')?.textContent.includes('?'));${shot("taught-mobile")}await page.getByRole('textbox',{name:'Reply to your teacher',exact:true}).fill('The new binding owns the moved value and drops it when that owner leaves scope. I used your explanation and worked example as help.');await page.getByRole('button',{name:'Send reply',exact:true}).click();`,
  );
  saved = await waitForState("learner re-teach reply", async () => {
    const s = await state();
    const reply = s.teacher.requests
      .filter((r: any) => r.kind === "chat" && r.id !== request.id)
      .at(-1);
    if (reply?.status === "failed") throw new Error(reply.error);
    return reply?.status === "done" ||
      s.teacher.messages.filter((m: any) => m.role === "teacher").length === 2
      ? s
      : null;
  });
  await code(
    `await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.cl-teacher-message[data-role="teacher"]').length===2);${shot("reply-mobile")}`,
  );
  if (
    JSON.stringify(store.listGrades("rust", lesson)) !== JSON.stringify(before.grades) ||
    JSON.stringify(store.listSubmissions("rust", lesson)) !== JSON.stringify(before.submissions)
  )
    throw new Error("Re-teaching or panel reply altered original assessment");
  const item = store.reviewItems("rust").find((i) => i.lesson === lesson)!;
  if (!item.needsReteach)
    throw new Error("Assisted re-teaching cleared the unresolved review pause");
  if (
    item.progress === "retained-evidence" ||
    item.delayedSuccesses ||
    item.delayedTransfers ||
    item.box
  )
    throw new Error("Assisted re-teaching claimed delayed retention");
  for (const privatePath of [
    ".pi-teacher-resumes.json",
    ".teacher.json",
    `${lesson}/quiz/key.json`,
    `${lesson}/quiz/plan.json`,
  ])
    if ((await fetch(`${base}/c/rust/${privatePath}`)).status !== 404)
      throw new Error("Private re-teach state leaked");
  if (artifacts)
    fs.writeFileSync(
      path.join(artifacts, "result.json"),
      JSON.stringify(
        { before, after: saved, item, checks: store.listRetrievalChecks("rust") },
        null,
        2,
      ),
    );
  console.log(
    "PASS: repeated misses pause review; real panel re-teach and assisted reply survive reload without grade or retention changes",
  );
}

export async function verifyReteachBrowser(artifacts: string | null) {
  const host = "service";
  const f = makeFixture();
  seedClassroom(f);
  const lesson = seedReteach(f.root, "001-ownership");

  const browser = `studens-reteach-${host}-${process.pid}`;
  let turns = 0;
  const message =
    "One owner controls cleanup. For example, when a String moves from a to b, b owns it and drops it when b leaves scope. Who drops a value after it moves to a new binding?";
  const teacher = new TeacherService(async (_identity, prompt) => {
    if (prompt.includes("Background private review refill"))
      return refillPlan(refillRequests("rust").find((r) => r.status === "running")!);
    turns++;
    if (turns === 1) throw new Error("Fixture provider interrupted during re-teach.");
    return { calls: [], message, learning_record: "", notes_markdown: "" };
  });
  teacher.attach("rust", "codex");
  server.setHooks({
    onAsk() {},
    onFollowUp() {},
    onQuizSubmit() {},
    onReflect() {},
    teacherState: (c, l) => teacher.publicState(c, l),
    onTeacherChat: (c, l, t, id) => teacher.chat(c, l, t, id),
    onTeacherRetry: (c, id) => teacher.retry(c, id),
  });
  try {
    const base = await server.start(0);
    await playwright(browser, f.root, "open", base);
    await driveReteach(
      browser,
      f.root,
      base,
      lesson,
      artifacts ? path.join(artifacts, host) : null,
      true,
    );
    if (turns !== 3)
      throw new Error(`Expected failed request, explicit retry and learner reply, got ${turns}`);
  } catch (error) {
    if (artifacts) {
      const failureDir = path.join(artifacts, host);
      fs.mkdirSync(failureDir, { recursive: true });
      fs.writeFileSync(
        path.join(failureDir, "failure.json"),
        JSON.stringify(
          {
            error: String(error),
            teacher: teacher.publicState("rust", lesson),
          },
          null,
          2,
        ),
      );
      fs.cpSync(path.join(f.root, "rust"), path.join(failureDir, "classroom"), {
        recursive: true,
      });
    }
    throw error;
  } finally {
    await teacher.stop();
    await playwright(browser, f.root, "close");
    await server.close();
    f.cleanup();
  }
}
