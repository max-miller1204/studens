import * as http from "node:http";
import * as net from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
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

async function preconnect(listener: http.Server, base: string) {
  const accepted = once(listener, "connection");
  const url = new URL(base);
  const socket = net.createConnection({ host: url.hostname, port: Number(url.port) });
  socket.resume();
  const [incoming] = (await accepted) as [net.Socket];
  return { socket, incoming };
}

it("closes accepted zero-byte preconnections before any client teardown", async () => {
  const fixture = makeFixture();
  const { base, listener } = await startListener();
  const { socket, incoming } = await preconnect(listener, base);
  const closing = server.close();
  try {
    expect(await Promise.race([closing.then(() => "closed"), delay(1000, "pending")])).toBe(
      "closed",
    );
    expect(listener.listening).toBe(false);
    expect(incoming.bytesRead).toBe(0);
    expect(incoming.bytesWritten).toBe(0);
    expect(socket.bytesRead).toBe(0);
    expect(socket.bytesWritten).toBe(0);
  } finally {
    // Failure cleanup cannot satisfy the assertion above.
    socket.destroy();
    await closing;
    fixture.cleanup();
  }
});

it("reaps an unused socket when shutdown starts in its connection event", async () => {
  const fixture = makeFixture();
  const { base, listener } = await startListener();
  let closing: Promise<void> | undefined;
  listener.once("connection", () => (closing = server.close()));
  const { socket, incoming } = await preconnect(listener, base);
  try {
    expect(closing).toBeDefined();
    expect(await Promise.race([closing!.then(() => "closed"), delay(1000, "pending")])).toBe(
      "closed",
    );
    expect(incoming.bytesRead + incoming.bytesWritten).toBe(0);
    expect(socket.bytesRead + socket.bytesWritten).toBe(0);
  } finally {
    socket.destroy();
    await closing;
    fixture.cleanup();
  }
});

it("preserves even a one-byte partial request while reaping unused neighbors", async () => {
  const fixture = makeFixture();
  const { base, listener } = await startListener();
  const partial = await preconnect(listener, base);
  const idle = await preconnect(listener, base);
  let text = "";
  partial.socket.on("data", (chunk) => (text += chunk.toString()));
  const received = once(partial.incoming, "data");
  partial.socket.write("G");
  await received;
  let closed = false;
  const closing = server.close().then(() => (closed = true));
  try {
    await once(idle.incoming, "close");
    expect(closed).toBe(false);
    expect(partial.incoming.destroyed).toBe(false);
    const ended = once(partial.socket, "end");
    partial.socket.write("ET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    await ended;
    await closing;
    expect(text).toMatch(/^HTTP\/1.1 200 /);
    expect(text).toContain("</html>");
    expect(idle.incoming.bytesRead + idle.incoming.bytesWritten).toBe(0);
  } finally {
    partial.socket.destroy();
    idle.socket.destroy();
    await closing;
    fixture.cleanup();
  }
});

it("lets an active HTTP response finish while unused connections close", async () => {
  const fixture = makeFixture();
  const { base, listener } = await startListener();
  const client = await preconnect(listener, base);
  const idle = await preconnect(listener, base);
  let text = "";
  client.socket.on("data", (chunk) => (text += chunk.toString()));
  const ended = once(client.socket, "end");
  let finish: (() => void) | undefined;
  const original = http.ServerResponse.prototype.end;
  const ready = new Promise<void>((resolve) => {
    vi.spyOn(http.ServerResponse.prototype, "end").mockImplementation(function (
      this: http.ServerResponse,
      ...args
    ) {
      // Hold the real landing response at its public HTTP response boundary.
      this.flushHeaders();
      finish = () => {
        original.apply(this, args);
      };
      resolve();
      return this;
    });
  });
  client.socket.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
  await ready;
  let closed = false;
  const closing = server.close().then(() => (closed = true));
  try {
    await once(idle.incoming, "close");
    expect(closed).toBe(false);
    expect(client.incoming.destroyed).toBe(false);
    finish!();
    await ended;
    await closing;
    expect(text).toMatch(/^HTTP\/1.1 200 /);
    expect(text).toContain("</html>");
  } finally {
    client.socket.destroy();
    idle.socket.destroy();
    await closing;
    fixture.cleanup();
  }
});

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
  const idle = await preconnect(old.listener, old.base);
  const closing = server.close();
  let current: Awaited<ReturnType<typeof pendingEvents>> | undefined;
  let nextIdle: Awaited<ReturnType<typeof preconnect>> | undefined;
  try {
    const next = await startListener();
    expect(next.listener).not.toBe(old.listener);
    nextIdle = await preconnect(next.listener, next.base);
    current = await pendingEvents(next.listener, next.base);
    current.socket.write("\r\n");
    await current.until(": connected");
    late.socket.write("\r\n");
    expect(await late.until("\r\n\r\n")).toMatch(/^HTTP\/1.1 503 /);
    await late.ended;
    await closing;
    expect(idle.incoming.bytesRead + idle.incoming.bytesWritten).toBe(0);
    expect(nextIdle.incoming.destroyed).toBe(false);
    const nextReceived = once(nextIdle.incoming, "data");
    nextIdle.socket.write("G");
    await nextReceived;
    expect(nextIdle.incoming.bytesRead).toBe(1);
    expect(late.text()).toMatch(/^HTTP\/1.1 503 /);
    expect(server.getBaseUrl()).toBe(next.base);
    server.pushEvent("rust", "001-ownership", "teacher", {});
    expect(await current.until("event: activity")).toMatch(/^HTTP\/1.1 200 /);
    const nextEnded = once(nextIdle.socket, "end");
    nextIdle.socket.write("ET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    await nextEnded;
    await Promise.all([server.close(), current.ended]);
  } finally {
    late.socket.end();
    idle.socket.destroy();
    nextIdle?.socket.destroy();
    current?.socket.end();
    await closing;
    await server.close();
    fixture.cleanup();
  }
});
