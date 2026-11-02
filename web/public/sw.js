// CLAUDE.md "Offline at runtime" / SPEC.md: this caches only the built app
// shell -- navigations/index.html, hashed /assets/*, /icons/*, and
// manifest.webmanifest. It must never intercept or cache `/api/*`: that is
// session-scoped data (auth state, library/asset listings, admin data) and
// has to hit the network every time, or logout, session revocation and
// account changes would be invisible and a later browser user could see the
// previous user's cached responses. It also must never intercept, cache, or
// prefetch `tile.openstreetmap.org` (or any other cross-origin host) -- OSM
// tile retention is the browser's own HTTP cache, bounded by the tile
// server's `Cache-Control`, nothing more.
const CACHE_NAME = "photos-viewer-shell-v2";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

// Lets the page force-clear the app shell cache on logout, so the next
// sign-in (possibly a different user, on a shared device) never serves a
// stale cached navigation from before the logout.
self.addEventListener("message", (event) => {
  if (event.data?.type === "CLEAR_CACHE") {
    event.waitUntil(caches.delete(CACHE_NAME));
  }
});

// Only a full 200 response is safe to store: a 206 (Range) response rejects
// cache.put(), and an opaque (cross-origin no-cors) response has status 0
// and would cache an unreadable blob.
async function putInCache(cache, request, response) {
  if (response.status !== 200 || request.headers.has("range")) return;
  try {
    await cache.put(request, response.clone());
  } catch {
    // Not storable (e.g. partial/opaque) -- nothing to cache.
  }
}

async function networkFirst(cache, request) {
  try {
    const response = await fetch(request);
    await putInCache(cache, request, response);
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(cache, request) {
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  await putInCache(cache, request, response);
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  const isNavigation = request.mode === "navigate" || url.pathname === "/" || url.pathname === "/index.html";
  const isAsset = url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/");
  if (!isNavigation && !isAsset && url.pathname !== "/manifest.webmanifest") return;

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => (isAsset ? cacheFirst(cache, request) : networkFirst(cache, request))),
  );
});
