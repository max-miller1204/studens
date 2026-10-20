import { describe, it, expect, vi } from "vitest";
const { call, disconnect } = vi.hoisted(() => ({ call: vi.fn(), disconnect: vi.fn() }));
vi.mock("../src/pi-service-client.ts", () => ({
  PiServiceClient: class {
    definitions = async () => [
      { name: "open_classroom", title: "Open Classroom", description: "Open", inputSchema: {} },
    ];
    call = call;
    disconnect = disconnect;
  },
}));
vi.mock("../src/status-widget.ts", () => ({
  attachStatusWidget: async () => {},
  detachStatusWidget: () => {},
}));
import classroomExtension from "../index.ts";
describe("Pi extension service ownership", () => {
  it("forwards authoring tools and detaches without taking browser turns or stopping the service", async () => {
    const hooks = new Map<string, any>();
    const tools = new Map<string, any>();
    const commands = new Map<string, any>();
    await classroomExtension({
      on: (name: string, fn: any) => hooks.set(name, fn),
      registerTool: (tool: any) => tools.set(tool.name, tool),
      registerCommand: (name: string, spec: any) => commands.set(name, spec),
    } as any);
    expect([...hooks.keys()]).toEqual(["session_start", "session_shutdown"]);
    expect([...commands.keys()]).toEqual(["classroom", "teach"]);
    expect(tools.has("grade_lesson_quiz")).toBe(false);
    call.mockResolvedValue({ content: [{ type: "text", text: "service URL" }], details: {} });
    expect(await tools.get("open_classroom").execute("call", { classroom: "rust" })).toEqual({
      content: [{ type: "text", text: "service URL" }],
      details: {},
    });
    expect(call).toHaveBeenCalledWith("open_classroom", { classroom: "rust" });
    await hooks.get("session_shutdown")();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(call).not.toHaveBeenCalledWith("classroom_service", { action: "stop" });
  });
});
