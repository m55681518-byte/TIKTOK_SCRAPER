/**
 * ============================================================================
 *  TikGrab PWA — Service Worker
 * ============================================================================
 *  Keeps the app shell available offline (required for Android Chrome's
 *  installability criteria) while ALWAYS going to the network for:
 *    • /api/*        → fresh scraper results, never stale
 *    • cross-origin  → TikTok CDN etc. (never intercepted)
 *
 *  Strategy for same-origin GET assets: cache-first with background refresh
 *  (the app shell is tiny, so this makes launch instant).
 * ============================================================================
 */

'use strict';

const CACHE_VERSION = 'tikgrab-v1';
const CACHE_NAME = `tikgrab-shell-${CACHE_VERSION}`;

// The app shell — everything the UI needs to render.
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
];

/* ── Install: pre-cache the shell ─────────────────────────────────────────── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()) // activate the new worker immediately
  );
});

/* ── Activate: purge old cache versions ───────────────────────────────────── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('tikgrab-shell-') && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

/* ── Fetch ────────────────────────────────────────────────────────────────── */
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only handle simple GETs. Never intercept POSTs (share-target POST,
  // /api/download) or anything cross-origin.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API calls must always hit the network (fresh scraper data).
  if (url.pathname.startsWith('/api/')) return;

  // Web Share Target landings — always fresh so the shared link is processed.
  if (url.pathname === '/share-target') return;

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      // Cache-first + background refresh (stale-while-revalidate).
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached); // offline → keep serving the cached copy

      return cached || networkFetch;
    })
  );
});
