#!/usr/bin/env node
const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  const host = process.env.MYSQL_HOST || '127.0.0.1';
  const port = Number(process.env.MYSQL_PORT || 3306);
  const user = process.env.MYSQL_USER || 'cft_app';
  const password = process.env.MYSQL_PASSWORD;
  const database = process.env.MYSQL_DATABASE || 'circor_e2e_dev';

  let conn;
  try {
    conn = await mysql.createConnection({ host, port, user, password, database });
    console.log(`Connected to MySQL -> ${host}:${port}/${database}\n`);

    const [counts] = await conn.query(`
      SELECT 
        (SELECT COUNT(*) FROM purchase_orders) AS purchase_orders,
        (SELECT COUNT(*) FROM product_lines) AS product_lines,
        (SELECT COUNT(*) FROM milestones) AS milestones,
        (SELECT COUNT(*) FROM product_catalog) AS product_catalog,
        (SELECT COUNT(*) FROM audit_logs) AS audit_logs
    `);
    console.log('--- Table Row Counts ---');
    console.table(counts);

    const [orders] = await conn.query(`
      SELECT po_number, customer_name, status, po_date, updated_at 
      FROM purchase_orders 
      ORDER BY updated_at DESC 
      LIMIT 10
    `);
    console.log('--- Recent Purchase Orders in Database ---');
    console.table(orders);
  } catch (err) {
    console.error('Failed to query database:', err.message);
    process.exit(1);
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

main();
