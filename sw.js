// FK Fashion Admin — Service Worker
const CACHE = "fk-admin-v1";
const SHELL = ["/", "/admin", "/index.html"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (url.hostname.includes("firebase")||url.hostname.includes("google")||url.hostname.includes("imagekit")||url.hostname.includes("gstatic")||url.pathname.startsWith("/api/")) return;
  if (e.request.mode==="navigate") { e.respondWith(caches.match("/admin").then(c=>c||fetch(e.request))); return; }
  e.respondWith(caches.match(e.request).then(cached => {
    if (cached) return cached;
    return fetch(e.request).then(res => {
      if (!res||res.status!==200) return res;
      caches.open(CACHE).then(c=>c.put(e.request,res.clone()));
      return res;
    }).catch(()=>cached);
  }));
});
