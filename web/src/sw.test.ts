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

function loadHandler(type: string, origin: string, fakeCaches: unknown, fakeFetch: unknown) {
  const fakeSelf = createFakeSelf(origin);
  new Function("self", "caches", "fetch", SW_SOURCE)(fakeSelf, fakeCaches, fakeFetch);
  const handlers = fakeSelf.listeners[type];
  if (!handlers || handlers.length !== 1) throw new Error(`sw.js did not register exactly one ${type} listener`);
  return { handler: handlers[0], fakeSelf };
}

function loadFetchHandler(origin: string, fakeCaches: unknown, fakeFetch: unknown) {
  return loadHandler("fetch", origin, fakeCaches, fakeFetch).handler;
}

function makeFetchEvent(url: string, init?: RequestInit) {
  let responded: Promise<unknown> | undefined;
  return {
    request: new Request(url, init),
    respondWith(promise: Promise<unknown>) {
      responded = promise;
    },
    get responded() {
      return responded;
    },
  };
}

function makeLifecycleEvent() {
  let waited: Promise<unknown> | undefined;
  return {
    waitUntil(promise: Promise<unknown>) {
      waited = promise;
    },
    get waited() {
      return waited;
    },
  };
}

describe("public/sw.js", () => {
  it("caches a same-origin hashed asset request (cache-first)", async () => {
    const origin = "http://localhost:3000";
    const fakeCache = { match: vi.fn().mockResolvedValue(undefined), put: vi.fn().mockResolvedValue(undefined) };
    const fakeCaches = { open: vi.fn().mockResolvedValue(fakeCache) };
    const fakeFetch = vi.fn().mockResolvedValue(new Response("js-bytes", { status: 200 }));

    const fetchHandler = loadFetchHandler(origin, fakeCaches, fakeFetch);
    const event = makeFetchEvent(`${origin}/assets/index-abc.js`);
    fetchHandler(event);
    await event.responded;

    expect(fakeCaches.open).toHaveBeenCalled();
    expect(fakeCache.put).toHaveBeenCalledTimes(1);
  });

  it("never intercepts or caches /api/* requests", async () => {
    const origin = "http://localhost:3000";
    const fakeCaches = { open: vi.fn() };
    const fakeFetch = vi.fn();

    const fetchHandler = loadFetchHandler(origin, fakeCaches, fakeFetch);
    const event = makeFetchEvent(`${origin}/api/me`);
    fetchHandler(event);

    expect(event.responded).toBeUndefined();
    expect(fakeCaches.open).not.toHaveBeenCalled();
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("never intercepts or caches library-scoped /api/* asset listings", async () => {
    const origin = "http://localhost:3000";
    const fakeCaches = { open: vi.fn() };
    const fakeFetch = vi.fn();

    const fetchHandler = loadFetchHandler(origin, fakeCaches, fakeFetch);
    const event = makeFetchEvent(`${origin}/api/libraries/1/assets`);
    fetchHandler(event);

    expect(event.responded).toBeUndefined();
    expect(fakeCaches.open).not.toHaveBeenCalled();
  });

  it("returns a fresh 401 for /api/me after the session is revoked, never a stale cached 200", async () => {
    // The SW does not intercept /api/*, so it never calls caches.open/put for
    // it -- the real fetch (standing in for the server here) is the only
    // source of truth, and switches from 200 to 401 between calls.
    const origin = "http://localhost:3000";
    const fakeCaches = { open: vi.fn() };
    const realFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ username: "a" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));

    const fetchHandler = loadFetchHandler(origin, fakeCaches, realFetch);

    const first = makeFetchEvent(`${origin}/api/me`);
    fetchHandler(first);
    expect(first.responded).toBeUndefined();
    const firstResponse = await realFetch(first.request);
    expect(firstResponse.status).toBe(200);

    const second = makeFetchEvent(`${origin}/api/me`);
    fetchHandler(second);
    expect(second.responded).toBeUndefined();
    const secondResponse = await realFetch(second.request);
    expect(secondResponse.status).toBe(401);
    expect(fakeCaches.open).not.toHaveBeenCalled();
  });

  it("does not cache.put a 206 Range response for an original", async () => {
    const origin = "http://localhost:3000";
    const fakeCache = { match: vi.fn().mockResolvedValue(undefined), put: vi.fn().mockResolvedValue(undefined) };
    const fakeCaches = { open: vi.fn().mockResolvedValue(fakeCache) };
    const fakeFetch = vi.fn().mockResolvedValue(new Response("partial-bytes", { status: 206 }));

    const fetchHandler = loadFetchHandler(origin, fakeCaches, fakeFetch);
    const event = makeFetchEvent(`${origin}/assets/range-file.bin`, { headers: { Range: "bytes=0-10" } });
    fetchHandler(event);
    await event.responded;

    expect(fakeCache.put).not.toHaveBeenCalled();
  });

  it("is network-first for a navigation and caches the fresh response", async () => {
    const origin = "http://localhost:3000";
    const fakeCache = { match: vi.fn().mockResolvedValue(undefined), put: vi.fn().mockResolvedValue(undefined) };
    const fakeCaches = { open: vi.fn().mockResolvedValue(fakeCache) };
    const fakeFetch = vi.fn().mockResolvedValue(new Response("<html>fresh</html>", { status: 200 }));

    const fetchHandler = loadFetchHandler(origin, fakeCaches, fakeFetch);
    const event = makeFetchEvent(`${origin}/index.html`);
    fetchHandler(event);
    const response = (await event.responded) as Response;

    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(await response.text()).toBe("<html>fresh</html>");
    expect(fakeCache.put).toHaveBeenCalledTimes(1);
  });

  it("falls back to the cache for a navigation when the network fetch rejects (offline)", async () => {
    const origin = "http://localhost:3000";
    const cachedResponse = new Response("<html>cached-shell</html>", { status: 200 });
    const fakeCache = { match: vi.fn().mockResolvedValue(cachedResponse), put: vi.fn() };
    const fakeCaches = { open: vi.fn().mockResolvedValue(fakeCache) };
    const fakeFetch = vi.fn().mockRejectedValue(new TypeError("network error"));

    const fetchHandler = loadFetchHandler(origin, fakeCaches, fakeFetch);
    const event = makeFetchEvent(`${origin}/index.html`);
    fetchHandler(event);
    const response = (await event.responded) as Response;

    expect(await response.text()).toBe("<html>cached-shell</html>");
    expect(fakeCache.put).not.toHaveBeenCalled();
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

  it("deletes stale cache names and claims clients on activate", async () => {
    const origin = "http://localhost:3000";
    const fakeCaches = {
      keys: vi.fn().mockResolvedValue(["photos-viewer-shell-v1", "photos-viewer-shell-v3"]),
      delete: vi.fn().mockResolvedValue(true),
    };

    const { handler: activateHandler, fakeSelf } = loadHandler("activate", origin, fakeCaches, vi.fn());
    const event = makeLifecycleEvent();
    activateHandler(event);
    await event.waited;

    expect(fakeCaches.delete).toHaveBeenCalledTimes(1);
    expect(fakeCaches.delete).toHaveBeenCalledWith("photos-viewer-shell-v1");
    expect(fakeCaches.delete).not.toHaveBeenCalledWith("photos-viewer-shell-v3");
    expect(fakeSelf.clients.claim).toHaveBeenCalledTimes(1);
  });
});
