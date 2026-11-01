
const mysql = require("mysql2/promise");
const fs = require("node:fs");

async function main() {
  const ca = fs.readFileSync(process.env.AIVEN_MYSQL_CA_PATH, "utf8");

  const connection = await mysql.createConnection({
    host: process.env.AIVEN_MYSQL_HOST,
    port: Number(process.env.AIVEN_MYSQL_PORT),
    user: process.env.AIVEN_MYSQL_USER,
    password: process.env.AIVEN_MYSQL_PASSWORD,
    database: process.env.AIVEN_MYSQL_DATABASE,
    ssl: { ca, rejectUnauthorized: true }
  });

  try {
    const [rows] = await connection.query(
      `SELECT TABLE_NAME
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ?
         AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME`,
      [process.env.AIVEN_MYSQL_DATABASE]
    );

    console.log("Database:", process.env.AIVEN_MYSQL_DATABASE);
    console.log("Table count:", rows.length);
    rows.forEach(row => console.log("-", row.TABLE_NAME));

    if (rows.length !== 19) {
      throw new Error(`Expected 19 tables; found ${rows.length}`);
    }

    console.log("Schema verification passed.");
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error("Verification failed:", error.message);
  process.exitCode = 1;
});
