/** Fixture plans prove the learner/HTTP/persistence boundary, not model semantics. */
import * as fs from "node:fs";
import * as path from "node:path";
import { makeFixture, seedClassroom, lessonHtml } from "../test/helpers.ts";
import { codeQuestion, codeRubric, source, exercise } from "../test/code-fixture.ts";
import { TeacherService } from "../src/teacher-service.ts";
import { readTeacherState } from "../src/service-state.ts";
import { applyGrade } from "../src/quiz-grading.ts";
import * as server from "../src/server.ts";
import * as store from "../src/store.ts";
import { playwright, playwrightCode } from "./playwright.ts";
import { highlightText } from "./browser-actions.ts";

export async function verifyExpectedAnswers(artifacts: string): Promise<void> {
  fs.mkdirSync(artifacts, { recursive: true });
  const f = makeFixture();
  seedClassroom(f);
  const save = (name: string, value: unknown) =>
    fs.writeFileSync(path.join(artifacts, name + ".json"), JSON.stringify(value, null, 2));
  const shell = (title: string, body: string) =>
    lessonHtml(title, body)
      .replace("<main data-cl-content>", '<main class="cl-lesson-shell" data-cl-content>')
      .replace(
        "<head>",
        '<head><meta name="viewport" content="width=device-width, initial-scale=1">',
      );
  const lesson = "001-ownership";
  f.write(
    `rust/${lesson}/lesson.json`,
    JSON.stringify({ title: "Check your reasoning", assessmentContract: 1 }),
  );
  f.write(
    `rust/${lesson}/lesson.html`,
    shell(
      "Check your reasoning",
      `<h1>Check your reasoning</h1><p>Read your saved answer and feedback, then continue with your teacher.</p><form class="cl-quiz" data-quiz-id="check" data-title="Forces and motion"><ol class="cl-questions"><li class="cl-q" data-question-id="reason" data-type="short"><p class="cl-q-prompt">Explain why a moving object continues at constant velocity when the net force is zero.</p><textarea></textarea></li><li class="cl-q" data-question-id="force" data-type="numeric"><p class="cl-q-prompt">A 2 kg object accelerates at 3 m/s². What is the net force?</p><input class="cl-number"><input class="cl-unit" value="N" readonly></li></ol></form>`,
    ),
  );
  f.write(
    `rust/${lesson}/quiz/key.json`,
    JSON.stringify({
      check: {
        reason: {
          expected: "Zero net force means zero acceleration; velocity remains constant.",
          points: 2,
          full: "Connect zero net force with zero acceleration and unchanged velocity.",
          partial: "One point for zero acceleration without the velocity consequence.",
        },
        force: {
          expected: { value: 6, unit: "N", tolerance: 0.1 },
          points: 1,
          full: "Multiply mass by acceleration, with newtons as the unit.",
          partial: "No credit for an incorrect force or missing unit.",
        },
      },
    }),
  );
  const sub = store.createSubmission({
    classroom: "rust",
    lesson,
    quizId: "check",
    quizTitle: "Forces and motion",
    kind: "check",
    answers: [
      {
        questionId: "reason",
        type: "short",
        value: "Zero net force means zero acceleration, so velocity stays constant.",
      },
      { questionId: "force", type: "numeric", value: "3", unit: "N" },
    ],
  });
  applyGrade(sub, {
    score: 67,
    feedbackMarkdown:
      "Your explanation connects force, acceleration, and velocity. Revisit the calculation with your teacher.",
    questions: [
      ...sub.deterministicGrades!,
      {
        questionId: "reason",
        correct: true,
        pointsEarned: 2,
        pointsPossible: 2,
        feedback: "You correctly connect zero acceleration with unchanged velocity.",
      },
    ],
  });
  const forms: Record<string, { markup: string; expected: unknown; grading?: string }> = {
    choice: {
      markup:
        '<label><input type="radio" name="choice" value="a">Alpha option</label><label><input type="radio" name="choice" value="b">Beta option</label>',
      expected: "a",
    },
    multi: {
      markup:
        '<label><input type="checkbox" value="a">First option</label><label><input type="checkbox" value="b">Second option</label>',
      expected: ["a", "b"],
    },
    term: { markup: '<input type="text">', expected: ["term", "synonym"] },
    short: {
      markup: "<textarea></textarea>",
      expected: "Explain the complete original reasoning.",
    },
    numeric: {
      markup: '<input class="cl-number"><input class="cl-unit" value="N" readonly>',
      expected: { value: 6, unit: "N", tolerance: 0.1 },
    },
    cloze: {
      markup:
        '<p class="cl-cloze">The <input type="text" data-blank="agent"> leaves at <input type="text" data-blank="end">.</p>',
      expected: { agent: ["owner", "holder"], end: "scope" },
    },
    order: {
      markup:
        '<ol class="cl-order"><li data-item="a">First step</li><li data-item="b">Second step</li></ol>',
      expected: ["b", "a"],
    },
    match: {
      markup:
        '<ol class="cl-match-left"><li data-item="left">Left item</li><li data-item="left2">Other left item</li></ol><ol class="cl-match-right"><li data-item="right">Right item</li><li data-item="right2">Other right item</li></ol>',
      expected: { left: "right", left2: "right2" },
    },
    locate: {
      markup:
        '<div class="cl-q-stimulus"><p data-segment="s1">First segment</p><p data-segment="s2">Second segment</p></div>',
      expected: ["s2"],
      grading: "exact",
    },
  };
  const key: Record<string, unknown> = {};
  const content = Object.entries(forms)
    .map(([type, value]) => {
      key[type] = {
        q: {
          expected: value.expected,
          points: 1,
          full: `Full ${type} reasoning.`,
          partial: `Partial ${type} reasoning.`,
          ...(value.grading ? { grading: value.grading } : {}),
          criteria: [{ id: "criterion", description: `Original ${type} criterion`, points: 1 }],
        },
      };
      return `<form class="cl-quiz" data-quiz-id="${type}" data-kind="pretest" data-title="${type} example"><ol class="cl-questions"><li class="cl-q" data-question-id="q" data-type="${type}"><p class="cl-q-prompt">Try this ${type} example.</p>${value.markup}</li></ol></form>`;
    })
    .join("");
  key.code = { q: codeRubric };
  key.private = {
    q: {
      expected: "NEVER-EXPOSE-PRIVATE-SIBLING",
      points: 1,
      full: "Private sibling full",
      partial: "Private sibling partial",
      criteria: [{ id: "private", description: "Private sibling criterion", points: 1 }],
    },
  };
  key.variants = { expected: "NEVER-EXPOSE-VARIANT-POOL" };
  f.write(
    "rust/002-formats/lesson.json",
    JSON.stringify({ title: "Answer formats", assessmentContract: 1, criterionContract: 1 }),
  );
  f.write(
    "rust/002-formats/lesson.html",
    shell(
      "Answer formats",
      `<h1>Answer formats</h1>${content}<form class="cl-quiz" data-quiz-id="code" data-kind="pretest"><ol class="cl-questions">${codeQuestion(source, exercise, "q")}</ol></form><form class="cl-quiz" data-quiz-id="private"><ol class="cl-questions"><li class="cl-q" data-question-id="q" data-type="short"><p class="cl-q-prompt">Neighboring ungraded question.</p><textarea></textarea></li></ol></form>`,
    ),
  );
  f.write("rust/002-formats/quiz/key.json", JSON.stringify(key));
  f.write("rust/003-neighbor/lesson.json", JSON.stringify({ title: "Ungraded neighbor" }));
  f.write(
    "rust/003-neighbor/lesson.html",
    shell("Ungraded neighbor", "<p>A separate ungraded lesson.</p>"),
  );
  let fail = true,
    turns = 0;
  const teacher = new TeacherService(async () => {
    turns++;
    const request = readTeacherState("rust")!.requests.find((r) => r.status === "running")!;
    const plan = {
      calls: [] as { name: string; arguments_json: string }[],
      message:
        "A 4 kg object accelerates at 2 m/s². Calculate its net force and explain the relationship.",
      learning_record: "",
      notes_markdown: "",
    };
    if (request.kind === "resume") return plan;
    if (request.kind === "chat")
      return {
        ...plan,
        message: "You multiplied mass by acceleration for the new example.",
        learning_record:
          "# Corrective force example\nThe learner applies mass times acceleration; this is immediate correction.",
        calls: [
          {
            name: "record_retrieval_check",
            arguments_json: JSON.stringify({
              classroom: "rust",
              review_key: `${lesson}/check/force`,
              answer: readTeacherState("rust")!.messages.find(
                (m) => m.id === request.id && m.role === "learner",
              )!.text,
              evidence: "Applies the relationship in the new example.",
              assistance: "none",
            }),
          },
        ],
      };
    if (fail) {
      fail = false;
      throw new Error("Fixture grading unavailable. Retry explicitly.");
    }
    const s = store.findSubmission(request.target)!;
    return {
      ...plan,
      message: "Your pretest is graded. Continue reading.",
      calls: [
        {
          name: "grade_quiz_answers",
          arguments_json: JSON.stringify({
            submission_id: s.id,
            feedback_markdown: "Saved format feedback.",
            questions: s.answers
              .filter((a) => !s.deterministicGrades?.some((g) => g.questionId === a.questionId))
              .map((a) => ({
                question_id: a.questionId,
                correct: true,
                points_earned: a.type === "code" ? 2 : 1,
                points_possible: a.type === "code" ? 2 : 1,
                feedback: "Saved reasoning.",
                criteria: s.rubricCriteria![a.questionId].map((c) => ({
                  criterion_id: c.id,
                  points_earned: c.points,
                  feedback: "Saved criterion reasoning.",
                })),
              })),
          }),
        },
      ],
    };
  });
  teacher.attach("rust", "codex");
  teacher.connect();
  const session = `studens-expected-${process.pid}`;
  let opened = false;
  try {
    const base = await server.start(0);
    await playwright(session, f.root, "open", `${base}/c/rust/${lesson}`);
    opened = true;
    const anchor = await playwrightCode<{ after: string }>(
      session,
      f.root,
      `async page=>{
      let release;const held=new Promise(resolve=>release=resolve);
      await page.route('**/api/quiz/expected?**',async route=>{await held;await route.continue()});
      await page.reload();await page.locator('form[data-state="graded"]').waitFor();
      const before=await page.evaluate(async()=>{const m=await import('/static/lesson-dom.mjs');return m.buildTextIndex(document.querySelector('main')).text});
      release();await page.locator('.cl-expected[data-status="available"]').waitFor();
      await page.unroute('**/api/quiz/expected?**');
      const result=await page.evaluate(async before=>{
        const m=await import('/static/lesson-dom.mjs'),root=document.querySelector('main'),index=m.buildTextIndex(root);
        const expected=root.querySelector('.cl-expected-value').firstChild,prompt=root.querySelector('.cl-q-prompt').firstChild;
        const start=index.text.indexOf(prompt.textContent),range=m.rangeFromOffsets(index,start,start+prompt.textContent.length);
        return {before,after:index.text,expectedOutside:m.outsideIndex(expected),promptOutside:m.outsideIndex(prompt),promptRange:range?.toString(),offsets:range&&m.offsetsFromRange(index,range)};
      },before);
      if(result.before!==result.after||!result.expectedOutside||result.promptOutside||!result.offsets||!result.promptRange.includes('net force'))throw new Error('Expected panel changed canonical text anchors: '+JSON.stringify(result));
      const highlightText=${highlightText.toString()};
      await highlightText(page,'.cl-q-prompt >> nth=0','net force');await page.locator('.cl-ask-pill').waitFor({state:'visible'});
      await page.evaluate(()=>getSelection().removeAllRanges());await page.locator('h1').click();
      return result;
    }`,
    );
    save("anchor-arrival", anchor);
    save(
      "initial",
      await playwrightCode(
        session,
        f.root,
        `async page=>{
      await page.locator('.cl-expected[data-status="available"]').waitFor();
      if(await page.locator('.cl-expected[data-status="waiting"]').count()!==1)throw new Error('Miss released early');
      const screenshots=[];for(const [name,width,height] of [['desktop',1280,900],['mobile',375,812]]){await page.setViewportSize({width,height});for(const colorScheme of ['light','dark']){await page.emulateMedia({colorScheme});const file=${JSON.stringify(artifacts)}+'/after-'+name+'-'+colorScheme+'.png';await page.screenshot({path:file,fullPage:true});screenshots.push(file);}}
      return {screenshots,text:await page.locator('.cl-expected').allTextContents()};
    }`,
      ),
    );
    teacher.resume({ classroom: "rust", lesson, submission_id: sub.id });
    await teacher.idle();
    save("corrective-before", readTeacherState("rust"));
    await playwrightCode(
      session,
      f.root,
      `async page=>{await page.locator('.cl-teacher textarea').fill('8 N, because force equals 4 kg times 2 m/s². No help.');await page.locator('.cl-teacher button[type="submit"]').click();await page.locator('[data-question-id="force"] .cl-expected[data-status="available"]').waitFor();return true;}`,
    );
    await teacher.idle();
    save("corrective-after", readTeacherState("rust"));
    const beforeReads = JSON.stringify({
      grades: store.listGrades("rust", lesson),
      events: store.reviewEvents("rust"),
      checks: store.listRetrievalChecks("rust"),
    });
    save(
      "reload-probes",
      await playwrightCode(
        session,
        f.root,
        `async page=>{
      const second=await page.context().newPage();await second.goto(page.url());await second.locator('[data-question-id="force"] .cl-expected[data-status="available"]').waitFor();
      await page.reload();await page.locator('[data-question-id="force"] .cl-expected[data-status="available"]').waitFor();
      if(!await second.locator('[data-question-id="reason"] > textarea').isDisabled())throw new Error('Second tab unlocked');
      const query=new URLSearchParams({classroom:'rust',lesson:${JSON.stringify(lesson)},quizId:'check',submissionId:${JSON.stringify(sub.id)}});
      const results=[];for(const patch of [{submissionId:'other'},{quizId:'private'},{lesson:'003-neighbor'},{classroom:'other'},{classroom:'../rust'}]){const p=new URLSearchParams(query);for(const [k,v]of Object.entries(patch))p.set(k,v);const r=await page.request.get(${JSON.stringify(base)}+'/api/quiz/expected?'+p);if(r.status()<400)throw new Error('Accepted tampered target');results.push({patch,status:r.status(),body:await r.json()});}
      await page.setViewportSize({width:375,height:812});await page.screenshot({path:${JSON.stringify(path.join(artifacts, "corrective-mobile-dark.png"))},fullPage:true});await second.close();return results;
    }`,
      ),
    );
    if (
      beforeReads !==
      JSON.stringify({
        grades: store.listGrades("rust", lesson),
        events: store.reviewEvents("rust"),
        checks: store.listRetrievalChecks("rust"),
      })
    )
      throw new Error("Reveal/reload changed grades or learning evidence");
    const keyFile = path.join(f.root, "rust", lesson, "quiz/key.json"),
      original = fs.readFileSync(keyFile);
    fs.writeFileSync(keyFile, '{"changed":true}');
    await playwrightCode(
      session,
      f.root,
      `async page=>{await page.reload();await page.getByRole('button',{name:'Retry expected answer',exact:true}).first().waitFor();return true;}`,
    );
    fs.writeFileSync(keyFile, original);
    await playwrightCode(
      session,
      f.root,
      `async page=>{await page.getByRole('button',{name:'Retry expected answer',exact:true}).first().focus();await page.keyboard.press('Enter');await page.locator('[data-question-id="reason"] .cl-expected[data-status="available"]').waitFor();return true;}`,
    );
    save(
      "anchor-retry",
      await playwrightCode(
        session,
        f.root,
        `async page=>{
      return await page.evaluate(async before=>{const m=await import('/static/lesson-dom.mjs'),after=m.buildTextIndex(document.querySelector('main')).text;
      if(before!==after)throw new Error('Expected answer error/retry changed canonical text index');return {before,after};},${JSON.stringify(anchor.after)});
    }`,
      ),
    );
    save(
      "formats",
      await playwrightCode(
        session,
        f.root,
        `async page=>{
      await page.goto(${JSON.stringify(base)}+'/c/rust/002-formats');await page.locator('form[data-state="fresh"]').first().waitFor();
      if(await page.locator('.cl-expected').count())throw new Error('Fresh page contains expected answer');
      const traffic=[];page.on('response',async r=>{if(r.url().includes('/api/')){const body=await r.text().catch(()=> '');if(body.includes('NEVER-EXPOSE'))traffic.push(body);}});
      await page.locator('form[data-quiz-id="short"] textarea').fill('My explanation');await page.locator('form[data-quiz-id="short"] button[type="submit"]').click();await page.getByRole('button',{name:'Retry request',exact:true}).waitFor();
      const saved=await(await page.request.get(${JSON.stringify(base)}+'/api/state?classroom=rust&lesson=002-formats')).json();
      const pending=saved.quizzes[0].submission;const waiting=await(await page.request.get(${JSON.stringify(base)}+'/api/quiz/expected?'+new URLSearchParams({classroom:'rust',lesson:'002-formats',quizId:'short',submissionId:pending.id}))).json();if(waiting.questions.q.status!=='waiting'||waiting.questions.q.expected)throw new Error('Failed grade released key');
      await page.reload();await page.getByRole('button',{name:'Retry request',exact:true}).waitFor();await page.getByRole('button',{name:'Retry request',exact:true}).click();await page.locator('form[data-quiz-id="short"] .cl-expected[data-status="available"]').waitFor();
      const selectors={choice:'input[value="b"]',multi:'input[value="a"]'};for(const [type,selector]of Object.entries(selectors))await page.locator('form[data-quiz-id="'+type+'"] '+selector).check();
      await page.locator('form[data-quiz-id="term"] input').first().fill('attempt');await page.locator('form[data-quiz-id="numeric"] .cl-number').fill('3');
      for(const input of await page.locator('form[data-quiz-id="cloze"] [data-blank]').all())await input.fill('attempt');
      await page.locator('form[data-quiz-id="locate"] .cl-segment').first().click();
      await page.locator('form[data-quiz-id="match"] select').first().selectOption('right'); await page.locator('form[data-quiz-id="match"] select').nth(1).selectOption('right2');
      for(const type of ['choice','multi','term','numeric','cloze','order','match','locate','code']){const form=page.locator('form[data-quiz-id="'+type+'"]');await form.locator('.cl-quiz-footer button[type="submit"]').click();await form.locator('.cl-expected[data-status="available"]').waitFor();}
      const rendered=await page.locator('.cl-expected-value').allTextContents();for(const expected of ['Alpha option','First option; Second option','6 N (tolerance: ±0.1)','Left item → Right item','Second segment','Blank agent: owner or holder'])if(!rendered.some(t=>t.includes(expected)))throw new Error('Unreadable expected format: '+expected+' '+JSON.stringify(rendered));
      if(await page.locator('form[data-quiz-id="private"] .cl-expected').count())throw new Error('Private sibling displayed');
      for(const file of ['quiz/key.json','quiz/plan.json','quiz/submissions/unknown.json','quiz/grades/unknown.json','.teacher.json'])if((await page.request.get(page.url()+'/'+file)).status()!==404)throw new Error('Private file served');
      if(traffic.length)throw new Error('Private sibling appeared in API traffic');
      await page.screenshot({path:${JSON.stringify(path.join(artifacts, "formats-mobile-dark.png"))},fullPage:true});
      return {rendered,waiting,privateTraffic:traffic.length};
    }`,
      ),
    );
    await teacher.idle();
    save("result", {
      turns,
      gradeUnchanged: store.listGrades("rust", lesson).length === 1,
      teacher: readTeacherState("rust"),
      checks: store.listRetrievalChecks("rust"),
    });
  } finally {
    fs.cpSync(f.root, path.join(artifacts, "classroom"), { recursive: true });
    if (opened) await playwright(session, f.root, "close");
    await teacher.stop();
    await server.close();
    f.cleanup();
  }
}
if (process.argv[1]?.endsWith("e2e-expected-answers.ts"))
  await verifyExpectedAnswers(path.resolve(process.argv[2] ?? "/tmp/studens-expected-answers"));
