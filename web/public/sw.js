// CLAUDE.md "Offline at runtime" / SPEC.md: this caches same-origin app
// requests only. It must never intercept, cache, or prefetch
// `tile.openstreetmap.org` (or any other cross-origin host) -- OSM tile
// retention is the browser's own HTTP cache, bounded by the tile server's
// `Cache-Control`, nothing more.
const CACHE_NAME = "photos-viewer-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    }),
  );
});
