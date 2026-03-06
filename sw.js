// FK Fashion Service Worker
const CACHE = "fk-fashion-v3";

// Cache the app shell AND the Firebase SDK files so they work offline
const PRECACHE = [
  "/",
  "/admin",
  "/index.html",
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js",
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js",
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js",
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      // addAll fails if any single request fails — use individual puts for external URLs
      Promise.allSettled(
        PRECACHE.map(url =>
          fetch(url, { cache: "no-cache" })
            .then(res => { if (res.ok) c.put(url, res); })
            .catch(() => {}) // silently skip if offline during install
        )
      )
    )
    // NO skipWaiting — prevents reload glitch
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  // NO clients.claim() — prevents reload glitch
});

self.addEventListener("fetch", e => {
  const url = e.request.url;

  // Never intercept Firestore API calls or ImageKit uploads
  if (
    url.includes("firestore.googleapis.com") ||
    url.includes("identitytoolkit.googleapis.com") ||
    url.includes("securetoken.googleapis.com") ||
    url.includes("upload.imagekit.io") ||
    url.includes("/api/") ||
    e.request.method !== "GET"
  ) return;

  // For Firebase SDK JS files: cache first (they never change for a fixed version)
  if (url.includes("gstatic.com") || url.includes("firebasejs")) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          if (res && res.status === 200) {
            caches.open(CACHE).then(c => c.put(e.request, res.clone()));
          }
          return res;
        });
      })
    );
    return;
  }

  // For page navigation: network first, fall back to cached shell
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then(res => { caches.open(CACHE).then(c => c.put(e.request, res.clone())); return res; })
        .catch(() => caches.match("/admin") || caches.match("/") || caches.match("/index.html"))
    );
    return;
  }

  // For all other assets: cache first, then network
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.status === 200) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      }).catch(() => new Response("Offline", { status: 503 }));
    })
  );
});
