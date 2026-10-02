// Service worker: caches the app shell so Lawn IQ opens and works offline.
// Bump VERSION whenever any app file changes so phones pick up the update.

const VERSION = '2.4.1';
const CACHE = `lawn-care-${VERSION}`; // prefix kept from the app's first name so old caches get cleaned up
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/charts.js',
  'js/db.js',
  'js/defaults.js',
  'js/engine.js',
  'js/icons.js',
  'js/irrigation.js',
  'js/logsheet.js',
  'js/season.js',
  'js/store.js',
  'js/ui.js',
  'js/util.js',
  'js/weather.js',
  'js/views/calendar.js',
  'js/views/forecast.js',
  'js/views/history.js',
  'js/views/rachio.js',
  'js/views/today.js',
  'js/views/winter.js',
  'js/views/yard.js',
  'img/header.jpg',
  'img/share.png',
  'icons/app-icon-180.png',
  'icons/app-icon-192.png',
  'icons/app-icon-512.png',
  'icons/app-icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('lawn-care-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Weather and other services go straight to the network; the app keeps its own offline copy.
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('index.html', { cacheName: CACHE })
        .then((cached) => cached || fetch(req))
        .catch(() => caches.match('index.html')),
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => cached || fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy));
      }
      return res;
    })),
  );
});
