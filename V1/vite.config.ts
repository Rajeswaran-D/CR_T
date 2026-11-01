import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Plugin } from 'vite'

function sharedStatePlugin(): Plugin {
  const stateFile = path.join(os.homedir(), '.cft-project-e2e-tracker-shared-state.json')
  let state: Record<string, unknown> = {}

  try {
    if (fs.existsSync(stateFile)) state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  } catch {
    state = {}
  }

  return {
    name: 'cft-shared-state',
    configureServer(server) {
      server.middlewares.use('/api/shared-state', (req, res, next) => {
        if (req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(state))
          return
        }

        if (req.method !== 'PUT') {
          next()
          return
        }

        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', () => {
          try {
            const update = JSON.parse(body) as Record<string, unknown>
            state = { ...state, ...update }
            fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8')
            res.statusCode = 204
            res.end()
          } catch {
            res.statusCode = 400
            res.end('Invalid shared state payload')
          }
        })
      })
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    sharedStatePlugin(),
  ],
})
