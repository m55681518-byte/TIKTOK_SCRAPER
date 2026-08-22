/* ══════════════════════════════════════════════════════════════════════════
   TikGrab — Cyber-Neon Minimalist · vanilla JS
   ──────────────────────────────────────────────────────────────────────────
   • UI state machine: idle → loading (neon ring) → ready card / error.
   • DEMO_MODE = true  → the exact brief behaviour: 3-second setTimeout mock,
                         then the frosted "Download Ready" card slides down.
   • DEMO_MODE = false → real client-side extraction, straight from TikTok's
                         public native endpoints (oEmbed → embed player
                         payload → aweme/v1/play?watermark=0). No servers,
                         no proxies, no keys.
   ══════════════════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const DEMO_MODE = false; // flip to true to preview the 3s mock flow

  const $ = (id) => document.getElementById(id);
  const els = {
    url: $('url'), format: $('format'), get: $('get'), pill: $('pill'),
    error: $('error'),
    ready: $('ready'), thumb: $('r-thumb'), title: $('r-title'),
    author: $('r-author'), chips: $('r-chips'),
    dlVideo: $('dl-video'), dlMp3: $('dl-mp3'), dlAlt: $('dl-alt'),
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ── URL helpers ──────────────────────────────────────────────────────── */
  const TIKTOK_RE = /https?:\/\/(?:www\.|m\.|vm\.|vt\.)?tiktok\.com\/[^\s"'<>()]+/i;
  const TIKTOK_HOST_RE = /(^|\.)tiktok\.com$/i;

  function extractTikTokUrl(text) {
    if (!text) return null;
    const trimmed = String(text).trim();
    const match = trimmed.match(TIKTOK_RE);
    const candidate = match ? match[0] : trimmed;
    try {
      const u = new URL(candidate);
      if (!TIKTOK_HOST_RE.test(u.hostname)) return null;
      if (!u.pathname || u.pathname === '/') return null;
      u.protocol = 'https:'; u.search = ''; u.hash = '';
      return u.toString();
    } catch { return null; }
  }

  const idFromPath = (url) => {
    const m = url.match(/(?:video|photo)\/(\d{6,})/);
    return m ? m[1] : null;
  };
  const unescapeUrl = (s) => String(s).replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
  const safeName = (t) => {
    let b = String(t || '').replace(/#\S+/g, ' ').replace(/[^\w\- ]+/g, ' ')
      .trim().replace(/\s+/g, '_');
    if (b.length > 48) b = b.slice(0, 48);
    return b || 'tiktok_video';
  };
  const fmtDur = (s) => (s > 0 ? `${Math.floor(s / 60)}:${String(s % 60).padLeft(2, '0')}` : '');

  /* ── Direct TikTok pipeline (no proxies) ──────────────────────────────── */
  const fetchT = (url, ms = 15000) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    return fetch(url, { signal: c.signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
      .finally(() => clearTimeout(t));
  };

  function parseEmbed(html, meta) {
    const out = {
      video: null, alts: [], audio: null, internalId: null,
      cover: (meta && meta.thumbnail_url) || null,
      title: (meta && meta.title) || '',
      author: (meta && meta.author_name) || '',
      duration: 0,
    };
    const add = (u) => {
      if (!u || !/^https:\/\//i.test(u)) return;
      u = unescapeUrl(u);
      if (!out.alts.includes(u)) out.alts.push(u);
    };

    for (const [, , body] of html.matchAll(
      /<script[^>]*id=["'](SIGI_STATE|__INITIAL_PROPS__|UNIVERSAL_DATA_FOR_REHYDRATION)["'][^>]*>([\s\S]*?)<\/script>/g
    )) {
      let root; try { root = JSON.parse(body); } catch { continue; }
      const pools = [];
      const walk = (n) => {
        if (!n || typeof n !== 'object') return;
        if (Array.isArray(n)) return n.forEach(walk);
        for (const [k, v] of Object.entries(n)) {
          if (/^ItemModule/i.test(k) && v && typeof v === 'object') pools.push(Object.values(v));
          else walk(v);
        }
      };
      walk(root);
      for (const items of pools) for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const v = item.video || item;
        out.title = out.title || item.desc || item.title || '';
        const a = item.author || {};
        out.author = out.author || a.nickname || (a.uniqueId ? `@${a.uniqueId}` : '');
        out.cover = out.cover || v.cover || v.originCover || null;
        out.duration = out.duration || (v.duration > 1000 ? Math.round(v.duration / 1000) : (v.duration || 0));
        out.internalId = out.internalId || v.videoId || null;
        out.audio = out.audio || (item.music && (item.music.playUrl || item.music.playAddr)) || null;
        add(v.downloadAddr); add(v.playAddr);
        for (const b of (v.bitrateInfo || [])) for (const u of ((b.PlayAddr || {}).UrlList || [])) add(u);
      }
    }

    for (const [, u] of html.matchAll(/["'](playAddr|downloadAddr|playApi)["']\s*:\s*["'](https?:[^"']+)["']/g)) add(u);
    if (!out.internalId) {
      const m = html.match(/["']videoId["']\s*:\s*["'](v[0-9a-z]+)["']/i);
      if (m) out.internalId = m[1];
    }
    if (!out.audio) {
      const m = html.match(/["']playUrl["']\s*:\s*["'](https?:[^"']+?\.mp3[^"']*)["']/i);
      if (m) out.audio = unescapeUrl(m[1]);
    }

    if (out.internalId) {
      out.video = `https://api.tiktok.com/aweme/v1/play/?video_id=${encodeURIComponent(out.internalId)}` +
        '&line=0&ratio=default&watermark=0&media_type=4&logo_name=tiktok';
    }
    if (!out.video) out.video = out.alts[0] || null;
    return out;
  }

  async function resolveDirect(cleanUrl) {
    let meta = null;
    try {
      const r = await fetchT(`https://www.tiktok.com/oembed?url=${encodeURIComponent(cleanUrl)}`);
      if (r.ok) meta = await r.json();
    } catch { /* optional */ }

    let id = idFromPath(cleanUrl);
    if (!id && meta && typeof meta.html === 'string') {
      const m = meta.html.match(/embed\/v2\/(\d{6,})|data-video-id=["'](\d{6,})["']/);
      if (m) id = m[1] || m[2];
    }
    if (!id) throw new Error('NO_ID');

    let html = null;
    for (const p of [`/embed/v2/${id}`, `/embed/${id}`]) {
      try {
        const r = await fetchT(`https://www.tiktok.com${p}`);
        if (!r.ok) continue;
        const t = await r.text();
        if (/SIGI_STATE|videoData|playAddr|ItemModule/i.test(t)) { html = t; break; }
      } catch { /* next */ }
    }
    if (!html) throw new Error('EMBED_BLOCKED');

    const data = parseEmbed(html, meta);
    if (!data.video) throw new Error('NO_MEDIA');
    return data;
  }

  /* ── 3-second mock extraction (brief's demo behaviour) ────────────────── */
  const demo = () => new Promise((resolve) => setTimeout(() => resolve({
    title: 'Cyber-neon demo — extraction simulated (DEMO_MODE)',
    author: '@tikgrab',
    cover: null,
    duration: 15,
    internalId: 'demo',
    video: 'https://www.tiktok.com/',   // sample links for the demo card
    audio: 'https://www.tiktok.com/',
    alts: [],
  }), 3000));

  /* ── UI states ────────────────────────────────────────────────────────── */
  let busy = false;
  let alternates = [];

  const setLoading = (on) => {
    busy = on;
    els.get.classList.toggle('loading', on);
    els.get.disabled = on;
    els.url.disabled = on;
    els.format.disabled = on;
  };
  const showError = (msg) => { els.error.textContent = msg; els.error.hidden = false; };
  const hideError = () => { els.error.hidden = true; };

  function chip(text) {
    if (!text) return;
    const s = document.createElement('span');
    s.textContent = text;
    els.chips.appendChild(s);
  }

  function renderReady(v) {
    els.title.textContent = v.title || 'TikTok video';
    els.author.textContent = v.author || '';
    els.chips.innerHTML = '';
    chip(v.internalId && v.internalId !== 'demo' ? 'native stream' : 'cdn');
    chip(fmtDur(v.duration));
    if (v.audio) chip('mp3');

    els.thumb.innerHTML = '▶';
    if (v.cover) {
      const img = document.createElement('img');
      img.src = v.cover; img.alt = ''; img.referrerPolicy = 'no-referrer';
      img.onerror = () => img.remove();
      els.thumb.appendChild(img);
    }

    els.dlVideo.href = v.video;
    els.dlVideo.setAttribute('download', `${safeName(v.title)}.mp4`);
    if (v.audio) {
      els.dlMp3.style.display = '';
      els.dlMp3.href = v.audio;
      els.dlMp3.setAttribute('download', `${safeName(v.title)}.mp3`);
    } else {
      els.dlMp3.style.display = 'none';
    }

    alternates = (v.alts || []).filter((u) => u !== v.video);
    if (alternates.length) {
      els.dlAlt.hidden = false;
      els.dlAlt.href = alternates[0];
    } else {
      els.dlAlt.hidden = true;
    }

    // The format picked in the dropdown gets the emphasized halo.
    const chosen = els.format.value;
    els.dlVideo.classList.toggle('chosen', chosen === 'video');
    els.dlMp3.classList.toggle('chosen', chosen === 'mp3');

    els.ready.classList.add('show'); // frosted card slides down
  }

  /* ── "Get" click ──────────────────────────────────────────────────────── */
  async function onGet() {
    if (busy) return;
    const url = extractTikTokUrl(els.url.value);
    if (!url) {
      showError('paste a valid tiktok link — e.g. https://www.tiktok.com/@user/video/…');
      return;
    }
    els.url.value = url;
    hideError();
    els.ready.classList.remove('show');
    setLoading(true);

    const started = Date.now();
    try {
      const data = DEMO_MODE ? await demo() : await resolveDirect(url);
      // let the neon ring breathe for a beat (skip in demo — it already waits 3s)
      if (!DEMO_MODE) await sleep(Math.max(0, 900 - (Date.now() - started)));
      renderReady(data);
    } catch (err) {
      const m = err && err.message;
      showError(
        m === 'NO_ID'
          ? 'couldn\u2019t read the video id — paste the full …/video/<id> link.'
          : m === 'NO_MEDIA'
            ? 'no playable stream in tiktok\u2019s response (private / deleted / region-locked).'
            : 'tiktok refused the direct browser request — no proxies by design. retry in a moment.'
      );
    } finally {
      setLoading(false);
    }
  }

  els.get.addEventListener('click', onGet);
  els.url.addEventListener('keydown', (e) => e.key === 'Enter' && onGet());
  els.dlAlt.addEventListener('click', () => {
    if (!alternates.length) return;
    alternates.push(alternates.shift());
    els.dlAlt.href = alternates[0];
  });
})();
