// Offline-Cache: nach dem ersten Laden läuft die App ohne Internet.
var CACHE = "kassa-v8";
var FILES = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./logo.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(FILES.map(function (f) { return c.add(f).catch(function () {}); }));
  }));
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }));
  self.clients.claim();
});

// Netzwerk zuerst (für Preis-Updates), sonst Cache
self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request).then(function (r) {
      // Nur gültige Antworten übernehmen – bei 404 (Seite offline genommen)
      // oder WLAN-Anmeldeseiten bleibt die gespeicherte App aktiv.
      if (!r.ok || r.redirected) throw new Error("bad response");
      var copy = r.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return r;
    }).catch(function () {
      return caches.match(e.request).then(function (m) { return m || caches.match("./index.html"); });
    })
  );
});
