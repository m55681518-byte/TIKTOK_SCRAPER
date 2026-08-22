import { useCallback, useEffect, useRef, useState } from 'react'

/* ────────────────────────────────────────────────────────────────────────────
 * Core TikGrab logic, ported from the 2D app:
 *  • Web Share Target: read ?shared/?url/?text/?title, clean the address bar,
 *    auto-resolve (zero taps after sharing).
 *  • Manual: paste → POST /api/download → result card.
 *  • Save: anchor → GET /api/proxy-download (native Android download).
 * ──────────────────────────────────────────────────────────────────────────── */

const TIKTOK_RE = /https?:\/\/(?:www\.|m\.|vm\.|vt\.)?tiktok\.com\/[^\s"'<>()]+/i
const TIKTOK_HOST_RE = /(^|\.)tiktok\.com$/i

export function extractTikTokUrl(text) {
  if (!text || typeof text !== 'string') return null
  const trimmed = text.trim()
  if (!trimmed) return null
  const match = trimmed.match(TIKTOK_RE)
  const candidate = match ? match[0] : trimmed
  try {
    const u = new URL(candidate)
    if (!TIKTOK_HOST_RE.test(u.hostname)) return null
    if (!u.pathname || u.pathname === '/') return null
    u.protocol = 'https:'
    u.search = ''
    u.hash = ''
    return u.toString()
  } catch {
    return null
  }
}

export function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return ''
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`
  if (mb >= 1) return `${mb.toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

export function formatDuration(sec) {
  if (!sec || sec <= 0) return ''
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

export function useTikGrab() {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState('idle') // idle | resolving | error
  const [error, setError] = useState('')
  const [video, setVideo] = useState(null)
  const [toasts, setToasts] = useState([])
  const idRef = useRef(0)

  const toast = useCallback((message, ms = 3000) => {
    const id = ++idRef.current
    setToasts((t) => [...t, { id, message }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms)
  }, [])

  const resolve = useCallback(
    async (raw) => {
      if (busy) return
      const url = extractTikTokUrl(raw)
      if (!url) {
        setPhase('error')
        setError('Please share or paste a valid TikTok video link, e.g. https://vm.tiktok.com/…')
        return
      }
      setInput(url)
      setVideo(null)
      setBusy(true)
      setPhase('resolving')
      try {
        const resp = await fetch('/api/download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        })
        let data = null
        try {
          data = await resp.json()
        } catch {
          /* non-JSON */
        }
        if (!resp.ok || !data || data.success === false || !data.downloadUrl) {
          throw new Error(
            (data && data.error && data.error.message) || `Request failed (HTTP ${resp.status})`
          )
        }
        setVideo(data)
        setPhase('idle')
        toast('Ready — tap “Save Video (.MP4)”')
      } catch (err) {
        setPhase('error')
        setError(err.message || 'Unknown error')
      } finally {
        setBusy(false)
      }
    },
    [busy, toast]
  )

  /* Web Share Target: shared links arrive as query params */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (![...params.keys()].length) return
    const candidate =
      params.get('shared') || params.get('url') || params.get('text') || params.get('title') || ''
    window.history.replaceState({}, '', window.location.pathname)
    const url = extractTikTokUrl(candidate)
    if (url) {
      resolve(url)
    } else if (candidate.trim()) {
      setInput(candidate.trim())
      toast("Couldn't find a TikTok link in the shared text")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { input, setInput, busy, phase, error, video, toasts, toast, resolve }
}

/* Native install prompt (Android "Add to Home Screen") */
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState(null)
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    const onPrompt = (e) => {
      e.preventDefault()
      setDeferred(e)
    }
    const onInstalled = () => {
      setInstalled(true)
      setDeferred(null)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const promptInstall = useCallback(async () => {
    if (!deferred) return
    deferred.prompt()
    await deferred.userChoice
    setDeferred(null)
  }, [deferred])

  return { canInstall: !!deferred && !installed, promptInstall }
}
