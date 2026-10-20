/** Directed native producer/checker/publication proof, separate from autonomous authoring comparisons. */
import * as fs from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { makeFixture } from "../test/helpers.ts";
import { ROOT, TEST_MODELS, useTestModel, parseHarness } from "./harness.ts";
import { control, ensureService, servicePaths, serviceStatus } from "../src/service-client.ts";
import { lessonRequests } from "../src/next-lesson.ts";
import { readTeacherState } from "../src/service-state.ts";
import { teachingSources } from "../src/lesson-sources.ts";
import { playwright, playwrightCode } from "./playwright.ts";
const host = parseHarness(
  process.argv[2],
  "Usage: node scripts/e2e-source-authoring.ts <pi|claude|codex> <artifacts>",
);
assert.ok(process.argv[3]);
const out = path.resolve(process.argv[3]);
fs.mkdirSync(out); // Evidence is never overwritten.
const f = makeFixture(),
  restore = useTestModel(host),
  browser = "studens-native-source-" + host + "-" + process.pid,
  client = "source-authoring-" + process.pid;
const hash = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
function inventory(root: string): Record<string, string> {
  return Object.fromEntries(
    fs
      .readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => {
        const file = path.join(e.parentPath, e.name);
        return [path.relative(root, file), hash(fs.readFileSync(file))];
      })
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}
f.write(
  "source-course/classroom.json",
  JSON.stringify({ title: "Source provenance", emoji: "📚", createdAt: 1 }),
);
f.write("source-course/MISSION.md", "# Mission\n\n## Why\n\nReason about ownership.\n");
f.write(
  "source-course/GLOSSARY.md",
  "# Glossary\n\n**Ownership**:\nA rule assigning one owner to each value.\n",
);
f.write(
  "source-course/NOTES.md",
  "# Notes\n\nThe learner explicitly requests a short lesson and skips the pretest.\n",
);
const listener = net.createServer();
await new Promise<void>((r) => listener.listen(0, "127.0.0.1", r));
process.env.PI_CLASSROOM_SERVICE_PORT = String((listener.address() as net.AddressInfo).port);
await new Promise<void>((r) => listener.close(() => r()));
process.env.PI_CLASSROOM_TAILSCALE = "0";
process.env.PI_CLASSROOM_TEACHER = host;
let opened = false,
  started = false,
  status: any,
  failure: string | undefined;
const topic =
  'Teach a short lesson explaining Rust ownership through a worked move example and a fresh independent application. Explicitly skip the pretest and its gate together, as requested by the learner. Keep one objective, one normal check, and exactly two private review variants. Use the existing strict rubric and criteria contracts. The exact canonical glossary term is Ownership. Declare the section that actually teaches that concept as <section id="ownership-origin" data-cl-teaches="Ownership">. Do not mark mere mentions or assessments. Use a different example for the check and variants, and do not disclose their answers. Use the canonical lesson shell. No web research is needed for this elementary example.';
const sourceFiles = [
  "src/lesson-sources.ts",
  "src/store/lesson-sources.ts",
  "src/prompts.ts",
  "src/next-lesson.ts",
  "src/lesson-output.ts",
  "src/teacher.ts",
  "src/teacher-service.ts",
  "src/pi-teacher.ts",
  "src/teaching-plan.ts",
  "scripts/lesson-inputs.ts",
  "scripts/check-lesson.ts",
  "docs/SOURCE-LINKS.md",
  "assets/runtime/glossary-ui.mjs",
];
fs.writeFileSync(
  path.join(out, "provenance.json"),
  JSON.stringify(
    {
      host,
      model: TEST_MODELS[host],
      kind: "directed-native-source-authoring",
      autonomousAdoption: false,
      topic,
      source: ROOT,
      sourceHashes: Object.fromEntries(
        sourceFiles.map((file) => [file, hash(fs.readFileSync(path.join(ROOT, file)))]),
      ),
    },
    null,
    2,
  ),
);
try {
  status = await ensureService();
  started = true;
  assert.equal(status.packageRoot, path.resolve(ROOT));
  await control("/rpc", {
    client,
    backend: host,
    message: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "source-authoring-verifier", version: "1" },
      },
    },
  });
  const attached = await control("/rpc", {
    client,
    backend: host,
    message: {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "open_classroom",
        arguments: { classroom: "source-course", teacher_backend: host },
      },
    },
  });
  assert.ok(!attached.error && !attached.result?.isError, JSON.stringify(attached));
  await playwright(browser, out, "open", status.url + "/c/source-course");
  opened = true;
  if (host !== "pi")
    await playwrightCode(
      browser,
      out,
      `async page=>{await page.goto(${JSON.stringify(status.url + "/c/source-course/settings")});await page.getByLabel('Teacher model',{exact:true}).selectOption('__custom__');await page.getByLabel('Model ID',{exact:true}).fill(${JSON.stringify(TEST_MODELS[host].model)});await page.getByRole('button',{name:'Save teacher model',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved for the next'}).waitFor();return true;}`,
    );
  await playwrightCode(
    browser,
    out,
    `async page=>{await page.goto(${JSON.stringify(status.url + "/c/source-course")});await page.getByLabel('What would you like to learn next?').fill(${JSON.stringify(topic)});await page.getByRole('button',{name:'Next lesson',exact:true}).click();return true;}`,
  );
  const deadline = Date.now() + 600000;
  let saved;
  while (Date.now() < deadline) {
    saved = lessonRequests("source-course").at(-1);
    if (saved?.status === "failed" || saved?.status === "done") break;
    await new Promise((r) => setTimeout(r, 500));
  }
  fs.writeFileSync(path.join(out, "stored-request.json"), JSON.stringify(saved, null, 2));
  assert.equal(
    saved?.status,
    "done",
    saved?.error ?? "Native source authoring did not finish before deadline.",
  );
  assert.ok(saved?.document && saved.pageCheck);
  const receipt = JSON.parse(saved.pageCheck.report);
  assert.equal(receipt.learnerStateChanged, false);
  for (const [file, digest] of Object.entries(receipt.preflight.inputHashes))
    assert.equal(
      hash(fs.readFileSync(path.join(f.root, "source-course", saved.lesson, file))),
      digest,
    );
  const sources = teachingSources(saved.document.lesson_html);
  assert.deepEqual(sources, [{ term: "Ownership", anchor: "ownership-origin" }]);
  const identity = readTeacherState("source-course")!.identity;
  assert.equal(identity.backend, host);
  const before = inventory(path.join(f.root, "source-course"));
  const ui = await playwrightCode(
    browser,
    out,
    `async page=>{const writes=[];page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.method()+' '+r.url());});await page.goto(${JSON.stringify(status.url + "/c/source-course/" + saved.lesson)});await page.locator('.cl-term').first().waitFor();await page.locator('.cl-term').first().click();const pop=page.getByRole('dialog',{name:'Ownership',exact:true});if(await pop.locator('[data-cl-origin]').isVisible())throw new Error('Origin bypassed recall.');await pop.getByRole('button',{name:'Show the definition',exact:true}).click();const href=await pop.getByRole('link').getAttribute('href');await pop.getByRole('link').click();await page.locator('#ownership-origin').waitFor();await page.reload();await page.waitForFunction(()=>document.activeElement?.id==='ownership-origin');const target=await page.locator('#ownership-origin').boundingBox(),header=await page.locator('.cl-header').boundingBox();if(target.y<header.y+header.height-1)throw new Error('Teaching heading hidden below header.');await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:${JSON.stringify(path.join(out, "native-origin-desktop-light.png"))},fullPage:true});if(writes.length)throw new Error('Navigation wrote state: '+JSON.stringify(writes));return {href,writes,clicked:true,persisted:true};}`,
  );
  assert.equal(
    ui && (ui as { href: string }).href,
    `/c/source-course/${saved.lesson}#ownership-origin`,
  );
  const after = inventory(path.join(f.root, "source-course"));
  assert.deepEqual(after, before);
  fs.writeFileSync(
    path.join(out, "result.json"),
    JSON.stringify(
      {
        kind: "directed-native-source-authoring",
        host,
        identity,
        model: TEST_MODELS[host],
        request: saved.id,
        lesson: saved.lesson,
        sources,
        receipt,
        ui,
        before,
        after,
        zeroNavigationWrites: true,
        zeroNavigationModelCalls: true,
        zeroLearningCredit: true,
        semanticReview:
          "Read authored section separately; this proves declared provenance, not human learning.",
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: native directed source declaration survived strict schema, checker and four-file publication; real source link clicked and reload persisted without writes.",
  );
} catch (error) {
  failure = String(error);
  fs.writeFileSync(
    path.join(out, "failure.json"),
    JSON.stringify({ error: failure, request: lessonRequests("source-course").at(-1) }, null, 2),
  );
  if (opened) {
    fs.writeFileSync(
      path.join(out, "failure-snapshot.txt"),
      await playwright(browser, out, "snapshot"),
    );
    await playwright(browser, out, "screenshot", "--filename=" + path.join(out, "failure.png"));
  }
  throw error;
} finally {
  if (opened) await playwright(browser, out, "close");
  fs.cpSync(path.join(f.root, "source-course"), path.join(out, "classroom"), { recursive: true });
  if (fs.existsSync(servicePaths().dir))
    fs.cpSync(servicePaths().dir, path.join(out, "service"), { recursive: true });
  if (started) {
    await control("/disconnect", { client });
    await control("/stop", {});
    try {
      const deadline = Date.now() + 15000;
      while ((await serviceStatus()).running) {
        if (Date.now() >= deadline)
          throw new Error("Owned service did not stop within 15 seconds.");
        await new Promise((r) => setTimeout(r, 100));
      }
    } catch (error) {
      fs.writeFileSync(
        path.join(out, "cleanup-failure.json"),
        JSON.stringify({ error: String(error), pid: status.pid }, null, 2),
      );
      if ((await serviceStatus()).root === f.root) process.kill(status.pid, "SIGKILL");
    }
  }
  restore();
  f.cleanup();
  fs.writeFileSync(
    path.join(out, "cleanup.json"),
    JSON.stringify({ browserClosed: true, ownedFixtureRemoved: !fs.existsSync(f.root), failure }),
  );
}
