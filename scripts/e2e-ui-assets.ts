import * as fs from "node:fs";
import * as path from "node:path";
import * as server from "../src/server.ts";
import { DAY_MS } from "../src/review.ts";
import { completePreparedReview } from "../src/review-session.ts";
import {
  makeFixture,
  seedClassroom,
  seedPreparedReviewSource,
  closeReviewVariants,
  writeGradedAttempt,
  termAnswer,
  lessonHtml,
} from "../test/helpers.ts";
import { playwright, playwrightCode } from "../scripts/playwright.ts";
if (!process.argv[2]) throw new Error("Usage: node scripts/e2e-ui-assets.ts <artifacts>");
const out = path.resolve(process.argv[2]);
fs.mkdirSync(out, { recursive: true });
const fixture = makeFixture();
const session = `studens-ui-assets-${process.pid}`;
const prose =
  '<section><h1>Ownership and scope</h1><p data-font-prose>Every value has one owner. When the owner leaves its scope, the value is released. Keep this rule in mind as you trace a move.</p><p data-font-extended>Český příklad: Žluťoučký kůň. Łódź, œuvre, français, Știință.</p><pre><code data-font-code>let message = "Český příklad";\nprintln!("{}", message);</code></pre></section>';
let opened = false;
try {
  seedClassroom(fixture);
  seedPreparedReviewSource(fixture.root, "rust", "001-ownership", "check-1", ["q1", "q2"]);
  closeReviewVariants(fixture.root);
  const file = path.join(fixture.root, "rust/001-ownership/lesson.html");
  fs.writeFileSync(
    file,
    fs
      .readFileSync(file, "utf8")
      .replace("<main data-cl-content>", '<main class="cl-lesson-shell" data-cl-content>' + prose),
  );
  fixture.write(
    "rust/reference/ownership.html",
    lessonHtml("Ownership reference", prose).replace(
      "<main data-cl-content>",
      '<main class="cl-lesson-shell" data-cl-content>',
    ),
  );
  writeGradedAttempt({
    at: Date.now() - 2 * DAY_MS,
    answers: [termAnswer("q1", "owner"), termAnswer("q2", "owner")],
    correct: { q1: true, q2: true },
  });
  server.setHooks({
    reviewOwner: "pi",
    delivery: "push",
    onAsk() {
      throw new Error("Unexpected Ask");
    },
    onFollowUp() {
      throw new Error("Unexpected follow-up");
    },
    onQuizSubmit() {
      throw new Error("Unexpected submit");
    },
    onReflect() {
      throw new Error("Unexpected reflection");
    },
    onReview: (review) => {
      completePreparedReview(review);
    },
    onReviewRetry: (review) => {
      completePreparedReview(review);
    },
  });
  const base = await server.start(0);
  await playwright(session, fixture.root, "open", `${base}/c/rust`);
  opened = true;
  const result = await playwrightCode(
    session,
    fixture.root,
    `async () => {
 const must=(v,m)=>{if(!v)throw new Error(m)};
 const requests=[], responses=[],blocked=[];
 await page.context().route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1'||u.hostname==='localhost'||u.protocol==='data:')return route.continue();blocked.push(u.href);return route.abort('blockedbyclient')});
 page.on('request',r=>requests.push(r.url()));
 page.on('response',r=>responses.push({url:r.url(),status:r.status(),type:r.headers()['content-type']}));
 await page.reload();
 await page.getByRole('button',{name:'Start review',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[data-review-active="true"]')?.dataset.state==='fresh');
 const review=page.url();
 const observations=[];
 const cdp=await page.context().newCDPSession(page); await cdp.send('DOM.enable');await cdp.send('CSS.enable');
 for(const [name,url] of [['shell',${JSON.stringify(base + "/c/rust")}],['lesson',${JSON.stringify(base + "/c/rust/001-ownership")}],['review',review],['reference',${JSON.stringify(base + "/r/rust/ownership.html")}]]){
 for(const accent of ['indigo','copper','green','neutral']){
 await page.goto(${JSON.stringify(base + "/c/rust/settings")});await page.getByLabel('Accent',{exact:true}).selectOption(accent);
 for(const width of [1280,390]){for(const theme of ['light','dark']){
 await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});
 await page.goto(url); await page.evaluate(t=>localStorage.setItem('pi-classroom-theme',t),theme);await page.reload();
 await page.locator('main').waitFor(); if(name!=='reference')await page.getByRole('button',{name:'Toggle colour theme',exact:true}).waitFor();
 await page.evaluate(()=>document.fonts.ready);
 const state=await page.evaluate(()=>({accent:document.documentElement.dataset.accent,theme:document.documentElement.dataset.theme,width:document.documentElement.scrollWidth,measure:getComputedStyle(document.documentElement).getPropertyValue('--cl-measure'),faces:[...document.fonts].map(f=>({family:f.family,status:f.status,weight:f.weight,style:f.style})),icons:[...document.querySelectorAll('.cl-theme-icon svg')].map(s=>s.outerHTML),preloads:[...document.querySelectorAll('link[rel="preload"]')].map(l=>l.getAttribute('href'))}));
 const fonts={}; const doc=await cdp.send('DOM.getDocument');
 for(const selector of ['.cl-breadcrumb','[data-font-prose]','[data-font-extended]','[data-font-code]','.cl-q-prompt']){
 const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector}); if(nodeId) fonts[selector]=(await cdp.send('CSS.getPlatformFontsForNode',{nodeId})).fonts;
 }
 must(state.width<=width,name+' overflows');must(state.measure.trim()==='34rem',name+' changed the reading measure');must(state.theme===theme,name+' captured the wrong theme');must(state.accent===accent,name+' lost the saved accent');
 for(const [selector,actual] of Object.entries(fonts)){
 const expected=selector==='.cl-breadcrumb'?'inter':selector==='[data-font-code]'?'jetbrainsmono':'sourceserif4';
 must(actual.length>0&&actual.every(f=>f.isCustomFont&&f.familyName.replace(/[^a-z0-9]/gi,'').toLowerCase().includes(expected)),name+' uses unexpected rendered face at '+selector+': '+JSON.stringify(actual));
 }

 {must(state.preloads.length===2,name+' missing preloads');if(name!=='reference')must(state.faces.some(f=>f.family.replaceAll('\"','')==='Inter Variable'&&f.status==='loaded'),name+' Inter not loaded');if(name!=='shell')must(state.faces.some(f=>f.family.replaceAll('\"','')==='Source Serif 4 Variable'&&f.status==='loaded'),name+' serif not loaded'); if(name!=='reference')must(state.icons.length===2,name+' missing SVGs');}
 await page.screenshot({path:${JSON.stringify(out)}+'/'+name+'-'+width+'-'+theme+'-'+accent+'.png',fullPage:true});
 observations.push({name,width,theme,accent,state,fonts});
 if(name!=='reference'){await page.getByRole('button',{name:'Toggle colour theme',exact:true}).click();must(await page.evaluate(()=>document.documentElement.dataset.theme)!==theme,'theme did not toggle');await page.reload();must(await page.evaluate(()=>document.documentElement.dataset.theme)!==theme,'theme did not persist');must(await page.evaluate(()=>document.documentElement.dataset.accent)===accent,'theme toggle lost accent');}
 }}}}
 const missing=await page.request.get(${JSON.stringify(base + "/static/vendor/lucide/missing.svg")});must(missing.status()===404,'missing asset exposed');
 const missingFont=await page.request.get(${JSON.stringify(base + "/static/vendor/inter/missing.woff2")});must(missingFont.status()===404,'missing font exposed');
 const unknown=await page.evaluate(async()=>{const {icon}=await import('/static/icons.mjs');try{icon('missing');return 'unexpected'}catch(error){return error.message}});must(unknown==='Unknown bundled icon: missing','unknown icon did not fail explicitly');
 const faceProbes=[];
 for(const family of ['Inter Variable','Source Serif 4 Variable','JetBrains Mono Variable'])for(const style of ['normal','italic'])for(const weight of [400,700]){
 await page.evaluate(({family,style,weight})=>{const old=document.querySelector('[data-font-probe]');if(old)old.remove();const span=document.createElement('span');span.dataset.fontProbe='';span.textContent='Český příklad: Žluťoučký kůň. Łódź, œuvre, français, Știință.';Object.assign(span.style,{fontFamily:family,fontStyle:style,fontWeight:String(weight)});document.body.append(span)},{family,style,weight});
 await page.evaluate(()=>document.fonts.ready);
 const doc=await cdp.send('DOM.getDocument');const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'[data-font-probe]'});const {fonts}=await cdp.send('CSS.getPlatformFontsForNode',{nodeId});
 must(fonts.length>0&&fonts.every(f=>f.isCustomFont&&f.familyName.replace(/[^a-z0-9]/gi,'').toLowerCase().includes(family.replace(/ Variable$/,'').replace(/[^a-z0-9]/gi,'').toLowerCase())),'unexpected extended probe face: '+JSON.stringify(fonts));faceProbes.push({family,style,weight,fonts});
 }
 await page.evaluate(()=>document.querySelector('[data-font-probe]').remove());
 const external=await page.evaluate(async()=>{try{await fetch('https://example.com/ui-assets-probe');return 'unexpected'}catch{return 'blocked'}});must(external==='blocked','external probe succeeded');
 must(blocked.length===1&&blocked[0]==='https://example.com/ui-assets-probe','page attempted an external asset request');
 const fontResponses=responses.filter(r=>r.url.endsWith('.woff2'));
 must(fontResponses.length>0&&fontResponses.every(r=>r.status===200&&r.type==='font/woff2'),'local font response failed');
 must(new Set(fontResponses.map(r=>r.url)).size===12,'not all local font subsets loaded');
 return {base:${JSON.stringify(base)},review,observations,requests,responses,blocked,faceProbes,unknown,missingStatus:missing.status(),missingFontStatus:missingFont.status(),external};
 }`,
  );
  fs.writeFileSync(path.join(out, "runtime.json"), JSON.stringify(result, null, 2));
  console.log(out);
} finally {
  if (opened) await playwright(session, fixture.root, "close");
  await server.close();
  fixture.cleanup();
}
