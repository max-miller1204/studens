/** Exercise device appearance without teacher requests or learning evidence. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as server from "../src/server.ts";
import { lessonHtml, makeFixture, seedClassroom } from "../test/helpers.ts";
import { highlightText } from "./browser-actions.ts";
import { playwright, playwrightCode } from "./playwright.ts";

export async function verifyAppearanceBrowser(artifacts: string | null): Promise<void> {
  const f = makeFixture();
  seedClassroom(f);
  f.write("rust/NOTES.md", "# Notes\n");
  f.write(
    "rust/001-ownership/lesson.html",
    lessonHtml(
      "Ownership",
      `<h1>Ownership</h1><p data-passage>Every value has one owner. The owner releases the value when its scope ends.</p><form class="cl-quiz" data-quiz-id="check-1" data-title="Check your understanding"><ol class="cl-questions"><li class="cl-q" data-question-id="q1" data-type="choice"><p class="cl-q-prompt">How many owners does a value have?</p><label><input type="radio" name="q1" value="one">One owner</label><label><input type="radio" name="q1" value="many">Several owners</label></li></ol></form>`,
    ).replace("<main data-cl-content>", '<main class="cl-lesson-shell" data-cl-content>'),
  );
  f.write(
    "rust/reference/ownership.html",
    lessonHtml("Ownership reference", '<pre class="mermaid">flowchart LR\n  Owner --> Value</pre>'),
  );
  const review = "review-00000000-0000-4000-8000-000000000137";
  f.write(
    `rust/.reviews/${review}/lesson.json`,
    JSON.stringify({ title: "Ownership review", kind: "review", createdAt: 3 }),
  );
  f.write(
    `rust/.reviews/${review}/lesson.html`,
    lessonHtml(
      "Ownership review",
      `<form class="cl-quiz" data-quiz-id="review-1" data-kind="review"><ol class="cl-questions"><li class="cl-q" data-question-id="q1" data-type="choice" data-review-of="001-ownership/check-1/q1"><p class="cl-q-prompt">Who releases a value?</p><label><input type="radio" name="q1" value="owner">Its owner</label></li></ol></form>`,
    ).replace("<main data-cl-content>", '<main class="cl-lesson-shell" data-cl-content>'),
  );

  const out = artifacts ?? fs.mkdtempSync(path.join(os.tmpdir(), "studens-appearance-"));
  fs.mkdirSync(out, { recursive: true });
  const session = `studens-appearance-${process.pid}`;
  let opened = false;
  let teacherRequests = 0;
  const forbidden = () => {
    teacherRequests++;
    throw new Error("Appearance triggered a teacher request.");
  };
  server.setHooks({
    delivery: "wait",
    onAsk: forbidden,
    onFollowUp: forbidden,
    onReflect: forbidden,
    onQuizSubmit: forbidden,
    onTeacherChat: forbidden,
  });
  const hashes = () =>
    Object.fromEntries(
      fs
        .readdirSync(f.root, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile() && !e.name.includes("draft"))
        .map((e) => {
          const file = path.join(e.parentPath, e.name);
          return [
            path.relative(f.root, file),
            createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
          ];
        })
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  const before = hashes();
  try {
    const base = await server.start(0);
    await playwright(session, out, "open", base);
    opened = true;
    await playwright(session, out, "video-start", path.join(out, "switch-reload.webm"));
    const result = await playwrightCode(
      session,
      out,
      `async page => {
      const errors = [], writes = [], matrix = [], paint = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => {if (!['GET','HEAD'].includes(r.method())) writes.push({url:r.url(),method:r.method()});});
      const base = ${JSON.stringify(base)}, out = ${JSON.stringify(out)};
      const shot = async name => {await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:out+'/'+name+'.png',fullPage:true});};
      const settings = async () => {await page.goto(base+'/c/rust/settings');await page.getByLabel('Accent',{exact:true}).waitFor();};
      const theme = t => page.getByLabel('Theme',{exact:true}).selectOption(t);
      const accent = a => page.getByLabel('Accent',{exact:true}).selectOption(a);
      const appearance = () => page.evaluate(()=>({theme:document.documentElement.dataset.theme,accent:document.documentElement.dataset.accent,scheme:getComputedStyle(document.documentElement).colorScheme}));
      for (const [size,width,height,t] of [['desktop',1280,900,'light'],['mobile',390,844,'dark']]) {
        await page.setViewportSize({width,height}); await settings();await theme(t);await accent('indigo');
        for (const [name,url] of [['landing','/'],['classroom','/c/rust'],['lesson','/c/rust/001-ownership'],['settings','/c/rust/settings']]) {
          await page.goto(base+url);
          if(name==='lesson') await page.locator('.cl-submit').waitFor();
          if(name==='settings') await page.locator('[data-settings-content]').waitFor({state:'visible'});
          if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw Error('Horizontal overflow: '+name+'/'+size);
          await shot(name+'-'+size+'-'+t);
        }
      }
      await page.setViewportSize({width:1280,height:900});
      for(const t of ['light','dark']) for(const a of ['indigo','copper','green','neutral']) {
        await settings(); await theme(t); await accent(a);
        await page.goto(base+'/c/rust/001-ownership'); await page.locator('.cl-submit').waitFor();
        const colors=await page.evaluate(()=>{
          const sample=document.createElement('span');document.body.append(sample);
          const resolve=(token)=>{sample.style.color='var('+token+')';return getComputedStyle(sample).color;};
          const c=Object.fromEntries(['accent','accent-ink','accent-soft','surface','surface-2','bg','text','text-muted','text-faint','warn','warn-soft'].map(k=>[k,resolve('--cl-'+k)]));
          sample.remove();return c;
        });
        const luminance=c=>{const rgb=c.match(/[\\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
        const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
        const ratios={soft:contrast(colors.accent,colors['accent-soft']),solid:contrast(colors.accent,colors.surface),button:contrast(colors['accent-ink'],colors.accent),text:contrast(colors.text,colors.bg),muted:contrast(colors['text-muted'],colors.surface),faint:contrast(colors['text-faint'],colors['surface-2']),warn:contrast(colors.warn,colors['warn-soft'])};
        if(ratios.soft<4.5||ratios.solid<3||ratios.button<4.5||ratios.text<4.5||ratios.muted<4.5||ratios.faint<4.5||ratios.warn<4.5)throw Error('Contrast failed '+JSON.stringify({t,a,ratios}));
        matrix.push({theme:t,accent:a,colors,ratios});await shot('matrix-'+t+'-'+a);
      }
      // Native controls work with keyboard input and keep focus after the switch.
      await settings(); const select=page.getByLabel('Accent',{exact:true});await select.focus();await page.keyboard.press('Space');await page.keyboard.press('c');await page.keyboard.press('Enter');
      if(await select.inputValue()!=='copper'||!await select.evaluate(e=>e===document.activeElement))throw Error('Keyboard accent selection failed.');
      await theme('dark');await page.getByRole('button',{name:'Toggle colour theme'}).click();
      if((await appearance()).theme!=='light'||await page.getByLabel('Theme',{exact:true}).inputValue()!=='light')throw Error('Header and Settings disagree.');
      await theme('system');await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});
      if((await appearance()).scheme!=='light dark')throw Error('System override was retained.');
      const dark=await page.evaluate(()=>getComputedStyle(document.body).backgroundColor);
      await page.emulateMedia({colorScheme:'light'});const light=await page.evaluate(()=>getComputedStyle(document.body).backgroundColor);
      if(dark===light)throw Error('System theme does not follow OS changes.');
      await theme('dark');await accent('green');
      // Observe the attributes while the blocking stylesheet is held, before paint.
      for(const url of ['/', '/c/rust', '/c/rust/settings','/c/rust/001-ownership','/doc/rust/NOTES.md','/r/rust/ownership.html','/c/rust/reviews','/c/rust/reviews/${review}']) {
        let release, arrived;const gate=new Promise(r=>release=r),ready=new Promise(r=>arrived=r);
        await page.route('**/static/classroom.css',async route=>{arrived();await gate;await route.continue();});
        const navigation=page.goto(base+url);await ready;
        await page.waitForFunction(()=>document.documentElement.dataset.accent==='green'&&document.documentElement.dataset.theme==='dark');
        paint.push({url,...await appearance()});release();await navigation;await page.unroute('**/static/classroom.css');
        if(await page.locator('[data-cl-appearance-error]').count())throw Error('Saved appearance failed on '+url);
      }
      await settings();await settings();
      await page.evaluate(()=>{const select=document.querySelector('[data-cl-accent-choice]');select.style.transition='color 2s';select.addEventListener('change',()=>{window.appearanceSwitch={suppressed:document.documentElement.classList.contains('cl-appearance-changing'),duration:getComputedStyle(select).transitionDuration};});});
      await accent('neutral');const transition=await page.evaluate(()=>window.appearanceSwitch);
      if(!transition.suppressed||transition.duration!=='0s')throw Error('Appearance transition was not suppressed.');
      await page.waitForFunction(()=>!document.documentElement.classList.contains('cl-appearance-changing'));
      await page.locator('[data-cl-accent-choice]').evaluate(e=>e.style.removeProperty('transition'));
      const neighbor=await page.context().newPage();await neighbor.goto(base+'/r/rust/ownership.html');
      const diagram=neighbor.locator('.cl-diagram svg');await diagram.waitFor();
      const diagramId=await diagram.getAttribute('id');
      const nodeFill=()=>neighbor.locator('.cl-diagram svg .node rect').first().evaluate(e=>getComputedStyle(e).fill);
      const beforeFill=await nodeFill();await accent('copper');
      await neighbor.waitForFunction(()=>document.documentElement.dataset.accent==='copper');
      await neighbor.waitForFunction(id=>document.querySelector('.cl-diagram svg')?.id!==id,diagramId);
      if(await nodeFill()===beforeFill)throw Error('Accent change kept the diagram fill.');
      await neighbor.screenshot({path:out+'/diagram-accent-copper.png',fullPage:true});await neighbor.close();
      await theme('dark');await accent('copper');await page.reload();
      if((await appearance()).accent!=='copper')throw Error('Reload lost accent.');
      await page.setViewportSize({width:390,height:844});await page.emulateMedia({forcedColors:'active',reducedMotion:'reduce'});
      await page.getByLabel('Accent',{exact:true}).focus();await shot('forced-colors-settings');
      await page.goto(base+'/c/rust/001-ownership');await page.locator('.cl-submit').waitFor();await page.locator('.cl-submit').focus();
      const forced=await page.locator('.cl-submit').evaluate(e=>({border:getComputedStyle(e).borderTopWidth,outline:getComputedStyle(e).outlineStyle,shadow:getComputedStyle(e).boxShadow}));
      if(forced.border!=='1px'||forced.outline==='none'||forced.shadow!=='none')throw Error('Forced colors lost boundary/focus.');await shot('forced-colors-lesson');
      await page.emulateMedia({forcedColors:'none'});
      // An invalid preference is visible and requires an explicit correction.
      await page.evaluate(()=>localStorage.setItem('pi-classroom-accent','invalid-accent'));
      await settings();await page.getByRole('alert').filter({hasText:'Invalid saved accent'}).waitFor();await shot('invalid-accent');
      await page.getByRole('button',{name:'Retry appearance'}).click();
      if(!await page.getByRole('alert').filter({hasText:'Invalid saved accent'}).isVisible())throw Error('Retry hid invalid preference.');
      await accent('neutral');await page.reload();if(await page.locator('[data-cl-appearance-error]').count())throw Error('Explicit accent correction failed.');
      await page.evaluate(()=>localStorage.setItem('pi-classroom-theme','invalid-theme'));await settings();await page.getByRole('alert').filter({hasText:'Invalid saved theme'}).waitFor();await theme('light');
      // Simulate unavailable browser storage at the production localStorage boundary.
      const blocked=await page.context().newPage();await blocked.addInitScript(()=>Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new Error('Storage access denied for appearance probe.');}}));
      await blocked.goto(base+'/c/rust/settings');await blocked.getByRole('alert').filter({hasText:'Storage access denied'}).waitFor();
      await blocked.getByLabel('Accent',{exact:true}).selectOption('green');
      if(await blocked.locator('[data-cl-appearance-status]').textContent())throw Error('Blocked save claimed success.');
      await blocked.screenshot({path:out+'/unavailable-storage.png',fullPage:true});await blocked.close();
      // Selection and opening Ask leave quiz controls unchanged and send no request.
      await settings();await theme('dark');await accent('indigo');
      await page.goto(base+'/c/rust/001-ownership');await page.locator('.cl-submit').waitFor();
      await page.getByRole('radio',{name:'One owner',exact:true}).check();
      await page.locator('[data-passage]').click();
      await (${highlightText.toString()})(page,'[data-passage]','Every value has one owner.');
      await page.locator('[data-cl-selection-action="ask"],.cl-selection-actions .cl-ask-pill').click();
      await page.locator('[data-cl-question]').waitFor();
      if(!await page.getByRole('radio',{name:'One owner',exact:true}).isChecked())throw Error('Ask changed quiz answer.');
      await shot('lesson-mobile-dark-ask');
      if(writes.some(r=>!r.url.includes('/draft')))throw Error('Unexpected write '+JSON.stringify(writes));
      if(errors.length)throw Error('Page errors '+JSON.stringify(errors));
      return {matrix,paint,forced,transition,crossTab:true,diagramAccent:true,system:{dark,light},writes,errors,keyboard:true,reload:true,storageErrors:true,adjacentAsk:true};
    }`,
    );
    fs.writeFileSync(path.join(out, "result.json"), JSON.stringify(result, null, 2));
    await playwright(session, out, "video-stop");
    assert.equal(teacherRequests, 0);
    assert.deepEqual(
      hashes(),
      before,
      "Appearance or adjacent controls changed durable learning state.",
    );
    fs.writeFileSync(
      path.join(out, "state.json"),
      JSON.stringify({ teacherRequests, before, after: hashes() }, null, 2),
    );
  } catch (error) {
    fs.writeFileSync(
      path.join(out, "failure.json"),
      JSON.stringify(error, Object.getOwnPropertyNames(error), 2),
    );
    throw error;
  } finally {
    if (opened) await playwright(session, out, "close");
    await server.close();
    f.cleanup();
    fs.writeFileSync(
      path.join(out, "cleanup.json"),
      JSON.stringify({ serverRunning: server.isRunning(), fixtureExists: fs.existsSync(f.root) }),
    );
  }
}
