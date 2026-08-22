/**
 * ============================================================================
 *  TikGrab PWA — Backend (Node.js + Express)
 * ============================================================================
 *
 *  One process serves everything:
 *
 *    1. The installable PWA            → static files from ./public
 *    2. The scraper API proxy          → POST /api/download
 *       (the RapidAPI key lives ONLY here — it never reaches the browser)
 *    3. A CORS-safe MP4 streaming proxy→ GET /api/stream
 *       (pipes the CDN file through our origin so the browser can fetch it
 *        with progress and force a real `.mp4` download)
 *    4. The Web Share Target landing   → GET/POST /share-target
 *       (Android share sheet → this endpoint → redirect into the UI)
 *
 *  Flow:
 *    TikTok → Share → TikGrab (PWA)
 *      → app.js reads the shared link (query params)
 *      → POST /api/download { url }          ──► RapidAPI scraper
 *      ← { downloadUrl, title, cover, … }
 *      → user taps "Save Video (.MP4)"
 *      → GET /api/stream?url=…               ──► pipes MP4 with progress
 *      → file saved as .mp4
 *
 *  Run:   npm install && npm start        (http://localhost:3000)
 *  Env:   see .env.example (RAPIDAPI_KEY is required)
 * ============================================================================
 */

'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const axios = require('axios');

/* ────────────────────────────────────────────────────────────────────────────
 * 1. Configuration
 * ──────────────────────────────────────────────────────────────────────────── */

const CONFIG = {
  port: parseInt(process.env.PORT || '3000', 10),
  rapidApiHost:
    process.env.RAPIDAPI_HOST ||
    'tiktok-downloader-download-tiktok-videos-without-watermark.p.rapidapi.com',
  rapidApiKey: process.env.RAPIDAPI_KEY || '',
  rapidApiPath: process.env.RAPIDAPI_PATH || '/',
  upstreamTimeoutMs: parseInt(process.env.UPSTREAM_TIMEOUT_MS || '45000', 10),
};

function assertConfig() {
  // Missing key must NOT crash the process: platforms like Vercel deploy
  // first and receive env vars afterwards. The UI keeps working and the
  // scraper endpoint answers 503 NOT_CONFIGURED until the key is set.
  if (!CONFIG.rapidApiKey) {
    console.warn(
      '\n[WARN] RAPIDAPI_KEY is not set.\n' +
        '       The PWA will serve, but /api/download returns 503 until you add\n' +
        '       RAPIDAPI_KEY (deploy dashboard → Environment Variables) and redeploy.\n'
    );
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * 2. Typed errors → stable JSON for the frontend
 * ──────────────────────────────────────────────────────────────────────────── */

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * 3. TikTok URL validation & cleaning
 * ============================================================================
 * Shared payloads rarely contain a bare link — Android's share sheet hands us
 * things like "Check out this video! https://vm.tiktok.com/ZSxxxx/ #fyp".
 * We extract the link, force https, and drop ALL query params: TikTok's
 * tracking junk (_r, _t, is_copy_url, share_app_id, utm_*) is pure noise —
 * the video id lives entirely in the URL path.
 * ──────────────────────────────────────────────────────────────────────────── */

const TIKTOK_HOST_RE = /(^|\.)tiktok\.com$/i;
const TIKTOK_URL_RE = /https?:\/\/(?:www\.|m\.|vm\.|vt\.)?tiktok\.com\/[^\s"'<>()]+/i;

function extractTiktokUrl(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const match = trimmed.match(TIKTOK_URL_RE);
  const candidate = match ? match[0] : trimmed;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (!TIKTOK_HOST_RE.test(parsed.hostname)) return null;
  if (!parsed.pathname || parsed.pathname === '/') return null;

  parsed.protocol = 'https:';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

/* ────────────────────────────────────────────────────────────────────────────
 * 4. Upstream scraper client (RapidAPI)
 * ──────────────────────────────────────────────────────────────────────────── */

const upstreamClient = axios.create({
  baseURL: `https://${CONFIG.rapidApiHost}`,
  timeout: CONFIG.upstreamTimeoutMs,
  headers: {
    // The secret lives ONLY on this server.
    'x-rapidapi-key': CONFIG.rapidApiKey,
    'x-rapidapi-host': CONFIG.rapidApiHost,
    Accept: 'application/json',
    'User-Agent': 'TikGrabPWA/1.0',
  },
});

async function fetchUpstream(cleanUrl) {
  let response;
  try {
    response = await upstreamClient.get(CONFIG.rapidApiPath, {
      params: { url: cleanUrl },
    });
  } catch (err) {
    if (err.response) {
      const { status } = err.response;
      if (status === 429) {
        throw new ApiError(429, 'RATE_LIMITED',
          'The scraper API rate limit was reached. Wait a moment and try again.');
      }
      if (status === 401 || status === 403) {
        throw new ApiError(502, 'UPSTREAM_AUTH',
          'The scraper API rejected our credentials. Check RAPIDAPI_KEY.');
      }
      throw new ApiError(502, 'UPSTREAM_ERROR', `The scraper API returned HTTP ${status}.`);
    }
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET') {
      throw new ApiError(504, 'UPSTREAM_TIMEOUT',
        'The scraper API took too long to respond. Try again.');
    }
    throw new ApiError(502, 'UPSTREAM_UNREACHABLE',
      'Could not reach the scraper API. Check the server network.');
  }
  return response.data;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 5. Response normalisation
 * ============================================================================
 * Primary contract (tikwm-style, served by this RapidAPI listing):
 *   { code: 0, msg: "success", data: { title, cover, duration,
 *     play, hdplay, wmplay, size, hd_size, author: {...}, ... } }
 * Also tolerates sibling shapes (top-level fields, data.data, urls[]).
 * ──────────────────────────────────────────────────────────────────────────── */

function pickString(...values) {
  for (const v of values) {
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return null;
}

function pickNumber(...values) {
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
    if (typeof v === 'string' && /^\d+$/.test(v)) return parseInt(v, 10);
  }
  return null;
}

function parseUpstreamPayload(payload, sourceUrl) {
  if (!payload || typeof payload !== 'object' || Buffer.isBuffer(payload)) {
    throw new ApiError(502, 'UPSTREAM_INVALID_RESPONSE',
      'The scraper API returned an unexpected (non-JSON) payload.');
  }

  // tikwm-style failure envelope: { code: -1, msg: "..." }
  if ('code' in payload && payload.code !== 0 && payload.code !== '0' && payload.code !== 200) {
    const msg = pickString(payload.msg, payload.message);
    throw new ApiError(422, 'VIDEO_UNAVAILABLE',
      `${msg || 'The video could not be processed.'} It may be private, deleted or region-locked.`);
  }

  const data = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  const inner = data.data && typeof data.data === 'object' ? data.data : data;

  // Prefer HD (still watermark-free), fall back to the standard rendition.
  let downloadUrl = pickString(inner.hdplay, inner.play, inner.url, inner.video,
    inner.videoUrl, inner.downloadUrl, inner.mp4, inner.dlink);
  let quality = downloadUrl && inner.hdplay && downloadUrl === inner.hdplay ? 'HD' : 'SD';

  if (!downloadUrl && Array.isArray(inner.urls)) {
    const entry = inner.urls.find((u) => u && typeof u === 'object' && typeof u.url === 'string');
    if (entry) {
      downloadUrl = entry.url;
      quality = pickString(entry.name, entry.quality) || 'SD';
    }
  }

  if (!downloadUrl) {
    throw new ApiError(502, 'NO_MEDIA_LINK',
      'No playable MP4 link in the scraper response. Photo/slideshow posts cannot be downloaded.');
  }

  const author = inner.author && typeof inner.author === 'object' ? inner.author : {};
  const sizeBytes = quality === 'HD'
    ? pickNumber(inner.hd_size, inner.size)
    : pickNumber(inner.size, inner.hd_size);

  return {
    downloadUrl,
    title: pickString(inner.title, inner.desc) || 'TikTok video',
    cover: pickString(inner.cover, inner.origin_cover, inner.thumbnail) || null,
    extras: {
      sourceUrl,
      videoId: pickString(inner.id, inner.video_id),
      authorUsername: pickString(author.unique_id, author.username),
      authorNickname: pickString(author.nickname, author.name),
      durationSeconds: pickNumber(inner.duration, inner.durationSec),
      sizeBytes,
      quality,
      hdAvailable: typeof inner.hdplay === 'string' && inner.hdplay.length > 0,
    },
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 6. Express app
 * ──────────────────────────────────────────────────────────────────────────── */

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));
// Some Android browsers POST share data as text/plain.
app.use(express.text({ type: 'text/plain', limit: '16kb' }));

// Request logger:  METHOD /path → status (ms)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

/* ── 6a. Static PWA files ────────────────────────────────────────────────────
 * Served from /public at the site root, so manifest.json and sw.js get the
 * root scope the browser requires for installability + share-target. */
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

/* ── 6b. Health probe ────────────────────────────────────────────────────── */
app.get('/healthz', (req, res) => {
  res.json({ success: true, service: 'tikgrab-pwa', uptimeSec: Math.round(process.uptime()) });
});

/* ── 6c. Scraper endpoint ────────────────────────────────────────────────────
 * POST /api/download  { "url": "<tiktok share link>" }
 * → 200 { success: true, downloadUrl, title, cover, extras }
 * ──────────────────────────────────────────────────────────────────────────── */
app.post('/api/download', async (req, res, next) => {
  try {
    if (!CONFIG.rapidApiKey) {
      throw new ApiError(503, 'NOT_CONFIGURED',
        'This deployment has no RAPIDAPI_KEY yet. Add it in your deploy dashboard (Environment Variables) and redeploy.');
    }
    const raw = (req.body && (req.body.url || req.body.link)) || req.query.url || '';
    const cleanUrl = extractTiktokUrl(typeof raw === 'string' ? raw : '');
    if (!cleanUrl) {
      throw new ApiError(400, 'INVALID_URL',
        'Please provide a valid TikTok video link, e.g. https://vm.tiktok.com/…');
    }
    const payload = await fetchUpstream(cleanUrl);
    const video = parseUpstreamPayload(payload, cleanUrl);
    res.status(200).json({ success: true, ...video });
  } catch (err) {
    next(err);
  }
});

/* ── 6d. Web Share Target landing ────────────────────────────────────────────
 * When the manifest declares share_target, Android navigates here from the
 * native share sheet:  /share-target?title=…&text=…&url=…
 * (Chrome sends the shared caption in `text` and/or the link in `url`.)
 * We extract the TikTok link and redirect into the UI, which auto-starts. */
function extractShareParam(req) {
  const q = req.query || {};
  return (
    (typeof q.url === 'string' && q.url) ||
    (typeof q.text === 'string' && q.text) ||
    (typeof q.title === 'string' && q.title) ||
    (typeof req.body === 'string' && req.body) ||
    (req.body && typeof req.body.url === 'string' && req.body.url) ||
    (req.body && typeof req.body.text === 'string' && req.body.text) ||
    ''
  );
}

function handleShareTarget(req, res) {
  const shared = extractTiktokUrl(extractShareParam(req));
  const target = shared ? `/?shared=${encodeURIComponent(shared)}` : '/';
  res.redirect(302, target);
}

app.get('/share-target', handleShareTarget);
app.post('/share-target', handleShareTarget); // robustness: method:POST manifests

/* ── 6e. MP4 forced-download proxies ─────────────────────────────────────────
 * GET /api/proxy-download?url=<encoded mp4>   ← the one the UI button points to
 * GET /api/stream?url=<encoded mp4>[&name=…]  ← same proxy, custom filename
 *
 * Why: TikTok CDN hosts usually send no CORS headers, and a plain CDN link
 * would just open in a new tab on Android. Proxying through our own origin
 * with `Content-Disposition: attachment` makes the browser SAVE the bytes
 * natively to device storage (Downloads/) instead of navigating.
 * ──────────────────────────────────────────────────────────────────────────── */
const BLOCKED_HOST_RE = /(^|\.)(localhost|local|internal|lan)$/i;
const PRIVATE_IP_RE =
  /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

function validatedStreamTarget(raw) {
  let parsed;
  try {
    parsed = new URL(typeof raw === 'string' ? raw : '');
  } catch {
    throw new ApiError(400, 'INVALID_URL', 'Missing or invalid stream URL.');
  }
  // Basic SSRF guard: plain https to public hosts only.
  if (
    parsed.protocol !== 'https:' ||
    BLOCKED_HOST_RE.test(parsed.hostname) ||
    PRIVATE_IP_RE.test(parsed.hostname)
  ) {
    throw new ApiError(400, 'INVALID_URL', 'Stream URL rejected.');
  }
  return parsed.toString();
}

const PROXY_UA =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/126.0 Mobile Safari/537.36 TikGrabPWA/1.0';

async function pipeMp4(req, res, next, filename) {
  try {
    const target = validatedStreamTarget(req.query.url);

    const upstream = await axios.get(target, {
      responseType: 'stream',
      timeout: 5 * 60 * 1000,
      // TikTok CDNs redirect a lot — follow them.
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 400,
      headers: {
        'User-Agent': PROXY_UA,
        Accept: 'video/mp4,video/*;q=0.9,*/*;q=0.8',
      },
    });

    res.status(200);
    res.set('Content-Type', 'video/mp4');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.set('Cache-Control', 'no-store');
    const len = upstream.headers['content-length'];
    if (len) res.set('Content-Length', String(len));

    upstream.data.pipe(res);
    upstream.data.on('error', () => res.destroy());
    req.on('close', () => upstream.data.destroy());
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    next(new ApiError(502, 'STREAM_FAILED',
      `Could not stream the video file (${err.message}). Try again or use the direct link.`));
  }
}

/**
 * GET /api/proxy-download?url=<encoded mp4>
 * Forces a native download: the Android browser saves the file to device
 * storage as tiktok_video.mp4 instead of opening it in a tab.
 */
app.get('/api/proxy-download', (req, res, next) => {
  pipeMp4(req, res, next, 'tiktok_video.mp4');
});

/** Same proxy with a custom filename (kept for programmatic use). */
app.get('/api/stream', (req, res, next) => {
  const name = String(req.query.name || 'tiktok_video')
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 60) || 'tiktok_video';
  pipeMp4(req, res, next, `${name}.mp4`);
});

/* ── 6f. SPA fallback + errors ───────────────────────────────────────────── */

app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    // Unknown GET path → serve the app (keeps deep links/share params sane).
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  next(new ApiError(404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`));
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof ApiError) {
    if (err.status >= 500) console.error('[upstream]', err.message);
    return res.status(err.status).json({
      success: false,
      error: { code: err.code, message: err.message },
    });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' },
    });
  }
  console.error('[unhandled]', err);
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL', message: 'Unexpected server error.' },
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 7. Startup
 * ──────────────────────────────────────────────────────────────────────────── */

function start() {
  assertConfig();
  app.listen(CONFIG.port, '0.0.0.0', () => {
    console.log('──────────────────────────────────────────────────────────────');
    console.log(` TikGrab PWA listening on http://0.0.0.0:${CONFIG.port}`);
    console.log(` Scraper host : ${CONFIG.rapidApiHost}`);
    console.log(` PWA          : installable at any HTTPS origin serving this app`);
    console.log('──────────────────────────────────────────────────────────────');
  });
}

if (require.main === module) {
  start();
}

// Serverless platforms (Vercel) require the handler as the export: the
// Express app itself is a (req, res) function. `listen()` only runs when
// executed directly (local / Render / Docker).
module.exports = app;
module.exports.app = app;
module.exports.extractTiktokUrl = extractTiktokUrl;
module.exports.parseUpstreamPayload = parseUpstreamPayload;
module.exports.ApiError = ApiError;
