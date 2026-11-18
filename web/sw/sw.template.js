/*
 * Memos service worker (fork): keeps the app itself available offline. Generated at build time
 * from web/sw/sw.template.js; __BUILD__ and __PRECACHE__ are filled in by web/sw/plugin.ts.
 *
 * - The app's scripts and styles of this build are cached on install, so every screen opens
 *   offline, not only the ones visited before.
 * - Pages are fetched from the network first; offline, the cached app page answers.
 * - API calls, files and live updates are never cached here: memo data is kept by the app
 *   itself (lib/offline), where it is cleared on sign-out.
 */
const BUILD = "__BUILD__";
const PRECACHE = __PRECACHE__;
const CACHE = `memos-app-${BUILD}`;
const PAGE = "/";
const NAVIGATION_TIMEOUT_MS = 4000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // One failed file must not void the whole install; it is fetched again when used.
      await Promise.all([PAGE, ...PRECACHE].map((url) => cache.add(new Request(url, { cache: "reload" })).catch(() => undefined)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("memos-app-") && name !== CACHE) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

const isPassThrough = (url) =>
  url.origin !== self.location.origin ||
  url.pathname.startsWith("/api/") ||
  url.pathname.startsWith("/memos.api.") ||
  url.pathname.startsWith("/file/") ||
  url.pathname.startsWith("/o/") ||
  url.pathname === "/sw.js";

const withTimeout = (promise, ms) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (isPassThrough(url)) return;

  if (request.mode === "navigate") {
    // Every route is the same app page: fresh from the network, the saved copy offline.
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const response = await withTimeout(fetch(request), NAVIGATION_TIMEOUT_MS);
          if (response.ok) await cache.put(PAGE, response.clone());
          return response;
        } catch {
          return (await cache.match(PAGE)) || Response.error();
        }
      })(),
    );
    return;
  }

  // Built files never change under their name: the cached copy is the right one.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      if (cached && url.pathname.startsWith("/assets/")) return cached;
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      } catch (error) {
        if (cached) return cached;
        throw error;
      }
    })(),
  );
});
