/** Public research uses one checked DNS answer for each actual connection. */
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readLessonSource } from "../src/lesson-research.ts";
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("node:http", () => ({ request: vi.fn() }));
vi.mock("node:https", () => ({ request: vi.fn() }));
const publicIP = "93.184.216.34";
let responses: Array<{
  status?: number;
  headers?: Record<string, string>;
  peer?: string;
  chunks?: Buffer[];
}>;
let connections: Array<{ url: URL; address: string; family: number; options: any }>;
beforeEach(() => {
  responses = [];
  connections = [];
  vi.mocked(lookup).mockResolvedValue([{ address: publicIP, family: 4 }] as any);
  const connect = (url: URL, options: any, receive: (response: any) => void) => {
    const request = new EventEmitter() as EventEmitter & { end(): void };
    request.end = () => {
      options.lookup(url.hostname, {}, (error: Error | null, address: string, family: number) => {
        if (error) {
          request.emit("error", error);
          return;
        }
        connections.push({ url, address, family, options });
        const result = responses.shift() ?? {};
        const response = Readable.from(result.chunks ?? [Buffer.from("Public source")]);
        Object.assign(response, {
          statusCode: result.status ?? 200,
          headers: result.headers ?? { "content-type": "text/plain" },
          socket: { remoteAddress: result.peer ?? address },
        });
        queueMicrotask(() => receive(response));
      });
    };
    return request;
  };
  vi.mocked(httpRequest).mockImplementation(connect as any);
  vi.mocked(httpsRequest).mockImplementation(connect as any);
});
afterEach(() => vi.clearAllMocks());
it("pins the public DNS answer and retains the HTTPS hostname without disabling TLS validation", async () => {
  await expect(readLessonSource({ url: "https://source.example:8443/book" })).resolves.toContain(
    "Public source",
  );
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(connections).toHaveLength(1);
  const connection = connections[0];
  expect(connection.address).toBe(publicIP);
  expect(connection.family).toBe(4);
  expect(connection.url.host).toBe("source.example:8443");
  expect(httpsRequest).toHaveBeenCalledTimes(1);
  expect(httpRequest).not.toHaveBeenCalled();
  expect(connection.options).toMatchObject({ agent: false, family: 4 });
  expect(connection.options.rejectUnauthorized).toBeUndefined();
  expect(connection.options.checkServerIdentity).toBeUndefined();
  expect(connection.options.headers).toBeUndefined();
  expect(connection.options.signal).toBeInstanceOf(AbortSignal);
});
it("revalidates redirect destinations before connecting and rejects a private second answer", async () => {
  vi.mocked(lookup)
    .mockResolvedValueOnce([{ address: publicIP, family: 4 }] as any)
    .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }] as any);
  responses.push({ status: 302, headers: { location: "http://private.example/fixture" } });
  await expect(readLessonSource({ url: "https://source.example/start" })).rejects.toThrow(
    "private network",
  );
  expect(lookup).toHaveBeenCalledTimes(2);
  expect(connections).toHaveLength(1);
});
it("uses each redirected hostname and its own pinned answer, including relative redirects", async () => {
  vi.mocked(lookup)
    .mockResolvedValueOnce([{ address: publicIP, family: 4 }] as any)
    .mockResolvedValueOnce([{ address: "1.1.1.1", family: 4 }] as any)
    .mockResolvedValueOnce([{ address: "1.0.0.1", family: 4 }] as any);
  responses.push(
    { status: 301, headers: { location: "/next" } },
    { status: 307, headers: { location: "https://other.example/end" } },
  );
  await expect(readLessonSource({ url: "https://source.example/start" })).resolves.toContain(
    "Source: https://other.example/end",
  );
  expect(connections.map((c) => [c.url.hostname, c.url.pathname, c.address])).toEqual([
    ["source.example", "/start", publicIP],
    ["source.example", "/next", "1.1.1.1"],
    ["other.example", "/end", "1.0.0.1"],
  ]);
});
it.each(["127.0.0.1", "1.1.1.1"])(
  "rejects an actual peer %s that differs from the checked destination",
  async (peer) => {
    responses.push({ peer, chunks: [Buffer.from("Must not return this body")] });
    await expect(readLessonSource({ url: "http://source.example/" })).rejects.toThrow(
      "validated public address",
    );
  },
);
it.each([
  "127.0.0.1",
  "10.1.2.3",
  "169.254.169.254",
  "100.100.100.100",
  "172.20.1.1",
  "192.168.1.1",
  "198.18.0.1",
  "::1",
  "::ffff:127.0.0.1",
  "fd00::1",
  "fe80::1",
  "ff02::1",
  "64:ff9b::7f00:1",
  "2001:db8::1",
  "2002:7f00:1::",
])("rejects nonpublic DNS answer %s before connection", async (address) => {
  vi.mocked(lookup).mockResolvedValue([{ address, family: address.includes(":") ? 6 : 4 }] as any);
  await expect(readLessonSource({ url: "https://source.example/" })).rejects.toThrow(
    "private network",
  );
  expect(connections).toEqual([]);
});
it("rejects mixed public/private DNS answers", async () => {
  vi.mocked(lookup).mockResolvedValue([
    { address: publicIP, family: 4 },
    { address: "10.0.0.1", family: 4 },
  ] as any);
  await expect(readLessonSource({ url: "https://source.example/" })).rejects.toThrow(
    "private network",
  );
  expect(connections).toEqual([]);
});
it.each(["file:///etc/passwd", "https://user:password@source.example/"])(
  "rejects disallowed URL %s before DNS",
  async (url) => {
    await expect(readLessonSource({ url })).rejects.toThrow("public URL without credentials");
    expect(lookup).not.toHaveBeenCalled();
  },
);
it("rejects credentials introduced by a redirect", async () => {
  responses.push({ status: 302, headers: { location: "https://user:password@other.example/" } });
  await expect(readLessonSource({ url: "https://source.example/" })).rejects.toThrow(
    "without credentials",
  );
  expect(connections).toHaveLength(1);
});
it("bounds redirect loops without reading their bodies", async () => {
  responses.push(
    ...Array.from({ length: 6 }, () => ({ status: 302, headers: { location: "/again" } })),
  );
  await expect(readLessonSource({ url: "https://source.example/" })).rejects.toThrow(
    "five redirects",
  );
  expect(connections).toHaveLength(6);
});
it("rejects oversized source bodies", async () => {
  responses.push({ chunks: [Buffer.alloc(2 * 1024 * 1024), Buffer.from("x")] });
  await expect(readLessonSource({ url: "https://source.example/" })).rejects.toThrow(
    "exceeds 2 MB",
  );
});
it.each<{ status?: number; headers?: Record<string, string>; error: string }>([
  { status: 403, error: "HTTP 403" },
  { headers: { "content-type": "application/octet-stream" }, error: "unsupported content type" },
  { status: 302, headers: {}, error: "without a location" },
])("surfaces response failures: $error", async (result) => {
  responses.push(result);
  await expect(readLessonSource({ url: "https://source.example/" })).rejects.toThrow(result.error);
});

it("accepts a pinned global IPv6 connection with equivalent address notation", async () => {
  vi.mocked(lookup).mockResolvedValue([{ address: "2606:4700:4700::1111", family: 6 }] as any);
  responses.push({ peer: "2606:4700:4700:0:0:0:0:1111" });
  await expect(readLessonSource({ url: "https://source.example/" })).resolves.toContain(
    "Public source",
  );
  expect(connections[0].family).toBe(6);
});
it("bounds a stalled DNS lookup before creating any connection", async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(lookup).mockImplementation(() => new Promise(() => {}) as any);
    const denied = expect(readLessonSource({ url: "https://source.example/" })).rejects.toThrow(
      "DNS timed out",
    );
    await vi.advanceTimersByTimeAsync(30000);
    await denied;
    expect(connections).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});
