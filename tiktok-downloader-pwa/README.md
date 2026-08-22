# TikGrab PWA — TikTok → MP4 in one tap (no app stores)

An installable **Progressive Web App** + **Express** backend that saves TikTok videos watermark-free:

- **No app-store bans** — users install straight from your HTTPS URL ("Add to Home Screen").
- **Android native share sheet** — thanks to the [Web Share Target API](https://developer.mozilla.org/docs/Web/Manifest/share_target): share a video from TikTok → TikGrab opens and starts resolving it, zero taps.
- **App-like** — `display: standalone`, own icon, full-screen, works offline for the app shell.
- **CORS-safe downloads** — MP4s stream through `GET /api/stream` on our own origin with a live 0→100% progress bar and are force-saved as a real `.mp4` file.

```
TikTok → Share → TikGrab (PWA, Android share sheet)
        → app.js reads ?text=…/?url=…        (Web Share Target payload)
        → POST /api/download                 (RapidAPI scraper, key server-side)
        ← { downloadUrl, title, cover, … }
        → "Save Video (.MP4)"
        → GET /api/stream?url=…              (pipes CDN through our origin)
        → file saved with progress bar
```

> ⚠️ **Legal note** — for downloading videos you own or have permission to save. Re-uploading creators' content violates TikTok's ToS and may infringe copyright.

---

## Structure

```
tiktok-downloader-pwa/
├── server.js          # Express: static PWA + /api/download + /api/stream + /share-target
├── test-live.js       # dependency-free live verification (Node 18+)
├── package.json
├── vercel.json        # one-command deploy → Vercel
├── render.yaml        # one-command deploy → Render (recommended)
├── .env.example       # secrets template (`.env` is git-ignored)
└── public/
    ├── index.html     # mobile-first glassmorphism UI
    ├── app.js         # share target, resolve flow, streamed save, install banner
    ├── styles.css     # dark glassmorphism, TikTok palette
    ├── sw.js          # offline app shell, network-only for /api
    ├── manifest.json  # standalone + icons + share_target ← share-sheet magic
    └── icons/         # 192/512/maskable/apple-touch + regeneration recipe
```

## Local run

```bash
cd tiktok-downloader-pwa
npm install
cp .env.example .env      # paste your RAPIDAPI_KEY
npm run dev               # → http://localhost:3000

# automated live verification (hits the real RapidAPI with a real TikTok URL):
npm run test:live
```

## Deploy to a live HTTPS URL (required for PWA install + share target)

**Render (recommended — long-running server, no function time limits on streams):**
1. Push this repo to GitHub.
2. render.com → *New → Blueprint* → pick the repo (reads `render.yaml`).
3. Paste your RapidAPI key when prompted for `RAPIDAPI_KEY` → Deploy.
4. Open the `https://…onrender.com` URL on Android Chrome → ⋮ → *Install app*.

**Vercel:** `vercel deploy` — `vercel.json` routes everything to `server.js`
(serverless; fine for normal use, but very large video streams can approach
function limits, hence Render is preferred).

## How the Android share sheet works (the critical part)

1. The PWA **must be served over HTTPS** and **installed** (or at least installable).
2. `manifest.json` declares:
   ```json
   "share_target": {
     "action": "/", "method": "GET",
     "params": { "title": "title", "text": "text", "url": "url" }
   }
   ```
3. Android then lists TikGrab in TikTok's share menu. Sharing launches
   `https://your-host/?text=<caption+link>&url=<link>`; `app.js` extracts the
   TikTok URL, cleans it, and auto-resolves it. `GET /share-target` exists as a
   normalised landing (extract → redirect) for method-POST manifests too.

## Backend endpoints

| Route | Purpose |
|---|---|
| `POST /api/download` `{ "url": … }` | `{ success, downloadUrl, title, cover, extras }` — watermark-free MP4 |
| `GET /api/proxy-download?url=<mp4>` | **Forced-download proxy** — `Content-Disposition: attachment; filename="tiktok_video.mp4"`; the Save button points here so Android saves natively |
| `GET /api/stream?url=<mp4>&name=<file>` | Same proxy, custom filename |
| `GET/POST /share-target` | Web Share Target landing → redirects into the UI |
| `GET /healthz` | liveness |

Errors are stable JSON: `400 INVALID_URL`, `422 VIDEO_UNAVAILABLE`, `429 RATE_LIMITED`, `502 UPSTREAM_*`/`NO_MEDIA_LINK`, `504 UPSTREAM_TIMEOUT`.

## Icons

Already generated and wired (`icon-192`, `icon-512`, `icon-maskable-512`, `apple-touch-icon`). To swap artwork, drop a 1024² PNG and follow the recipe in `public/icons/README.md`.

## Security

- The RapidAPI key lives only in `.env` on the server — the browser never sees it.
- `/api/stream` has an SSRF guard (https-only, private/localhost ranges rejected).
- 🔑 Rotate the key you pasted in chat; update `.env` after testing.

## Troubleshooting

| Symptom | Fix |
|---|---|
| No "Install app" option in Chrome | Needs HTTPS, valid manifest + icons, and a registered service worker — all present here; also open via a real network URL, not localhost on the phone. |
| App missing from Android share sheet | PWA not installed yet — install it once, then it appears in TikTok's share menu. |
| `RATE_LIMITED` / `UPSTREAM_AUTH` | RapidAPI quota / key issue — check your subscription. |
| Download stalls | Large HD file on a slow connection; the proxy streams with no artificial cap. |
