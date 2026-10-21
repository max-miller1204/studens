import { detectOpeningBackend } from "./teacher-host.ts";
/** An MCP connection attaches to the persistent service. stdin does not own HTTP. */
import { resumeTeacherTool } from "./teacher-resume.ts";
import * as readline from "node:readline";
import { randomUUID } from "node:crypto";
import { control, ensureService, serviceStatus } from "./service-client.ts";
import { McpSession, LearnerInbox, type JsonRpcMessage } from "./mcp.ts";
import { serviceToolDefinitions } from "./service-tools.ts";
import { PhoneAccess } from "./phone-access.ts";
import type { Backend } from "./teacher.ts";

const local = new McpSession(new LearnerInbox(), {
  tools: [
    resumeTeacherTool(() => {
      throw new Error("Teacher resumption requires a service connection.");
    }),
    ...serviceToolDefinitions.map((tool) => ({
      ...tool,
      async execute() {
        throw new Error("Service tools require a service connection.");
      },
    })),
  ],
  async open() {
    throw new Error("Opening a classroom requires a service connection.");
  },
});
const client = randomUUID();
let backend: Backend | undefined;
let connected = false;
let start: Promise<unknown> | undefined;
const pending = new Set<Promise<void>>();
function write(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
async function attach(): Promise<void> {
  start ??= ensureService().catch((err) => {
    start = undefined;
    throw err;
  });
  try {
    await start;
    connected = true;
  } finally {
    start = undefined;
  }
}
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  if (!line.trim()) return;
  let message: JsonRpcMessage;
  try {
    message = JSON.parse(line);
  } catch {
    write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  const request = (async () => {
    if (message.method === "initialize") {
      backend = detectOpeningBackend(
        String(message.params?.clientInfo?.name ?? ""),
        process.env.PI_CLASSROOM_TEACHER,
      );
    }
    if (message.method !== "tools/call") {
      const response = await local.handle(message);
      if (response) write(response);
      return;
    }
    // Status and stop must not start a stopped service.
    let management = false;
    if (
      message.method === "tools/call" &&
      message.params?.name === "classroom_service" &&
      ["status", "stop"].includes(message.params?.arguments?.action)
    ) {
      const status = await serviceStatus();
      if (!status.running) {
        // A crashed service can leave its route. Report it, and remove it on stop.
        const phone = new PhoneAccess();
        const tailnet =
          message.params.arguments.action === "status" ? await phone.status() : await phone.stop();
        if (message.params.arguments.action === "stop") connected = false;
        write({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            content: [{ type: "text", text: JSON.stringify({ ...status, tailnet }) }],
            isError: false,
          },
        });
        return;
      }
      management = true;
    }
    // A live status probe already found the owner. Do not restart it if it exits
    // between that probe and the management request.
    if (management) connected = true;
    else await attach();
    const response = await control("/rpc", { client, backend, message });
    if (
      message.params?.name === "classroom_service" &&
      message.params?.arguments?.action === "stop" &&
      !response?.error &&
      response?.result?.isError === false
    )
      connected = false;
    if (response) write(response);
  })().catch((err) => {
    console.error("[classroom] MCP request failed", err);
    if (message.id !== undefined && message.id !== null)
      write({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: err.message } });
  });
  pending.add(request);
  void request.finally(() => pending.delete(request));
});
lines.on("close", () => {
  void (async () => {
    // stdin can close before an accepted stop has returned its acknowledgement.
    await Promise.all(pending);
    if (start) await start;
    if (connected) await control("/disconnect", { client });
  })()
    .catch((err) => console.error("[classroom] detach failed", err))
    .finally(() => process.exit(0));
});
