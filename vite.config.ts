import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync('./package.json', 'utf8'))
// GitHub Actions exposes the commit it is building; locally there isn't one.
const commit = process.env.GITHUB_SHA?.slice(0, 7) ?? 'dev'

// GitHub Pages serves project sites from /<repo>/, so the base path must match
// the repository name. Override with BASE_PATH=/ for a user/organisation site.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/3DFrames/',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_COMMIT__: JSON.stringify(commit),
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  worker: { format: 'es' },
})
