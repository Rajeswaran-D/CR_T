import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password?: string;
  database: string;
  connectionLimit: number;
}

const dbConfig: DbConfig = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'cft_app',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'cft_tracker',
  connectionLimit: 10
};

let pool: mysql.Pool | null = null;
let isConnected = false;

export async function getDbPool(): Promise<mysql.Pool | null> {
  if (pool) return pool;

  // Don't attempt to connect if credentials are not provided
  if (!process.env.MYSQL_HOST && !process.env.MYSQL_DATABASE) {
    return null;
  }

  try {
    pool = mysql.createPool({
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      password: dbConfig.password,
      database: dbConfig.database,
      waitForConnections: true,
      connectionLimit: dbConfig.connectionLimit,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000
    });

    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    isConnected = true;
    console.log(`[Database] Connected to MySQL (${dbConfig.host}:${dbConfig.port}/${dbConfig.database})`);
    return pool;
  } catch (err: any) {
    console.warn(`[Database] MySQL connection skipped/unavailable: ${err.message}. Using fast local storage fallback.`);
    pool = null;
    isConnected = false;
    return null;
  }
}

export function isDbConnected(): boolean {
  return isConnected;
}
