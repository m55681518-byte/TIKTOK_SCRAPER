/**
 * ============================================================================
 *  TikGrab — Backend API (Node.js + Express)
 * ============================================================================
 *
 *  Purpose
 *  -------
 *  A thin, secure proxy between the Flutter mobile app and the third-party
 *  TikTok scraping service hosted on RapidAPI:
 *
 *      TikTok "Share" ──► POST /api/download { "url": "https://vm.tiktok.com/xxxx/" }
 *                              │
 *                              │ 1. Validate & clean the URL (drop tracking params)
 *                              │ 2. Forward it to RapidAPI  (the API key stays
 *                              │    server-side and is NEVER shipped to devices)
 *                              │ 3. Normalise the upstream JSON
 *                              ▼
 *      { "success": true, "video": { "downloadUrl": "https://…/video.mp4", … } }
 *                              │
 *                              ▼
 *      The Flutter app streams that MP4 straight into the user's gallery.
 *
 *  Why a backend at all?
 *  ---------------------
 *  The RapidAPI key is a secret. Bundling it into the mobile binary would leak
 *  it to every user (APK/IPA strings are trivially extractable) and the quota
 *  would be burned in hours. Keeping the key behind this service also lets us
 *  validate/clean URLs, rate-limit abuse, and swap scraper vendors without
 *  shipping a new app build.
 *
 *  Environment (see .env.example — all values are optional except RAPIDAPI_KEY)
 *  --------------------------------------------------------------------------
 *    PORT                   listen port (default 3000)
 *    ALLOWED_ORIGINS        CORS allowlist, comma separated ("*" = dev only)
 *    RAPIDAPI_HOST          scraper host on RapidAPI
 *    RAPIDAPI_KEY           your secret RapidAPI key
 *    RAPIDAPI_PATH          endpoint path on that host (default "/")
 *    UPSTREAM_TIMEOUT_MS    upstream request timeout
 *    RATE_LIMIT_WINDOW_MS   rate-limiter window (default 60000)
 *    RATE_LIMIT_MAX         max requests per IP per window (default 30)
 *
 *  Run
 *  ---
 *    npm install
 *    npm run dev      # auto-reload via node --watch
 *    npm start        # production
 * ============================================================================
 */

'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { rateLimit } = require('express-rate-limit');

/* ────────────────────────────────────────────────────────────────────────────
 * 1. Configuration
 * ──────────────────────────────────────────────────────────────────────────── */

const CONFIG = {
  port: parseInt(process.env.PORT || '3000', 10),
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // RapidAPI scraper endpoint
  rapidApiHost:
    process.env.RAPIDAPI_HOST ||
    'tiktok-downloader-download-tiktok-videos-without-watermark.p.rapidapi.com',
  rapidApiKey: process.env.RAPIDAPI_KEY || '',
  rapidApiPath: process.env.RAPIDAPI_PATH || '/',

  upstreamTimeoutMs: parseInt(process.env.UPSTREAM_TIMEOUT_MS || '30000', 10),
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '30', 10),
};

function assertConfig() {
  if (!CONFIG.rapidApiKey) {
    console.error(
      '\n[FATAL] RAPIDAPI_KEY is not set.\n' +
        '        Copy backend/.env.example to backend/.env and fill it in.\n'
    );
    process.exit(1);
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * 2. Typed errors → mapped to JSON responses by the central error handler
 * ──────────────────────────────────────────────────────────────────────────── */

class ApiError extends Error {
  /**
   * @param {number} status  HTTP status to respond with
   * @param {string} code    stable machine-readable code for the app
   * @param {string} message human-readable message for the app to display
   * @param {object} [details] optional debug details (never secrets)
   */
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * 3. TikTok URL validation & cleaning
 * ──────────────────────────────────────────────────────────────────────────── */

const TIKTOK_HOST_RE = /(^|\.)tiktok\.com$/i;
// Matches every TikTok link flavour: tiktok.com, www., m., vm. and vt.
const TIKTOK_URL_RE = /https?:\/\/(?:www\.|m\.|vm\.|vt\.)?tiktok\.com\/[^\s"'<>()]+/i;

/**
 * Extracts a TikTok video link from arbitrary input and returns it CLEANED:
 *   • scheme forced to https
 *   • query string and fragment removed entirely
 *
 * Shared payloads rarely contain just the link — TikTok shares look like:
 *   "Check out this video! https://vm.tiktok.com/ZSxxxx/ #fyp #viral"
 *
 * The tracking parameters TikTok appends (_r, _t, is_copy_url,
 * is_from_webapp, share_app_id, referer, utm_*, …) are pure noise: the video
 * identifier lives entirely in the URL path, so dropping them is always safe
 * and keeps upstream lookups fast and cache-friendly.
 *
 * @param {string} input raw text from the app (body.url)
 * @returns {string|null} cleaned https URL, or null if it isn't a TikTok video link
 */
function extractTiktokUrl(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Find a TikTok link anywhere inside the text; fall back to the raw text.
  const match = trimmed.match(TIKTOK_URL_RE);
  const candidate = match ? match[0] : trimmed;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  // Must be a tiktok.com domain (vm./vt./www./m. included) …
  if (!TIKTOK_HOST_RE.test(parsed.hostname)) return null;
  // … and must point at something deeper than the homepage (a video path or
  // a short-link code such as /ZSxxxxx/).
  if (!parsed.pathname || parsed.pathname === '/') return null;

  parsed.protocol = 'https:';
  parsed.search = ''; // drop ALL query params (tracking junk)
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
    // The key lives ONLY here, on the server. It is never sent to the app.
    'x-rapidapi-key': CONFIG.rapidApiKey,
    'x-rapidapi-host': CONFIG.rapidApiHost,
    Accept: 'application/json',
    'User-Agent': 'TikGrab/1.0',
  },
});

/**
 * Sends the cleaned TikTok URL to the RapidAPI scraper.
 * GET https://{RAPIDAPI_HOST}{RAPIDAPI_PATH}?url=<cleaned tiktok url>
 *
 * @param {string} cleanUrl
 * @returns {Promise<object>} raw upstream JSON payload
 */
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
        // RapidAPI monthly/hourly quota exhausted or per-second limit hit.
        throw new ApiError(
          429,
          'RATE_LIMITED',
          'The scraper API rate limit was reached. Please wait a moment and try again.'
        );
      }
      if (status === 401 || status === 403) {
        throw new ApiError(
          502,
          'UPSTREAM_AUTH',
          'The scraper API rejected our credentials. Check RAPIDAPI_KEY / subscription status.'
        );
      }
      throw new ApiError(502, 'UPSTREAM_ERROR', `The scraper API returned HTTP ${status}.`);
    }
    if (
      err.code === 'ECONNABORTED' ||
      err.code === 'ETIMEDOUT' ||
      err.code === 'ECONNRESET'
    ) {
      throw new ApiError(
        504,
        'UPSTREAM_TIMEOUT',
        'The scraper API took too long to respond. Please try again.'
      );
    }
    throw new ApiError(
      502,
      'UPSTREAM_UNREACHABLE',
      'Could not reach the scraper API. Check server network/DNS.'
    );
  }
  return response.data;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 5. Response normalisation
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

/**
 * Normalises the raw upstream payload into one stable shape for the app.
 *
 * Primary contract (the tikwm-style contract served by this RapidAPI listing):
 * {
 *   "code": 0,
 *   "msg": "success",
 *   "data": {
 *     "id": "7106594312292453675",
 *     "title": "caption…",
 *     "cover": "https://…",
 *     "duration": 14,
 *     "play":   "https://….mp4",   ← watermark-free
 *     "hdplay": "https://….mp4",   ← watermark-free HD when available
 *     "wmplay": "https://….mp4",   ← watermarked (ignored by the app)
 *     "size": 1234567, "hd_size": 2345678,
 *     "music": "https://….mp3",
 *     "author": { "unique_id": "tiktok", "nickname": "TikTok", … }
 *   }
 * }
 *
 * The parser also tolerates several sibling shapes (top-level fields, nested
 * `data.data`, `urls` arrays) so swapping scraper vendors later is a config
 * change rather than a code change.
 *
 * @param {object} payload raw upstream JSON
 * @param {string} sourceUrl the cleaned TikTok URL that produced this payload
 */
function parseUpstreamPayload(payload, sourceUrl) {
  if (!payload || typeof payload !== 'object' || Buffer.isBuffer(payload)) {
    throw new ApiError(
      502,
      'UPSTREAM_INVALID_RESPONSE',
      'The scraper API returned an unexpected (non-JSON) payload.'
    );
  }

  // tikwm-style failure envelope: { code: -1, msg: "error description" }
  if (
    'code' in payload &&
    payload.code !== 0 &&
    payload.code !== '0' &&
    payload.code !== 200
  ) {
    const upstreamMsg = pickString(payload.msg, payload.message);
    throw new ApiError(
      422,
      'VIDEO_UNAVAILABLE',
      `${upstreamMsg || 'The video could not be processed.'} It may be private, deleted or region-locked.`
    );
  }

  const data = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  // Some mirrors wrap the payload once more: { data: { data: { … } } }
  const inner = data.data && typeof data.data === 'object' ? data.data : data;

  // Prefer HD (still watermark-free), fall back to the standard rendition.
  let downloadUrl = pickString(
    inner.hdplay,
    inner.play,
    inner.url,
    inner.video,
    inner.videoUrl,
    inner.downloadUrl,
    inner.mp4,
    inner.dlink
  );
  let quality =
    downloadUrl && inner.hdplay && downloadUrl === inner.hdplay ? 'HD' : 'SD';

  // Fallback shape: { urls: [ { url, name|quality }, … ] }
  if (!downloadUrl && Array.isArray(inner.urls)) {
    const entry = inner.urls.find(
      (u) => u && typeof u === 'object' && typeof u.url === 'string'
    );
    if (entry) {
      downloadUrl = entry.url;
      quality = pickString(entry.name, entry.quality) || 'SD';
    }
  }

  if (!downloadUrl) {
    // Usually a slideshow/photo post (no video) or an upstream regression.
    throw new ApiError(
      502,
      'NO_MEDIA_LINK',
      'The scraper response did not include a playable MP4 link. If this is a photo/slideshow post, only videos can be downloaded.',
      { receivedKeys: Object.keys(inner) }
    );
  }

  const author = inner.author && typeof inner.author === 'object' ? inner.author : {};
  const musicInfo =
    inner.music_info && typeof inner.music_info === 'object' ? inner.music_info : {};
  const sizeBytes =
    quality === 'HD'
      ? pickNumber(inner.hd_size, inner.size)
      : pickNumber(inner.size, inner.hd_size);

  return {
    sourceUrl,
    videoId: pickString(inner.id, inner.video_id, inner.videoId),
    title: pickString(inner.title, inner.desc) || 'TikTok video',
    coverUrl: pickString(inner.cover, inner.origin_cover, inner.thumbnail, inner.coverUrl),
    durationSeconds: pickNumber(inner.duration, inner.durationSec),
    sizeBytes,
    authorUsername: pickString(author.unique_id, author.username, author.uniqueId),
    authorNickname: pickString(author.nickname, author.name),
    musicTitle: pickString(musicInfo.title, inner.music_title),
    /** The direct watermark-free MP4 link the app downloads. */
    downloadUrl,
    quality,
    hdAvailable: typeof inner.hdplay === 'string' && inner.hdplay.length > 0,
    /** Exposed for completeness; the app always uses `downloadUrl`. */
    watermarkUrl: pickString(inner.wmplay),
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 6. Express app
 * ──────────────────────────────────────────────────────────────────────────── */

const app = express();
app.disable('x-powered-by');

// When deployed behind a reverse proxy (nginx, Heroku, Render, …) uncomment
// so express-rate-limit sees real client IPs:
// app.set('trust proxy', 1);

// CORS — wide open for development, locked down via ALLOWED_ORIGINS in prod.
if (CONFIG.allowedOrigins.includes('*')) {
  app.use(cors());
} else {
  app.use(cors({ origin: CONFIG.allowedOrigins }));
}

app.use(express.json({ limit: '16kb' }));

// Minimal request logger:  METHOD /path → status (ms)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(
      `${new Date().toISOString()} ${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - start}ms)`
    );
  });
  next();
});

/* ────────────────────────────────────────────────────────────────────────────
 * 7. Routes
 * ──────────────────────────────────────────────────────────────────────────── */

/** Liveness probe. */
app.get('/healthz', (req, res) => {
  res.json({
    success: true,
    service: 'tikgrab-backend',
    uptimeSec: Math.round(process.uptime()),
  });
});

// Protects the (paid) RapidAPI quota from runaway clients and abuse.
const downloadLimiter = rateLimit({
  windowMs: CONFIG.rateLimitWindowMs,
  limit: CONFIG.rateLimitMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many requests — please slow down a little.' },
  },
});

/**
 * Shared handler for POST/GET /api/download.
 * Accepts the TikTok URL as JSON body ({ "url": "…" }) or ?url= query param.
 */
async function handleDownload(req, res) {
  const raw = (req.body && (req.body.url || req.body.link)) || req.query.url || '';

  const cleanUrl = extractTiktokUrl(raw);
  if (!cleanUrl) {
    throw new ApiError(
      400,
      'INVALID_URL',
      'Please provide a valid TikTok video link, e.g. https://vm.tiktok.com/… or https://www.tiktok.com/@user/video/…'
    );
  }

  const payload = await fetchUpstream(cleanUrl);
  const video = parseUpstreamPayload(payload, cleanUrl);

  res.status(200).json({ success: true, video });
}

/**
 * POST /api/download   { "url": "<tiktok share link>" }
 * → 200 { success: true, video: { downloadUrl, title, coverUrl, … } }
 */
app.post('/api/download', downloadLimiter, (req, res, next) => {
  handleDownload(req, res).catch(next);
});

// Same behaviour via GET for quick browser/curl smoke tests.
app.get('/api/download', downloadLimiter, (req, res, next) => {
  handleDownload(req, res).catch(next);
});

/* ────────────────────────────────────────────────────────────────────────────
 * 8. 404 + central error handler (every error becomes stable JSON)
 * ──────────────────────────────────────────────────────────────────────────── */

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` },
  });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof ApiError) {
    if (err.status >= 500) console.error('[upstream]', err.message);
    return res.status(err.status).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
  }

  // Malformed JSON body (thrown by express.json)
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
 * 9. Startup
 * ──────────────────────────────────────────────────────────────────────────── */

function start() {
  assertConfig();
  app.listen(CONFIG.port, '0.0.0.0', () => {
    console.log('──────────────────────────────────────────────────────────────');
    console.log(` TikGrab backend listening on http://0.0.0.0:${CONFIG.port}`);
    console.log(` Upstream scraper host : ${CONFIG.rapidApiHost}`);
    console.log(` Rate limit            : ${CONFIG.rateLimitMax} req / ${CONFIG.rateLimitWindowMs}ms per IP`);
    console.log('──────────────────────────────────────────────────────────────');
  });
}

if (require.main === module) {
  start();
}

// Exported for unit tests / serverless adapters.
module.exports = { app, extractTiktokUrl, parseUpstreamPayload, ApiError };
