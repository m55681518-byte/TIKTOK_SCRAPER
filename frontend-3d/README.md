# TikGrab 3D — Awwwards-style frontend

React + React Three Fiber + framer-motion + Tailwind CSS v4 (Vite build).

The 3D canvas renders the deep-space scenery (glossy neon blobs, music notes,
stars, cursor parallax); the entire UI is an HTML overlay on top of it — the
exact technique used by top Pinterest/Awwwards 3D sites (cheap DOM, GPU scenery).

## Develop

```bash
npm install
npm run dev          # http://localhost:5173 (point VITE at the Express API via proxy or same origin)
```

For full-stack dev, run the Express backend in `../tiktok-downloader-pwa`
and use `npm run dev` with the backend on port 3000 — the app calls relative
`/api/*` paths, so either serve Vite behind the same origin or use a proxy.

## Ship to the Express server

```bash
npm run build                     # → dist/
rm -rf ../tiktok-downloader-pwa/public
cp -r dist ../tiktok-downloader-pwa/public
```

The built assets are committed to `../tiktok-downloader-pwa/public`, so the
backend deploys unchanged (Render/Vercel) and serves the 3D UI.

## What was retained from the 2D app

- Name + subtitle, input ("Paste a TikTok link..."), "Download video" CTA
- The three instructional steps (now 3D tiles)
- Web Share Target auto-resolve, result card, **Save Video (.MP4)** →
  `GET /api/proxy-download` (native Android download), install prompt,
  manifest.json + sw.js (PWA installability).
