/** Daily landing, classroom boundaries, publication recovery and durable assessment history. */
import * as fs from "node:fs";
import * as path from "node:path";
import { ClassroomBridge } from "../src/bridge.ts";
import { lessonDir } from "../src/paths.ts";
import { completePreparedReview, currentReview, reviewSessions } from "../src/review-session.ts";
import { DAY_MS } from "../src/review.ts";
import * as server from "../src/server.ts";
import * as store from "../src/store.ts";
import { dailyReviews } from "../src/store/daily-review.ts";
import { readTeacherState } from "../src/service-state.ts";
import { TeacherService } from "../src/teacher-service.ts";
import {
  makeFixture,
  seedClassroom,
  seedPreparedReviewSource,
  closeReviewVariants,
  termAnswer,
  writeGradedAttempt,
} from "../test/helpers.ts";
import { playwright, playwrightCode } from "./playwright.ts";

export async function verifyDailyReview(artifacts: string | null): Promise<void> {
  for (const host of ["pi", "service"] as const) {
    const fixture = makeFixture();
    const evidence = artifacts ? path.join(artifacts, host) : null;
    if (evidence) fs.mkdirSync(evidence, { recursive: true });
    for (const [classroom, title] of [
      ["biology", "Biology"],
      ["rust", "Rust"],
    ]) {
      seedClassroom(fixture, {
        classroom,
        title,
        mission: `# Mission: ${title}\n\n## Why\n\nUnderstand ${title.toLowerCase()} through deliberate practice.`,
      });
      seedPreparedReviewSource(fixture.root, classroom, "001-ownership", "check-1", ["q1", "q2"]);
      closeReviewVariants(fixture.root, classroom);
      // New pools declare weights before daily planning; legacy histories stay unchanged.
      const keyFile = path.join(fixture.root, classroom, "001-ownership/quiz/key.json");
      const key = JSON.parse(fs.readFileSync(keyFile, "utf8"));
      for (const entry of Object.values(key["check-1"]) as Array<{
        points: number;
        criteria?: unknown;
        variants: Array<{ rubric: { points: number; criteria?: unknown } }>;
      }>) {
        const description =
          classroom === "biology" ? "Identify the cell membrane" : "Identify the current owner";
        entry.criteria = [{ id: "answer", description, points: entry.points }];
        for (const variant of entry.variants)
          variant.rubric.criteria = [{ id: "answer", description, points: variant.rubric.points }];
      }
      fs.writeFileSync(keyFile, JSON.stringify(key));
      const metaFile = path.join(fixture.root, classroom, "001-ownership/lesson.json");
      fs.writeFileSync(
        metaFile,
        JSON.stringify({ ...JSON.parse(fs.readFileSync(metaFile, "utf8")), criterionContract: 1 }),
      );
      if (classroom === "biology") {
        for (const file of ["lesson.html", "quiz/key.json", "quiz/plan.json"]) {
          const name = path.join(fixture.root, classroom, "001-ownership", file);
          const text = fs
            .readFileSync(name, "utf8")
            .replaceAll("Explain ownership.", "Explain cells.")
            .replaceAll(
              "A value moves into a new scope. Who releases it?",
              "Which structure controls what enters and leaves a cell?",
            )
            .replaceAll("The new owner", "The cell membrane")
            .replaceAll("The old binding", "The nucleus")
            .replaceAll("The current owner releases the value.", "The membrane controls transport.")
            .replaceAll(
              "The old binding no longer owns it.",
              "The nucleus contains genetic material.",
            );
          fs.writeFileSync(name, text);
        }
      }
      const submission = writeGradedAttempt({
        classroom,
        at: Date.now() - 2 * DAY_MS,
        answers: ["q1", "q2"].map((q) =>
          termAnswer(q, "original", {
            learning: {
              objectiveId: q,
              objective: {
                statement: classroom === "biology" ? "Explain cells." : "Explain ownership.",
                application: false,
              },
              task: "retrieval",
              support: "independent",
              assistance: "none",
            },
          }),
        ),
        correct: { q1: true, q2: true },
      });
      // Historical grade revisions are immutable evidence, not new attempts.
      const grade = store.listGrades(classroom, "001-ownership")[0];
      store.writeGrade({
        ...grade,
        gradedAt: grade.gradedAt + 1,
        feedbackMarkdown: "Historical revision retained.",
      });
      if (store.listSubmissions(classroom, "001-ownership")[0].id !== submission.id)
        throw new Error("Original identity lost.");
    }
    const original = Object.fromEntries(
      ["biology", "rust"].map((c) => [
        c,
        {
          submissions: store.listSubmissions(c, "001-ownership"),
          grades: store.listGrades(c, "001-ownership"),
        },
      ]),
    );
    const browser = `studens-daily-${host}-${process.pid}`;
    let opened = false,
      turns = 0,
      publications = 0,
      conflict = true;
    const prompts: string[] = [];
    const bridge = new ClassroomBridge({
      sendUserMessage: (prompt) => {
        turns++;
        prompts.push(prompt);
        queueMicrotask(() =>
          bridge.onAgentEnd([
            {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: prompt.includes("queued teacher-panel resume request")
                    ? "What does the cell membrane control?"
                    : "Yes, the cell membrane controls transport.",
                },
              ],
            },
          ]),
        );
      },
    });
    const teacher = new TeacherService(async (identity, prompt) => {
      turns++;
      prompts.push(`${identity.backend}: ${prompt}`);
      return {
        calls: [],
        message: prompt.includes("queued teacher-panel resume request")
          ? "What does the cell membrane control?"
          : "Yes, the cell membrane controls transport.",
        learning_record: "",
        notes_markdown: "",
      };
    });
    if (host === "service") {
      teacher.attach("biology", "claude");
      teacher.attach("rust", "codex");
    }
    const publish = (session: Parameters<typeof completePreparedReview>[0]) => {
      publications++;
      if (dailyReviews()[0].groups.length !== 2)
        throw new Error("Published before all group plans saved.");
      if (session.classroom === "rust" && conflict)
        fixture.write(
          `rust/.reviews/${session.lesson}/lesson.html`,
          "Conflicting reserved document.",
        );
      completePreparedReview(session);
    };
    server.setHooks({
      delivery: host === "service" ? "service" : "push",
      reviewOwner: host,
      canAccept: (c) => {
        if (host === "service" && !readTeacherState(c))
          throw new Error(`No teacher owns classroom ${c}.`);
      },
      onAsk: () => {
        throw new Error("Unexpected annotation");
      },
      onFollowUp: () => {},
      onQuizSubmit: () => {
        throw new Error("Closed grading called teacher");
      },
      onReflect: () => {},
      onReview: publish,
      onReviewRetry: publish,
      onReviewMiss: (s) =>
        host === "service"
          ? teacher.resume({ classroom: s.classroom, lesson: s.lesson, submission_id: s.id }, true)
          : bridge.correctReview(s),
      teacherState: (c, l) =>
        host === "service" ? teacher.publicState(c, l) : bridge.panelState(c, l),
      onTeacherChat: (c, l, text, id) =>
        host === "service" ? teacher.chat(c, l, text, id) : bridge.chat(c, l, text, id),
      onTeacherRetry: (c, id) => (host === "service" ? teacher.retry(c, id) : bridge.retry(c, id)),
    });
    const code = (body: string) =>
      playwrightCode(browser, fixture.root, `async page=>{${body};return true;}`);
    const shot = (name: string) =>
      evidence
        ? `await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:${JSON.stringify(path.join(evidence, `${name}.png`))},fullPage:true});`
        : "";
    const stateShots = (name: string) =>
      [1280, 390]
        .map(
          (width) => `
      await page.setViewportSize({width:${width},height:844});
      await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
      if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw Error('Review state overflows viewport');
      ${shot(`${name}-${width}`)}
    `,
        )
        .join("\n");
    const save = (name: string, value: unknown) => {
      if (evidence) fs.writeFileSync(path.join(evidence, name), JSON.stringify(value, null, 2));
    };
    try {
      const base = await server.start(0);
      await playwright(browser, fixture.root, "open", base);
      opened = true;
      await code(`
        await page.setViewportSize({width:1440,height:900});
        await page.getByRole('heading',{name:'4 due across classrooms',exact:true}).waitFor();
        await page.getByRole('button',{name:'Start daily review',exact:true}).waitFor({state:'visible'});
        ${shot("landing-desktop")}
        await page.setViewportSize({width:390,height:844});${shot("landing-mobile")}
        if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw new Error('Landing overflows mobile.');
        await page.getByRole('button',{name:'Start daily review',exact:true}).click();
        await page.getByRole('heading',{name:'Daily review',exact:true}).waitFor();
        await page.getByRole('button',{name:'Continue Biology review',exact:true}).waitFor();
        const meter = page.getByRole('progressbar',{name:'Completed classrooms'});
        await meter.waitFor();
        if(await meter.getAttribute('aria-valuenow') !== '0' || await meter.getAttribute('aria-valuemax') !== '2') throw Error('Initial classroom progress is incorrect');
        if(await page.locator('.cl-daily-group').count()!==2) throw new Error('Groups not separated.');
        ${shot("groups-mobile")}
        await page.setViewportSize({width:1440,height:900});${shot("groups-desktop")}
      `);
      const daily = dailyReviews()[0];
      save("selected-before-progress.json", daily);
      if (daily.groups.some((group) => group.plan.criterionContract !== 1))
        throw new Error("Daily plans lost predeclared criterion metadata.");
      if (turns || publications !== 1 || reviewSessions("rust").length)
        throw new Error("Start published extra groups or used teacher authoring.");
      const duplicate = await fetch(`${base}/api/daily-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: crypto.randomUUID() }),
      });
      const dup = await duplicate.json();
      if (dup.daily.id !== daily.id || dailyReviews().length !== 1 || publications !== 1)
        throw new Error("Repeated start duplicated daily work.");
      await code(`
        const second=await page.context().newPage();await second.goto(${JSON.stringify(base)});
        await second.getByRole('button',{name:'Continue daily review',exact:true}).click();
        await second.getByRole('button',{name:'Continue Biology review',exact:true}).waitFor();await second.close();
        await page.reload();await page.getByRole('button',{name:'Continue Biology review',exact:true}).click();
        await page.waitForFunction(()=>document.querySelector('[data-review-active="true"]')?.dataset.state==='fresh');
        await page.locator('form.cl-quiz:visible input[value="owner"]').check();
        await page.locator('form.cl-quiz:visible button[type="submit"]').click();
        await page.getByText('Question 1 of 2 · 1 answered',{exact:true}).waitFor();
        if(await page.locator('form.cl-quiz:visible .cl-q-criteria li').count()!==1)throw new Error('Daily closed criterion allocation missing.');
        await page.getByRole('link',{name:'Continue daily review',exact:true}).click();
        await page.getByRole('button',{name:'Continue Biology review',exact:true}).waitFor();
        if(await page.getByRole('button',{name:'Start Rust review',exact:true}).count()) throw new Error('Next classroom enabled before all cards graded.');
        await page.getByRole('button',{name:'Continue Biology review',exact:true}).click();
        await page.getByText('Question 2 of 2 · 1 answered',{exact:true}).waitFor();
        await page.locator('form.cl-quiz:visible input[value="old"]').check();
        await page.waitForFunction(()=>document.querySelector('form.cl-quiz:not([hidden]) .cl-quiz-status')?.textContent==='Draft saved.');
        await page.reload();
        await page.getByText('Question 2 of 2 · 1 answered',{exact:true}).waitFor();
        if(!await page.locator('form.cl-quiz:visible input[value="old"]').isChecked()) throw new Error('Draft lost on reload.');
        await page.setViewportSize({width:390,height:844});${shot("card-mobile")}
        await page.locator('form.cl-quiz:visible button[type="submit"]').click();
        await page.getByText('Review complete · 2 of 2 answered',{exact:true}).waitFor();
        await page.getByText('What does the cell membrane control?',{exact:true}).waitFor();
        await page.getByRole('textbox',{name:'Reply to your teacher',exact:true}).fill('The cell membrane controls what enters and leaves the cell.');
        await page.getByRole('button',{name:'Send reply',exact:true}).click();
        await page.getByText('Yes, the cell membrane controls transport.',{exact:true}).waitFor();
        ${shot("correction-mobile")}
        await page.getByRole('link',{name:'Continue daily review',exact:true}).click();
        const staleLanding = await page.request.post(${JSON.stringify(`${base}/api/daily-review`)}, {data:{id:crypto.randomUUID()}});
        const staleResult = await staleLanding.json();
        if(staleLanding.status()!==202 || staleResult.daily.groups[1].status!=='planned') throw new Error('Delayed landing start published the next classroom.');
        await page.getByRole('button',{name:'Start Rust review',exact:true}).click();
        await page.getByRole('alert').filter({hasText:'publication conflicts with lesson.html'}).waitFor();
        await page.getByRole('button',{name:'Retry Rust review',exact:true}).waitFor();${stateShots("partial-failure")}
        await page.reload();await page.getByRole('button',{name:'Retry Rust review',exact:true}).waitFor();
      `);
      const staleStart = await fetch(`${base}/api/daily-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: crypto.randomUUID() }),
      });
      if (
        staleStart.status !== 202 ||
        Number(publications) !== 2 ||
        !dailyReviews()[0].groups[1].error
      )
        throw new Error("A stale landing start retried the later classroom.");
      const beforeRetry = publications;
      save("partial-failure.json", {
        daily: dailyReviews()[0],
        biology: currentReview("biology"),
        rust: currentReview("rust"),
        publications,
        turns,
      });
      if (
        Number(publications) !== 2 ||
        store.listGrades("biology", currentReview("biology")!.lesson).length !== 2 ||
        store.listGrades("rust", currentReview("rust")!.lesson).length
      )
        throw new Error("Partial progress not preserved.");
      conflict = false;
      fs.unlinkSync(path.join(lessonDir("rust", currentReview("rust")!.lesson), "lesson.html"));
      await code(`
        await page.locator('.cl-teacher-activity').getByRole('button',{name:/^Retry activity: Preparing your daily review/}).click();
        await page.waitForFunction(()=>document.querySelector('[data-review-active="true"]')?.dataset.state==='fresh');
        for(let i=0;i<2;i++){
          await page.locator('form.cl-quiz:visible input[value="owner"]').check();
          await page.locator('form.cl-quiz:visible button[type="submit"]').click();
          await page.waitForFunction(()=>document.querySelector('[data-review-active="true"]')?.dataset.state==='graded');
          if(i===0) await page.getByRole('button',{name:'Next question',exact:true}).click();
        }
        await page.getByRole('link',{name:'Continue daily review',exact:true}).click();
        await page.getByText('Daily review complete. Each classroom keeps its review history.',{exact:true}).waitFor();
        await page.reload();await page.getByText('Daily review complete. Each classroom keeps its review history.',{exact:true}).waitFor();
        if(await page.getByRole('progressbar',{name:'Completed classrooms'}).getAttribute('aria-valuenow') !== '2') throw Error('Completed classroom progress is incorrect');
        ${stateShots("complete")}
        await page.getByRole('link',{name:'Biology review history',exact:true}).click();
        await page.getByText('2/2 answered',{exact:true}).waitFor();${shot("classroom-history")}
        await page.goto(${JSON.stringify(`${base}/reviews/daily`)});
        await page.getByRole('heading',{name:'Daily review history',exact:true}).waitFor();
        await page.getByText('2 classrooms · 2 complete',{exact:true}).waitFor();${shot("daily-history")}
        await page.goto(${JSON.stringify(base)});
        await page.getByRole('heading',{name:'0 due across classrooms',exact:true}).waitFor();
        if(!await page.getByRole('button',{name:'Start daily review',exact:true}).isDisabled()) throw new Error('Completed daily cards left items due today.');
        ${stateShots("scheduled")}
        // Full delayed answers move due dates forward. Teacher prose without a saved
        // retrieval check keeps the miss open with next-day due. Bind retirement by
        // saved key because the active-item selector changes after each action.
        for(const classroom of ['biology','rust']) {
          await page.goto(${JSON.stringify(base)} + '/c/' + classroom);
          await page.getByText('Manage review items',{exact:true}).click();
          const keys=await page.locator('[data-review-item][data-retired="false"]').evaluateAll(items=>items.map(item=>item.dataset.reviewItem));
          for(const key of keys) {
            const item=page.locator('[data-review-item='+JSON.stringify(key)+']');
            await Promise.all([page.waitForEvent('load'),item.getByRole('button',{name:'Retire item',exact:true}).click()]);
            await page.getByText('Manage review items',{exact:true}).click();
            await item.getByRole('button',{name:'Restore item',exact:true}).waitFor();
          }
        }
        await page.goto(${JSON.stringify(base)});
        await page.getByRole('heading',{name:'0 due across classrooms',exact:true}).waitFor();
        if(!await page.getByRole('button',{name:'Start daily review',exact:true}).isDisabled()) throw new Error('Empty due start enabled.');
        ${stateShots("empty-due")}
      `);
      if (publications !== beforeRetry + 1 || turns !== 2)
        throw new Error("Group progress duplicated publication or teacher turns.");
      for (const c of ["biology", "rust"]) {
        if (
          JSON.stringify({
            submissions: store.listSubmissions(c, "001-ownership"),
            grades: store.listGrades(c, "001-ownership"),
          }) !== JSON.stringify(original[c])
        )
          throw new Error(`Original evidence/revisions changed in ${c}.`);
        const review = currentReview(c)!;
        if (
          store.readLesson(c, review.lesson)?.criterionContract !== 1 ||
          !store
            .listSubmissions(c, review.lesson)
            .every(
              (submission) =>
                submission.rubricCriteria && Array.isArray(submission.earlyReviewKeys),
            )
        )
          throw new Error("Daily publication lost criterion/timing snapshots.");
        const publicState = await (
          await fetch(`${base}/api/state?classroom=${c}&lesson=${review.lesson}`)
        ).text();
        if (/rubricCriteria|earlyReviewKeys|deterministicGrades|teachingPlan/.test(publicState))
          throw new Error("Daily private submission fields leaked.");
        if (
          store.listGrades(c, review.lesson).length !== 2 ||
          store.listSubmissions(c, review.lesson).length !== 2 ||
          store.readClassroom(c)!.lessonCount !== 1
        )
          throw new Error(`Duplicate/lost review history in ${c}.`);
        for (const route of [
          `/c/${c}/.reviews.json`,
          `/c/${c}/.reviews/${review.lesson}/lesson.html`,
          `/c/${c}/reviews/${review.lesson}/quiz/key.json`,
          `/c/${c}/reviews/${review.lesson}/quiz/plan.json`,
        ])
          if ((await fetch(base + route)).status !== 404)
            throw new Error(`Private route leaked ${route}`);
      }
      const scheduling = Object.fromEntries(
        ["biology", "rust"].map((c) => [
          c,
          {
            items: store.reviewItems(c),
            events: store.reviewEvents(c),
          },
        ]),
      );
      save("scheduling.json", scheduling);
      for (const [classroom, state] of Object.entries(scheduling)) {
        for (const item of state.items) {
          if (item.dueAt <= Date.now() || item.context !== "unknown")
            throw new Error(`Daily scheduling failed for ${classroom}/${item.key}.`);
          const events = state.events.filter((e) => e.key === item.key);
          const miss = events.find((e) => !e.correct);
          if (
            miss &&
            (!item.gapOpen ||
              item.lastCorrect ||
              item.delayedSuccesses !== 0 ||
              item.dueAt !== Math.max(miss.at, miss.feedbackAt ?? miss.at) + DAY_MS)
          )
            throw new Error(
              "Teacher prose without a saved check resolved the miss or changed its interval.",
            );
          if (!miss && (item.gapOpen || item.stability <= 1))
            throw new Error("Due correct answer did not grow stability.");
        }
      }
      const state = fs.readFileSync(path.join(fixture.root, ".daily-reviews.json"), "utf8");
      fixture.write(".daily-reviews.json", "{invalid");
      await code(
        `await page.reload();await page.getByRole('button',{name:'Retry daily review state',exact:true}).waitFor();${stateShots("state-failed")}`,
      );
      fixture.write(".daily-reviews.json", state);
      await code(
        `await page.getByRole('button',{name:'Retry daily review state',exact:true}).click();await page.getByRole('heading',{name:'0 due across classrooms',exact:true}).waitFor();`,
      );
      const results = {
        host,
        source: "fixture teacher through existing bridge/service boundaries",
        daily: dailyReviews(),
        original,
        prompts,
        turns,
        publications,
        grades: Object.fromEntries(
          ["biology", "rust"].map((c) => [c, store.listGrades(c, currentReview(c)!.lesson)]),
        ),
        teachers:
          host === "service"
            ? { biology: readTeacherState("biology"), rust: readTeacherState("rust") }
            : undefined,
      };
      save("result.json", results);
      if (
        host === "service" &&
        (readTeacherState("biology")!.identity.backend !== "claude" ||
          readTeacherState("rust")!.identity.backend !== "codex")
      )
        throw new Error("Daily review switched classroom backends.");
      await server.close();
      await server.start(0);
      if (turns !== 2 || dailyReviews().length !== 1)
        throw new Error("Recovery duplicated teacher work or batches.");
      console.log(
        `PASS: ${host} daily landing, grouped progression, repeated start, drafts/reload, partial failure/retry, corrections, unchanged revisions, separate history, empty state and private routes`,
      );
    } catch (error) {
      save("failure.json", { error: String(error), turns, publications, prompts });
      save("failure-state.json", {
        daily: dailyReviews(),
        classrooms: Object.fromEntries(
          ["biology", "rust"].map((c) => [
            c,
            {
              reviews: reviewSessions(c),
              lessons: store.listLessons(c),
              assessments: store.listLessonDirs(c).map((l) => ({
                lesson: l,
                submissions: store.listSubmissions(c, l),
                grades: store.listGrades(c, l),
              })),
              teacher: readTeacherState(c),
            },
          ]),
        ),
      });
      if (opened && evidence) await code(shot("failure")).catch(() => {});
      throw error;
    } finally {
      if (opened) await playwright(browser, fixture.root, "close");
      await teacher.stop();
      await server.close();
      fixture.cleanup();
    }
  }
}
