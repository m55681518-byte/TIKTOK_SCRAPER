import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Built output lands in ../tiktok-downloader-pwa/public (the Express server's
// static root) via `npm run ship` — see package scripts in the repo README.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1800, // three.js is chunky; expected
  },
})
