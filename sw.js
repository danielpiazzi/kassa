// Offline-Cache: nach dem ersten Laden läuft die App ohne Internet.
// Fester Name: Updates kommen automatisch über den fetch-Handler (Datei-Vergleich),
// es muss keine Versionsnummer mehr hochgezählt werden.
var CACHE = "kassa-app";
var FILES = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./logo.png"];
var TIMEOUT_MS = 3000; // so lange aufs Netz warten, dann gespeicherte Version zeigen

// Alles-oder-nichts: schlägt eine Datei fehl, scheitert die Installation und
// die alte, vollständige Offline-Kopie bleibt aktiv.
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(FILES.map(function (f) { return new Request(f, { cache: "reload" }); }));
  }).then(function () { return self.skipWaiting(); }));
});

// Alte Caches (kassa-v1 … kassa-v19) aufräumen
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

function sameBytes(a, b) {
  return Promise.all([a.clone().arrayBuffer(), b.clone().arrayBuffer()]).then(function (x) {
    var p = new Uint8Array(x[0]), q = new Uint8Array(x[1]);
    if (p.length !== q.length) return false;
    for (var i = 0; i < p.length; i++) if (p[i] !== q[i]) return false;
    return true;
  });
}

// Neue Antwort nur speichern, wenn sie sich vom Gespeicherten unterscheidet.
// Liefert true, wenn eine bereits gespeicherte Datei geändert wurde.
function storeIfChanged(req, r) {
  return caches.open(CACHE).then(function (c) {
    return c.match(req).then(function (old) {
      if (!old) return c.put(req, r.clone()).then(function () { return false; });
      return sameBytes(old, r).then(function (same) {
        return same ? false : c.put(req, r.clone()).then(function () { return true; });
      });
    });
  });
}

function tellPages(msg) {
  self.clients.matchAll({ type: "window" }).then(function (list) {
    list.forEach(function (cl) { cl.postMessage(msg); });
  });
}

// Netzwerk zuerst (für Updates), nach TIMEOUT_MS oder bei Fehler die gespeicherte Version
self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  var req = e.request, servedFromCache = false;

  function fromCache() {
    return caches.match(req).then(function (m) {
      return m || (req.mode === "navigate" ? caches.match("./index.html") : undefined);
    });
  }

  // Hintergrund-Speichern muss sofort angemeldet werden, sonst bricht der Browser es
  // ab, wenn die Antwort schon aus dem Speicher kam (Zeitlimit-Fall).
  var bgDone;
  e.waitUntil(new Promise(function (res) { bgDone = res; }));

  // cache:"no-cache" = beim Server nachfragen (GitHub erlaubt sonst 10 Min. alte Kopien)
  var net = fetch(req.url, { cache: "no-cache" }).then(function (r) {
    if (!r.ok || r.redirected) throw new Error("bad response");
    return isGenuine(r).then(function (ok) {
      if (!ok) throw new Error("fremde Seite (WLAN-Anmeldung?)");
      // Kopie ziehen, bevor die Seite den Inhalt liest; im Hintergrund speichern.
      // Kam die Seite schon aus dem Speicher und hat sich etwas geändert,
      // der Seite Bescheid geben, damit sie bei Gelegenheit neu lädt.
      var copy = r.clone();
      storeIfChanged(req, copy).then(function (changed) {
        if (changed && servedFromCache) tellPages("updated");
      }).catch(function () {}).then(bgDone);
      return r;
    });
  });
  net.catch(function () { bgDone(); });

  e.respondWith(new Promise(function (resolve, reject) {
    var done = false;
    function finish(r, cached) {
      if (!done && r) { done = true; servedFromCache = !!cached; clearTimeout(timer); resolve(r); }
    }
    var timer = setTimeout(function () { fromCache().then(function (m) { finish(m, true); }); }, TIMEOUT_MS);
    net.then(function (r) { finish(r, false); }).catch(function () {
      fromCache().then(function (m) {
        if (m) finish(m, true);
        else if (!done) { done = true; clearTimeout(timer); reject(new Error("offline")); }
      });
    });
  }));
});
