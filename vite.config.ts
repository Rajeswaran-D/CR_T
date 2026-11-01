import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// NOTE: this dev server previously contained a "dev fallback" that answered
// /api/* requests with fabricated 200/204 responses (backed by a local JSON
// state file) whenever the Express backend was unreachable — i.e. it reported
// successful saves that never reached the database. That fallback has been
// removed: a dead backend now produces an explicit 502 JSON error so the UI
// can show offline/failed state instead of a false success.

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, res) => {
            console.error(`[vite-proxy] Backend at http://localhost:3001 unreachable: ${err.message}`);
            // Honest failure: never fabricate a success for a dead backend.
            if (res && 'writeHead' in res && !res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                error: 'Backend unavailable. Start it with "npm run server" (expected at http://localhost:3001).',
                devProxy: true
              }));
            }
          });
        }
      }
    }
  }
})
