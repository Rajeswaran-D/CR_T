import mysql from 'mysql2/promise';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { logDbActivity } from './dbLogger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load the repository-local .env via a path anchored to this file, so the
// backend always reads the intended local environment file regardless of the
// shell's working directory. `.env.production` is intentionally NEVER loaded
// by the server — it is a handover template for Docker/Render only.
const ENV_FILE_PATH = path.resolve(__dirname, '../.env');
dotenv.config({ path: ENV_FILE_PATH });

export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password?: string;
  database: string;
  connectionLimit: number;
  ssl?: {
    ca: string | Buffer;
    rejectUnauthorized: boolean;
  };
}

export interface SafeDbConfig {
  host: string;
  port: number;
  database: string;
  connectionLimit: number;
  hasPassword: boolean;
  sslEnabled: boolean;
  sslRejectUnauthorized: boolean;
  caConfigured: boolean;
}

/**
 * Resolves the CA certificate for verified TLS connections.
 * Supports:
 *  1. File path from MYSQL_SSL_CA_PATH or AIVEN_MYSQL_CA_PATH.
 *  2. Direct inline PEM certificate string from MYSQL_SSL_CA or AIVEN_MYSQL_CA_CERT.
 * Local dev without SSL returns null, leaving TLS unconfigured.
 */
function resolveSslCa(): string | Buffer | null {
  const caPath = process.env.MYSQL_SSL_CA_PATH || process.env.AIVEN_MYSQL_CA_PATH;
  if (caPath) {
    try {
      const resolvedPath = path.isAbsolute(caPath) ? caPath : path.resolve(process.cwd(), caPath);
      if (fs.existsSync(resolvedPath)) {
        return fs.readFileSync(resolvedPath);
      }
      console.warn(`[Database] Specified CA path does not exist on disk: ${resolvedPath}`);
    } catch (err: any) {
      console.error(`[Database] Failed to read CA certificate from path "${caPath}": ${err.message}`);
    }
  }

  const inlineCa = process.env.MYSQL_SSL_CA || process.env.AIVEN_MYSQL_CA_CERT;
  if (inlineCa && inlineCa.trim()) {
    const trimmed = inlineCa.trim();
    if (trimmed.includes('BEGIN CERTIFICATE')) {
      return trimmed;
    }
    // Check if base64 encoded
    try {
      const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
      if (decoded.includes('BEGIN CERTIFICATE')) {
        return decoded;
      }
    } catch {
      // not base64
    }
    return trimmed;
  }

  return null;
}

function buildDbConfig(): DbConfig {
  const host = process.env.MYSQL_HOST || process.env.AIVEN_MYSQL_HOST || 'localhost';
  const port = Number(process.env.MYSQL_PORT || process.env.AIVEN_MYSQL_PORT || 3306);
  const user = process.env.MYSQL_USER || process.env.AIVEN_MYSQL_USER || 'cft_app';
  const password = process.env.MYSQL_PASSWORD || process.env.AIVEN_MYSQL_PASSWORD || '';
  const database = process.env.MYSQL_DATABASE || process.env.AIVEN_MYSQL_DATABASE || 'cft_tracker';
  const ca = resolveSslCa();

  const cfg: DbConfig = {
    host,
    port,
    user,
    password,
    database,
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10)
  };

  // Set TLS/SSL only when CA is provided. Reject unauthorized is strictly true.
  if (ca) {
    cfg.ssl = {
      ca,
      rejectUnauthorized: true
    };
  }

  return cfg;
}

// Safe diagnostics without secret values or passwords — used by health/status endpoints.
export function getSafeDbConfig(): SafeDbConfig {
  const cfg = buildDbConfig();
  return {
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    connectionLimit: cfg.connectionLimit,
    hasPassword: Boolean(cfg.password),
    sslEnabled: Boolean(cfg.ssl),
    sslRejectUnauthorized: cfg.ssl ? cfg.ssl.rejectUnauthorized : false,
    caConfigured: Boolean(cfg.ssl?.ca)
  };
}

/**
 * Reports whether MySQL connection settings are present, naming any missing
 * variables (names only — never values). Used so a misconfigured environment
 * produces a clear diagnostic instead of silently selecting a default database.
 */
export function getDbEnvStatus(): { configured: boolean; missing: string[]; envFile: string; envFileExists: boolean } {
  const missing: string[] = [];
  if (!process.env.MYSQL_HOST && !process.env.AIVEN_MYSQL_HOST) missing.push('MYSQL_HOST');
  if (!process.env.MYSQL_DATABASE && !process.env.AIVEN_MYSQL_DATABASE) missing.push('MYSQL_DATABASE');
  if (!process.env.MYSQL_USER && !process.env.AIVEN_MYSQL_USER) missing.push('MYSQL_USER');
  if (!process.env.MYSQL_PASSWORD && !process.env.AIVEN_MYSQL_PASSWORD) missing.push('MYSQL_PASSWORD');
  return {
    configured: missing.length === 0,
    missing,
    envFile: ENV_FILE_PATH,
    envFileExists: fs.existsSync(ENV_FILE_PATH)
  };
}

/** True when MySQL settings were supplied — the app then MUST use the database (no silent fallback). */
export function isDbConfigured(): boolean {
  return getDbEnvStatus().configured;
}

let pool: mysql.Pool | null = null;
let isConnected = false;
let warnedMissingEnv = false;

export async function getDbPool(): Promise<mysql.Pool | null> {
  // Reuse existing pool only after verifying it can still serve a connection.
  if (pool) {
    try {
      const conn = await pool.getConnection();
      try {
        await conn.ping();
      } finally {
        conn.release();
      }
      isConnected = true;
      return pool;
    } catch {
      // Pool is stale — fall through and rebuild below.
      try {
        await pool.end();
      } catch {
        // Ignore cleanup errors; a fresh pool will be attempted.
      }
      pool = null;
      isConnected = false;
    }
  }

  // Refuse to guess a database: all connection variables must be present.
  // Missing configuration is reported clearly (variable names only) instead of
  // silently falling back to a default host/database.
  const envStatus = getDbEnvStatus();
  if (!envStatus.configured) {
    isConnected = false;
    if (!warnedMissingEnv) {
      warnedMissingEnv = true;
      console.warn(
        `[Database] MySQL configuration is INCOMPLETE — missing: ${envStatus.missing.join(', ')}. ` +
        `Env file: ${envStatus.envFile} (exists: ${envStatus.envFileExists}). ` +
        `Running WITHOUT database (explicit fallback mode).`
      );
    }
    return null;
  }

  const dbConfig = buildDbConfig();

  try {
    const poolConfig: mysql.PoolOptions = {
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      password: dbConfig.password,
      database: dbConfig.database,
      waitForConnections: true,
      connectionLimit: dbConfig.connectionLimit,
      queueLimit: 0,
      connectTimeout: 20000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
      dateStrings: true,
      ...(dbConfig.ssl ? { ssl: dbConfig.ssl } : {})
    };

    pool = mysql.createPool(poolConfig);

    const pingStart = performance.now();
    const conn = await pool.getConnection();
    try {
      await conn.ping();
    } finally {
      conn.release();
    }
    const pingMs = performance.now() - pingStart;
    isConnected = true;
    logDbActivity(
      'CONNECTION',
      'mysql_pool',
      `Connected & ping verified (${dbConfig.host}:${dbConfig.port}/${dbConfig.database}${dbConfig.ssl ? ' [TLS/SSL]' : ''}, limit: ${dbConfig.connectionLimit})`,
      { durationMs: pingMs }
    );
    return pool;
  } catch (err: any) {
    logDbActivity(
      'CONNECTION',
      'mysql_pool',
      `Connection failed for ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`,
      { error: err.message }
    );
    if (pool) {
      try {
        await pool.end();
      } catch {
        // Ignore cleanup errors on failed connect.
      }
    }
    pool = null;
    isConnected = false;
    return null;
  }
}

export function isDbConnected(): boolean {
  return isConnected && pool !== null;
}

export async function closeDbPool(): Promise<void> {
  if (pool) {
    try {
      await pool.end();
      logDbActivity('CONNECTION', 'mysql_pool', 'Connection pool closed cleanly');
    } finally {
      pool = null;
      isConnected = false;
    }
  }
}
