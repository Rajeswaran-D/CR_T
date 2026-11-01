import express, { Request, Response } from 'express';
import cors from 'cors';
import compression from 'compression';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';
import { getDbPool, isDbConnected } from './db';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const stateFile = process.env.STATE_FILE_PATH || path.join(os.homedir(), '.cft-project-e2e-tracker-shared-state.json');

// Performance optimizations: gzip/brotli compression, cors, json body parser
app.use(compression({
  threshold: 1024,
  level: 6
}));

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Organization-Id', 'Authorization']
}));

app.use(express.json({ limit: '20mb' }));

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

// Debounced background sync to disk for maximum throughput
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

// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------

// 1. Health Check & Diagnostics
app.get('/api/health', async (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    dbConnected: isDbConnected(),
    storageProvider: isDbConnected() ? 'mysql' : 'memory-with-file-sync',
    uptime: process.uptime()
  });
});

// 2. Shared State GET (High Speed In-Memory Response)
app.get('/api/shared-state', async (req: Request, res: Response) => {
  // TODO(org-backend): enforce tenant isolation from trusted auth/session.
  // `X-Organization-Id` is currently client-supplied (dev only) — do NOT trust
  // it alone in production. Expected: WHERE organization_id = req.orgId.
  const _orgId = req.headers['x-organization-id'] as string || 'default';
  void _orgId;
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('X-Served-By', 'cft-production-engine');

  // If MySQL is connected, optionally sync/retrieve from DB; otherwise serve ultra-fast memoryState
  res.json(memoryState);
});

// 3. Shared State PUT (Atomic Merge & Async Persistence)
app.put('/api/shared-state', async (req: Request, res: Response) => {
  try {
    const update = req.body as Record<string, unknown>;
    if (!update || typeof update !== 'object') {
      res.status(400).json({ error: 'Invalid shared state payload' });
      return;
    }

    // Atomic update in memory
    memoryState = {
      ...memoryState,
      ...update
    };

    // Schedule high-speed disk sync
    scheduleStateSave();

    res.status(204).end();
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// 4. Schema initialization helper (optional for bootstrap)
app.post('/api/db/init-schema', async (_req: Request, res: Response) => {
  const pool = await getDbPool();
  if (!pool) {
    res.status(503).json({ error: 'MySQL is not configured or unavailable' });
    return;
  }

  try {
    const schemaPath = path.join(__dirname, '../database/mysql-schema.sql');
    if (!fs.existsSync(schemaPath)) {
      res.status(404).json({ error: 'mysql-schema.sql not found' });
      return;
    }

    const sql = fs.readFileSync(schemaPath, 'utf8');
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    const conn = await pool.getConnection();
    try {
      for (const stmt of statements) {
        await conn.query(stmt);
      }
      res.json({ success: true, message: `Executed ${statements.length} schema statements successfully.` });
    } finally {
      conn.release();
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Production Static Frontend Serving
// ---------------------------------------------------------------------------
const distPath = path.join(__dirname, '../dist');
if (fs.existsSync(distPath)) {
  // Static assets cached aggressively (1 year)
  app.use(express.static(distPath, {
    maxAge: '1y',
    immutable: true,
    index: false
  }));

  // Single Page App fallback for HTML5 routing
  app.get('*', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Start Server
app.listen(PORT, async () => {
  console.log(`====================================================`);
  console.log(`🚀 CFT Tracker Backend Server running on port ${PORT}`);
  console.log(`⚡ Mode: ${process.env.NODE_ENV || 'production'}`);
  console.log(`⚡ Compression: Enabled (gzip/brotli)`);
  console.log(`⚡ Static Client: ${fs.existsSync(distPath) ? 'Available (dist/)' : 'Not Built (run npm run build)'}`);
  console.log(`====================================================`);

  // Attempt background DB connection pool initialization
  await getDbPool();
});
