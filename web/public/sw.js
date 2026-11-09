// Saphal Stocks service worker: the app opens offline. App files are cached as they load;
// market data is managed by the app itself (stored on the device), so data files bypass this cache.
const CACHE = "saphal-stocks-v1";
const SCOPE = self.registration.scope;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([SCOPE, SCOPE + "manifest.webmanifest", SCOPE + "icons/icon-192.png", SCOPE + "icons/apple-touch-icon.png"])).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.includes("/data/") || url.pathname.endsWith("/version.json")) return; // market data and the version note: always from the network
  // Pages: network first (fresh app after updates), fall back to the cached shell offline.
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(SCOPE, copy)); return r; }).catch(() => caches.match(SCOPE)));
    return;
  }
  // Hashed assets, fonts, icons: cache first, then network (and store).
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return r; })));
});

// Notifications requested by the page (alerts and reminders).
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "notify") self.registration.showNotification(e.data.title, { body: e.data.body, icon: SCOPE + "icons/icon-192.png", badge: SCOPE + "icons/favicon-32.png", tag: e.data.title });
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((cs) => (cs[0] ? cs[0].focus() : self.clients.openWindow(SCOPE + "alerts"))));
});
