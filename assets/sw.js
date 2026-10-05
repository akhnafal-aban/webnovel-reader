/* =========================================================================
   MT Reader — Service Worker
   network-first for JS/CSS/data (always fresh when online),
   cache-first for images. Offline-friendly PWA.
   ========================================================================= */
var CACHE = "mt-reader-v1";
var CORE = [
  "./",
  "./index.html",
  "./assets/tokens.css",
  "./assets/app.css",
  "./assets/app.js",
  "./assets/tts.js",
  "./assets/lightbox.js",
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
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

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

  // network-first for JS/CSS/data/HTML
  e.respondWith(fetch(req).then(function (res) {
    if (res && res.ok) {
      var clone = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, clone); }).catch(function () {});
    }
    return res;
  }).catch(function () {
    return caches.match(req).then(function (hit) { return hit || caches.match("./index.html"); });
  }));
});
