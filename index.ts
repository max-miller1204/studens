/** Pi initiates authoring; the shared persistent service owns learner requests. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PiServiceClient } from "./src/pi-service-client.ts";
import { registerClassroomCommands } from "./src/commands.ts";
import { attachStatusWidget, detachStatusWidget } from "./src/status-widget.ts";

export default async function classroomExtension(pi: ExtensionAPI): Promise<void> {
  const client = new PiServiceClient();
  for (const tool of await client.definitions()) {
    pi.registerTool({
      name: tool.name,
      label: tool.title ?? tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      execute: async (_id: string, args: unknown) => client.call(tool.name, args),
    });
  }
  registerClassroomCommands(pi, client);
  pi.on("session_start", async (_event, ctx) => {
    await attachStatusWidget(ctx.ui as any);
  });
  pi.on("session_shutdown", async () => {
    detachStatusWidget();
    await client.disconnect();
  });
}
