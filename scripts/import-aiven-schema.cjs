
const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");

async function main() {
  const root = path.resolve(__dirname, "..");
  const schemaPath = path.join(root, "database", "mysql-schema.sql");

  const required = [
    "AIVEN_MYSQL_HOST",
    "AIVEN_MYSQL_PORT",
    "AIVEN_MYSQL_DATABASE",
    "AIVEN_MYSQL_USER",
    "AIVEN_MYSQL_PASSWORD",
    "AIVEN_MYSQL_CA_PATH",
  ];

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing environment variable: ${key}`);
    }
  }

  const sql = fs.readFileSync(schemaPath, "utf8");
  const forbidden =
    /^\s*(DROP\s+(DATABASE|TABLE)|TRUNCATE\s+TABLE|CREATE\s+DATABASE|USE\s+)/im;

  if (forbidden.test(sql)) {
    throw new Error("Schema contains a prohibited statement. Import cancelled.");
  }

  const caPath = path.resolve(process.env.AIVEN_MYSQL_CA_PATH);
  const ca = fs.readFileSync(caPath);

  const db = await mysql.createConnection({
    host: process.env.AIVEN_MYSQL_HOST,
    port: Number(process.env.AIVEN_MYSQL_PORT),
    user: process.env.AIVEN_MYSQL_USER,
    password: process.env.AIVEN_MYSQL_PASSWORD,
    database: process.env.AIVEN_MYSQL_DATABASE,
    ssl: {
      ca,
      rejectUnauthorized: true,
    },
    multipleStatements: true,
    connectTimeout: 20000,
  });

  try {
    const [existing] = await db.query(
      `SELECT TABLE_NAME
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
      [process.env.AIVEN_MYSQL_DATABASE]
    );

    if (existing.length > 0) {
      throw new Error(
        `Database already contains ${existing.length} tables. Import cancelled to avoid conflicts.`
      );
    }

    console.log("Connected securely. Target database is empty.");
    console.log("Importing schema...");

    await db.query(sql);

    const [tables] = await db.query(
      `SELECT TABLE_NAME
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME`,
      [process.env.AIVEN_MYSQL_DATABASE]
    );

    console.log(`Import complete. Tables created: ${tables.length}`);
    for (const table of tables) {
      console.log(`- ${table.TABLE_NAME}`);
    }

    if (tables.length !== 19) {
      throw new Error(
        `Expected 19 tables, but found ${tables.length}. Review the schema.`
      );
    }
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error("Schema import failed:", error.message);
  process.exitCode = 1;
});
