/** Settings UI and durable request boundary, using fixture teachers rather than inference. */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { makeFixture, seedClassroom } from "../test/helpers.ts";
import { TeacherService } from "../src/teacher-service.ts";
import { readTeacherState } from "../src/service-state.ts";
import * as server from "../src/server.ts";
import { readConfig } from "../src/config.ts";
import { learnerPreferences } from "../src/settings.ts";
import { playwright, playwrightCode } from "./playwright.ts";

export async function verifySettingsBrowser(artifacts: string | null): Promise<void> {
  const f = makeFixture();
  seedClassroom(f);
  seedClassroom(f, { classroom: "algebra" });
  f.write(
    "rust/NOTES.md",
    "# Notes\n\n## Preferences\n\nKeep examples short.\n\n## Index\n\n- [Memory](notes/memory.md): ownership mistakes\n",
  );
  f.write("rust/notes/memory.md", "# Memory\n\nTrace the ownership lifetime.\n");
  f.write("test-config.json", '{"tailscale":false,"unrelated":{"keep":true}}');
  const bin = f.write(
    "bin/codex",
    `#!${process.execPath}\n` +
      String.raw`
const send=m=>process.stdout.write(JSON.stringify(m)+'\n');
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(!m.id)return;
 if(m.method==='initialize')send({id:m.id,result:{}});
 else if(m.method==='config/read')send({id:m.id,result:{config:{model:'fixture-default'}}});
 else if(m.method==='model/list')send({id:m.id,result:{data:[{model:'fixture-default',displayName:'Fixture default'},{model:'fixture-next',displayName:'Fixture next'}],nextCursor:null}});
});
`,
  );
  fs.chmodSync(bin, 0o700);
  const previous = process.env.PATH;
  process.env.PATH = path.dirname(bin) + ":" + previous;
  const session = `studens-settings-${process.pid}`;
  const seen: Array<string | null | undefined> = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const teacher = new TeacherService(
    async (identity, _prompt, _cwd, save, _signal, _contract, _raw, active) => {
      seen.push(identity.requestedModel);
      save("settings-conversation");
      if (seen.length === 1) await gate;
      if (identity.requestedModel === "unavailable-model")
        throw new Error(
          `Codex turn failed: ${JSON.stringify({
            message: JSON.stringify({
              type: "error",
              error: {
                message:
                  'Selected model unavailable for this account. <img src=x onerror="alert(1)">',
              },
            }),
            codexErrorInfo: "other",
            additionalDetails: null,
          })}`,
        );
      active?.(identity.requestedModel ?? "fixture-default");
      return {
        calls: [],
        message: "What changes when ownership moves?",
        learning_record: "",
        notes_markdown: "",
      };
    },
  );
  let opened = false;
  if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
  const shot = (name: string) =>
    artifacts
      ? `await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:${JSON.stringify(path.join(artifacts, name + ".png"))},fullPage:true});`
      : "";
  try {
    teacher.connect(async () => {});
    teacher.attach("rust", "codex");
    const base = await server.start(0);
    const originalPort = server.getPort();
    const requestedPort = originalPort === 43567 ? 43568 : 43567;
    await playwright(session, f.root, "open", `${base}/c/rust`);
    opened = true;
    await playwrightCode(
      session,
      f.root,
      `async page=>{
      await page.setViewportSize({width:1280,height:800});${shot("classroom-desktop")}
      await page.setViewportSize({width:375,height:812});${shot("classroom-mobile")}
      await page.getByRole('link',{name:'Settings',exact:true}).click();
      await page.locator('[data-settings-content]').waitFor({state:'visible'});
      await page.getByLabel('Teacher model',{exact:true}).selectOption('fixture-next');
      await page.getByRole('button',{name:'Save teacher model',exact:true}).click();
      await page.getByRole('status').filter({hasText:'Saved for the next'}).waitFor();
      await page.getByLabel('Pace',{exact:true}).fill('Slower, with time to practise');
      await page.getByLabel('Depth',{exact:true}).fill('Detailed, with worked examples');
      await page.getByLabel('Tone',{exact:true}).fill('Direct and encouraging');
      await page.getByRole('button',{name:'Save preferences',exact:true}).click();
      await page.getByRole('status').filter({hasText:'Preferences saved'}).waitFor();
      await page.getByLabel('Local port',{exact:true}).fill(${JSON.stringify(String(requestedPort))});
      await page.getByRole('button',{name:'Save connection settings',exact:true}).click();
      await page.getByRole('status').filter({hasText:'local port applies after'}).waitFor();
      await page.reload();
      if(await page.getByLabel('Pace',{exact:true}).inputValue()!=='Slower, with time to practise')throw new Error('Preferences lost on reload.');
      if(await page.getByLabel('Teacher model',{exact:true}).inputValue()!=='fixture-next')throw new Error('Model selection lost on reload.');
      await page.setViewportSize({width:1280,height:800});${shot("settings-requested-desktop")}
      await page.setViewportSize({width:375,height:812});${shot("settings-requested-mobile")}
      if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Settings overflow at 375px.');
      await page.goto(${JSON.stringify(base + "/c/rust/001-ownership#cl-teacher")});
      await page.getByLabel('Reply to your teacher',{exact:true}).fill('Please continue this check.');
      await page.getByRole('button',{name:'Send reply',exact:true}).click();
      await page.locator('.cl-teacher-requests').filter({hasText:'replying'}).waitFor();
      await page.goto(${JSON.stringify(base + "/c/rust/settings")});
      await page.getByText('Teacher request in progress using fixture-next.',{exact:false}).waitFor();
      await page.getByLabel('Teacher model',{exact:true}).selectOption('');
      await page.getByRole('button',{name:'Save teacher model',exact:true}).click();
      await page.getByRole('status').filter({hasText:'Saved for the next'}).waitFor();
      ${shot("settings-during-request")}
      return {url:page.url()};
    }`,
    );
    if (readTeacherState("rust")!.identity.requestedModel !== null)
      throw new Error(
        "Model catalog loading replaced the learner’s default selection before save.",
      );
    if (seen.join() !== "fixture-next") throw new Error("Model changed during active work.");
    release();
    await teacher.idle();
    await playwrightCode(
      session,
      f.root,
      `async page=>{
      await page.getByText('Last answering model: fixture-next',{exact:true}).waitFor();
      ${shot("settings-active")}
      await page.getByLabel('Teacher model',{exact:true}).selectOption('__custom__');
      await page.getByLabel('Model ID',{exact:true}).fill('unavailable-model');
      await page.getByRole('button',{name:'Save teacher model',exact:true}).click();
      await page.getByRole('status').filter({hasText:'Saved for the next'}).waitFor();
      await page.goto(${JSON.stringify(base + "/c/rust/001-ownership#cl-teacher")});
      await page.getByLabel('Reply to your teacher',{exact:true}).fill('Try the selected model.');
      await page.getByRole('button',{name:'Send reply',exact:true}).click();
      await page.getByRole('button',{name:'Retry request',exact:true}).waitFor();
      ${shot("lesson-unavailable")}
      await page.goto(${JSON.stringify(base + "/c/rust/settings")});
      await page.locator('[data-teacher-error]').filter({hasText:'Selected model unavailable'}).waitFor();
      ${shot("settings-unavailable")}
      const error=page.locator('[data-teacher-error]');
      if(await error.locator('img').count())throw new Error('Host error markup was interpreted as HTML.');
      if((await error.locator('[data-teacher-error-reason]').textContent()).includes('codexErrorInfo'))throw new Error('Host reason obscured by metadata.');
      await error.getByText('Technical details',{exact:true}).click();
      const saved=(await (await page.request.get(${JSON.stringify(base + "/api/settings?classroom=rust")})).json()).teacher.error;
      if(await error.locator('pre').textContent()!==saved)throw new Error('Full original error not inspectable.');
      await page.waitForTimeout(2200);
      if(!await error.locator('details').evaluate(node=>node.open))throw new Error('Status refresh collapsed error details.');
      ${shot("settings-unavailable-details")}
      await page.getByLabel('Teacher model',{exact:true}).selectOption('');
      await page.getByRole('button',{name:'Save teacher model',exact:true}).click();
      await page.getByRole('status').filter({hasText:'Saved for the next'}).waitFor();
      return {};
    }`,
    );
    await teacher.idle();
    if (seen.length !== 2) throw new Error("Selection silently retried failed work.");
    await playwrightCode(
      session,
      f.root,
      `async page=>{
      await page.goto(${JSON.stringify(base + "/c/rust/001-ownership#cl-teacher")});
      await page.getByRole('button',{name:'Retry request',exact:true}).click();
      await page.locator('.cl-teacher-identity').filter({hasText:'Last answering model: fixture-default'}).waitFor();
      await page.goto(${JSON.stringify(base + "/c/rust/settings")});
      await page.getByLabel('Teacher model',{exact:true}).waitFor();
      // Another page changed the preference file; this page must report a stale save.
      await page.request.put(${JSON.stringify(base + "/api/settings?classroom=rust")},{data:{section:'preferences',revision:(await (await page.request.get(${JSON.stringify(base + "/api/settings?classroom=rust")})).json()).preferences.revision,values:{pace:'Other page',depth:'Detailed',tone:'Direct'}}});
      await page.getByLabel('Tone',{exact:true}).fill('Unsaved stale edit');
      await page.getByRole('button',{name:'Save preferences',exact:true}).click();
      await page.locator('[data-settings-error]').filter({hasText:'changed since this page loaded'}).waitFor();
      ${shot("settings-stale-error")}
      return {};
    }`,
    );
    await teacher.idle();
    if (Array.from(seen).length !== 3 || seen[2] !== null)
      throw new Error("Explicit retry failed to use configured default.");
    const savedPort = readConfig().port;
    const currentPort = server.getPort();
    if (artifacts)
      fs.writeFileSync(
        path.join(artifacts, "settings-ports.json"),
        JSON.stringify({ originalPort, requestedPort, savedPort, currentPort }, null, 2),
      );
    if (savedPort !== requestedPort || currentPort !== originalPort)
      throw new Error("Saved port was incorrectly applied to running listener.");
    if (!(readConfig() as any).unrelated.keep) throw new Error("Unrelated configuration lost.");
    if (learnerPreferences("algebra").values.pace)
      throw new Error("Preferences leaked across classrooms.");
    await teacher.stop();
    const restart = new TeacherService(async () => {
      throw new Error("Completed work was rerun after restart.");
    });
    restart.restore();
    await restart.idle();
    if (restart.settings("rust")?.identity.sessionId !== "settings-conversation")
      throw new Error("Conversation identity lost after restart.");
    await restart.stop();
    if (artifacts) {
      fs.writeFileSync(
        path.join(artifacts, "settings-state.json"),
        JSON.stringify(
          {
            seen,
            state: readTeacherState("rust"),
            preferences: learnerPreferences("rust"),
            config: readConfig(),
            originalPort,
            requestedPort,
            currentPort: server.getPort(),
          },
          null,
          2,
        ),
      );
      fs.copyFileSync(path.join(f.root, "rust/NOTES.md"), path.join(artifacts, "NOTES.md"));
    }
  } catch (error) {
    if (opened && artifacts) {
      const failure = await playwrightCode(
        session,
        f.root,
        `async page=>{await page.screenshot({path:${JSON.stringify(path.join(artifacts!, "failure.png"))},fullPage:true});return {url:page.url(),body:await page.locator('body').innerText()};}`,
      );
      fs.writeFileSync(
        path.join(artifacts, "failure.json"),
        JSON.stringify({ error: String(error), page: failure }, null, 2),
      );
    }
    throw error;
  } finally {
    release();
    await teacher.stop();
    if (opened) await playwright(session, f.root, "close");
    await server.close();
    process.env.PATH = previous;
    f.cleanup();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await verifySettingsBrowser(process.argv[2] ?? null);
