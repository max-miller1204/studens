import { saveLessonRequests } from "../src/store/lesson-requests.ts";
import { highlightText } from "./browser-actions.ts";
/** Public four-domain search, exact source navigation and isolation on real loopback HTTP. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { makeFixture, seedClassroom, lessonHtml } from "../test/helpers.ts";
import { applyAnswer } from "../src/answers.ts";
import { applyGrade } from "../src/quiz-grading.ts";
import * as server from "../src/server.ts";
import * as store from "../src/store.ts";
import { playwright, playwrightCode } from "./playwright.ts";

function hashes(root: string) {
  return Object.fromEntries(
    fs
      .readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => {
        const file = path.join(e.parentPath, e.name);
        return [
          path.relative(root, file),
          createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
        ];
      })
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}
export async function verifySearchBrowser(artifacts: string | null): Promise<void> {
  const f = makeFixture(),
    session = `studens-search-${process.pid}`,
    out = artifacts ?? fs.mkdtempSync(path.join(os.tmpdir(), "studens-search-evidence-"));
  fs.mkdirSync(out, { recursive: true });
  seedClassroom(f, { classroom: "rust", title: "Rust" });
  seedClassroom(f, { classroom: "math", title: "Mathematics" });
  const id = randomUUID(),
    orphan = randomUUID();
  const content = lessonHtml(
    "Ownership",
    `<p data-search-prose>Borrow checker uses café λ and <code>Vec&lt;T&gt;</code>.</p><p>Borrow checker repeated.</p><p>Borrow checker repeated.</p><p>Literal &lt;img src=x onerror=alert(1)&gt; remains text.</p><p data-adjacent>Every value has one owner.</p><p data-search-math>A move costs \\(O(1)\\), and \\(n\\) moves cost \\(O(n)\\).</p><form class="cl-quiz" data-quiz-id="search-check" data-title="Search adjacent"><ol class="cl-questions"><li class="cl-q" data-question-id="q1" data-type="short"><p class="cl-q-prompt">Explain ownership.</p><textarea></textarea></li></ol></form>`,
  );
  f.write("rust/001-ownership/lesson.html", content);
  f.write(
    "math/001-ownership/lesson.html",
    lessonHtml("Vectors", "<p>Borrow checker analogy for λ.</p>"),
  );
  f.write(
    "rust/GLOSSARY.md",
    "**Borrow checker**:\nValidates café λ references.\n\n**<img src=x onerror=alert(1)>**:\nA literal markup example.\n",
  );
  f.write(
    "rust/learning-records/0001-borrow.md",
    "# Borrow checker reflection\n\nI reasoned about λ and `Vec<T>`.\n",
  );
  const card = (cardId: string, question: string, exact: string) => ({
    id: cardId,
    classroom: "rust",
    lesson: "001-ownership",
    status: "answered",
    question,
    selection: exact,
    anchor: { exact, prefix: "", suffix: "", occurrence: 0 },
    answerMarkdown: "The borrow checker keeps references valid.",
    answerHtml: "<p>The borrow checker keeps references valid.</p>",
    createdAt: 1,
    answeredAt: 2,
    followUps: [],
  });
  f.write(
    "rust/001-ownership/annotations.json",
    JSON.stringify([
      card(id, "Why does the borrow checker reject café?", "Borrow checker"),
      card(orphan, "Borrow checker orphan context?", "Removed original sentence."),
    ]),
  );
  f.write("rust/001-ownership/quiz/key.json", JSON.stringify({ secret: "PRIVATE_SEARCH_CANARY" }));
  f.write("rust/001-ownership/quiz/privatevariants.json", "PRIVATE_SEARCH_CANARY");
  f.write(
    "rust/001-ownership/drafts.json",
    JSON.stringify({ version: 1, quizzes: {}, questions: {}, reflections: {} }),
  );
  const mathId = randomUUID();
  f.write("math/GLOSSARY.md", "**Borrow checker analogy**:\nA comparison for vectors.\n");
  f.write(
    "math/learning-records/0001-vectors.md",
    "# Borrow checker analogy\n\nVector reflection.\n",
  );
  f.write(
    "math/001-ownership/annotations.json",
    JSON.stringify([
      { ...card(mathId, "Borrow checker vector question?", "Borrow checker"), classroom: "math" },
    ]),
  );
  // Match the base shell's deterministic Mathematics / Rust card order.
  for (const classroom of ["rust", "math"]) {
    const at = classroom === "math" ? 4 : 3;
    fs.utimesSync(path.join(f.root, classroom), at, at);
    fs.utimesSync(path.join(f.root, classroom, "001-ownership"), at, at);
  }
  let opened = false,
    asks = 0,
    grades = 0;
  server.setHooks({
    delivery: "wait",
    onAsk(a) {
      asks++;
      applyAnswer(a.id, "The owner releases the value.");
    },
    onFollowUp() {
      throw new Error("Unexpected follow-up during search");
    },
    onReflect() {
      throw new Error("Unexpected reflection during search");
    },
    onQuizSubmit(s) {
      grades++;
      applyGrade(s, {
        score: 100,
        feedbackMarkdown: "Ownership explanation accepted.",
        questions: [{ questionId: "q1", correct: true, feedback: "One owner releases the value." }],
      });
    },
  });
  const report: Record<string, unknown> = {};
  const readonly = (before: ReturnType<typeof hashes>, label: string) => {
    const after = hashes(f.root);
    fs.writeFileSync(
      path.join(out, label + "-hashes.json"),
      JSON.stringify(
        { before, after, equal: JSON.stringify(before) === JSON.stringify(after) },
        null,
        2,
      ),
    );
    if (JSON.stringify(before) !== JSON.stringify(after) || asks || grades)
      throw new Error(label + ": search wrote state or invoked teacher");
  };
  try {
    const base = await server.start(0),
      before = hashes(f.root);
    await playwright(session, out, "open", base);
    opened = true;
    report.public = await playwrightCode(
      session,
      out,
      `async page=>{
  const errors=[],writes=[],dialogs=[];page.on('dialog',d=>dialogs.push(d.message()));page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url());});
  const shots=[];for(const [size,width,height]of [['desktop',1280,900],['mobile',390,844]])for(const theme of ['light','dark']){await page.setViewportSize({width,height});await page.evaluate(t=>localStorage.setItem('pi-classroom-theme',t),theme);await page.goto(${JSON.stringify(base)});await page.screenshot({path:${JSON.stringify(out)}+'/landing-'+size+'-'+theme+'.png',fullPage:true});shots.push({screen:'landing',size,theme});}
  await page.getByRole('link',{name:'Search across classrooms',exact:true}).focus();await page.keyboard.press('Enter');
  await page.getByRole('status').filter({hasText:'Enter a word'}).waitFor();
  const search=async q=>{await page.getByRole('searchbox').fill(q);await page.getByRole('button',{name:'Search',exact:true}).click();await page.getByRole('searchbox').waitFor();};
  await search('Borrow checker');const resultURL=page.url();
  const rows=page.locator('.cl-search-results > li');if(await rows.count()!==11)throw new Error('Four-domain count: '+await rows.count());
  for(const kind of ['Lesson','Question thread','Glossary term','Learning record'])if(!await rows.filter({has:page.locator('.cl-search-source',{hasText:kind})}).count())throw new Error('Missing domain '+kind);
  if(!await rows.filter({hasText:'Mathematics'}).count())throw new Error('Second classroom missing');
  for(const [size,width,height]of [['desktop',1280,900],['mobile',390,844]])for(const theme of ['light','dark']){await page.setViewportSize({width,height});await page.evaluate(t=>localStorage.setItem('pi-classroom-theme',t),theme);await page.reload();if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Search overflow');await page.screenshot({path:${JSON.stringify(out)}+'/results-'+size+'-'+theme+'.png',fullPage:true});}
  const links=await rows.locator('h2 a').evaluateAll(nodes=>nodes.map(n=>({url:n.href,title:n.textContent,kind:n.closest('li').querySelector('.cl-search-source').textContent})));
  for(let i=0;i<links.length;i++){
   await page.goto(resultURL);const link=page.locator('.cl-search-results h2 a').nth(i);await link.click();
   if(links[i].kind.includes('Question thread'))await page.locator('[id="'+new URL(links[i].url).hash.slice(1)+'"]').filter({hasText:links[i].title}).waitFor({state:'visible'});
   else {const hash=new URL(links[i].url).hash.slice(1);await page.locator('[id="'+hash+'"]').waitFor({state:'attached'});if(!await page.locator('[id="'+hash+'"]').evaluate(e=>(e.classList.contains('cl-search-anchor')?e.parentElement:e).textContent.toLowerCase().includes('borrow checker')))throw new Error('Wrong passage destination');}
   await page.screenshot({path:${JSON.stringify(out)}+'/destination-'+i+'.png',fullPage:true});await page.goBack();if(await page.getByRole('searchbox').inputValue()!=='Borrow checker')throw new Error('Back lost query');
  }
  await search('café');if(!await page.locator('.cl-search-results mark').count())throw new Error('Unicode match missing');
  await search('Vec<T>');if(await page.locator('.cl-search-results li').count()!==2)throw new Error('Code punctuation failed');
  await search('<img src=x onerror=alert(1)>');if(await page.locator('.cl-search-results img').count())throw new Error('Unsafe snippet markup');await page.locator('.cl-search-results li').filter({has:page.locator('.cl-search-source',{hasText:'Glossary term'})}).locator('h2 a').click();if(await page.locator('article img').count())throw new Error('Unsafe term source');await page.goBack();
  await search('O(n)');await page.locator('.cl-search-results h2 a').click();await page.locator('[data-search-math] .cl-math > math').nth(2).waitFor();if(await page.locator('[data-search-math]').getAttribute('id')!==new URL(page.url()).hash.slice(1))throw new Error('Wrong math passage');await page.screenshot({path:${JSON.stringify(out)}+'/destination-math.png',fullPage:true});await page.goBack();
  await search('NO_RESULTS_SEARCH');await page.getByRole('status').filter({hasText:'No results'}).waitFor();await page.screenshot({path:${JSON.stringify(out)}+'/no-results.png',fullPage:true});
  await search('PRIVATE_SEARCH_CANARY');await page.getByRole('status').filter({hasText:'No results'}).waitFor();if((await page.locator('.cl-search-results').count()))throw new Error('Private hit');
  await page.goto(${JSON.stringify(base + "/search?q=")});await page.getByRole('status').filter({hasText:'Enter a word'}).waitFor();
  if(errors.length||writes.length||dialogs.length)throw new Error(JSON.stringify({errors,writes,dialogs}));return {links,shots,errors,writes,dialogs,math:true,keyboard:true,backQuery:true,unicode:true,code:true,xss:true,privateExactQuery:true};
 }`,
    );
    readonly(before, "public");
    // Valid HTML optional closures must remain readable and resolve each sibling
    // passage independently, including nested list and table scopes.
    const optionalSource =
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Legacy reading</title></head><body><h1>Legacy reading</h1><p>First visible paragraph.<p>Second visible paragraph.<ul><li>Outer first.<ul><li>Inner first.<li>Inner second.</ul><li>Outer second.</ul><table><thead><tr><th>Heading one.<th>Heading two.<tbody><tr><td>Cell one.<table><tr><td>Nested cell one.<td>Nested cell two.</table><td>Cell two.<tr><td>Cell three.<td>Cell four.</table><p>Entity caf&eacute; &alpha; &copy; &NotEqualTilde; &amp;lt;script&amp;gt;<p>Last visible paragraph.';
    f.write("rust/001-ownership/lesson.html", optionalSource);
    const optionalHashes = hashes(f.root);
    report.optionalTags = await playwrightCode(
      session,
      out,
      `async page=>{
        const sourceResponse=await page.goto(${JSON.stringify(base + "/c/rust/001-ownership")});
        if(sourceResponse.status()!==200)throw new Error('Optional end tags broke public lesson');
        const cases=[['First visible paragraph.','P'],['Second visible paragraph.','P'],['Inner second.','LI'],['Outer second.','LI'],['Nested cell two.','TD'],['Cell four.','TD'],['Entity café α © ≂̸ &lt;script&gt;','P'],['Last visible paragraph.','P']];
        for(const [text,tag]of cases){
          const response=await page.goto(${JSON.stringify(base + "/search?q=")}+encodeURIComponent(text));
          if(response.status()!==200||await page.locator('.cl-search-results h2 a').count()!==1)throw new Error('Optional passage search '+text);
          await page.locator('.cl-search-results h2 a').click();const id=new URL(page.url()).hash.slice(1);
          const target=page.locator('[id="'+id+'"]');await target.waitFor({state:'visible'});
          if(!await target.evaluate((e,expected)=>e.tagName===expected.tag&&e.innerText.trim()===expected.text,{text,tag}))throw new Error('Wrong optional passage '+text);
        }
        await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>localStorage.setItem('pi-classroom-theme','light'));await page.reload();
        await page.screenshot({path:${JSON.stringify(path.join(out, "optional-tags.png"))},fullPage:true});
        await page.setViewportSize({width:390,height:844});await page.evaluate(()=>localStorage.setItem('pi-classroom-theme','dark'));await page.goto(${JSON.stringify(base + "/search?q=")});
        return {status:sourceResponse.status(),exactPassages:cases.length,nestedList:true,nestedTable:true,html5Entities:true,noDoubleDecode:true};
      }`,
    );
    readonly(optionalHashes, "optional-tags");
    const legacyResults = await fetch(base + "/search?q=Last+visible+paragraph.");
    const legacyLink = /href="([^"]+#cl-search-[^"]+)"/.exec(await legacyResults.text())?.[1];
    if (!legacyLink) throw new Error("No legacy source link");
    f.write(
      "rust/001-ownership/lesson.html",
      optionalSource.replace("Last visible paragraph.", "Edited legacy passage."),
    );
    const legacyHashes = hashes(f.root);
    report.legacyStale = await playwrightCode(
      session,
      out,
      `async page=>{await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>localStorage.setItem('pi-classroom-theme','light'));await page.goto(${JSON.stringify(base)}+${JSON.stringify(legacyLink)});if(await page.locator('main').count())throw new Error('Legacy fixture unexpectedly has main');await page.getByRole('status').filter({hasText:'This exact passage is no longer available'}).waitFor();await page.locator('[data-cl-search-notice]').getByRole('link',{name:'Search across classrooms',exact:true}).waitFor();await page.screenshot({path:${JSON.stringify(path.join(out, "legacy-stale.png"))},fullPage:true});await page.setViewportSize({width:390,height:844});await page.evaluate(()=>localStorage.setItem('pi-classroom-theme','dark'));await page.goto(${JSON.stringify(base + "/search?q=")});return {noMain:true,honestNotice:true,searchNavigation:true};}`,
    );
    readonly(legacyHashes, "legacy-stale");
    f.write("rust/001-ownership/lesson.html", content);
    // Source edits invalidate exact anchors; no stale offset or duplicate guess.
    const searchResponse = await fetch(
      base + "/search?q=" + encodeURIComponent("Borrow checker repeated."),
    );
    const html = await searchResponse.text();
    const old = /href="([^"]+#cl-search-[^"]+)"/.exec(html)?.[1];
    if (!old) throw new Error("No repeated passage link");
    f.write(
      "rust/001-ownership/lesson.html",
      content.replace("<p>Borrow checker repeated.</p>", ""),
    );
    const edited = hashes(f.root);
    report.edited = await playwrightCode(
      session,
      out,
      `async page=>{await page.goto(${JSON.stringify(base + old)});await page.getByRole('status').filter({hasText:'This exact passage is no longer available'}).waitFor();await page.screenshot({path:${JSON.stringify(path.join(out, "edited-passage.png"))},fullPage:true});return {honestMissingPassage:true};}`,
    );
    readonly(edited, "edited");
    f.write("rust/001-ownership/lesson.html", content);
    const glossary = fs.readFileSync(path.join(f.root, "rust/GLOSSARY.md"), "utf8");
    f.write("rust/GLOSSARY.md", "**MALFORMED_PRIVATE_BYTES**\nMissing colon.");
    const malformed = hashes(f.root);
    report.error = await playwrightCode(
      session,
      out,
      `async page=>{const response=await page.goto(${JSON.stringify(base + "/search?q=caf%C3%A9")});if(response.status()!==500)throw new Error('Malformed source did not fail');await page.getByRole('alert').filter({hasText:'rust/GLOSSARY.md: invalid glossary format'}).waitFor();if((await page.content()).includes('MALFORMED_PRIVATE_BYTES'))throw new Error('Error leaked source bytes');await page.screenshot({path:${JSON.stringify(path.join(out, "error.png"))},fullPage:true});return {status:response.status(),safeError:true};}`,
    );
    readonly(malformed, "error");
    f.write("rust/GLOSSARY.md", glossary);
    report.retry = await playwrightCode(
      session,
      out,
      `async page=>{await page.getByRole('heading',{name:'Cannot load search',exact:true}).waitFor();await page.getByRole('link',{name:'Retry search',exact:true}).click();if(await page.getByRole('searchbox').inputValue()!=='café')throw new Error('Retry lost query');await page.getByRole('status').filter({hasText:'matching'}).waitFor();return {explicitRetry:true};}`,
    );
    const secret = path.join(f.root, "rust/001-ownership/quiz/key.json"),
      link = path.join(f.root, "rust/learning-records/leak.md");
    fs.symlinkSync(secret, link);
    const linked = hashes(f.root);
    report.symlink = await playwrightCode(
      session,
      out,
      `async page=>{const r=await page.goto(${JSON.stringify(base + "/search?q=PRIVATE_SEARCH_CANARY")});if(r.status()!==500)throw new Error('Symlink did not fail');await page.getByRole('alert').filter({hasText:'symlinks are not allowed'}).waitFor();return {status:r.status(),guarded:true};}`,
    );
    readonly(linked, "symlink");
    fs.unlinkSync(link);
    const probes = [];
    for (const route of [
      "/doc/rust/learning-records/..%2f001-ownership%2fquiz%2fkey.json",
      "/c/rust/001-ownership/quiz/key.json",
      "/search/source?classroom=..%2Frust&type=glossary&term=Borrow",
      "/search/source?classroom=rust&type=glossary&term=Deleted",
    ]) {
      const response = await fetch(base + route),
        text = await response.text();
      if (response.status !== 404 || text.includes("PRIVATE_SEARCH_CANARY"))
        throw new Error("Private route " + route);
      probes.push({ route, status: response.status });
    }
    report.probes = probes;
    f.write(
      "math/learning-records/pagination.md",
      Array.from({ length: 90 }, (_, i) => `Paragraph ${i} with paginated needle.\n\n`).join(""),
    );
    const paginationHashes = hashes(f.root);
    report.pagination = await playwrightCode(
      session,
      out,
      `async page=>{await page.goto(${JSON.stringify(base + "/search?q=paginated+needle")});await page.getByRole('status').filter({hasText:'90 matching results'}).waitFor();if(await page.locator('.cl-search-results li').count()!==40)throw new Error('First page not bounded');await page.getByRole('link',{name:'Next results',exact:true}).click();if(await page.locator('.cl-search-results').getAttribute('start')!=='41')throw new Error('Second page offset');await page.getByRole('link',{name:'Next results',exact:true}).click();if(await page.locator('.cl-search-results li').count()!==10||await page.getByRole('link',{name:'Next results',exact:true}).count())throw new Error('Last page incomplete');await page.getByRole('link',{name:'Previous results',exact:true}).click();if(await page.getByRole('searchbox').inputValue()!=='paginated needle')throw new Error('Page query lost');await page.getByRole('searchbox').fill('');await page.getByRole('button',{name:'Search',exact:true}).click();await page.getByRole('status').filter({hasText:'Enter a word'}).waitFor();return {total:90,pages:[40,40,10],nextPrevious:true,clearToEmpty:true};}`,
    );
    readonly(paginationHashes, "pagination");
    const reviewId = randomUUID(),
      review = `review-${reviewId}`,
      reviewRelative = `rust/.reviews/${review}`;
    f.write(
      "rust/.reviews.json",
      JSON.stringify({
        version: 1,
        requests: [
          {
            id: reviewId,
            classroom: "rust",
            lesson: review,
            owner: "service",
            ownerPid: process.pid,
            at: 1,
            status: "done",
            items: [{ key: "001-ownership/search-check/q1" }],
          },
        ],
      }),
    );
    f.write(`${reviewRelative}/lesson.json`, JSON.stringify({ kind: "review", title: "Review" }));
    f.write(
      `${reviewRelative}/lesson.html`,
      lessonHtml(
        "Review",
        '<form class="cl-quiz" data-quiz-id="review-pretest" data-kind="pretest"><p>Predict review first.</p></form><template data-cl-after-pretest="review-pretest"><p>REVIEW_SEARCH_CANARY</p></template>',
      ),
    );
    const historySecret = f.write(
      "private-review-history.json",
      JSON.stringify({ private: "PRIVATE_SEARCH_CANARY" }),
    );
    const historyLink = path.join(f.root, reviewRelative, "quiz/submissions/trap.json");
    fs.mkdirSync(path.dirname(historyLink), { recursive: true });
    fs.symlinkSync(historySecret, historyLink);
    const historyHashes = hashes(f.root);
    report.reviewHistoryError = await playwrightCode(
      session,
      out,
      `async page=>{const r=await page.goto(${JSON.stringify(base + "/search?q=Predict+review")});if(r.status()!==500)throw new Error('Review history symlink was read');await page.getByRole('alert').filter({hasText:'invalid pretest gate or saved history'}).waitFor();if((await page.content()).includes('PRIVATE_SEARCH_CANARY'))throw new Error('Private history leaked');return {status:r.status(),safeError:true};}`,
    );
    readonly(historyHashes, "review-history");
    fs.unlinkSync(historyLink);
    report.reviewHistoryRetry = await playwrightCode(
      session,
      out,
      `async page=>{await page.getByRole('heading',{name:'Cannot load search',exact:true}).waitFor();await page.getByRole('link',{name:'Retry search',exact:true}).click();await page.getByRole('status').filter({hasText:'1 matching result'}).waitFor();await page.getByRole('searchbox').fill('REVIEW_SEARCH_CANARY');await page.getByRole('button',{name:'Search',exact:true}).click();await page.getByRole('status').filter({hasText:'No results'}).waitFor();return {explicitRetry:true,gateWithheld:true};}`,
    );
    const annotations = fs.readFileSync(
      path.join(f.root, "rust/001-ownership/annotations.json"),
      "utf8",
    );
    f.write("rust/001-ownership/annotations.json", "[]");
    report.deletedCard = await playwrightCode(
      session,
      out,
      `async page=>{await page.goto(${JSON.stringify(base + "/c/rust/001-ownership#cl-question-" + id)});await page.getByRole('status').filter({hasText:'This question card is no longer available'}).waitFor();return {honestDeletedCard:true};}`,
    );
    f.write("rust/001-ownership/annotations.json", annotations);
    report.missingSources = await playwrightCode(
      session,
      out,
      `async page=>{const record=await page.goto(${JSON.stringify(base + "/doc/rust/learning-records/deleted.md#cl-search-missing")});if(record.status()!==404)throw new Error('Missing record not honest');const term=await page.goto(${JSON.stringify(base + "/search/source?classroom=rust&type=glossary&term=Deleted")});if(term.status()!==404)throw new Error('Missing term not honest');return {record:record.status(),term:term.status()};}`,
    );
    seedClassroom(f, { classroom: "rust", lesson: "002-gated" });
    f.write(
      "rust/002-gated/lesson.html",
      lessonHtml(
        "Predict",
        '<form class="cl-quiz" data-quiz-id="search-pretest" data-kind="pretest"><ol class="cl-questions"><li class="cl-q" data-question-id="q1" data-type="short"><p class="cl-q-prompt">Predict ownership.</p><textarea></textarea></li></ol></form><template data-cl-after-pretest="search-pretest"><p>SEARCH_GATED_CANARY café.</p></template>',
      ),
    );
    seedClassroom(f, { classroom: "rust", lesson: "003-unpublished" });
    f.write(
      "rust/003-unpublished/lesson.html",
      lessonHtml("UNPUBLISHED_SEARCH_CANARY", "<p>UNPUBLISHED_SEARCH_CANARY</p>"),
    );
    saveLessonRequests("rust", [
      {
        id: randomUUID(),
        classroom: "rust",
        lesson: "003-unpublished",
        topic: "UNPUBLISHED_SEARCH_CANARY",
        owner: "pi",
        ownerPid: process.pid,
        at: 1,
        status: "failed",
        error: "Publication held for the search visibility fixture.",
      },
    ]);
    const gatedHashes = hashes(f.root);
    report.hidden = await playwrightCode(
      session,
      out,
      `async page=>{for(const q of ['SEARCH_GATED_CANARY','UNPUBLISHED_SEARCH_CANARY']){await page.goto(${JSON.stringify(base + "/search?q=")}+encodeURIComponent(q));await page.getByRole('status').filter({hasText:'No results'}).waitFor();}return {pretestWithheld:true,unpublishedWithheld:true};}`,
    );
    readonly(gatedHashes, "gated");
    report.pretest = await playwrightCode(
      session,
      out,
      `async page=>{await page.goto(${JSON.stringify(base + "/c/rust/002-gated")});await page.waitForFunction(()=>document.querySelector('[data-quiz-id="search-pretest"]')?.dataset.state==='fresh');if((await page.content()).includes('SEARCH_GATED_CANARY'))throw new Error('Gate leaked lesson');await page.locator('[data-quiz-id="search-pretest"] textarea').fill('I predict one owner.');await page.getByRole('button',{name:'Submit for grading',exact:true}).click();await page.getByText('SEARCH_GATED_CANARY café.',{exact:true}).waitFor();await page.goto(${JSON.stringify(base + "/search?q=SEARCH_GATED_CANARY")});await page.getByRole('status').filter({hasText:'1 matching result'}).waitFor();await page.locator('.cl-search-results h2 a').click();await page.getByText('SEARCH_GATED_CANARY café.',{exact:true}).waitFor();return {releasedAfterActualSavedGrade:true,exactReleasedLink:true};}`,
    );
    // Normal adjacent user actions use existing fixture teacher/grade boundaries, not a model.
    report.adjacent = await playwrightCode(
      session,
      out,
      `async page=>{
 await page.goto(${JSON.stringify(base + "/c/rust/001-ownership")});await page.waitForFunction(()=>document.querySelector('[data-quiz-id="search-check"]')?.dataset.state==='fresh');
 await (${highlightText.toString()})(page,'[data-adjacent]','Every value has one owner.');await page.locator('.cl-ask-pill').click();await page.locator('[data-cl-question]').fill('Who releases this value?');await page.locator('[data-cl-ask-form]').getByRole('button',{name:'Ask your teacher',exact:true}).click();await page.getByText('The owner releases the value.',{exact:true}).waitFor();
 await page.locator('[data-quiz-id="search-check"] textarea').fill('Every value has one owner.');await page.locator('[data-quiz-id="search-check"]').getByRole('button',{name:'Submit for grading',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-quiz-id="search-check"]')?.dataset.state==='graded');await page.reload();await page.waitForFunction(()=>document.querySelector('[data-quiz-id="search-check"]')?.dataset.state==='graded');return {askAnswered:true,quizGraded:true,reload:true};
 }`,
    );
    if (
      asks !== 1 ||
      grades !== 2 ||
      store.listSubmissions("rust", "001-ownership").length !== 1 ||
      store.latestGrades("rust", "001-ownership").length !== 1
    )
      throw new Error("Adjacent persistence count mismatch");
    report.counts = { asks, grades };
    fs.writeFileSync(path.join(out, "result.json"), JSON.stringify(report, null, 2));
    console.log(
      "PASS: four-domain public search and source navigation, canonical edits, Unicode/code/XSS, errors/retry, privacy/read-only state, adjacent Ask and graded quiz (fixture teacher).",
    );
  } catch (error) {
    fs.writeFileSync(
      path.join(out, "failure.json"),
      JSON.stringify({ error: String(error), report }, null, 2),
    );
    if (opened) {
      fs.writeFileSync(
        path.join(out, "failure-snapshot.txt"),
        await playwright(session, out, "snapshot"),
      );
      await playwright(session, out, "screenshot", `--filename=${path.join(out, "failure.png")}`);
    }
    throw error;
  } finally {
    if (opened) await playwright(session, out, "close");
    await server.close();
    f.cleanup();
    fs.writeFileSync(
      path.join(out, "cleanup.json"),
      JSON.stringify({
        sessionClosed: true,
        serverClosed: true,
        fixtureRemoved: !fs.existsSync(f.root),
      }),
    );
  }
}
