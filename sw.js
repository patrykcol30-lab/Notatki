// Notatki+ – service worker: instalacja aplikacji + czytanie offline wcześniej otwartych notatek
const V = "notatki-v2";
const SHELL = ["/", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== V).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin) return;
  if (u.pathname.startsWith("/.netlify/") || u.pathname === "/api/login") return;
  const key = r.mode === "navigate" ? "/" : r;

  e.respondWith((async () => {
    const cached = await caches.match(key);
    // sieć najpierw (świeże dane); gdy brak internetu lub sieć jest bardzo wolna – ostatnia zapisana kopia
    const net = fetch(r).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(V).then((c) => c.put(key, copy)); }
      return res;
    });
    if (!cached) return net.catch(() => Response.error());
    return Promise.race([net.catch(() => cached), new Promise((ok) => setTimeout(() => ok(cached), 2500))]);
  })());
});
