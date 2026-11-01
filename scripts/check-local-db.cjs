#!/usr/bin/env node
/**
 * Local MySQL connectivity & schema check for the CIRCOR E2E tracker.
 *
 * - READ-ONLY: executes SELECT/SHOW/ information_schema queries only.
 * - Never prints passwords or other secret values.
 * - Targets the database named in the repo-local .env (never .env.production).
 *
 * Usage: npm run db:check
 * Exit codes: 0 = all checks passed, 1 = one or more checks failed.
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

const ROOT = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT, '.env');
dotenv.config({ path: ENV_FILE });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function expectedTables() {
  const schemaPath = path.join(ROOT, 'database', 'mysql-schema.sql');
  if (!fs.existsSync(schemaPath)) return { schemaPath, tables: [] };
  const sql = fs.readFileSync(schemaPath, 'utf8');
  const tables = [];
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z0-9_]+)`?/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    if (!tables.includes(m[1])) tables.push(m[1]);
  }
  return { schemaPath, tables };
}

async function main() {
  console.log('--- CIRCOR local database check (read-only) ---');
  console.log(`Env file: ${ENV_FILE}${fs.existsSync(ENV_FILE) ? '' : ' (MISSING)'}`);

  const host = process.env.MYSQL_HOST;
  const port = Number(process.env.MYSQL_PORT || 3306);
  const user = process.env.MYSQL_USER;
  const database = process.env.MYSQL_DATABASE;
  const password = process.env.MYSQL_PASSWORD;
  const caPath = process.env.MYSQL_SSL_CA_PATH || process.env.AIVEN_MYSQL_CA_PATH;
  const caInline = process.env.MYSQL_SSL_CA || process.env.AIVEN_MYSQL_CA_CERT;

  const missing = [];
  if (!host) missing.push('MYSQL_HOST');
  if (!user) missing.push('MYSQL_USER');
  if (!database) missing.push('MYSQL_DATABASE');
  if (password === undefined || password === '') missing.push('MYSQL_PASSWORD');
  if (missing.length > 0) {
    check('env configuration', false, `missing: ${missing.join(', ')}`);
    process.exit(1);
  }

  const sslEnabled = Boolean((caPath && fs.existsSync(path.isAbsolute(caPath) ? caPath : path.resolve(ROOT, caPath))) || caInline);
  console.log(`Target: ${host}:${port}/${database} (TLS: ${sslEnabled ? 'on' : 'off'}, user: ${user})`);
  console.log('');

  let conn;
  try {
    const opts = { host, port, user, password, database, connectTimeout: 8000 };
    if (sslEnabled) {
      const ca = caPath
        ? fs.readFileSync(path.isAbsolute(caPath) ? caPath : path.resolve(ROOT, caPath))
        : caInline.trim();
      opts.ssl = { ca, rejectUnauthorized: true };
    }
    conn = await mysql.createConnection(opts);

    const [ping] = await conn.query('SELECT 1 AS ok');
    check('connect + SELECT 1', ping && ping[0].ok === 1);

    const [dbRows] = await conn.query('SELECT DATABASE() AS db');
    const actualDb = dbRows[0] && dbRows[0].db;
    check('connected database matches target', actualDb === database, `actual: ${actualDb}`);

    const { schemaPath, tables } = expectedTables();
    if (tables.length === 0) {
      check('schema file parse', false, `no CREATE TABLE statements found at ${schemaPath}`);
    } else {
      const [rows] = await conn.query(
        'SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?',
        [database]
      );
      const present = new Set(rows.map(r => String(r.t)));
      const missingTables = tables.filter(t => !present.has(t));
      check(
        `schema tables (${tables.length} expected)`,
        missingTables.length === 0,
        missingTables.length ? `missing: ${missingTables.join(', ')}` : 'all present'
      );
    }

    const [orgs] = await conn.query('SELECT id FROM organizations');
    const orgIds = orgs.map(o => o.id);
    check(
      'organizations rows readable',
      Array.isArray(orgIds),
      `ids: ${orgIds.length ? orgIds.join(', ') : '(none yet)'}`
    );
  } catch (err) {
    check('connect + query', false, err.message && !String(err.message).includes(password) ? err.message : 'connection error');
  } finally {
    if (conn) await conn.end().catch(() => {});
  }

  const failed = results.filter(r => !r.ok).length;
  console.log('');
  console.log(failed === 0 ? 'RESULT: PASS (all checks green)' : `RESULT: FAIL (${failed} check(s) failed)`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('RESULT: FAIL (unexpected error)', err.message);
  process.exit(1);
});