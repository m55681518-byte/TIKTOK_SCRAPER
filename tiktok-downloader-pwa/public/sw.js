/**
 * TikGrab 3D — Service Worker
 *
 * Vite emits hashed asset names, so instead of a fixed precache list we:
 *   • precache the stable core (shell, manifest, icons)
 *   • cache same-origin GETs at runtime (stale-while-revalidate)
 * API routes and share-target landings ALWAYS hit the network.
 */

'use strict'

const CACHE = 'tikgrab-3d-v1'
const CORE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith('tikgrab-') && k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return // never touch CDN/external
  if (url.pathname.startsWith('/api/')) return // fresh scraper data
  if (url.pathname === '/share-target') return // always fresh

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      const refresh = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        })
        .catch(() => cached)
      return cached || refresh
    })
  )
})
