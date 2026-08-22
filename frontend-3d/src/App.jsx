import { AnimatePresence, motion, useSpring, useMotionValue } from 'framer-motion'
import Scene from './Scene.jsx'
import {
  useTikGrab,
  useInstallPrompt,
  formatBytes,
  formatDuration,
} from './useTikGrab.js'

/* ────────────────────────────────────────────────────────────────────────────
 * The 3D canvas lives BEHIND this HTML overlay (the Awwwards technique):
 * all interactivity stays in cheap, accessible DOM; the GPU does the scenery.
 * ──────────────────────────────────────────────────────────────────────────── */

function TiltCard({ children, className = '' }) {
  const rx = useSpring(useMotionValue(0), { stiffness: 180, damping: 20 })
  const ry = useSpring(useMotionValue(0), { stiffness: 180, damping: 20 })

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width - 0.5
    const py = (e.clientY - r.top) / r.height - 0.5
    ry.set(px * 13) // tilt towards the mouse
    rx.set(-py * 9)
  }
  const onLeave = () => {
    rx.set(0)
    ry.set(0)
  }

  return (
    <motion.div
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{ rotateX: rx, rotateY: ry, transformStyle: 'preserve-3d' }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

const Chip = ({ show, children }) =>
  show ? (
    <span className="rounded-lg bg-white/10 px-2 py-1 text-[11px] font-semibold text-white/70">
      {children}
    </span>
  ) : null

const STEPS = [
  { n: 1, text: 'Open a video in TikTok and tap Share.' },
  { n: 2, text: 'Choose TikGrab from the share menu.' },
  { n: 3, text: 'Tap Save Video — the MP4 lands in your Downloads.' },
]

export default function App() {
  const { input, setInput, busy, phase, error, video, toasts, toast, resolve } = useTikGrab()
  const { canInstall, promptInstall } = useInstallPrompt()

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text && text.trim()) setInput(text.trim())
      else toast('Clipboard is empty')
    } catch {
      toast('Clipboard access denied — paste manually')
    }
  }

  return (
    <div className="relative min-h-dvh overflow-hidden">
      {/* ── 3D world (fixed, behind everything) ── */}
      <Scene />

      {/* ── UI overlay ── */}
      <main className="pointer-events-none relative z-10 mx-auto flex min-h-dvh w-full max-w-3xl flex-col items-center px-4 pb-16 pt-10 sm:pt-14">
        {/* Header */}
        <motion.header
          initial={{ opacity: 0, y: -24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
          className="text-center"
        >
          <div
            className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-[20px] text-3xl"
            style={{
              background: 'linear-gradient(135deg, #fe2c55, #ff6a88 55%, #25f4ee)',
              boxShadow: '0 12px 40px rgba(254,44,85,.45), 0 0 60px rgba(37,244,238,.2)',
            }}
          >
            ♪
          </div>
          <h1 className="grad-text text-5xl font-black tracking-tight sm:text-6xl">
            TikGrab
          </h1>
          <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-white/60 sm:text-[15px]">
            Share a TikTok here — or paste its link — and save the video{' '}
            <span className="font-semibold text-white">watermark-free.</span>
          </p>
        </motion.header>

        {/* ── Hero glass card (floats + tilts + dynamic shadow) ── */}
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 0.15, duration: 0.7, ease: 'easeOut' }}
          className="pointer-events-auto relative mt-10 w-full max-w-md"
          style={{ perspective: 1100 }}
        >
          {/* idle float */}
          <motion.div
            animate={{ y: [0, -12, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
            style={{ transformStyle: 'preserve-3d' }}
          >
            <TiltCard className="glass rounded-[28px] p-6 sm:p-7">
              <div style={{ transform: 'translateZ(45px)' }}>
                {/* Input row */}
                <div className="neon-input flex items-center gap-2 rounded-2xl px-4 py-1.5">
                  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" className="shrink-0 text-white/40">
                    <path d="M10.5 13.5a4 4 0 0 0 5.7.3l3-3a4 4 0 1 0-5.7-5.7l-1.2 1.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    <path d="M13.5 10.5a4 4 0 0 0-5.7-.3l-3 3a4 4 0 1 0 5.7 5.7l1.2-1.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && resolve(input)}
                    disabled={busy}
                    type="url"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck="false"
                    placeholder="Paste a TikTok link..."
                    aria-label="TikTok video link"
                    className="w-full bg-transparent py-3 text-sm text-white outline-none placeholder:text-white/35"
                  />
                  <button
                    onClick={paste}
                    disabled={busy}
                    title="Paste from clipboard"
                    aria-label="Paste from clipboard"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-[#25f4ee] transition hover:bg-[#25f4ee]/10 active:scale-90"
                  >
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none">
                      <rect x="6" y="4.5" width="12" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
                      <path d="M9.5 3.5h5v2.5h-5z" fill="currentColor" />
                      <path d="M9.5 12h5M9.5 15.5h3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>

                {/* 3D pill CTA */}
                <button
                  onClick={() => resolve(input)}
                  disabled={busy}
                  className="btn-3d mt-5 w-full px-6 py-4 text-[15px]"
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
                    <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {busy ? 'Working…' : 'Download video'}
                </button>

                {/* Status */}
                <AnimatePresence mode="wait">
                  {phase === 'resolving' && (
                    <motion.div
                      key="resolving"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-5 flex items-center gap-3 text-sm text-white/70">
                        <div className="spinner-3d" />
                        Fetching the watermark-free MP4 link…
                      </div>
                    </motion.div>
                  )}
                  {phase === 'error' && (
                    <motion.div
                      key="error"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-5 rounded-xl border border-[#ff5a6a]/35 bg-[#ff5a6a]/10 px-4 py-3 text-[13px] leading-relaxed text-[#ffb3bb]">
                        {error}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </TiltCard>
          </motion.div>

          {/* dynamic soft shadow on the floor */}
          <motion.div
            aria-hidden="true"
            className="card-shadow mx-auto -mt-4 h-10 w-3/4"
            animate={{ scale: [1, 0.88, 1], opacity: [0.6, 0.38, 0.6] }}
            transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
          />
        </motion.div>

        {/* ── Result card ── */}
        <AnimatePresence>
          {video && (
            <motion.section
              initial={{ opacity: 0, y: 34, rotateX: 14 }}
              animate={{ opacity: 1, y: 0, rotateX: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ type: 'spring', stiffness: 130, damping: 17 }}
              className="pointer-events-auto mt-6 w-full max-w-md"
              style={{ perspective: 900 }}
            >
              <TiltCard className="glass rounded-[24px] p-5">
                <div style={{ transform: 'translateZ(35px)' }}>
                  <div className="flex gap-4">
                    <div className="grid h-[92px] w-[66px] shrink-0 place-items-center overflow-hidden rounded-xl bg-white/10 text-white/40">
                      {video.cover ? (
                        <img
                          src={video.cover}
                          alt="Video thumbnail"
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover"
                          onError={(e) => e.currentTarget.remove()}
                        />
                      ) : (
                        '▶'
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="line-clamp-3 text-sm font-semibold leading-snug text-white/90">
                        {video.title || 'TikTok video'}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Chip show={video.extras?.authorNickname || video.extras?.authorUsername}>
                          {video.extras?.authorNickname || `@${video.extras?.authorUsername}`}
                        </Chip>
                        <Chip show={formatDuration(video.extras?.durationSeconds)}>
                          {formatDuration(video.extras?.durationSeconds)}
                        </Chip>
                        <Chip show={formatBytes(video.extras?.sizeBytes)}>
                          {formatBytes(video.extras?.sizeBytes)}
                        </Chip>
                        <Chip show={video.extras?.quality}>{video.extras?.quality}</Chip>
                      </div>
                    </div>
                  </div>

                  {/* Native download via the forced-download proxy */}
                  <a
                    href={`/api/proxy-download?url=${encodeURIComponent(video.downloadUrl)}`}
                    onClick={() => toast('Download started — check your download notification')}
                    className="btn-3d btn-3d-cyan mt-5 w-full px-6 py-3.5 text-[15px] no-underline"
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
                      <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Save Video (.MP4)
                  </a>
                  <div className="mt-3 text-center text-[11px] text-white/40">
                    Saves natively to your device as tiktok_video.mp4
                  </div>
                  <a
                    href={video.downloadUrl}
                    target="_blank"
                    rel="noopener"
                    className="mt-2 block text-center text-xs text-[#25f4ee]/80 hover:text-[#25f4ee]"
                  >
                    Open the direct CDN link instead
                  </a>
                </div>
              </TiltCard>
            </motion.section>
          )}
        </AnimatePresence>

        {/* ── 3D step tiles ── */}
        <div
          className="mt-14 grid w-full max-w-2xl grid-cols-1 gap-4 sm:grid-cols-3"
          style={{ perspective: 900 }}
        >
          {STEPS.map((s, i) => (
            <motion.div
              key={s.n}
              initial={{ opacity: 0, y: 50, rotateX: 20 }}
              whileInView={{ opacity: 1, y: 0, rotateX: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              whileHover={{ y: -10, scale: 1.05 }}
              transition={{ delay: i * 0.12, type: 'spring', stiffness: 120, damping: 16 }}
              className="glass-tile pointer-events-auto rounded-2xl p-5"
              style={{ transformStyle: 'preserve-3d' }}
            >
              <div
                className="mx-auto grid h-9 w-9 place-items-center rounded-xl text-sm font-black text-[#25f4ee]"
                style={{
                  background: 'linear-gradient(135deg, rgba(254,44,85,.3), rgba(37,244,238,.22))',
                  border: '1px solid rgba(255,255,255,.12)',
                  transform: 'translateZ(25px)',
                }}
              >
                {s.n}
              </div>
              <p className="mt-3 text-center text-[13px] leading-relaxed text-white/65">{s.text}</p>
            </motion.div>
          ))}
        </div>

        <footer className="mt-12 max-w-sm text-center text-[11px] leading-relaxed text-white/35">
          For personal use only — respect creators’ rights and TikTok’s Terms of Service.
        </footer>
      </main>

      {/* ── Install pill ── */}
      <AnimatePresence>
        {canInstall && (
          <motion.button
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 30 }}
            onClick={promptInstall}
            className="glass fixed bottom-5 right-5 z-20 rounded-full px-5 py-3 text-sm font-bold text-[#25f4ee]"
          >
            ⤓ Install App
          </motion.button>
        )}
      </AnimatePresence>

      {/* ── Toasts ── */}
      <div className="pointer-events-none fixed bottom-20 left-1/2 z-30 -translate-x-1/2 space-y-2">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 16, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="glass rounded-xl px-4 py-2.5 text-[13px] text-white/90"
            >
              {t.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}
