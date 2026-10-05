/* =========================================================================
   MT Reader — Service Worker (root scope)
   Lives at /sw.js so its scope covers the whole app (not just /assets/).
   network-first for JS/CSS/data/HTML (always fresh when online),
   cache-first for images. Offline-friendly PWA. Zero deps.
   ========================================================================= */
var CACHE = "mt-reader-v2";
var CORE = [
  "./",
  "./index.html",
  "./assets/tokens.css",
  "./assets/app.css",
  "./assets/app.js",
  "./assets/tts.js",
  "./assets/lightbox.js",
  "./assets/sw.js",
  "./assets/vendor/animejs.umd.js",
  "./data/books.js",
  "./data/v15/chapters.js",
  "./data/v16/chapters.js",
  "./manifest.webmanifest"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CORE).catch(function () {}); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.map(function (k) { if (k !== CACHE) return caches.delete(k); }));
  }).then(function () {
    // tell all open clients to refresh so they pick up the new controlled SW
    return self.clients.claim();
  }));
});
self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Only handle same-scope GETs; let the browser handle the rest.
  var isImg = /\.(jpe?g|png|gif|webp|svg|avif)$/i.test(url.pathname);

  if (isImg) {
    // cache-first, fallback network
    e.respondWith(caches.open(CACHE).then(function (c) {
      return c.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          if (res && res.ok) c.put(req, res.clone());
          return res;
        }).catch(function () { return c.match(req); });
      });
    }));
    return;
  }

  // network-first for JS/CSS/data/HTML; offline fallback to cache, then app shell for navigations
  e.respondWith(fetch(req).then(function (res) {
    if (res && res.ok) {
      var clone = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, clone); }).catch(function () {});
    }
    return res;
  }).catch(function () {
    return caches.match(req).then(function (hit) {
      if (hit) return hit;
      // for a failed navigation, fall back to the cached app shell
      if (req.mode === "navigate") return caches.match("./index.html");
      return new Response("", { status: 504, statusText: "Offline" });
    });
  }));
});
