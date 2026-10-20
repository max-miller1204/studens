import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

import * as server from "../src/server.ts";
import {
  WIDGET_KEY,
  attachStatusWidget,
  detachStatusWidget,
  refreshStatusWidget,
  type WidgetHost,
} from "../src/status-widget.ts";
import { makeFixture, seedClassroom, type Fixture } from "./helpers.ts";

interface Call {
  key: string;
  content: string[] | undefined;
  placement?: string;
}

/** A stub `ctx.ui` recording every setWidget call. */
function stubHost(theme?: WidgetHost["theme"]): WidgetHost & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    theme,
    setWidget(key, content, options) {
      calls.push({ key, content, placement: options?.placement });
    },
  };
}

const status = vi.hoisted(() => ({ running: false, port: 0 }));
vi.mock("../src/service-client.ts", () => ({ serviceStatus: async () => status }));
let fixture: Fixture;

beforeEach(() => {
  status.running = false;
  fixture = makeFixture();
  seedClassroom(fixture);
});

afterEach(async () => {
  detachStatusWidget();
  await server.close();
  fixture.cleanup();
});

describe("the widget's lifecycle", () => {
  it("appears with the live port once the server is up, and clears when it stops", async () => {
    const host = stubHost();

    await attachStatusWidget(host);
    expect(host.calls).toEqual([{ key: WIDGET_KEY, content: undefined, placement: "belowEditor" }]);

    await server.start();
    status.running = true;
    status.port = server.getPort()!;
    await refreshStatusWidget();
    const shown = host.calls.at(-1)!;
    expect(shown.key).toBe(WIDGET_KEY);
    // The port is read from the server, so it stays current after a restart.
    expect(shown.content).toHaveLength(1);
    expect(shown.content![0]).toContain(String(server.getPort()));

    await server.close();
    status.running = false;
    await refreshStatusWidget();
    expect(host.calls.at(-1)!.content).toBeUndefined();
  });

  it("clears the widget on shutdown and then stays quiet", async () => {
    const host = stubHost();
    await attachStatusWidget(host);
    detachStatusWidget();

    expect(host.calls.at(-1)).toEqual({ key: WIDGET_KEY, content: undefined });

    const after = host.calls.length;
    await refreshStatusWidget();
    expect(host.calls).toHaveLength(after);
  });

  it("does nothing at all when the session has no UI", async () => {
    await expect(attachStatusWidget(null)).resolves.toBeUndefined();
    await expect(refreshStatusWidget()).resolves.toBeUndefined();
  });

  it("survives a UI that does not support widgets", async () => {
    const host: WidgetHost = {
      setWidget() {
        throw new Error("no widgets in this mode");
      },
    };

    await attachStatusWidget(host);
    await server.start();
    expect(() => refreshStatusWidget()).not.toThrow();
    expect(server.isRunning()).toBe(true);
  });
});
