// Offline-Cache: nach dem ersten Laden läuft die App ohne Internet.
var CACHE = "kassa-v19";
var FILES = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./logo.png"];
var TIMEOUT_MS = 3000; // so lange aufs Netz warten, dann gespeicherte Version zeigen

// Alles-oder-nichts: schlägt eine Datei fehl, scheitert die Installation und
// die alte, vollständige Offline-Kopie bleibt aktiv.
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(FILES.map(function (f) { return new Request(f, { cache: "reload" }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Ist die Antwort wirklich von unserer App? WLAN-Anmeldeseiten liefern oft
// eine fremde HTML-Seite mit Status 200 – die darf nie gespeichert werden.
function isGenuine(r) {
  var type = r.headers.get("content-type") || "";
  if (type.indexOf("text/html") < 0) return Promise.resolve(true);
  return r.clone().text().then(function (t) { return t.indexOf('data-app="kassa"') >= 0; });
}

// Netzwerk zuerst (für Updates), nach TIMEOUT_MS oder bei Fehler die gespeicherte Version
self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  var req = e.request;

  function fromCache() {
    return caches.match(req).then(function (m) {
      return m || (req.mode === "navigate" ? caches.match("./index.html") : undefined);
    });
  }

  // cache:"no-cache" = beim Server nachfragen (GitHub erlaubt sonst 10 Min. alte Kopien)
  var net = fetch(req.url, { cache: "no-cache" }).then(function (r) {
    if (!r.ok || r.redirected) throw new Error("bad response");
    return isGenuine(r).then(function (ok) {
      if (!ok) throw new Error("fremde Seite (WLAN-Anmeldung?)");
      var copy = r.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
      return r;
    });
  });

  e.respondWith(new Promise(function (resolve, reject) {
    var done = false;
    function finish(r) { if (!done && r) { done = true; clearTimeout(timer); resolve(r); } }
    var timer = setTimeout(function () { fromCache().then(finish); }, TIMEOUT_MS);
    net.then(finish).catch(function () {
      fromCache().then(function (m) {
        if (m) finish(m);
        else if (!done) { done = true; clearTimeout(timer); reject(new Error("offline")); }
      });
    });
  }));
});
