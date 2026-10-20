/** Temporary automatic tailnet route evaluation. Preserve the user's Serve config.
 * Set STUDENS_PHONE_PORT when 8443 holds another route. */
import { playwright, playwrightCode } from "./playwright.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { useTestModel, harnessCommand } from "./harness.ts";
import { readTeacherState } from "../src/service-state.ts";
import { promisify } from "node:util";
import { makeFixture, seedClassroom } from "../test/helpers.ts";
import { control, ensureService, serviceStatus } from "../src/service-client.ts";
const exec = promisify(execFile);
const artifacts = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
const backend = process.argv[3] ?? "codex";
if (!["pi", "codex"].includes(backend)) throw new Error("Phone backend must be pi or codex.");
const restore = backend === "pi" ? useTestModel("pi") : () => {};
const browser = `studens-phone-settings-${process.pid}`;
let browserOpen = false;
const fixture = makeFixture();
seedClassroom(fixture);
const listener = net.createServer();
await new Promise<void>((r) => listener.listen(0, "127.0.0.1", r));
process.env.PI_CLASSROOM_SERVICE_PORT = String((listener.address() as net.AddressInfo).port);
await new Promise<void>((r) => listener.close(() => r()));
const httpsPort = Number(process.env.STUDENS_PHONE_PORT ?? 8443);
process.env.PI_CLASSROOM_CONFIG = fixture.write(
  "config.json",
  JSON.stringify({ tailscalePort: httpsPort }),
);
delete process.env.PI_CLASSROOM_TAILSCALE;
const before = JSON.parse((await exec("tailscale", ["serve", "status", "--json"])).stdout);
if (
  before.TCP?.[String(httpsPort)] ||
  Object.keys(before.Web ?? {}).some((key) => key.endsWith(`:${httpsPort}`))
)
  throw new Error(
    `HTTPS port ${httpsPort} is already configured. Choose an unused STUDENS_PHONE_PORT; no route was changed.`,
  );
function unrelated(config: any): unknown {
  const copy = structuredClone(config);
  delete copy.TCP?.[String(httpsPort)];
  for (const key of Object.keys(copy.Web ?? {}))
    if (key.endsWith(`:${httpsPort}`)) delete copy.Web[key];
  return copy;
}
async function call(name: string, args: unknown): Promise<any> {
  const response = await control("/rpc", {
    client: "phone-evaluation",
    backend,
    message: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
  });
  if (response.result.isError) throw new Error(response.result.content[0].text);
  return response.result.content[0].text;
}
const writeConfig = (config: unknown) =>
  fs.writeFileSync(process.env.PI_CLASSROOM_CONFIG!, JSON.stringify(config));
const routed = async () =>
  Object.keys(
    JSON.parse((await exec("tailscale", ["serve", "status", "--json"])).stdout).Web ?? {},
  ).some((key) => key.endsWith(`:${httpsPort}`));
const openTailnet = async () => {
  const opened = await call("open_classroom", { classroom: "rust", teacher_backend: backend });
  const link = /^\[Open classroom\]\((https:\/\/[^)]+\.ts\.net:(\d+)\/c\/rust)\)$/.exec(opened);
  if (!link || Number(link[2]) !== httpsPort)
    throw new Error(`open_classroom did not return the tailnet link: ${opened}`);
  return link[1];
};
try {
  await ensureService();
  let hostOutput = "";
  if (backend === "pi") {
    const [command, args] = harnessCommand(
      "pi",
      'Call open_classroom for classroom rust and teacher_backend pi. Then call open_classroom with classroom rust and lesson "001-ownership". Return both tool-provided links and end this turn.',
      ["open_classroom"],
    );
    const child = spawn(command, args, {
      cwd: fixture.root,
      env: { ...process.env, PI_CLASSROOMS_DIR: fixture.root },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stdout.on("data", (c) => {
      hostOutput += c;
    });
    child.stderr.on("data", (c) => {
      stderr += c;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const code = await Promise.race([
        new Promise<number | null>((resolve, reject) => {
          child.once("error", reject);
          child.once("close", resolve);
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Initiating Pi phone host timed out.")),
            180_000,
          );
        }),
      ]);
      if (code !== 0) throw new Error(`Initiating Pi phone host exited ${code}: ${stderr}`);
    } finally {
      clearTimeout(timer);
      child.kill();
      if (artifacts) {
        fs.writeFileSync(path.join(artifacts, "pi-host-output.jsonl"), hostOutput);
        fs.writeFileSync(path.join(artifacts, "pi-host-stderr.log"), stderr);
      }
    }
    if (
      !(await serviceStatus()).running ||
      !(await routed()) ||
      readTeacherState("rust")?.identity.backend !== "pi"
    )
      throw new Error("Pi exit lost its persistent teacher/route.");
  }
  const classroom = await openTailnet();
  if (
    backend === "pi" &&
    (!hostOutput.includes(classroom) || !hostOutput.includes(`${classroom}/001-ownership`))
  )
    throw new Error("Actual Pi did not return classroom and lesson tailnet links.");
  for (const url of [classroom, `${classroom}/001-ownership`])
    if (!(await fetch(url)).ok) throw new Error(`Tailnet URL did not load: ${url}`);
  const state = JSON.parse(await call("classroom_service", { action: "status" }));
  const current = JSON.parse((await exec("tailscale", ["serve", "status", "--json"])).stdout);
  if (
    Object.keys(current.AllowFunnel ?? {}).some(
      (key) => key.endsWith(`:${httpsPort}`) && current.AllowFunnel[key],
    )
  )
    throw new Error("Owned route enabled Funnel.");
  if (artifacts)
    fs.writeFileSync(
      path.join(artifacts, "tailnet-provenance.json"),
      JSON.stringify(
        {
          backend,
          before,
          during: current,
          classroom,
          lesson: `${classroom}/001-ownership`,
          status: state,
          initiatingHostExited: true,
        },
        null,
        2,
      ),
    );
  if (!state.tailnet?.enabled) throw new Error("Service status did not report the owned route.");
  const base = (await serviceStatus()).url;
  await playwright(browser, fixture.root, "open", `${base}/c/rust/settings`);
  browserOpen = true;
  await playwrightCode(
    browser,
    fixture.root,
    `async page=>{
    const field=page.getByLabel('Enable Tailscale links while connected',{exact:true});
    await field.uncheck();
    await page.getByRole('button',{name:'Save connection settings',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Links updated'}).waitFor();
    ${artifacts ? `await page.screenshot({path:${JSON.stringify(path.join(artifacts, "settings-tailnet-disabled.png"))},fullPage:true});` : ""}
    return {};
  }`,
  );
  if (await routed())
    throw new Error("Saving disabled links on the settings page kept the owned route.");
  await playwrightCode(
    browser,
    fixture.root,
    `async page=>{
    await page.getByLabel('Enable Tailscale links while connected',{exact:true}).check();
    await page.getByRole('button',{name:'Save connection settings',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Links updated'}).waitFor();return {};
  }`,
  );
  if (!(await routed()))
    throw new Error("Saving enabled links on the settings page did not restore the owned route.");
  if (!(await fetch(classroom)).ok)
    throw new Error("Settings route was not reachable on the tailnet after enabling links.");
  writeConfig({ tailscale: false, tailscalePort: httpsPort });
  const local = await call("open_classroom", { classroom: "rust" });
  if (!local.includes("http://127.0.0.1:")) throw new Error(`Disabled links stayed: ${local}`);
  if (await routed()) throw new Error("Disabling tailnet links kept the owned route.");
  writeConfig({ tailscalePort: httpsPort });
  await openTailnet();
  const stopped = JSON.parse(await call("classroom_service", { action: "stop" }));
  if (!stopped.tailnet?.removed) throw new Error("Service stop did not remove the owned route.");
  await new Promise((r) => setTimeout(r, 300));
  const after = JSON.parse((await exec("tailscale", ["serve", "status", "--json"])).stdout);
  if (JSON.stringify(unrelated(before)) !== JSON.stringify(unrelated(after)))
    throw new Error("Unrelated Serve routes changed.");
  if (await routed()) throw new Error("Owned tailnet route remains.");
  if (artifacts)
    fs.writeFileSync(path.join(artifacts, "tailnet-after.json"), JSON.stringify(after, null, 2));
  console.log(
    "PASS: automatic tailnet classroom and lesson links, service status, settings-page disable/enable, config disable, service stop cleanup, and unchanged unrelated routes.",
  );
} finally {
  if (browserOpen) await playwright(browser, fixture.root, "close");
  if ((await serviceStatus()).running) {
    await control("/stop", {});
    await new Promise((r) => setTimeout(r, 300));
  }
  fixture.cleanup();
  restore();
}
