const CACHE = "ledger-v3";
const SHELL = [
  "/ledger/",
  "/ledger/index.html",
  "/ledger/ledger-core.js",
  "/ledger/manifest.json",
  "/ledger/icons/icon-192.png",
  "/ledger/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Cache-first for the app shell and same-origin assets; cache-first (with
// network fallback + cache-fill) for Tesseract's CDN assets so OCR keeps
// working offline after the first successful scan. Network-first for
// anything hitting api.anthropic.com (never cache API responses).
self.addEventListener("fetch", (event) => {
  const url = event.request.url;
  if (url.includes("api.anthropic.com")) return; // never intercept API calls

  const isTesseractAsset = url.includes("cdn.jsdelivr.net") || url.includes("tessdata");
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((resp) => {
        if (resp && resp.status === 200 && (event.request.url.startsWith(self.location.origin) || isTesseractAsset)) {
          const copy = resp.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return resp;
      }).catch(() => cached);
    })
  );
});
