// Saphal Stocks service worker: the app opens offline. App files are cached as they load;
// market data is managed by the app itself (stored on the device), so data files bypass this cache.
const CACHE = "saphal-stocks-v1";
const SCOPE = self.registration.scope;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([SCOPE, SCOPE + "manifest.webmanifest", SCOPE + "icons/icon-192.png", SCOPE + "icons/apple-touch-icon.png"])).catch(() => {}));
  self.skipWaiting();
});

// This web address is shared with other apps (for example Saphal Manifest): only ever remove this app's own old caches.
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("saphal-stocks-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.includes("/data/") || url.pathname.endsWith("/version.json")) return; // market data and the version note: always from the network
  // Pages: open instantly from this release's saved copy (no wait for the network, however slow it is).
  // Each release ships a new worker with its own saved copy of every file, so updates still arrive: the browser
  // checks for a new worker in the background and the app reloads into the new release when it is ready.
  if (req.mode === "navigate") {
    if (!url.href.startsWith(SCOPE)) return;
    e.respondWith(caches.open(CACHE).then((c) => c.match(SCOPE).then((hit) => hit || fetch(req).then((r) => { if (r.ok) c.put(SCOPE, r.clone()); return r; }))).catch(() => fetch(req)));
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
