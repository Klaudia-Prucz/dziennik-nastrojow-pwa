// public/sw.js

const CACHE_NAME = "dziennik-pwa-v1";

// Pliki niezbędne do startu aplikacji (App Shell)
const APP_SHELL = [
  "/",                       // root
  "/index.html",
  "/manifest.webmanifest",

  "/css/styles.css",

  "/js/app.js",
  "/js/router.js",
  "/js/views.js",
  "/js/offline.js",
  "/js/supabaseClient.js",
];

// INSTALL — zapisujemy shell aplikacji
self.addEventListener("install", (event) => {
  console.log("[SW] install");
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL);
    })
  );
  self.skipWaiting();
});

// ACTIVATE — czyszczenie starych cache
self.addEventListener("activate", (event) => {
  console.log("[SW] activate");
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// FETCH — strategia:
// - najpierw sieć
// - fallback do cache (offline)
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Tylko GET (nie dotykamy POSTów do Supabase)
  if (req.method !== "GET") return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        // cache only same-origin
        if (req.url.startsWith(self.location.origin)) {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
