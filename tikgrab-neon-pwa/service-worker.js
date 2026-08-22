/* ══════════════════════════════════════════════════════════════════════════
   TikGrab — service-worker.js
   Caches the app shell (HTML, CSS, JS, manifest, icons) AND Google Fonts so
   the installed PWA launches instantly and works offline.
   ══════════════════════════════════════════════════════════════════════════ */

'use strict';

const CACHE = 'tikgrab-neon-v1';

const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

/* Install → precache the shell, activate immediately */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

/* Activate → purge old caches, claim clients */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('tikgrab-') && k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* Fetch → shell: cache-first w/ background refresh · fonts: SWR (opaque ok) */
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isFont = FONT_HOSTS.includes(url.hostname);
  const isShell = url.origin === self.location.origin;
  if (!isFont && !isShell) return; // never touch TikTok or other origins

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      const refresh = fetch(request)
        .then((response) => {
          // opaque (cross-origin fonts) or ok same-origin responses are cacheable
          if (response && (response.ok || response.type === 'opaque')) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached); // offline → serve what we have
      return cached || refresh;
    })
  );
});
