/**
 * ============================================================================
 *  TikGrab PWA — app.js (vanilla JS, no build step)
 * ============================================================================
 *  Responsibilities:
 *    1. Web Share Target: read the shared TikTok link from the URL query
 *       string (?text=…&url=…&title=… or our own ?shared=… redirect) and
 *       auto-start the resolve flow.
 *    2. Manual flow: paste a link → resolve via POST /api/download.
 *    3. Save: the "Save Video (.MP4)" button is a REAL ANCHOR pointing at
 *       GET /api/proxy-download?url=… — the server answers with
 *       `Content-Disposition: attachment; filename="tiktok_video.mp4"`, so
 *       the Android browser saves the file NATIVELY to device storage
 *       (Downloads/) with its own download progress, instead of opening
 *       the CDN link in a tab.
 *    4. Native install prompt banner (beforeinstallprompt).
 *    5. Service-worker registration (offline app shell + installability).
 * ============================================================================
 */

'use strict';

(() => {
  /* ── Elements ─────────────────────────────────────────────────────────── */
  const $ = (id) => document.getElementById(id);
  const els = {
    urlInput: $('url-input'),
    pasteBtn: $('paste-btn'),
    downloadBtn: $('download-btn'),

    statusCard: $('status-card'),
    rowResolving: $('row-resolving'),
    rowError: $('row-error'),
    errorMsg: $('error-msg'),

    resultCard: $('result-card'),
    thumb: $('result-thumb'),
    title: $('result-title'),
    chipAuthor: $('chip-author'),
    chipDuration: $('chip-duration'),
    chipSize: $('chip-size'),
    chipQuality: $('chip-quality'),
    saveBtn: $('save-btn'),
    directLink: $('direct-link'),

    installBanner: $('install-banner'),
    installBtn: $('install-btn'),
    installDismiss: $('install-dismiss'),
  };

  /* ── State ────────────────────────────────────────────────────────────── */
  const state = {
    busy: false,
    video: null, // { downloadUrl, title, cover, extras }
  };

  /* ── URL helpers ──────────────────────────────────────────────────────── */
  const TIKTOK_RE = /https?:\/\/(?:www\.|m\.|vm\.|vt\.)?tiktok\.com\/[^\s"'<>()]+/i;
  const TIKTOK_HOST_RE = /(^|\.)tiktok\.com$/i;

  /** Extracts a cleaned TikTok link from any shared/pasted text. */
  function extractTikTokUrl(text) {
    if (!text || typeof text !== 'string') return null;
    const trimmed = text.trim();
    if (!trimmed) return null;

    const match = trimmed.match(TIKTOK_RE);
    const candidate = match ? match[0] : trimmed;
    try {
      const u = new URL(candidate);
      if (!TIKTOK_HOST_RE.test(u.hostname)) return null;
      if (!u.pathname || u.pathname === '/') return null;
      // Clean: https only, drop ALL tracking params + fragment.
      u.protocol = 'https:';
      u.search = '';
      u.hash = '';
      return u.toString();
    } catch {
      return null;
    }
  }

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
    if (mb >= 1) return `${mb.toFixed(1)} MB`;
    return `${Math.round(bytes / 1024)} KB`;
  }

  function formatDuration(sec) {
    if (!sec || sec <= 0) return '';
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  }

  /* ── UI state helpers ─────────────────────────────────────────────────── */
  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }

  function setPhase(phase) {
    hide(els.rowResolving);
    hide(els.rowError);
    if (phase === 'idle') {
      hide(els.statusCard);
      return;
    }
    show(els.statusCard);
    if (phase === 'resolving') show(els.rowResolving);
    if (phase === 'error') show(els.rowError);
  }

  function setBusy(busy) {
    state.busy = busy;
    els.downloadBtn.disabled = busy;
    els.urlInput.disabled = busy;
    els.pasteBtn.disabled = busy;
  }

  function toast(message, ms = 3000) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  /* ── API: resolve link → MP4 metadata ─────────────────────────────────── */
  async function resolveVideo(url) {
    const resp = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    let data = null;
    try { data = await resp.json(); } catch { /* non-JSON error */ }

    if (!resp.ok || !data || data.success === false) {
      const msg = data && data.error && data.error.message;
      throw new Error(msg || `Request failed (HTTP ${resp.status})`);
    }
    if (!data.downloadUrl) {
      throw new Error('The backend did not return a downloadable video link.');
    }
    return data;
  }

  /* ── Result rendering ─────────────────────────────────────────────────── */
  function renderResult(video) {
    state.video = video;

    els.title.textContent = video.title || 'TikTok video';

    // Thumbnail (fallback icon stays if the image fails).
    els.thumb.innerHTML = '';
    if (video.cover) {
      const img = document.createElement('img');
      img.src = video.cover;
      img.alt = 'Video thumbnail';
      img.referrerPolicy = 'no-referrer';
      img.onerror = () => img.remove();
      els.thumb.appendChild(img);
    }

    const x = video.extras || {};
    setChip(els.chipAuthor, x.authorNickname || (x.authorUsername ? `@${x.authorUsername}` : ''));
    setChip(els.chipDuration, formatDuration(x.durationSeconds));
    setChip(els.chipSize, formatBytes(x.sizeBytes));
    setChip(els.chipQuality, x.quality || '');

    // The Save button POINTS at the forced-download proxy. Tapping it makes
    // the browser navigate to our origin, which answers with
    // Content-Disposition: attachment → Android saves tiktok_video.mp4
    // natively to Downloads/ (with the system download progress).
    els.saveBtn.href =
      `/api/proxy-download?url=${encodeURIComponent(video.downloadUrl)}`;

    // Escape hatch: raw CDN link (may open in a tab on some browsers).
    els.directLink.href = video.downloadUrl;
    show(els.directLink);
    show(els.resultCard);
  }

  function setChip(el, text) {
    if (text) { el.textContent = text; show(el); } else { hide(el); }
  }

  function hideResult() {
    state.video = null;
    hide(els.resultCard);
    hide(els.directLink);
  }

  /* ── Main flow ────────────────────────────────────────────────────────── */
  async function startFlow(rawInput) {
    if (state.busy) return;

    const url = extractTikTokUrl(rawInput);
    if (!url) {
      setPhase('error');
      els.errorMsg.textContent =
        'Please share or paste a valid TikTok video link, e.g. https://vm.tiktok.com/…';
      return;
    }

    els.urlInput.value = url;
    hideResult();
    setBusy(true);
    setPhase('resolving');

    try {
      const video = await resolveVideo(url);
      renderResult(video);
      setPhase('idle');
      toast('Ready — tap "Save Video (.MP4)"');
    } catch (err) {
      setPhase('error');
      els.errorMsg.textContent = err.message || 'Unknown error';
    } finally {
      setBusy(false);
    }
  }

  /* ── 1) Web Share Target: shared links arrive as query params ─────────── */
  function handleIncomingShare() {
    const params = new URLSearchParams(location.search);
    if (![...params.keys()].length) return;

    // Chrome sends `text` (caption) and/or `url`; our /share-target redirect
    // uses `shared`. Check the most specific first.
    const candidate =
      params.get('shared') ||
      params.get('url') ||
      params.get('text') ||
      params.get('title') ||
      '';

    // Clean the address bar so a refresh doesn't re-trigger the flow.
    history.replaceState({}, '', location.pathname);

    const url = extractTikTokUrl(candidate);
    if (url) {
      startFlow(url); // auto-download: zero taps after sharing
    } else if (candidate.trim()) {
      els.urlInput.value = candidate.trim();
      toast("Couldn't find a TikTok link in the shared text");
    }
  }

  /* ── 2) Manual events ─────────────────────────────────────────────────── */
  els.downloadBtn.addEventListener('click', () => startFlow(els.urlInput.value));
  els.urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startFlow(els.urlInput.value);
  });

  els.pasteBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        els.urlInput.value = extractTikTokUrl(text) || text.trim();
      } else {
        toast('Clipboard is empty');
      }
    } catch {
      toast('Clipboard access denied — paste manually');
      els.urlInput.focus();
    }
  });

  // NOTE: no preventDefault here on purpose — the anchor must navigate to
  // /api/proxy-download so the browser performs the NATIVE download.
  els.saveBtn.addEventListener('click', () => {
    toast('Download started — check your download notification');
  });

  /* ── 3) Native install prompt (Android "Add to Home Screen") ──────────── */
  let deferredPrompt = null;

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    navigator.standalone === true;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we show our own, nicer banner
    deferredPrompt = e;
    if (!isStandalone && !sessionStorage.getItem('tikgrab-install-dismissed')) {
      show(els.installBanner);
    }
  });

  els.installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') hide(els.installBanner);
    deferredPrompt = null;
  });

  els.installDismiss.addEventListener('click', () => {
    hide(els.installBanner);
    sessionStorage.setItem('tikgrab-install-dismissed', '1');
  });

  window.addEventListener('appinstalled', () => {
    hide(els.installBanner);
    toast('✓ TikGrab installed');
  });

  /* ── 4) Service worker (offline shell + installability) ───────────────── */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('Service worker registration failed:', err);
      });
    });
  }

  /* ── Boot ─────────────────────────────────────────────────────────────── */
  handleIncomingShare();
})();
