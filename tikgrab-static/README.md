# TikGrab — static, zero-cost edition (direct TikTok embed pipeline)

Single `index.html`, 100% client-side. **No serverless functions, no API keys,
no database, no CORS proxies** — the browser communicates directly with
TikTok's own public servers.

## Resolution pipeline (first-party endpoints only)
1. `https://www.tiktok.com/oembed?url=…` — public oEmbed: title, author,
   thumbnail, and the canonical video id for short `vm./vt.` links.
2. `https://www.tiktok.com/embed/v2/<id>` (fallback `/embed/<id>`) — the
   native embed player page; its SIGI_STATE / initial-props JSON payload
   carries clean CDN play addresses, the internal aweme `videoId`, cover
   art and the music MP3.
3. `https://api.tiktok.com/aweme/v1/play/?video_id=<internal>&watermark=0` —
   TikTok's native play endpoint with the watermark flag off, used as the
   primary "Download Video (No Watermark)" link. An alternate-CDN cycler is
   offered from the payload's extra edge URLs.

Downloads are handed to the native download manager via
`<a download target="_blank" rel="noopener noreferrer">` — media flows
TikTok CDN → user device, 0 bytes through any host of ours.

## Deploy to Vercel (free tier)
New project → import repo → **Root Directory: `tikgrab-static`** →
Framework: *Other* → Deploy. No env vars needed.

> Honest note: direct browser requests depend on TikTok's public endpoints
> answering cross-origin calls from your origin; if TikTok ever blocks one,
> the UI shows a clear error instead of silently relaying through proxies.
