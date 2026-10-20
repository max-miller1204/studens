/** Pi's extension uses the same private control socket and tool dispatch as MCP. */
import { randomUUID } from "node:crypto";
import { control, ensureService, serviceStatus } from "./service-client.ts";
import { McpSession, LearnerInbox } from "./mcp.ts";
import { serviceToolDefinitions } from "./service-tools.ts";
import { resumeTeacherTool } from "./teacher-resume.ts";
import type { ToolResult } from "./tools.ts";
import { PhoneAccess } from "./phone-access.ts";

export class PiServiceClient {
  private readonly client = randomUUID();
  private sequence = 0;
  private connected = false;
  async definitions(): Promise<any[]> {
    const unavailable = () => {
      throw new Error("A service connection is required.");
    };
    const local = new McpSession(new LearnerInbox(), {
      open: async () => unavailable(),
      tools: [
        resumeTeacherTool(unavailable),
        ...serviceToolDefinitions.map((tool) => ({ ...tool, execute: async () => unavailable() })),
      ],
    });
    const response = await local.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    return (response as any).result.tools;
  }
  async call(name: string, args: unknown): Promise<ToolResult> {
    let managementStatus: any;
    if (name === "classroom_service" && ["status", "stop"].includes((args as any)?.action)) {
      const status = (managementStatus = await serviceStatus());
      if (!status.running) {
        const phone = new PhoneAccess();
        const tailnet = (args as any).action === "stop" ? await phone.stop() : await phone.status();
        if ((args as any).action === "stop") this.connected = false;
        return {
          content: [{ type: "text", text: JSON.stringify({ ...status, tailnet }) }],
          details: {},
        };
      }
    }
    const status = managementStatus ?? (await ensureService());
    if (name !== "classroom_service" && !status.backends?.includes("pi"))
      throw new Error(
        "The running service does not support dedicated Pi teachers. Stop it explicitly with /classroom stop, then retry /classroom.",
      );
    this.connected = true;
    const response: any = await control("/rpc", {
      client: this.client,
      backend: status.backends?.includes("pi") ? "pi" : undefined,
      message: {
        jsonrpc: "2.0",
        id: ++this.sequence,
        method: "tools/call",
        params: { name, arguments: args },
      },
    });
    if (response?.error) throw new Error(response.error.message);
    if (!response?.result) throw new Error("Pi service returned no tool result. Retry explicitly.");
    if (response.result.isError)
      throw new Error(response.result.content.map((c: any) => c.text ?? "").join("\n"));
    if (name === "classroom_service" && (args as any)?.action === "stop") this.connected = false;
    return { content: response.result.content, details: {} };
  }
  async disconnect(): Promise<void> {
    if (this.connected) await control("/disconnect", { client: this.client });
    this.connected = false;
  }
}
