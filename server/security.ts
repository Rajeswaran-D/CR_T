import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

/**
 * Security middleware & helpers for the CFT Tracker backend.
 *
 * Authentication contract (see DEPLOYMENT-CHECKLIST.md):
 *  - Every data endpoint requires a valid `X-Organization-Id` header that matches
 *    the org-id pattern below. A missing/invalid header is rejected (fail-closed);
 *    it NEVER silently falls back to a default organization.
 *  - Optional bearer-token authentication is enabled by configuring `ORG_API_KEYS`
 *    (JSON map of orgId -> key(s)). When configured, requests must carry a matching
 *    `Authorization: Bearer <key>` header.
 *  - Setting `CFT_REQUIRE_AUTH=true` makes authentication mandatory: if ORG_API_KEYS
 *    is not configured the server fails closed with 503 instead of serving data.
 *  X-Organization-Id alone is a routing hint, not authorization. Enabling
 *  ORG_API_KEYS + CFT_REQUIRE_AUTH is the supported authorization mechanism until
 *  a real identity provider is wired in.
 */

// Org ids are lowercase slugs: 3-64 chars, letters/digits/dot/underscore/hyphen.
const ORG_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/;

export function isValidOrgId(value: unknown): value is string {
  return typeof value === 'string' && ORG_ID_PATTERN.test(value);
}

/** Constant-time string comparison (hashes first to avoid length leaks). */
function timingSafeStringEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function parseOrgApiKeys(): Record<string, string[]> | null {
  const raw = process.env.ORG_API_KEYS;
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const out: Record<string, string[]> = {};
    for (const [org, keys] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(keys)) {
        const list = keys.filter((k): k is string => typeof k === 'string' && k.length > 0);
        if (list.length > 0) out[org] = list;
      } else if (typeof keys === 'string' && keys.length > 0) {
        out[org] = [keys];
      }
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    console.error('[Auth] ORG_API_KEYS is not valid JSON — treating authentication as unconfigured (fail-closed when required).');
    return null;
  }
}

export function authRequired(): boolean {
  return process.env.CFT_REQUIRE_AUTH === 'true';
}

/**
 * Express middleware: validates org identity and (when configured) bearer-token
 * authorization, then exposes the trusted org id via res.locals.orgId.
 */
export function requireOrg(req: Request, res: Response, next: NextFunction): void {
  const raw = req.headers['x-organization-id'];
  const orgId = Array.isArray(raw) ? raw[0] : raw;
  if (!isValidOrgId(orgId)) {
    res.status(400).json({ error: 'Missing or invalid organization identity (X-Organization-Id header).' });
    return;
  }

  const keys = parseOrgApiKeys();
  if (!keys && authRequired()) {
    console.error('[Auth] CFT_REQUIRE_AUTH=true but ORG_API_KEYS is not configured — refusing request (fail-closed).');
    res.status(503).json({ error: 'Server authentication is not configured. Contact the administrator.' });
    return;
  }

  if (keys) {
    const allowed = keys[orgId] || [];
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const ok = token.length > 0 && allowed.some(k => timingSafeStringEqual(token, k));
    if (!ok) {
      res.status(401).json({ error: 'Invalid or missing organization credentials.' });
      return;
    }
  }

  res.locals.orgId = orgId;
  next();
}

/** Reads the validated org id set by requireOrg. Throws if middleware was skipped. */
export function orgOf(res: Response): string {
  const id = res.locals.orgId;
  if (!isValidOrgId(id)) {
    throw new Error('Organization identity missing from request context (requireOrg middleware not applied).');
  }
  return id;
}

// ---------------------------------------------------------------------------
// CORS — allowlist only. The Vercel frontend and local dev origins are the
// approved consumers; everything else is rejected before hitting route logic.
// ---------------------------------------------------------------------------

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  'http://localhost:5175',
  'http://127.0.0.1:5175',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'https://circor-tracker.vercel.app',
  'https://circor-tracker-api.onrender.com'
];

export function allowedOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS;
  if (raw && raw.trim()) {
    return raw.split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);
  }
  return DEFAULT_ALLOWED_ORIGINS;
}

export function isAllowedOrigin(origin: string): boolean {
  const normalized = origin.replace(/\/+$/, '');
  if (allowedOrigins().includes(normalized)) {
    return true;
  }
  // Permit any local loopback development origin on any port
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalized)) {
    return true;
  }
  // Temporary public development tunnels are opt-in and limited to ngrok's
  // HTTPS domains. Keep this disabled by default for deployed environments.
  if (process.env.ALLOW_NGROK_ORIGINS === 'true' && /^https:\/\/[^/]+\.ngrok(?:-free)?\.(dev|app|io)$/.test(normalized)) {
    return true;
  }
  return false;
}

export function corsGuard(req: Request, res: Response, next: NextFunction): void {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : null;
  if (origin) {
    const normalized = origin.replace(/\/+$/, '');
    if (!isAllowedOrigin(normalized)) {
      res.status(403).json({ error: 'Origin not allowed.' });
      return;
    }
    res.setHeader('Access-Control-Allow-Origin', normalized);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Organization-Id, Authorization, ngrok-skip-browser-warning');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}


// ---------------------------------------------------------------------------
// Rate limiting — simple fixed-window per client IP. Render runs a single
// instance, so an in-memory bucket is sufficient; no new dependencies.
// ---------------------------------------------------------------------------

const rateBuckets = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW_MS = 60_000;

export function rateLimiter(req: Request, res: Response, next: NextFunction): void {
  const raw = process.env.RATE_LIMIT_PER_MIN;
  const max = raw ? Number(raw) : (process.env.NODE_ENV === 'test' ? 0 : 300);
  if (!Number.isFinite(max) || max <= 0) {
    next();
    return;
  }
  const now = Date.now();
  if (rateBuckets.size > 10_000) rateBuckets.clear(); // bound memory
  const xff = req.headers['x-forwarded-for'];
  const ip = (typeof xff === 'string' ? xff.split(',')[0].trim() : (Array.isArray(xff) ? xff[0] : null)) || req.ip || req.socket.remoteAddress || 'unknown';
  let bucket = rateBuckets.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  if (bucket.count > max) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
    res.status(429).json({ error: 'Too many requests. Please retry shortly.' });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// Secure response headers
// ---------------------------------------------------------------------------

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  // The approved frontend is a different origin (Vercel -> Render), so this
  // API must allow cross-origin subresource loads; it does not weaken CORS.
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}

// ---------------------------------------------------------------------------
// Sanitized error responses — never leak SQL text, hosts, or stack traces.
// ---------------------------------------------------------------------------

export function logInternal(scope: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[${scope}] ${msg}`);
}

export function sendServerError(res: Response, status = 500, message = 'Internal server error. Please try again later.'): void {
  if (!res.headersSent) {
    res.status(status).json({ error: message });
  }
}

// ---------------------------------------------------------------------------
// Schema-admin gate for POST /api/db/init-schema.
// Disabled unless ENABLE_SCHEMA_ADMIN=true AND a SCHEMA_ADMIN_TOKEN is set AND
// the caller presents the matching bearer token. Anything else -> 404/403 so
// the endpoint is not advertised to ordinary callers.
// ---------------------------------------------------------------------------

export function requireSchemaAdmin(req: Request, res: Response, next: NextFunction): void {
  if (process.env.ENABLE_SCHEMA_ADMIN !== 'true') {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const token = process.env.SCHEMA_ADMIN_TOKEN;
  if (!token || token.length < 16) {
    res.status(403).json({ error: 'Schema administration is not configured.' });
    return;
  }
  const header = req.headers.authorization || '';
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!presented || !timingSafeStringEqual(presented, token)) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// Request validation helpers
// ---------------------------------------------------------------------------

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export function isSafeIdString(value: unknown, max = 128): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= max &&
    !CONTROL_CHARS.test(value)
  );
}

/** Returns an error message, or null when the order body is acceptable. */
export function validateOrderBody(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Request body must be a JSON object.';
  }
  const b = body as Record<string, unknown>;
  if (!isSafeIdString(b.id)) return 'Missing or invalid field: id.';
  if (!isSafeIdString(b.poNumber)) return 'Missing or invalid field: poNumber.';
  return null;
}

/** Whitelists + validates system config. Returns sanitized config or an error message. */
export function validateConfigBody(body: unknown): Record<string, unknown> | string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Request body must be a JSON object.';
  }
  const b = body as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const field of ['atRiskThresholdDays', 'delayedThresholdDays'] as const) {
    if (field in b) {
      const v = b[field];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 365) {
        return `Invalid field: ${field} must be a number between 0 and 365.`;
      }
      out[field] = Math.round(v);
    }
  }
  if ('offlineSyncQueue' in b) {
    if (!Array.isArray(b.offlineSyncQueue)) return 'Invalid field: offlineSyncQueue must be an array.';
    out.offlineSyncQueue = b.offlineSyncQueue;
  }
  if ('enablePushNotifications' in b) {
    if (typeof b.enablePushNotifications !== 'boolean') return 'Invalid field: enablePushNotifications must be a boolean.';
    out.enablePushNotifications = b.enablePushNotifications;
  }
  return out;
}
