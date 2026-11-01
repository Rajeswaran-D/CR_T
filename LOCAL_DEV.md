# Local Development Guide — CIRCOR E2E Order Tracker

## Required software

| Component | Version used | Notes |
|---|---|---|
| Node.js | v22.x (tested: 22.19.0) | npm 10.x |
| MySQL Server | 9.7 (Windows service `MySQL97`) | any MySQL 8+ compatible server |
| npm packages | from `package-lock.json` | run `npm install` once |

## Required local MySQL service & database

- Service: `MySQL97` on `127.0.0.1:3306` (start it: `Start-Service MySQL97`, may require elevation)
- Database: `circor_e2e_dev`
- Application user: `cft_app` with standard privileges (DML + CREATE/ALTER/INDEX on `circor_e2e_dev` only)
- Credentials live **only** in the git-ignored root `.env` — never commit or print them

Verify connectivity any time (read-only, prints no secrets):

```powershell
npm run db:check
```

## Required environment variables (names only — values stay in `.env`)

Frontend (Vite, exposed to the browser — must never contain secrets):
- `VITE_STORAGE_PROVIDER` (local)
- `VITE_STORAGE_API_BASE_URL` (/api)
- `VITE_ORGANIZATION_ID` (local-development)

Backend (server-side only):
- `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`
- Optional: `MYSQL_SSL_CA_PATH` / `MYSQL_SSL_CA` (TLS CA for cloud DBs), `PORT`, `CORS_ORIGINS`,
  `RATE_LIMIT_PER_MIN`, `ENABLE_SCHEMA_ADMIN` + `SCHEMA_ADMIN_TOKEN` (schema DDL endpoint, off by default)

The backend loads **only** the repo-root `.env` (path is anchored to `server/db.ts`, so the
shell's working directory does not matter). `.env.production` is a deployment handover template
and is **never** loaded by local processes. `npm run dev` (Vite dev mode) also loads only
`.env` + `.env.local`; `npm run build` reads `.env.production` for production values.

## Startup order (two terminals)

```powershell
# Terminal 1 — backend (http://localhost:3001)
npm run server

# Terminal 2 — frontend (http://localhost:5173)
npm run dev
```

Stop with `Ctrl+C` in each terminal. Frontend requests go to `/api` → Vite proxy → `localhost:3001`.

## Health checks

```powershell
Invoke-RestMethod http://localhost:3001/api/health        # status: healthy | degraded | fallback
Invoke-RestMethod http://localhost:3001/api/db/status     # target host/port/db, TLS, schema tables
npm run db:check                                          # independent direct-MySQL check
```

Meaning of `status`/`mode`:
- `healthy` — MySQL configured and connected; reads/writes hit `circor_e2e_dev`
- `degraded` — MySQL configured but unreachable; API reads/writes return **503** (no silent fallback)
- `fallback` — MySQL intentionally not configured; memory + `~/.cft-project-e2e-tracker-shared-state.json` only

## Organization identity

All data endpoints require a valid `X-Organization-Id` header (local value:
`local-development`). Missing/invalid header → `400` (fail-closed; it never defaults to another
organization). Note: this is a routing/tenant-scoping mechanism, **not** user authentication —
there is no login system yet; do not treat the API as production-secure on this basis.

## Common errors

| Symptom | Cause | Fix |
|---|---|---|
| Proxy 502 `Backend unavailable` | Backend not running | `npm run server` |
| API 503 `Database ... unavailable` | MySQL service stopped | `Start-Service MySQL97` (elevated), then `npm run db:check` |
| Startup warn `INCOMPLETE config — missing: …` | `.env` incomplete | Restore the named variables in `.env` |
| `Access denied for user 'cft_app'` | Wrong local password/grant | Re-check `MYSQL_PASSWORD` in `.env`; verify grants locally |
| Port already in use (5173/3001) | Leftover process | Find with `Get-NetTCPConnection -LocalPort 3001` and stop it |

## Resetting test data safely

- Synthetic test rows use ids/po numbers prefixed `LOCAL_SETUP_TEST_`. Delete them with
  `DELETE /api/orders/<id>` (or `DELETE FROM purchase_orders WHERE id LIKE 'LOCAL_SETUP_TEST_%'`
  scoped to `circor_e2e_dev` on 127.0.0.1).
- Never run DDL/DML against production hosts. Schema initialization via HTTP is disabled unless
  `ENABLE_SCHEMA_ADMIN=true` **and** `SCHEMA_ADMIN_TOKEN` (≥16 chars) is set and presented.

## Quality gates

```powershell
npx tsc -b                    # frontend + vite config type check
npx tsc -p tsconfig.server.json   # backend type check
npm run lint                  # oxlint
npm run build                 # tsc -b + production bundle
```
