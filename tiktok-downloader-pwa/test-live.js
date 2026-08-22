/**
 * ============================================================================
 *  test-live.js — automated live verification of the RapidAPI integration
 * ============================================================================
 *
 *  What it does:
 *    1. Loads RAPIDAPI_KEY / RAPIDAPI_HOST from .env (inline loader — this
 *       script has ZERO npm dependencies, it runs even before `npm install`)
 *    2. Sends a REAL TikTok video URL to the RapidAPI downloader endpoint
 *    3. Logs the (truncated) JSON response
 *    4. Extracts the watermark-free MP4 link
 *    5. Fetches the first 2 KB of that MP4 to confirm the link is LIVE
 *
 *  Usage:
 *      node test-live.js                       # default test video
 *      node test-live.js <any tiktok url>      # your own video
 *      npm run test:live
 *
 *  Requires Node 18+ (uses the built-in fetch).
 *  Exit code 0 = everything works end-to-end; 1 = failure (details logged).
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

/* ── Minimal .env loader (no deps) ──────────────────────────────────────── */
try {
  const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of envFile.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#') && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  }
} catch {
  // No .env — environment variables may come from the shell/deploy platform.
}

const HOST =
  process.env.RAPIDAPI_HOST ||
  'tiktok-downloader-download-tiktok-videos-without-watermark.p.rapidapi.com';
const KEY = process.env.RAPIDAPI_KEY || '';
const ENDPOINT_PATH = process.env.RAPIDAPI_PATH || '/';

// The exact live URL mandated for verification.
const DEFAULT_TEST_URL = 'https://www.tiktok.com/@lojashermit/video/7438771762495573303';
const TEST_URL = process.argv[2] || DEFAULT_TEST_URL;

const BROWSER_UA =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/126.0 Mobile Safari/537.36';

function pickString(...values) {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

async function main() {
  if (!KEY) {
    console.error('✗ RAPIDAPI_KEY is not set — copy .env.example to .env first.');
    process.exit(1);
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log(' TikGrab live integration test');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(` Host     : ${HOST}`);
  console.log(` TikTok   : ${TEST_URL}`);
  console.log('───────────────────────────────────────────────────────────');

  /* 1 ── resolve the video through RapidAPI ────────────────────────────── */
  console.log('→ Calling RapidAPI…');
  const t0 = Date.now();
  const upstream = await fetch(
    `https://${HOST}${ENDPOINT_PATH}?url=${encodeURIComponent(TEST_URL)}`,
    {
      headers: {
        'x-rapidapi-key': KEY,
        'x-rapidapi-host': HOST,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(45000),
    }
  );
  const data = await upstream.json().catch(() => null);
  console.log(`← HTTP ${upstream.status} in ${Date.now() - t0}ms`);

  console.log('\n── Raw response (truncated) ────────────────────────────────');
  console.log(JSON.stringify(data, null, 2).slice(0, 2500));
  console.log('────────────────────────────────────────────────────────────');

  if (data && 'code' in data && data.code !== 0 && data.code !== '0' && data.code !== 200) {
    console.error(`✗ Upstream reported failure: code=${data.code} msg=${data.msg}`);
    process.exit(1);
  }

  /* 2 ── extract the watermark-free MP4 ────────────────────────────────── */
  const d = (data && data.data && typeof data.data === 'object' ? data.data : data) || {};
  const mp4 =
    pickString(d.hdplay, d.play, d.url, d.video, d.downloadUrl) ||
    (Array.isArray(d.urls) && d.urls[0] && d.urls[0].url) ||
    null;

  if (!mp4) {
    console.error('✗ No MP4 link found in the response (photo/slideshow post?).');
    process.exit(1);
  }
  console.log(`\n✓ Watermark-free MP4 link:\n  ${mp4}`);
  console.log(`  Title  : ${pickString(d.title, d.desc) || '(none)'}`);
  console.log(`  Cover  : ${pickString(d.cover, d.origin_cover) || '(none)'}`);

  /* 3 ── confirm the MP4 link is actually alive ────────────────────────── */
  console.log('\n→ Fetching first 2 KB of the MP4…');
  const probe = await fetch(mp4, {
    headers: { 'User-Agent': BROWSER_UA, Range: 'bytes=0-2047' },
    signal: AbortSignal.timeout(30000),
  });
  const reader = probe.body.getReader();
  const first = await reader.read();
  const bytes = first.value ? first.value.length : 0;
  await reader.cancel().catch(() => {});

  if (bytes === 0) {
    console.error('✗ MP4 probe returned 0 bytes.');
    process.exit(1);
  }

  console.log(`✓ MP4 is LIVE — HTTP ${probe.status}, ` +
    `content-type: ${probe.headers.get('content-type') || 'n/a'}, ` +
    `content-length: ${probe.headers.get('content-length') || 'n/a'}, ` +
    `received ${bytes} bytes`);

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(' ✓✓ ALL CHECKS PASSED — the integration works end-to-end.');
  console.log('═══════════════════════════════════════════════════════════');
  process.exit(0);
}

main().catch((err) => {
  const detail =
    err && err.cause ? `${err.cause.code || err.cause.message}` : err.message;
  console.error(`\n✗ Test failed: ${detail}`);
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|EPIPE|SSL|UND_ERR/i.test(String(detail))) {
    console.error('  (network-level failure — this machine could not reach the API at all)');
  }
  process.exit(1);
});
