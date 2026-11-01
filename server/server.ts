import express, { Request, Response, NextFunction } from 'express';
import compression from 'compression';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { getDbPool, isDbConnected, isDbConfigured, getDbEnvStatus, getSafeDbConfig, closeDbPool } from './db';
import {
  initSchema,
  verifySchema,
  saveOrdersToDb,
  loadOrdersFromDb,
  deleteOrderFromDb,
  saveProductsToDb,
  loadProductsFromDb,
  saveAuditLogsToDb,
  loadAuditLogsFromDb,
  saveRectificationsToDb,
  loadRectificationsFromDb,
  saveConfigToDb,
  loadConfigFromDb,
  saveCancellationsToDb,
  loadCancellationsFromDb,
  saveTemplatesToDb,
  loadTemplatesFromDb,
  DEFAULT_ORG_ID
} from './mysqlAdapter';
import {
  requireOrg,
  requireSchemaAdmin,
  corsGuard,
  rateLimiter,
  securityHeaders,
  logInternal,
  sendServerError,
  validateOrderBody,
  validateConfigBody
} from './security';
import type { PurchaseOrder, ProductMasterItem, CategoryTemplate, RectificationAction, AuditLogEntry, SystemConfig, CancellationRequest } from '../src/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load the repository-local .env from a path anchored to this file so the
// backend always reads the intended local environment file, regardless of the
// shell's working directory. `.env.production` is NEVER loaded here.
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3001;
const stateFile = process.env.STATE_FILE_PATH || path.join(os.homedir(), '.cft-project-e2e-tracker-shared-state.json');
const SHARED_STATE_CACHE_TTL_MS = 1_000;
type SharedStatePayload = Record<string, unknown>;
const sharedStateCache = new Map<string, {
  expiresAt: number;
  payload?: SharedStatePayload;
  pending?: Promise<SharedStatePayload>;
}>();

const invalidateSharedStateCache = (orgId: string) => {
  sharedStateCache.delete(orgId);
};

async function loadSharedStateSnapshot(orgId: string): Promise<SharedStatePayload> {
  const now = Date.now();
  const cached = sharedStateCache.get(orgId);
  if (cached?.payload && cached.expiresAt > now) return cached.payload;
  if (cached?.pending) return cached.pending;

  const pending = (async (): Promise<SharedStatePayload> => {
    const pool = await resolveReadPool();
    if (pool) {
      const [orders, products, templates, audit, rects, config, cancellations] = await Promise.all([
        loadOrdersFromDb(pool, orgId),
        loadProductsFromDb(pool, orgId),
        loadTemplatesFromDb(pool, orgId),
        loadAuditLogsFromDb(pool, orgId),
        loadRectificationsFromDb(pool, orgId),
        loadConfigFromDb(pool, orgId),
        loadCancellationsFromDb(pool, orgId)
      ]);

      const state: SharedStatePayload = {
        cft_pos: stripTombstonedOrders(orders),
        cft_products: products,
        cft_templates: templates,
        cft_audit: audit,
        cft_rectifications: rects,
        cft_cancellations: cancellations
      };
      if (config) state.cft_config = config;
      return state;
    }

    if (Array.isArray(memoryState.cft_pos)) {
      memoryState.cft_pos = stripTombstonedOrders(memoryState.cft_pos as PurchaseOrder[]);
    }
    return { ...memoryState };
  })();

  sharedStateCache.set(orgId, { expiresAt: now + SHARED_STATE_CACHE_TTL_MS, pending });
  try {
    const payload = await pending;
    sharedStateCache.set(orgId, { expiresAt: Date.now() + SHARED_STATE_CACHE_TTL_MS, payload });
    return payload;
  } catch (error) {
    sharedStateCache.delete(orgId);
    throw error;
  }
}

/**
 * Thrown whenever MySQL is configured but cannot serve the request. Mapped to
 * a generic 503 by the error handler — the application must never pretend a
 * failed database read/write succeeded.
 */
class DbUnavailableError extends Error {
  constructor() {
    super('Database unavailable');
    this.name = 'DbUnavailableError';
  }
}

/** Maps handler errors to honest, non-leaking HTTP responses. */
function handleErr(scope: string, res: Response, err: unknown): void {
  if (err instanceof DbUnavailableError) {
    sendServerError(res, 503, 'Database is configured but unavailable. The request was NOT persisted.');
    return;
  }
  logInternal(scope, err);
  sendServerError(res);
}

// Performance optimizations: gzip/brotli compression, security headers,
// CORS allowlist, rate limiting, json body parser (30mb cap).
app.use(compression({
  threshold: 1024,
  level: 6
}));

app.use(securityHeaders);
app.use(corsGuard);
app.use(rateLimiter);
app.use(express.json({ limit: '30mb' }));

// Organization identity is required on every data endpoint. A missing or
// invalid X-Organization-Id header is rejected (fail-closed) — it never
// silently falls back to another organization. Health/status endpoints stay
// unauthenticated for local probing; they expose no row data.
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  if (req.path === '/health' || req.path === '/db/status') {
    next();
    return;
  }
  requireOrg(req, res, next);
});

// In-Memory Fast Cache for sub-millisecond responses
let memoryState: Record<string, unknown> = {};
let isDirty = false;

// Load initial state from disk
try {
  if (fs.existsSync(stateFile)) {
    memoryState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    console.log(`[Storage] Initial state loaded from ${stateFile} (${Object.keys(memoryState).length} keys)`);
  }
} catch (err: any) {
  console.warn(`[Storage] Could not read existing state file: ${err.message}. Initializing empty.`);
  memoryState = {};
}

// Debounced background sync to disk
function scheduleStateSave() {
  if (isDirty) return;
  isDirty = true;
  setTimeout(() => {
    try {
      fs.writeFileSync(stateFile, JSON.stringify(memoryState, null, 2), 'utf8');
      isDirty = false;
    } catch (err: any) {
      console.error(`[Storage Error] Failed to write state to disk: ${err.message}`);
      isDirty = false;
    }
  }, 100);
}

function getOrgId(req: Request): string {
  return (req.headers['x-organization-id'] as string) || DEFAULT_ORG_ID;
}

// ---------------------------------------------------------------------------
// Deleted-order tombstones — make a delete stick everywhere.
// A tombstone blocks ANY later re-insert of the same order id. This matters
// because shared-state sync and POST/PUT all UPSERT: a stale tab can push a
// pre-delete cft_pos snapshot and silently resurrect the MySQL row. Reads also
// filter tombstoned ids, so even if a row sneaks back it can never render.
// Tombstones live in the state file (survive restarts) and clear when the
// same id is re-created via POST /api/orders. After TTL they lapse by design.
// ---------------------------------------------------------------------------
const TOMBSTONE_KEY = '__deleted_order_ids__';
const TOMBSTONE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const TOMBSTONE_MAX = 1000;

function getTombstones(): Record<string, string> {
  const raw = memoryState[TOMBSTONE_KEY];
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? { ...(raw as Record<string, string>) }
    : {};
}

function pruneTombstones(map: Record<string, string>): Record<string, string> {
  const cutoff = Date.now() - TOMBSTONE_TTL_MS;
  let entries = Object.entries(map).filter(([, ts]) => {
    const t = Date.parse(ts);
    return Number.isFinite(t) && t >= cutoff;
  });
  if (entries.length > TOMBSTONE_MAX) entries = entries.slice(-TOMBSTONE_MAX);
  return Object.fromEntries(entries);
}

function tombstoneOrder(orderId: string): void {
  const next = pruneTombstones({ ...getTombstones(), [orderId]: new Date().toISOString() });
  memoryState[TOMBSTONE_KEY] = next;
  scheduleStateSave();
}

function untombstoneOrder(orderId: string): void {
  const current = getTombstones();
  if (!(orderId in current)) return;
  delete current[orderId];
  memoryState[TOMBSTONE_KEY] = current;
  scheduleStateSave();
}

function isOrderTombstoned(orderId: string): boolean {
  const ts = getTombstones()[orderId];
  if (!ts) return false;
  const t = Date.parse(ts);
  return !Number.isFinite(t) || t >= Date.now() - TOMBSTONE_TTL_MS;
}

function stripTombstonedOrders(orders: PurchaseOrder[]): PurchaseOrder[] {
  return orders.filter(o => o && o.id && !isOrderTombstoned(o.id));
}

// Serialize writes per organization so concurrent tabs cannot interleave
// full-state snapshots and leave the database in a mixed version.
const organizationWriteQueues = new Map<string, Promise<void>>();

// Persistence to MySQL when the API promises persistence.
// - MySQL deliberately not configured  -> no-op (explicit fallback mode).
// - MySQL configured but unreachable    -> throws DbUnavailableError (503).
// - SQL errors                          -> logged server-side and rethrown so
//   the caller returns an error instead of a false success.
// NOTE: shared-state sync is UPSERT-only by design (it cannot express deletes).
// Order deletes go through DELETE /api/orders/:id -> deleteOrderFromDb.
// This function must therefore never resurrect rows.
async function syncStateToMySql(orgId: string, update: Record<string, unknown>): Promise<void> {
  if (!isDbConfigured()) return; // explicit no-database fallback mode

  const previousWrite = organizationWriteQueues.get(orgId) || Promise.resolve();
  const currentWrite = previousWrite.then(async () => {
    const pool = await getDbPool();
    if (!pool) throw new DbUnavailableError();

    try {
      if (update.cft_pos && Array.isArray(update.cft_pos)) {
        // Tombstoned ids must never be re-inserted — stale tabs routinely push
        // pre-delete snapshots of cft_pos through this UPSERT path.
        const liveOrders = stripTombstonedOrders(update.cft_pos as PurchaseOrder[]);
        await saveOrdersToDb(pool, orgId, liveOrders);
      }
      if (update.cft_products && Array.isArray(update.cft_products)) {
        await saveProductsToDb(pool, orgId, update.cft_products as ProductMasterItem[]);
      }
      if (update.cft_audit && Array.isArray(update.cft_audit)) {
        await saveAuditLogsToDb(pool, orgId, update.cft_audit as AuditLogEntry[]);
      }
      if (update.cft_rectifications && Array.isArray(update.cft_rectifications)) {
        await saveRectificationsToDb(pool, orgId, update.cft_rectifications as RectificationAction[]);
      }
      if (update.cft_config && typeof update.cft_config === 'object') {
        await saveConfigToDb(pool, orgId, update.cft_config as SystemConfig);
      }
      if (update.cft_cancellations && Array.isArray(update.cft_cancellations)) {
        await saveCancellationsToDb(pool, orgId, update.cft_cancellations as CancellationRequest[]);
      }
      if (update.cft_templates && Array.isArray(update.cft_templates)) {
        await saveTemplatesToDb(pool, orgId, update.cft_templates as CategoryTemplate[]);
      }
    } catch (err) {
      if (err instanceof DbUnavailableError) throw err;
      logInternal(`MySQL Sync (${orgId})`, err);
      throw err;
    }
  });
  organizationWriteQueues.set(orgId, currentWrite);
  try {
    await currentWrite;
  } finally {
    if (organizationWriteQueues.get(orgId) === currentWrite) {
      organizationWriteQueues.delete(orgId);
    }
  }
}

/**
 * Pool for read endpoints:
 * - MySQL configured and reachable -> DB is authoritative (org-scoped SQL only).
 * - MySQL configured but unreachable -> throws DbUnavailableError (503) so the
 *   client sees the failure instead of silently reading stale memory.
 * - MySQL not configured -> null; handlers serve the explicit local fallback.
 */
async function resolveReadPool(): Promise<Awaited<ReturnType<typeof getDbPool>>> {
  const pool = await getDbPool();
  if (isDbConfigured() && !pool) throw new DbUnavailableError();
  return pool;
}

// ---------------------------------------------------------------------------
// 1. Health & Diagnostics
// ---------------------------------------------------------------------------

app.get('/api/health', async (_req: Request, res: Response) => {
  // Re-validates the pool so the endpoint never falsely claims MySQL is connected.
  await getDbPool();
  const dbConnected = isDbConnected();
  const configured = isDbConfigured();
  // Honest three-state health:
  //  - healthy:   MySQL configured and connected (database-backed operation)
  //  - degraded:  MySQL configured but NOT reachable (writes will fail with 503)
  //  - fallback:  MySQL intentionally not configured (local memory/file mode)
  const status = dbConnected ? 'healthy' : configured ? 'degraded' : 'fallback';
  res.json({
    status,
    timestamp: new Date().toISOString(),
    dbConnected,
    dbConfigured: configured,
    storageProvider: dbConnected ? 'mysql' : configured ? 'unavailable' : 'memory-with-file-sync',
    uptime: process.uptime(),
    db: getSafeDbConfig()
  });
});

// ---------------------------------------------------------------------------
// 2. Shared State Live-Sync (Frontend Store Gateway)
// ---------------------------------------------------------------------------

app.get('/api/shared-state', async (req: Request, res: Response) => {
  const orgId = getOrgId(req);
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('X-Served-By', 'cft-production-engine');

  try {
    res.json(await loadSharedStateSnapshot(orgId));
  } catch (err) {
    handleErr('shared-state:get', res, err);
  }
});

app.put('/api/shared-state', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const update = req.body as Record<string, unknown>;
    if (!update || typeof update !== 'object' || Array.isArray(update)) {
      res.status(400).json({ error: 'Invalid shared state payload' });
      return;
    }

    // Persist FIRST: a failed database write must never be reported as success
    // and must not leave a divergent memory copy behind.
    await syncStateToMySql(orgId, update);

    // Memory/file mirror is only maintained in explicit fallback mode; in
    // database-backed mode the database is the single source of truth.
    if (!isDbConfigured()) {
      memoryState = {
        ...memoryState,
        ...update
      };
      // Strip deleted ids immediately: this handler last-write-wins replaces
      // memory, so a stale tab's pre-delete snapshot must not re-introduce a
      // tombstoned order here (and the state file must stay clean too).
      if (Array.isArray(memoryState.cft_pos)) {
        memoryState.cft_pos = stripTombstonedOrders(memoryState.cft_pos as PurchaseOrder[]);
      }
      scheduleStateSave();
    }

    invalidateSharedStateCache(orgId);

    res.status(204).end();
  } catch (err) {
    handleErr('shared-state:put', res, err);
  }
});

// ---------------------------------------------------------------------------
// 3. Purchase Orders REST Endpoints
// ---------------------------------------------------------------------------

app.get('/api/orders', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const pool = await resolveReadPool();
    if (pool) {
      // Database-backed mode: org-scoped SQL only — unscoped in-memory orders
      // from other requests/organizations are never merged into the response.
      const orders = stripTombstonedOrders(await loadOrdersFromDb(pool, orgId));
      res.json(orders);
      return;
    }
    // Explicit fallback mode (MySQL not configured).
    res.json(stripTombstonedOrders((memoryState.cft_pos as PurchaseOrder[]) || []));
  } catch (err) {
    handleErr('orders:get', res, err);
  }
});

app.get('/api/orders/:id', async (req: Request, res: Response) => {
  try {
    if (isOrderTombstoned(String(req.params.id))) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    const orgId = getOrgId(req);
    const pool = await resolveReadPool();
    if (pool) {
      // Database is authoritative — no memory fallthrough could leak rows here.
      const orders = await loadOrdersFromDb(pool, orgId);
      const found = orders.find(p => p.id === req.params.id || p.poNumber === req.params.id);
      if (!found) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }
      res.json(found);
      return;
    }
    // Explicit fallback mode (MySQL not configured).
    const orders = (memoryState.cft_pos as PurchaseOrder[]) || [];
    const found = orders.find(p => p.id === req.params.id || p.poNumber === req.params.id);
    if (!found) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    res.json(found);
  } catch (err) {
    handleErr('orders:getById', res, err);
  }
});

app.post('/api/orders', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const bodyError = validateOrderBody(req.body);
    if (bodyError) {
      res.status(400).json({ error: bodyError });
      return;
    }
    const newOrder = req.body as PurchaseOrder;

    // Re-creating an order with the same id clears its delete tombstone so
    // the fresh row syncs instead of being filtered as a resurrection.
    untombstoneOrder(newOrder.id);

    if (isDbConfigured()) {
      // Persist this order first; a failed write returns 503/500 — never a
      // false 201. Memory is not consulted: the database is the source of truth.
      await syncStateToMySql(orgId, { cft_pos: [newOrder] });
    } else {
      // Explicit fallback mode: memory + file only.
      const currentOrders = ((memoryState.cft_pos as PurchaseOrder[]) || []).filter(o => o.id !== newOrder.id);
      memoryState.cft_pos = [newOrder, ...currentOrders];
      scheduleStateSave();
    }
    res.status(201).json(newOrder);
  } catch (err) {
    handleErr('orders:post', res, err);
  }
});

app.put('/api/orders/:id', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const orderUpdate = req.body as PurchaseOrder;

    if (isDbConfigured()) {
      const pool = await getDbPool();
      if (!pool) throw new DbUnavailableError();
      const orders = await loadOrdersFromDb(pool, orgId);
      const found = orders.find(p => p.id === req.params.id);
      if (!found) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }
      const merged: PurchaseOrder = { ...found, ...orderUpdate, lastUpdatedAt: new Date().toISOString() };
      // Await the upsert: failure surfaces as an error response, not a false 200.
      await syncStateToMySql(orgId, { cft_pos: [merged] });
      res.json(merged);
      return;
    }

    // Explicit fallback mode (MySQL not configured).
    const currentOrders = (memoryState.cft_pos as PurchaseOrder[]) || [];
    const idx = currentOrders.findIndex(o => o.id === req.params.id);

    if (idx < 0) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    currentOrders[idx] = { ...currentOrders[idx], ...orderUpdate, lastUpdatedAt: new Date().toISOString() };
    memoryState.cft_pos = currentOrders;
    scheduleStateSave();
    res.json(currentOrders[idx]);
  } catch (err) {
    handleErr('orders:put', res, err);
  }
});

app.delete('/api/orders/:id', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    // Tombstone FIRST: from this moment no upsert path may re-insert the id
    // and no read path may serve it, regardless of what happens below.
    tombstoneOrder(String(req.params.id));

    const pool = await resolveReadPool(); // throws 503 when configured but down
    if (pool) {
      const deleted = await deleteOrderFromDb(pool, orgId, String(req.params.id));
      if (!deleted) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }
      res.status(204).end();
      return;
    }

    // Explicit fallback mode (MySQL not configured): prune memory + file only.
    const currentOrders = (memoryState.cft_pos as PurchaseOrder[]) || [];
    const filtered = currentOrders.filter(o => o.id !== req.params.id);
    if (filtered.length === currentOrders.length) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    memoryState.cft_pos = filtered;
    scheduleStateSave();
    res.status(204).end();
  } catch (err) {
    handleErr('orders:delete', res, err);
  }
});

// ---------------------------------------------------------------------------
// 4. Products & Catalog Endpoints
// ---------------------------------------------------------------------------

app.get('/api/products', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const pool = await resolveReadPool();
    if (pool) {
      res.json(await loadProductsFromDb(pool, orgId));
      return;
    }
    res.json(memoryState.cft_products || []);
  } catch (err) {
    handleErr('products:get', res, err);
  }
});

app.post('/api/products', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const prod = req.body as ProductMasterItem;

    if (isDbConfigured()) {
      // Awaited upsert (saveProductsToDb never deletes missing rows): a DB
      // failure returns an error response instead of a false 201.
      const pool = await getDbPool();
      if (!pool) throw new DbUnavailableError();
      await saveProductsToDb(pool, orgId, [prod]);
    } else {
      // Explicit fallback mode: memory + file only.
      const current = (memoryState.cft_products as ProductMasterItem[]) || [];
      memoryState.cft_products = [...current.filter(p => p.id !== prod.id), prod];
      scheduleStateSave();
    }
    res.status(201).json(prod);
  } catch (err) {
    handleErr('products:post', res, err);
  }
});

// ---------------------------------------------------------------------------
// 5. Audit Log & Rectification Endpoints
// ---------------------------------------------------------------------------

app.get('/api/audit-log', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const pool = await resolveReadPool();
    if (pool) {
      res.json(await loadAuditLogsFromDb(pool, orgId));
      return;
    }
    res.json(memoryState.cft_audit || []);
  } catch (err) {
    handleErr('audit:get', res, err);
  }
});

app.post('/api/audit-log', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const entry = req.body as AuditLogEntry;

    if (isDbConfigured()) {
      const pool = await getDbPool();
      if (!pool) throw new DbUnavailableError();
      await saveAuditLogsToDb(pool, orgId, [entry]);
    } else {
      const current = (memoryState.cft_audit as AuditLogEntry[]) || [];
      memoryState.cft_audit = [entry, ...current];
      scheduleStateSave();
    }
    res.status(201).json(entry);
  } catch (err) {
    handleErr('audit:post', res, err);
  }
});

app.get('/api/rectifications', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const pool = await resolveReadPool();
    if (pool) {
      res.json(await loadRectificationsFromDb(pool, orgId));
      return;
    }
    res.json(memoryState.cft_rectifications || []);
  } catch (err) {
    handleErr('rectifications:get', res, err);
  }
});

// ---------------------------------------------------------------------------
// 6. Templates, Config & Cancellation Endpoints
// ---------------------------------------------------------------------------

app.get('/api/templates', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const pool = await resolveReadPool();
    if (pool) {
      res.json(await loadTemplatesFromDb(pool, orgId));
      return;
    }
    res.json(memoryState.cft_templates || []);
  } catch (err) {
    handleErr('templates:get', res, err);
  }
});

app.post('/api/templates', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const tmpl = req.body as CategoryTemplate;

    if (isDbConfigured()) {
      const pool = await getDbPool();
      if (!pool) throw new DbUnavailableError();
      await saveTemplatesToDb(pool, orgId, [tmpl]);
    } else {
      const current = (memoryState.cft_templates as CategoryTemplate[]) || [];
      memoryState.cft_templates = [...current.filter(t => t.id !== tmpl.id), tmpl];
      scheduleStateSave();
    }
    res.status(201).json(tmpl);
  } catch (err) {
    handleErr('templates:post', res, err);
  }
});

app.get('/api/config', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const pool = await resolveReadPool();
    if (pool) {
      const cfg = await loadConfigFromDb(pool, orgId);
      res.json(cfg || { atRiskThresholdDays: 3, delayedThresholdDays: 7, offlineSyncQueue: [], enablePushNotifications: false });
      return;
    }
    res.json(memoryState.cft_config || { atRiskThresholdDays: 3, delayedThresholdDays: 7, offlineSyncQueue: [], enablePushNotifications: false });
  } catch (err) {
    handleErr('config:get', res, err);
  }
});

app.put('/api/config', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const bodyResult = validateConfigBody(req.body);
    if (typeof bodyResult === 'string') {
      res.status(400).json({ error: bodyResult });
      return;
    }
    const newCfg = req.body as SystemConfig;

    if (isDbConfigured()) {
      const pool = await getDbPool();
      if (!pool) throw new DbUnavailableError();
      await saveConfigToDb(pool, orgId, newCfg);
    } else {
      memoryState.cft_config = newCfg;
      scheduleStateSave();
    }
    res.json(newCfg);
  } catch (err) {
    handleErr('config:put', res, err);
  }
});

app.get('/api/cancellations', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const pool = await resolveReadPool();
    if (pool) {
      res.json(await loadCancellationsFromDb(pool, orgId));
      return;
    }
    res.json(memoryState.cft_cancellations || []);
  } catch (err) {
    handleErr('cancellations:get', res, err);
  }
});

app.post('/api/cancellations', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const cancellation = req.body as CancellationRequest;

    if (isDbConfigured()) {
      const pool = await getDbPool();
      if (!pool) throw new DbUnavailableError();
      await saveCancellationsToDb(pool, orgId, [cancellation]);
    } else {
      const current = (memoryState.cft_cancellations as CancellationRequest[]) || [];
      memoryState.cft_cancellations = [cancellation, ...current.filter(c => c.id !== cancellation.id)];
      scheduleStateSave();
    }
    res.status(201).json(cancellation);
  } catch (err) {
    handleErr('cancellations:post', res, err);
  }
});

// ---------------------------------------------------------------------------
// 7. Database Schema Administration & Status
// Schema INIT (DDL) is administrative: disabled unless ENABLE_SCHEMA_ADMIN=true
// and a SCHEMA_ADMIN_TOKEN is configured, and the caller presents the token.
// Normal application traffic and startup never run DDL — startup only VERIFIES
// (read-only) which tables exist.
// ---------------------------------------------------------------------------

app.post('/api/db/init-schema', requireSchemaAdmin, async (_req: Request, res: Response) => {
  const pool = await getDbPool();
  if (!pool) {
    res.status(503).json({ error: 'MySQL is not configured or unavailable. Operating with local fallback.' });
    return;
  }

  try {
    const result = await initSchema(pool);
    res.json({ success: true, message: `Executed ${result.executedCount} statements successfully.` });
  } catch (err) {
    // Never echo raw SQL/DB errors to the caller.
    logInternal('db:init-schema', err);
    sendServerError(res, 500, 'Schema initialization failed. See server logs.');
  }
});

app.get('/api/db/status', async (_req: Request, res: Response) => {
  // Re-validates the pool so the endpoint never falsely claims MySQL is connected.
  await getDbPool();
  const connected = isDbConnected();
  const configured = isDbConfigured();
  const envStatus = getDbEnvStatus();

  // Read-only schema verification (never executes DDL).
  let schema: { expected: number; missingTables: string[] } | null = null;
  if (connected) {
    try {
      const pool = await getDbPool();
      if (pool) {
        const v = await verifySchema(pool);
        schema = { expected: v.expected.length, missingTables: v.missing };
      }
    } catch (err) {
      logInternal('db:status:schema', err);
    }
  }

  res.json({
    connected,
    configured,
    // healthy = connected; degraded = configured but unreachable; fallback = not configured
    mode: connected ? 'healthy' : configured ? 'degraded' : 'fallback',
    missingEnvVars: envStatus.configured ? [] : envStatus.missing,
    schema,
    storageProvider: connected ? 'mysql' : configured ? 'unavailable' : 'memory-with-file-sync',
    stateKeysCount: Object.keys(memoryState).length,
    ordersCount: ((memoryState.cft_pos as any[]) || []).length,
    db: getSafeDbConfig()
  });
});

// ---------------------------------------------------------------------------
// Production Static Frontend Serving
// ---------------------------------------------------------------------------

const distPath = path.join(__dirname, '../dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath, {
    maxAge: '1y',
    immutable: true,
    index: false
  }));

  app.use((req: Request, res: Response, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      res.setHeader('Cache-Control', 'no-cache');
      return res.sendFile(path.join(distPath, 'index.html'));
    }
    next();
  });
}

// ---------------------------------------------------------------------------
// Central error handler — logs details server-side only; responses are generic.
// (Placed after all routes so async/promise rejections from any handler land here.)
// ---------------------------------------------------------------------------
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof DbUnavailableError) {
    res.status(503).json({ error: 'Database is configured but unavailable. The request was NOT persisted.' });
    return;
  }
  logInternal('unhandled', err);
  res.status(500).json({ error: 'Internal server error. Please try again later.' });
});

// Start Server
const httpServer = app.listen(PORT, async () => {
  const envStatus = getDbEnvStatus();
  const safeCfg = getSafeDbConfig();

  console.log(`====================================================`);
  console.log(`🚀 CFT Tracker Backend Server running on port ${PORT}`);
  console.log(`⚡ Mode: ${process.env.NODE_ENV || 'production'}`);
  console.log(`⚡ Compression: Enabled (gzip/brotli)`);
  console.log(`⚡ Static Client: ${fs.existsSync(distPath) ? 'Available (dist/)' : 'Not Built (run npm run build)'}`);
  console.log(`⚡ Env file: ${envStatus.envFile} (exists: ${envStatus.envFileExists})`);
  if (envStatus.configured) {
    // Target summary — host/port/database/TLS only, never credentials.
    console.log(
      `[Database] Target: ${safeCfg.host}:${safeCfg.port}/${safeCfg.database}` +
      ` (TLS: ${safeCfg.sslEnabled ? 'on' : 'off'}, password set: ${safeCfg.hasPassword})`
    );
  } else {
    console.warn(`[Database] INCOMPLETE config — missing: ${envStatus.missing.join(', ')}. Running in fallback mode.`);
  }
  console.log(`====================================================`);

  // Connect and VERIFY schema (read-only). Startup never executes DDL —
  // schema administration is only available via the token-protected
  // POST /api/db/init-schema endpoint.
  try {
    const pool = await getDbPool();
    if (pool) {
      const v = await verifySchema(pool);
      if (v.missing.length === 0) {
        console.log(`[Database] Connected. Schema verified: ${v.present.length}/${v.expected.length} tables present.`);
      } else {
        console.warn(
          `[Database] Connected. Schema INCOMPLETE — missing tables: ${v.missing.join(', ')}. ` +
          `Run the protected POST /api/db/init-schema (admin token required) or apply database/mysql-schema.sql manually.`
        );
      }
    } else if (isDbConfigured()) {
      console.warn(`[Database] MySQL is CONFIGURED but UNAVAILABLE — API reads/writes will return 503 until it recovers.`);
    } else {
      console.warn(`[Database] MySQL not configured — running in explicit local fallback mode (memory + state file).`);
    }
  } catch (err) {
    logInternal('startup:db-verify', err);
  }
});

// Graceful shutdown — releases pool resources on SIGINT/SIGTERM.
async function shutdown(signal: string): Promise<void> {
  console.log(`[Server] Received ${signal}, shutting down...`);
  httpServer.close(async () => {
    await closeDbPool();
    process.exit(0);
  });
  // Force exit if connections hang.
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
