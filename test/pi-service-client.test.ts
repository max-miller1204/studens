import { beforeEach, expect, it, vi } from "vitest";
const { control, ensureService, serviceStatus } = vi.hoisted(() => ({
  control: vi.fn(),
  ensureService: vi.fn(),
  serviceStatus: vi.fn(),
}));
vi.mock("../src/service-client.ts", () => ({ control, ensureService, serviceStatus }));
import { PiServiceClient } from "../src/pi-service-client.ts";
beforeEach(() => {
  vi.clearAllMocks();
  control.mockResolvedValue({
    result: { content: [{ type: "text", text: "result" }], isError: false },
  });
});
it("discovers tools without starting HTTP or giving initiating Pi the grading tools", async () => {
  const tools = await new PiServiceClient().definitions();
  expect(tools.map((t) => t.name)).toEqual(
    expect.arrayContaining([
      "begin_teaching",
      "scaffold_lesson",
      "scaffold_review",
      "open_classroom",
      "resume_lesson_teacher",
      "classroom_service",
    ]),
  );
  expect(tools.map((t) => t.name)).not.toEqual(expect.arrayContaining(["grade_lesson_quiz"]));
  expect(ensureService).not.toHaveBeenCalled();
  expect(control).not.toHaveBeenCalled();
});
it.each(["status", "stop"])(
  "can explicitly %s an incompatible service without starting or replacing it",
  async (action) => {
    serviceStatus.mockResolvedValue({
      running: true,
      packageRoot: "/previous-package",
      version: "previous",
    });
    ensureService.mockRejectedValue(new Error("Incompatible owner must not be started/replaced."));
    await new PiServiceClient().call("classroom_service", { action });
    expect(ensureService).not.toHaveBeenCalled();
    expect(control).toHaveBeenCalledWith(
      "/rpc",
      expect.objectContaining({
        backend: undefined,
        message: expect.objectContaining({
          params: { name: "classroom_service", arguments: { action } },
        }),
      }),
    );
  },
);
it("keeps the Pi backend after management calls and rejects an old teacher protocol", async () => {
  const status = { running: true, backends: ["pi", "claude", "codex"] };
  serviceStatus.mockResolvedValue(status);
  ensureService.mockResolvedValue(status);
  const client = new PiServiceClient();
  await client.call("classroom_service", { action: "status" });
  await client.call("open_classroom", { classroom: "rust" });
  expect(control.mock.calls.every(([, args]) => args.backend === "pi")).toBe(true);
  ensureService.mockResolvedValue({ running: true });
  await expect(client.call("open_classroom", { classroom: "rust" })).rejects.toThrow();
  expect(control).toHaveBeenCalledTimes(2);
});
it("does not detach from the removed socket after an explicit successful stop", async () => {
  serviceStatus.mockResolvedValue({ running: true, backends: ["pi"] });
  const client = new PiServiceClient();
  await client.call("classroom_service", { action: "stop" });
  await client.disconnect();
  expect(control).toHaveBeenCalledTimes(1);
  expect(control.mock.calls[0][0]).toBe("/rpc");
});
