import * as http from "node:http";
import * as net from "node:net";
import { once } from "node:events";
import { makeFixture, seedClassroom } from "./helpers.ts";
import { afterEach, expect, it, vi } from "vitest";
import * as config from "../src/config.ts";
import * as server from "../src/server.ts";

afterEach(async () => {
  await server.close();
  vi.restoreAllMocks();
});

it("rejects an occupied configured port and preserves a fixed URL across restarts", async () => {
  const occupied = http.createServer();
  await new Promise<void>((resolve) => occupied.listen(0, "127.0.0.1", resolve));
  const address = occupied.address();
  if (!address || typeof address === "string") throw new Error("No test port.");
  vi.spyOn(config, "readConfig").mockReturnValue({ port: address.port });
  try {
    await expect(server.start()).rejects.toThrow(/EADDRINUSE/);
    expect(server.getPort()).toBeNull();
  } finally {
    await new Promise<void>((resolve, reject) =>
      occupied.close((err) => (err ? reject(err) : resolve())),
    );
  }
  const first = await server.start();
  expect(server.getPort()).toBe(address.port);
  await server.close();
  expect(await server.start()).toBe(first);
});

it("shares one server for concurrent start requests", async () => {
  vi.spyOn(config, "readConfig").mockReturnValue({});
  const urls = await Promise.all([server.start(), server.start(), server.start()]);
  expect(new Set(urls).size).toBe(1);
  expect(urls[0]).toBe(server.getBaseUrl());
});

/** Observe real listener/socket events so header ordering needs no timing delay. */
async function startListener() {
  const listen = vi.spyOn(http.Server.prototype, "listen");
  const base = await server.start(0);
  const listener = listen.mock.instances.at(-1)!;
  return { base, listener };
}

async function pendingEvents(listener: http.Server, base: string, query = "scope=root") {
  const accepted = once(listener, "connection");
  const url = new URL(base);
  const socket = net.createConnection({ host: url.hostname, port: Number(url.port) });
  let text = "";
  socket.on("data", (chunk) => (text += chunk.toString()));
  const ended = once(socket, "end");
  const [incoming] = (await accepted) as [net.Socket];
  const received = once(incoming, "data");
  socket.write(`GET /api/events?${query} HTTP/1.1\r\nHost: ${url.host}\r\n`);
  await received;
  return {
    socket,
    ended,
    text: () => text,
    async until(fragment: string) {
      while (!text.includes(fragment)) await once(socket, "data");
      return text;
    },
  };
}

it("refuses pending event headers dispatched after shutdown without client cleanup", async () => {
  const fixture = makeFixture();
  const { base, listener } = await startListener();
  const client = await pendingEvents(listener, base);
  const closing = server.close();
  try {
    client.socket.write("\r\n");
    expect(await client.until("\r\n\r\n")).toMatch(/^HTTP\/1.1 503 /);
    await client.ended;
    await closing;
    expect(client.text()).toMatch(/^HTTP\/1.1 503 /);
    expect(client.text()).toMatch(/Connection: close/i);
    expect(client.text()).toContain("Classroom server is shutting down.");
    expect(client.text()).not.toContain("text/event-stream");
    expect(client.text()).not.toContain(": connected");
  } finally {
    client.socket.end();
    await closing;
    fixture.cleanup();
  }
});

it("delivers normal lesson events and drains every registered stream scope", async () => {
  const fixture = makeFixture();
  seedClassroom(fixture);
  const { base, listener } = await startListener();
  const clients = [];
  try {
    for (const query of [
      "scope=root",
      "scope=classroom&classroom=rust",
      "classroom=rust&lesson=001-ownership",
    ]) {
      const client = await pendingEvents(listener, base, query);
      clients.push(client);
      client.socket.write("\r\n");
      expect(await client.until(": connected")).toMatch(/^HTTP\/1.1 200 /);
    }
    server.pushEvent("rust", "001-ownership", "teacher", { message: "visible" });
    await Promise.all(clients.slice(0, 2).map((client) => client.until("event: activity")));
    expect(await clients[2].until("visible")).toContain("event: teacher");
    await Promise.all([server.close(), ...clients.map((client) => client.ended)]);
  } finally {
    for (const client of clients) client.socket.end();
    await server.close();
    fixture.cleanup();
  }
});

it("keeps old listener intake closed while a concurrent new listener serves events", async () => {
  const fixture = makeFixture();
  seedClassroom(fixture);
  const old = await startListener();
  const late = await pendingEvents(old.listener, old.base);
  const closing = server.close();
  let current: Awaited<ReturnType<typeof pendingEvents>> | undefined;
  try {
    const next = await startListener();
    expect(next.listener).not.toBe(old.listener);
    current = await pendingEvents(next.listener, next.base);
    current.socket.write("\r\n");
    await current.until(": connected");
    late.socket.write("\r\n");
    expect(await late.until("\r\n\r\n")).toMatch(/^HTTP\/1.1 503 /);
    await late.ended;
    await closing;
    expect(late.text()).toMatch(/^HTTP\/1.1 503 /);
    expect(server.getBaseUrl()).toBe(next.base);
    server.pushEvent("rust", "001-ownership", "teacher", {});
    expect(await current.until("event: activity")).toMatch(/^HTTP\/1.1 200 /);
    await Promise.all([server.close(), current.ended]);
  } finally {
    late.socket.end();
    current?.socket.end();
    await closing;
    await server.close();
    fixture.cleanup();
  }
});
