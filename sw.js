// Notatki+ – service worker: instalacja aplikacji + czytanie offline wcześniej otwartych notatek
const V = "notatki-v1";
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

  // sieć najpierw (zawsze świeże dane), a bez internetu – ostatnia zapisana kopia
  e.respondWith(
    fetch(r)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(V).then((c) => c.put(r.mode === "navigate" ? "/" : r, copy));
        }
        return res;
      })
      .catch(() => caches.match(r.mode === "navigate" ? "/" : r).then((m) => m || Response.error()))
  );
});
