// FK Fashion Service Worker — offline shell caching
// NOTE: No skipWaiting/clients.claim — avoids the reload glitch on first install
const CACHE = "fk-fashion-v2";
const SHELL = ["/", "/admin", "/index.html"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  // NO skipWaiting — prevents forced page reload
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
  if (
    url.includes("firestore.googleapis.com") ||
    url.includes("firebase") ||
    url.includes("identitytoolkit") ||
    url.includes("securetoken") ||
    url.includes("imagekit.io") ||
    url.includes("gstatic.com") ||
    url.includes("googleapis.com") ||
    url.includes("/api/") ||
    e.request.method !== "GET"
  ) return;

  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then(res => { caches.open(CACHE).then(c => c.put(e.request, res.clone())); return res; })
        .catch(() => caches.match("/admin") || caches.match("/") || caches.match("/index.html"))
    );
    return;
  }

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
