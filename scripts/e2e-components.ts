/** Shared component reference served through the public reference route. No teacher/model. */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import * as server from "../src/server.ts";
import { makeFixture, seedClassroom, lessonHtml } from "../test/helpers.ts";
import { icon } from "../assets/runtime/icons.mjs";
import { playwright, playwrightCode } from "./playwright.ts";

const [directory, mode = "after"] = process.argv.slice(2);
if (!directory || !["before", "after"].includes(mode))
  throw new Error("Usage: node scripts/e2e-components.ts <artifacts> [before|after]");
const out = path.resolve(directory);
fs.mkdirSync(out, { recursive: true });
const fixture = makeFixture();
const session = `studens-components-${process.pid}`;
let opened = false;
let recording = false;
try {
  seedClassroom(fixture);
  fixture.write("rust/NOTES.md", "# Notes\n");
  fixture.write(
    "rust/reference/components.html",
    lessonHtml(
      "Shared controls",
      fs
        .readFileSync(new URL("./fixtures/base-components.html", import.meta.url), "utf8")
        .replace("□", icon("bookmark"))
        .replace("✓", icon("check")),
    ),
  );
  const hashes = () =>
    Object.fromEntries(
      fs
        .readdirSync(fixture.root, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => {
          const file = path.join(e.parentPath, e.name);
          return [
            path.relative(fixture.root, file),
            createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
          ];
        }),
    );
  const before = hashes();
  const base = await server.start(0);
  await playwright(session, out, "open", base);
  opened = true;
  await playwright(session, out, "video-start", path.join(out, "motion.webm"));
  recording = true;
  const result = await playwrightCode(
    session,
    out,
    `async page => {
    const base=${JSON.stringify(base)}, out=${JSON.stringify(out)}, verify=${JSON.stringify(mode === "after")};
    const must=(v,m)=>{if(!v)throw Error(m)}, errors=[], writes=[], matrix=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url())});
    for(const theme of ['light','dark']) for(const accent of ['indigo','copper','green','neutral']) for(const reducedMotion of ['no-preference','reduce']) for(const width of [1280,390]) {
      await page.setViewportSize({width,height:900});
      const cdp=await page.context().newCDPSession(page);
      await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:width===390});
      await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:reducedMotion},{name:'hover',value:width===390?'none':'hover'}]});
      await page.goto(base+'/c/rust/settings');
      await page.getByLabel('Theme',{exact:true}).selectOption(theme);
      await page.getByLabel('Accent',{exact:true}).selectOption(accent);
      await page.goto(base+'/r/rust/components.html');
      await page.getByRole('button',{name:'Open explanation',exact:true}).waitFor();
      await page.evaluate(()=>document.fonts.ready);
      const setup=await page.evaluate(()=>({theme:document.documentElement.dataset.theme,accent:document.documentElement.dataset.accent,width:document.documentElement.scrollWidth,hover:matchMedia('(hover: hover)').matches,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches}));
      must(setup.theme===theme&&setup.accent===accent,'appearance did not persist on navigation');
      must(setup.reduced===(reducedMotion==='reduce')&&setup.hover===(width===1280),'emulation does not match requested matrix');
      if(verify)must(setup.width<=width,'horizontal overflow '+JSON.stringify(setup));
      await page.screenshot({path:out+'/'+width+'-'+theme+'-'+accent+'-'+reducedMotion+'.png',fullPage:true});
      await page.getByRole('button',{name:'Open explanation',exact:true}).click();
      await page.getByText('Explanation opened.',{exact:true}).waitFor();
      await page.getByRole('button',{name:'Close explanation',exact:true}).click();
      await page.locator('#explanation').waitFor({state:'hidden'});
      await page.getByRole('button',{name:'Save explanation',exact:true}).click();
      must(await page.locator('#copy-status').textContent()==='Saved','missing static icon cue');
      await page.getByText('Why is this due?',{exact:true}).click();
      must(await page.locator('.cl-disclosure-row').getAttribute('aria-expanded')==='true','disclosure did not expand');
      await page.getByRole('button',{name:'Details',exact:true}).click();
      await page.getByLabel('Topic',{exact:true}).fill('Borrowing');
      await page.getByLabel('Include examples',{exact:true}).check();
      await page.getByRole('button',{name:'Retry',exact:true}).click();
      must((await page.locator('#retry-status').textContent()).includes('Retry requested'),'retry did not remain explicit');
      const styles=await page.evaluate(()=>{
        const read=s=>{const e=document.querySelector(s),c=getComputedStyle(e);return {transition:c.transitionProperty,duration:c.transitionDuration,animation:c.animationName,scale:c.scale,translate:c.translate,filter:c.filter}};
        return {button:read('.cl-button'),row:read('.cl-list-row'),tab:read('.cl-segmented button'),input:read('.cl-input'),skeleton:read('.cl-skeleton'),panel:read('#explanation'),icon:read('.cl-icon-swap > span'),accordion:read('.cl-accordion')};
      });
      if(verify){for(const name of ['row','tab','input'])must(styles[name].duration==='0s',name+' animates');if(reducedMotion==='reduce'){must(styles.button.transition==='opacity','press movement under reduced motion');must(styles.icon.transition==='opacity','icon movement under reduced motion');must(!styles.accordion.transition.includes('height'),'accordion movement under reduced motion');must(styles.skeleton.animation==='none','skeleton moves under reduced motion');must(styles.panel.transition.includes('opacity')&&!styles.panel.transition.includes('translate'),'panel movement under reduced motion');} }
      matrix.push({theme,accent,width,reducedMotion,setup,styles});
      await cdp.detach();
    }
    must(errors.length===0,'page errors '+errors);must(writes.length===0,'unexpected writes '+writes);
    return {matrix,errors,writes};
  }`,
  );
  const slow = await playwrightCode(
    session,
    out,
    `async page => {
    const out=${JSON.stringify(out)}, base=${JSON.stringify(base)}, samples=[];
    await page.setViewportSize({width:1280,height:900});
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:false});
    await cdp.send('Animation.enable');
    await cdp.send('Animation.setPlaybackRate',{playbackRate:0.1});
    for(const reducedMotion of ['no-preference','reduce']) {
      await page.emulateMedia({reducedMotion});
      await page.goto(base+'/c/rust/settings');
      await page.getByLabel('Theme',{exact:true}).selectOption('light');
      await page.getByLabel('Accent',{exact:true}).selectOption('indigo');
      await page.goto(base+'/r/rust/components.html');
      for(const [name,action] of [
        ['enter',()=>page.locator('#open-panel').click()],
        ['exit',()=>page.locator('#close-panel').click()],
        ['accordion',()=>page.getByText('Why is this due?',{exact:true}).click()],
        ['icon',()=>page.locator('#copy').click()],
        ['press',async()=>{await page.locator('#open-panel').hover();await page.mouse.down()}]
      ]) {
        await action();
        // Observe an actual intermediate frame at 10% playback, not just declarations.
        await page.waitForTimeout(500);
        const frames=await page.evaluate(()=>document.getAnimations().map(a=>({type:a.constructor.name,property:a.transitionProperty??a.animationName,frames:a.effect.getKeyframes(),time:a.currentTime})));
        await page.screenshot({path:out+'/motion-'+reducedMotion+'-'+name+'.png',fullPage:true});
        samples.push({reducedMotion,name,frames});
        if (${JSON.stringify(mode === "after")}) {
          const properties=frames.filter(f=>f.type==='CSSTransition').map(f=>f.property);
          if(reducedMotion==='reduce'&&properties.some(p=>!['opacity','display'].includes(p)))throw Error('Reduced motion moved: '+name);
          if(name==='accordion'&&reducedMotion==='no-preference'&&!properties.includes('height'))throw Error('Accordion height did not animate');
        }
        await page.evaluate(()=>document.getAnimations().filter(a=>a.constructor.name==='CSSTransition').forEach(a=>a.finish()));
        if(name==='press')await page.mouse.up();
      }
    }
    await cdp.send('Animation.setPlaybackRate',{playbackRate:1});
    await page.locator('.cl-disclosure-row').focus();
    await page.locator('.cl-disclosure-row').press('Enter');
    if(await page.locator('.cl-disclosure-row').getAttribute('aria-expanded')!=='false')throw Error('Keyboard disclosure did not close');
    if(!await page.locator('#due-details').evaluate(e=>e.inert))throw Error('Closed disclosure remains interactive');
    await page.locator('.cl-disclosure-row').press('Enter');
    if(await page.locator('.cl-disclosure-row').getAttribute('aria-expanded')!=='true')throw Error('Interrupted disclosure did not reopen');
    if(!await page.locator('.cl-disclosure-row').evaluate(e=>e===document.activeElement))throw Error('Disclosure lost keyboard focus');
    await cdp.detach();
    return samples;
  }`,
  );
  const after = hashes();
  fs.writeFileSync(
    path.join(out, "result.json"),
    JSON.stringify({ mode, ...(result as object), before, after, slow }, null, 2),
  );
  assert.deepEqual(after, before, "Shared controls changed durable classroom files");
  await playwright(session, out, "video-stop");
  recording = false;
  console.log(out);
} finally {
  if (recording) await playwright(session, out, "video-stop");
  if (opened) await playwright(session, out, "close");
  await server.close();
  fixture.cleanup();
}
