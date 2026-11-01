# CFT Tracker — Org Server Handover (DEPLOY.md)

> Local workflow is untouched. `npm run dev` + `docker compose up` still work
> with defaults. This file is only for the organization server + Cloud MySQL.

## 1. What the org must provide

| Variable | Required | Example |
|---|---|---|
| `MYSQL_HOST` | yes | `cloud-mysql.internal` |
| `MYSQL_PORT` | no (default `3306`) | `3306` |
| `MYSQL_DATABASE` | no (default `cft_tracker`) | `cft_tracker` |
| `MYSQL_USER` | yes | `cft_app` |
| `MYSQL_PASSWORD` | yes (secret manager) | `***` |
| `PORT` | no (default `3001`) | `3001` |
| `VITE_STORAGE_API_BASE_URL` | no (default `/api`) | `https://tracker.cicor.example/api` |
| `VITE_ORGANIZATION_ID` | no | `circor-flow-technologies` |

`VITE_*` values are **baked at `npm run build`**. If the org host differs,
rebuild: `VITE_STORAGE_API_BASE_URL=https://<org-host>/api npm run build`.

## 2. First-time schema init (org DBA, once)

Do NOT use `POST /api/db/init-schema` on cloud DB (it naively splits on `;`).
Run manually:

```bash
mysql -h <MYSQL_HOST> -u <MYSQL_USER> -p <MYSQL_DATABASE> < database/mysql-schema.sql
```

Schema is in `database/mysql-schema.sql` (MySQL 8 / InnoDB, org-scoped tables).

## 3. Deploy options

**A. Local dev (unchanged):**
```bash
npm install
npm run dev            # Vite :5173 + shared-state stub
# or
docker compose up --build
```

**B. Org server with Cloud MySQL:**
```bash
MYSQL_HOST=<cloud-host> MYSQL_USER=<org-user> \
MYSQL_PASSWORD=<org-secret> MYSQL_DATABASE=cft_tracker \
VITE_STORAGE_API_BASE_URL=https://<org-host>/api \
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f app
curl http://localhost:3001/api/health
```

## 4. Data migration (local JSON -> cloud)

Local dev persists to `~/.cft-project-e2e-tracker-shared-state.json`
(or `STATE_FILE_PATH` in prod compose). To seed cloud:

1. Open app locally -> Bulk Import -> Download CSV template.
2. Re-import rows on the org deployment, or hand the JSON file to backend
   adapter author to map `cft_pos / cft_products / cft_templates /
   cft_rectifications / cft_audit / cft_config` (see
   `src/services/storageContract.ts: STORAGE_KEYS`) into MySQL tables.

## 5. Known placeholders for org backend team

- `src/components/layout/Sidebar.tsx` — Role Switcher is dev-only.
  Replace with authenticated session (`TODO` in code).
- `src/context/AppContext.tsx` — `activeRole` is client-only until JWT/SSO.
- `server/server.ts: GET /api/shared-state` — `X-Organization-Id` is read but
  not enforced yet. Enforce `WHERE organization_id = req.orgId` from trusted
  auth, never from client alone. Current storage is last-write-wins JSON;
  replace with `GET/PATCH /api/orders`, `/api/milestones/:id` + transactions.
- `CORS origin '*'` in `server/server.ts` is dev-only — whitelist org domain.
- Secrets: `.env.production` / `Book2.xlsx` are now git-ignored. Never commit
  real `MYSQL_PASSWORD`. History still contains old placeholder
  `cft_secret_password` — rotate on first deploy (`git log -p` will show it).

## 6. Verify handover

```bash
npm run lint   # expect 0 errors (30 pre-existing warnings, safe to defer)
npm run build  # expect dist/ in ~2s, single-chunk ~1MB warning is known
```
