/** Exercise the shared app chrome through its public controls in disposable state. */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  makeFixture,
  seedClassroom,
  lessonHtml,
  writeGradedAttempt,
  termAnswer,
} from "../test/helpers.ts";
import * as server from "../src/server.ts";
import * as store from "../src/store.ts";
import { highlightText } from "./browser-actions.ts";
import { DAY_MS } from "../src/review.ts";
import { playwright, playwrightCode } from "./playwright.ts";

export async function verifyNavigationBrowser(out: string): Promise<void> {
  fs.mkdirSync(out, { recursive: true });
  const f = makeFixture();
  seedClassroom(f);
  seedClassroom(f, { classroom: "algebra", title: "Algebra" });
  f.write(
    "rust/001-ownership/lesson.html",
    lessonHtml(
      "Ownership",
      '<h1 id="ownership">Ownership</h1><p>Every value has one owner.</p><div style="height:1000px"></div><h2 id="moving">Moving ownership</h2><p>Moving transfers the owner.</p><div style="height:800px"></div>',
    ),
  );
  // A separate finished lesson contributes a due item; navigation must not resume it.
  seedClassroom(f, { classroom: "rust", lesson: "002-review-source" });
  writeGradedAttempt({
    lesson: "002-review-source",
    at: Date.now() - 10 * DAY_MS,
    answers: [termAnswer("q1", "one")],
    correct: { q1: true },
  });
  f.write(
    ".folders.json",
    JSON.stringify({ folders: [{ id: "languages", name: "Languages", classrooms: ["rust"] }] }),
  );
  seedClassroom(f, { lesson: "003-legacy" });
  f.write(
    "rust/003-legacy/lesson.html",
    '<!doctype html><html><head><title>Legacy reading</title></head><body><p id="legacy" style="margin:48px">Actual lesson prose stays separate from navigation.</p></body></html>',
  );
  let asks = 0;
  const unexpected = () => {
    throw Error("Navigation triggered an unexpected teacher request.");
  };
  server.setHooks({
    delivery: "wait",
    onAsk: () => {
      asks++;
    },
    onFollowUp: unexpected,
    onQuizSubmit: unexpected,
    onReflect: unexpected,
  });
  const session = "studens-navigation-" + process.pid;
  let opened = false;
  try {
    const base = await server.start(0);
    await playwright(session, out, "open", base);
    opened = true;
    await playwright(session, out, "video-start", path.join(out, "drawer.webm"));
    const result = await playwrightCode(
      session,
      out,
      `async page=>{
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      const base=${JSON.stringify(base)},out=${JSON.stringify(out)};
      const nav=page.getByRole('navigation',{name:'Main navigation',exact:true});
      await page.getByRole('heading',{name:'Today',exact:true}).waitFor();
      await page.getByText('How daily review works',{exact:true}).click();
      await page.locator('[data-daily-workload]').waitFor({state:'visible'});
      await page.getByText('How daily review works',{exact:true}).click();
      await nav.getByRole('link',{name:'Today 1 due',exact:true}).waitFor();
      if(await nav.locator('[aria-current="page"]').count()!==1)throw Error('Today current-page state missing');
      await nav.getByRole('link',{name:'Review',exact:true}).click();await page.waitForURL('**/reviews/daily');
      await nav.locator('[aria-current="page"][href="/reviews/daily"]').waitFor();
      await nav.getByRole('link',{name:'Today 1 due',exact:true}).click();await page.getByRole('heading',{name:'Today',exact:true}).waitFor();
      await nav.getByRole('link',{name:'Rust 1 due',exact:true}).click();
      await page.getByRole('heading',{level:1}).waitFor();
      await nav.locator('[aria-current="page"][href="/c/rust"]').waitFor();
      if(await page.getByRole('navigation',{name:'Breadcrumb',exact:true}).isVisible())throw Error('Redundant classroom breadcrumb remained visible');
      await page.getByRole('link',{name:'Course map',exact:true}).click();
      await page.getByRole('navigation',{name:'Breadcrumb',exact:true}).waitFor({state:'visible'});
      await nav.getByRole('link',{name:'Rust 1 due',exact:true}).click();
      await page.getByRole('main').locator('a[href="/c/rust/001-ownership"]').click();
      await page.getByRole('button',{name:'Expand navigation',exact:true}).waitFor();
      if(await page.locator('.cl-sidebar').evaluate(e=>e.getBoundingClientRect().width)!==48)throw Error('Default lesson rail is not 48px');
      await page.getByRole('button',{name:'Expand navigation',exact:true}).focus();await page.keyboard.press('Enter');
      await page.reload();await page.getByRole('button',{name:'Collapse navigation',exact:true}).waitFor();
      await page.getByRole('button',{name:'Collapse navigation',exact:true}).click();
      await page.reload();await page.getByRole('button',{name:'Expand navigation',exact:true}).waitFor();
      await page.locator('#moving').evaluate(el=>el.scrollIntoView({block:'start'}));
      const expectedPoint=await page.locator('#moving + p').getAttribute('id');
      await page.getByRole('link',{name:'Studens',exact:true}).click();
      const resume=page.getByRole('link',{name:'Continue lesson',exact:true});await resume.waitFor();
      if(await resume.getAttribute('href')!=='/c/rust/001-ownership#'+expectedPoint)throw Error('Continue lost resume point');
      await resume.click();await page.waitForURL('**/001-ownership#'+expectedPoint);
      await page.goto(base+'/');
      for(const width of [1280,390])for(const theme of ['light','dark']){
        await page.setViewportSize({width,height:844});await page.evaluate(t=>localStorage.setItem('pi-classroom-theme',t),theme);await page.reload();
        await page.locator('[data-cl-continue]').waitFor();
        await page.screenshot({path:out+'/today-'+width+'-'+theme+'.png',fullPage:true});
        if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Today overflow');
        if(width===390){
          const toggle=page.getByRole('button',{name:'Open navigation',exact:true});await toggle.focus();await page.keyboard.press('Enter');
          const drawer=page.getByRole('dialog',{name:'App navigation',exact:true});await drawer.waitFor();
          if(!await drawer.getByRole('button',{name:'Close navigation'}).evaluate(e=>e===document.activeElement))throw Error('Drawer did not focus close');
          await page.keyboard.press('Shift+Tab');if(!await page.getByLabel('Sidebar accent',{exact:true}).evaluate(e=>e===document.activeElement))throw Error('Reverse focus trap failed');
          await page.keyboard.press('Tab');if(!await drawer.getByRole('button',{name:'Close navigation'}).evaluate(e=>e===document.activeElement))throw Error('Forward focus trap failed');
          await page.locator('.cl-sidebar').evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished)));
          await page.screenshot({path:out+'/drawer-'+theme+'.png'});
          await page.keyboard.press('Escape');if(!await toggle.evaluate(e=>e===document.activeElement))throw Error('Escape did not restore focus');
          if(!await page.locator('.cl-sidebar').evaluate(e=>e.inert))throw Error('Closed drawer remains keyboard reachable');
          await toggle.click();await nav.getByRole('link',{name:'Languages',exact:true}).click();
          await page.getByRole('heading',{name:'Languages',exact:true}).waitFor();
          await page.goto(base+'/');
        }
        await page.goto(base+'/c/rust/001-ownership');await page.locator('.cl-lesson-page').waitFor();
        await page.screenshot({path:out+'/lesson-'+width+'-'+theme+'.png',fullPage:true});
        if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Lesson overflow');
        await page.goto(base+'/');
      }
      await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
      await page.getByRole('button',{name:'Open navigation',exact:true}).click();
      const motion=await page.locator('.cl-sidebar').evaluate(e=>({transform:getComputedStyle(e).transform,transition:getComputedStyle(e).transitionProperty,overscroll:getComputedStyle(e).overscrollBehavior}));
      if(motion.transform!=='none'||!motion.transition.includes('opacity')||motion.overscroll!=='contain')throw Error('Reduced motion/overscroll failed: '+JSON.stringify(motion));
      await page.keyboard.press('Escape');
      await page.getByRole('button',{name:'Open navigation',exact:true}).click();
      await page.setViewportSize({width:1280,height:844});
      await page.waitForFunction(()=>!document.body.classList.contains('cl-nav-open'));
      if(!await page.getByRole('main').evaluate(el=>el===document.activeElement))throw Error('Drawer resize lost focus');
      await page.route('**/api/navigation',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Navigation storage unavailable for verification.'})}),{times:1});
      await page.reload();await nav.getByRole('alert').getByText('Navigation storage unavailable for verification.',{exact:true}).waitFor();
      await nav.getByRole('button',{name:'Retry loading navigation',exact:true}).click();await nav.getByRole('link',{name:'Rust 1 due',exact:true}).waitFor();
      if(!await nav.getByRole('link',{name:'Today 1 due',exact:true}).evaluate(el=>el===document.activeElement))throw Error('Navigation retry lost keyboard focus');
      await page.getByLabel('Sidebar accent',{exact:true}).selectOption('green');await page.reload();
      if(await page.evaluate(()=>document.documentElement.dataset.accent)!=='green')throw Error('Sidebar accent did not persist');
      await page.getByRole('link',{name:'Settings',exact:true}).click();await page.locator('[data-settings-content]').waitFor({state:'visible'});
      await page.getByLabel('Accent',{exact:true}).waitFor();
      if(await page.getByLabel('Accent',{exact:true}).inputValue()!=='green')throw Error('Appearance controls disagree');
      await page.getByLabel('Accent',{exact:true}).selectOption('copper');
      if(await page.getByLabel('Sidebar accent',{exact:true}).inputValue()!=='copper')throw Error('Sidebar accent did not sync');
      await page.goto(base+'/c/algebra/001-ownership');
      await nav.getByRole('link',{name:'Algebra',exact:true}).waitFor();
      await page.getByRole('link',{name:'Studens',exact:true}).click();
      await page.getByRole('link',{name:'Continue lesson',exact:true}).waitFor();
      const latest=await page.getByRole('link',{name:'Continue lesson',exact:true}).getAttribute('href');
      if(!latest.startsWith('/c/algebra/001-ownership#') || !/^cl-search-[a-f0-9]{24}-[0-9]+$/.test(latest.split('#')[1]))throw Error('Most recent legacy lesson lost its public resume anchor: '+latest);
      await page.getByRole('link',{name:'Continue lesson',exact:true}).click();await page.waitForURL('**/001-ownership#cl-search-*');
      await page.goto(base+'/');await nav.getByRole('link',{name:'Search',exact:true}).click();await page.waitForURL('**/search');
      await nav.getByRole('link',{name:'Today 1 due',exact:true}).click();await page.getByRole('heading',{name:'Today',exact:true}).waitFor();
      await page.getByRole('link',{name:'Search classrooms',exact:true}).focus();await page.keyboard.press('Enter');await page.waitForURL('**/search');
      await page.goto(base+'/c/rust/003-legacy');await page.getByRole('button',{name:'Expand navigation',exact:true}).waitFor();
      if(await page.locator('main').count())throw Error('Legacy fixture unexpectedly has a main');
      await page.getByRole('button',{name:'Expand navigation',exact:true}).click();
      await nav.getByRole('link',{name:'Rust 1 due',exact:true}).waitFor();
      const headingPoint=await nav.getByRole('heading',{name:'Classrooms',exact:true}).evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const box=range.getBoundingClientRect();return {x:box.x+box.width/2,y:box.y+box.height/2};});
      await page.mouse.dblclick(headingPoint.x,headingPoint.y);
      if(await page.evaluate(()=>getSelection().toString().trim().toLowerCase())!=='classrooms')throw Error('Sidebar heading was not selected');
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0))));
      if(await page.locator('.cl-ask-pill').isVisible())throw Error('Navigation text became lesson prose');
      await (${highlightText})(page,'#legacy','Actual lesson prose');await page.locator('.cl-ask-pill').click();
      await page.locator('[data-cl-question]').fill('What does this mean?');
      const saved=page.waitForResponse(r=>r.url().endsWith('/api/ask')&&r.request().method()==='POST');
      await page.getByRole('button',{name:'Ask your teacher',exact:true}).click();const response=await saved;
      if(response.status()!==201)throw Error('Legacy Ask failed: '+await response.text());
      const annotation=await response.json();if(annotation.anchor.prefix!==''||annotation.anchor.exact!=='Actual lesson prose')throw Error('Chrome contaminated the saved lesson anchor');
      await page.getByRole('link',{name:'Studens',exact:true}).click();await page.getByRole('link',{name:'Continue lesson',exact:true}).waitFor();
      if(!await page.getByRole('link',{name:'Continue lesson',exact:true}).getAttribute('href').then(h=>h.startsWith('/c/rust/003-legacy#')))throw Error('Legacy body lost its resume anchor');
      if(errors.length)throw Error(errors.join('; '));return {errors,motion,resume:true,railPersistence:true,drawerKeyboard:true,dueCount:1,legacyAnchor:annotation.anchor};
    }`,
    );
    const annotations = store.listAnnotations("rust", "003-legacy");
    if (asks !== 1 || annotations.length !== 1 || annotations[0].anchor.prefix !== "")
      throw Error("Legacy Ask did not persist one clean lesson anchor.");
    await playwright(session, out, "video-stop");
    fs.writeFileSync(path.join(out, "result.json"), JSON.stringify(result, null, 2));
    console.log(
      "PASS: Today resume, due badges, navigation, lesson rail persistence, mobile drawer focus/Escape, themes, accent, reduced motion, and explicit navigation retry",
    );
  } catch (error) {
    if (opened)
      fs.writeFileSync(
        path.join(out, "failure-snapshot.txt"),
        await playwright(session, out, "snapshot"),
      );
    throw error;
  } finally {
    if (opened) await playwright(session, out, "close");
    await server.close();
    f.cleanup();
  }
}
