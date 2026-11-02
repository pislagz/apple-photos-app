import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// Loads the real file the browser gets, `public/sw.js`, with fake `self`/
// `caches`/`fetch` globals passed in as parameters -- so the top-level
// `self.addEventListener(...)` calls inside it bind to our fakes, not to
// jsdom's `window` (which jsdom itself aliases as `self`).
const SW_SOURCE = readFileSync(join(process.cwd(), "public/sw.js"), "utf-8");

function createFakeSelf(origin: string) {
  const listeners: Record<string, ((event: unknown) => void)[]> = {};
  return {
    location: { origin },
    clients: { claim: vi.fn() },
    skipWaiting: vi.fn(),
    addEventListener(type: string, handler: (event: unknown) => void) {
      (listeners[type] ??= []).push(handler);
    },
    listeners,
  };
}

function loadFetchHandler(origin: string, fakeCaches: unknown, fakeFetch: unknown) {
  const fakeSelf = createFakeSelf(origin);
  new Function("self", "caches", "fetch", SW_SOURCE)(fakeSelf, fakeCaches, fakeFetch);
  const handlers = fakeSelf.listeners.fetch;
  if (!handlers || handlers.length !== 1) throw new Error("sw.js did not register exactly one fetch listener");
  return handlers[0];
}

function makeFetchEvent(url: string) {
  let responded: Promise<unknown> | undefined;
  return {
    request: new Request(url),
    respondWith(promise: Promise<unknown>) {
      responded = promise;
    },
    get responded() {
      return responded;
    },
  };
}

describe("public/sw.js", () => {
  it("caches a same-origin thumbnail request", async () => {
    const origin = "http://localhost:3000";
    const fakeCache = { match: vi.fn().mockResolvedValue(undefined), put: vi.fn() };
    const fakeCaches = { open: vi.fn().mockResolvedValue(fakeCache) };
    const fakeFetch = vi.fn().mockResolvedValue(new Response("thumb-bytes", { status: 200 }));

    const fetchHandler = loadFetchHandler(origin, fakeCaches, fakeFetch);
    const event = makeFetchEvent(`${origin}/api/libraries/1/thumb/5?size=256`);
    fetchHandler(event);
    await event.responded;

    expect(fakeCaches.open).toHaveBeenCalled();
    expect(fakeCache.put).toHaveBeenCalledTimes(1);
  });

  it("never touches tile.openstreetmap.org", async () => {
    const fakeCaches = { open: vi.fn() };
    const fakeFetch = vi.fn();

    const fetchHandler = loadFetchHandler("http://localhost:3000", fakeCaches, fakeFetch);
    const event = makeFetchEvent("https://tile.openstreetmap.org/0/0/0.png");
    fetchHandler(event);
    await event.responded;

    expect(fakeCaches.open).not.toHaveBeenCalled();
    expect(fakeFetch).not.toHaveBeenCalled();
    expect(event.responded).toBeUndefined();
  });

  it("ignores non-GET same-origin requests", async () => {
    const origin = "http://localhost:3000";
    const fakeCaches = { open: vi.fn() };
    const fakeFetch = vi.fn();

    const fetchHandler = loadFetchHandler(origin, fakeCaches, fakeFetch);
    const event = {
      request: new Request(`${origin}/api/auth/logout`, { method: "POST" }),
      respondWith: vi.fn(),
    };
    fetchHandler(event);

    expect(event.respondWith).not.toHaveBeenCalled();
    expect(fakeCaches.open).not.toHaveBeenCalled();
  });
});
