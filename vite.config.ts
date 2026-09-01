import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves project sites from /<repo>/, so the base path must match
// the repository name. Override with BASE_PATH=/ for a user/organisation site.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/3DFrames/',
  plugins: [react()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  worker: { format: 'es' },
})
