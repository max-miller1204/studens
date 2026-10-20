/** Fixture teachers exercise the browser/durable queue, not model judgment quality. */
import * as fs from "node:fs";
import * as path from "node:path";
import { makeFixture, seedClassroom } from "../test/helpers.ts";
import { TeacherService } from "../src/teacher-service.ts";
import { readTeacherState } from "../src/service-state.ts";
import * as store from "../src/store.ts";
import * as server from "../src/server.ts";
import { applyGrade } from "../src/quiz-grading.ts";
import { seedDisputeProbe, driveDisputeProbe, DISPUTE_LESSON } from "./dispute-probe.ts";
import { playwright, playwrightCode } from "./playwright.ts";

export async function verifyDisputesBrowser(artifacts: string | null) {
  const f = makeFixture();
  seedClassroom(f);
  if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
  const save = (name: string, value: unknown) => {
    if (artifacts)
      fs.writeFileSync(path.join(artifacts, name + ".json"), JSON.stringify(value, null, 2));
  };
  const seed = seedDisputeProbe(f.root),
    session = `studens-disputes-${process.pid}`;
  let fail = false,
    turns = 0;
  const teacher = new TeacherService(async (_identity, prompt) => {
    turns++;
    const context = JSON.parse(
      prompt.split("\n\n").find((line) => line.startsWith('{"dispute_id"'))!,
    );
    if (fail) {
      fail = false;
      throw new Error("Fixture dispute model unavailable. Explicit retry is required.");
    }
    return {
      calls: [
        {
          name: "resolve_grade_dispute",
          arguments_json: JSON.stringify({
            dispute_id: context.dispute_id,
            decision: context.machine ? "declined" : "accepted",
            ...(context.machine
              ? {}
              : {
                  question: {
                    question_id: "mse",
                    correct: true,
                    points_earned: 4,
                    points_possible: 4,
                    feedback: "Both original calculation steps are correct.",
                    criteria: [
                      { criterion_id: "sum", points_earned: 2, feedback: "4 + 1 = 5 was given." },
                      {
                        criterion_id: "mean",
                        points_earned: 2,
                        feedback: "5 / 2 = 2.5 was already given.",
                      },
                    ],
                  },
                }),
          }),
        },
      ],
      message: context.machine
        ? "Your saved answer was 5, but 2 + 2 is 4. Machine points stay unchanged."
        : "Your original answer includes the averaging step 5 / 2 = 2.5. I restored its two declared criterion points.",
      learning_record: "",
      notes_markdown: "",
    };
  });
  teacher.attach("rust", "codex");
  teacher.connect();
  let opened = false;
  try {
    const base = await server.start(0);
    await playwright(session, f.root, "open", `${base}/c/rust/${DISPUTE_LESSON}`);
    opened = true;
    await driveDisputeProbe(session, f.root, base, artifacts, seed);
    await teacher.idle();
    const source = path.join(f.root, "rust", DISPUTE_LESSON),
      lesson = "996-retry-dispute";
    const dir = path.join(f.root, "rust", lesson);
    fs.mkdirSync(path.join(dir, "quiz"), { recursive: true });
    for (const file of ["lesson.html", "lesson.json", "quiz/key.json"])
      fs.copyFileSync(path.join(source, file), path.join(dir, file));
    const submission = store.createSubmission({ ...seed.submission, lesson, kind: "check" });
    const original = applyGrade(submission, {
      score: seed.grade.score,
      feedbackMarkdown: seed.grade.feedbackMarkdown,
      questions: seed.grade.questions,
    });
    fail = true;
    await playwrightCode(
      session,
      f.root,
      `async page=>{
      await page.goto(${JSON.stringify(base + "/c/rust/" + lesson)}); await page.locator('form[data-state="graded"]').waitFor();
      const second=await page.context().newPage(); await second.goto(page.url()); await second.locator('form[data-state="graded"]').waitFor();
      await page.locator('.cl-q[data-question-id="mse"] summary').first().click();
      await page.locator('.cl-q[data-question-id="mse"]').getByLabel('Why does your original answer deserve credit?').fill('The original answer already divides by two.');
      await page.locator('.cl-q[data-question-id="mse"]').getByRole('button',{name:'Send grade dispute',exact:true}).click();
      await page.getByRole('button',{name:'Retry request',exact:true}).waitFor();
      await page.reload(); await page.getByRole('button',{name:'Retry request',exact:true}).waitFor();
      await page.setViewportSize({width:375,height:812});
      ${artifacts ? `await page.screenshot({path:${JSON.stringify(path.join(artifacts, "retry-error-mobile.png"))},fullPage:true});` : ""}
      return true;
    }`,
    );
    await teacher.idle();
    const failed = readTeacherState("rust")!;
    save("failed-request", failed);
    if (turns !== 3 || store.listGrades("rust", lesson).length !== 1)
      throw new Error("Reload retried or revised a failed dispute");
    await playwrightCode(
      session,
      f.root,
      `async page=>{
      await page.getByRole('button',{name:'Retry request',exact:true}).click();
      await page.locator('.cl-q[data-question-id="mse"] .cl-dispute-response').waitFor();
      await page.reload(); await page.locator('.cl-q[data-question-id="mse"] .cl-dispute-response').waitFor();
      const second=page.context().pages().find(p=>p!==page);
      await second.reload(); await second.locator('.cl-q[data-question-id="mse"] .cl-dispute-response').waitFor();
      if(!await second.locator('.cl-q[data-question-id="mse"] > textarea').isDisabled())throw new Error('Second tab unlocked answer');
      const target=${JSON.stringify({ classroom: "rust", lesson, quizId: "check", submissionId: submission.id, gradedAt: original.gradedAt, questionId: "mse", reason: "stale reason" })};
      const probes=[];
      for(const patch of [{},{questionId:'unknown'},{lesson:'001-ownership'},{quizId:'neighbor'},{reason:''}]){
        const response=await page.request.post(${JSON.stringify(base)}+'/api/quiz/dispute',{data:{...target,id:crypto.randomUUID(),...patch}});
        if(response.status()<400)throw new Error('Accepted stale/neighbor/blank dispute'); probes.push({patch,status:response.status(),body:await response.json()});
      }
      for(const file of ['quiz/key.json','quiz/plan.json','quiz/submissions/no.json','quiz/grades/no.json'])if((await page.request.get(page.url()+'/'+file)).status()!==404)throw new Error('Private file served');
      const state=await (await page.request.get(${JSON.stringify(base)}+'/api/state?classroom=rust&lesson='+${JSON.stringify(lesson)})).json();
      await second.close(); return {probes,state};
    }`,
    ).then((result) => save("retry-and-probes", result));
    await teacher.idle();
    if (
      Number(turns) !== 4 ||
      store.listGrades("rust", lesson).length !== 2 ||
      JSON.stringify(store.listGrades("rust", lesson)[0]) !== JSON.stringify(original)
    )
      throw new Error("Explicit retry did not revise exactly once");
    save("final-teacher", readTeacherState("rust"));
    console.log(
      "PASS: fixture dispute failure, reload without retry, explicit retry once, second tab, stale/unknown/neighbor/blank targets and private routes",
    );
  } catch (error) {
    save("browser-failure", { error: String(error), teacher: readTeacherState("rust") });
    throw error;
  } finally {
    await teacher.stop();
    if (opened) await playwright(session, f.root, "close");
    await server.close();
    f.cleanup();
  }
}
