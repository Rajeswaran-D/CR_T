#!/usr/bin/env python3
"""
Local MySQL connectivity & schema check for CIRCOR E2E tracker in Python.
Read-only: checks connection and verifies schema tables without modifying data.
"""
import io
import os
import re
import sys
from pathlib import Path

# Ensure UTF-8 output on Windows console
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

import pymysql
from backend.config import (
    MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE,
    missing_db_vars
)
from backend.mysql_adapter import EXPECTED_TABLES

def check(name: str, ok: bool, detail: str = "") -> bool:
    status = "PASS" if ok else "FAIL"
    print(f"{status}  {name}{f' — {detail}' if detail else ''}")
    return ok

def expected_tables():
    schema_path = ROOT / "database" / "mysql-schema.sql"
    if not schema_path.exists():
        return []
    sql = schema_path.read_text(encoding="utf-8")
    tables = []
    for m in re.finditer(r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z0-9_]+)`?", sql, re.IGNORECASE):
        t = m.group(1)
        if t not in tables:
            tables.append(t)
    return tables

def main():
    print("--- CIRCOR local database check (Python / PyMySQL) ---")
    missing = missing_db_vars()
    if missing:
        check("env configuration", False, f"missing: {', '.join(missing)}")
        return 1

    print(f"Target: {MYSQL_HOST}:{MYSQL_PORT}/{MYSQL_DATABASE} (user: {MYSQL_USER})\n")
    conn = None
    results = []
    try:
        conn = pymysql.connect(
            host=MYSQL_HOST,
            port=MYSQL_PORT,
            user=MYSQL_USER,
            password=MYSQL_PASSWORD,
            database=MYSQL_DATABASE,
            charset="utf8mb4",
            connect_timeout=5,
        )
        with conn.cursor() as cursor:
            cursor.execute("SELECT 1 AS ok")
            row = cursor.fetchone()
            results.append(check("connect + SELECT 1", bool(row and row[0] == 1)))

            cursor.execute("SELECT DATABASE() AS db")
            row = cursor.fetchone()
            actual_db = row[0] if row else ""
            results.append(check("connected database matches target", actual_db == MYSQL_DATABASE, f"actual: {actual_db}"))

            tables = expected_tables()
            cursor.execute("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = %s", (MYSQL_DATABASE,))
            present = {r[0] for r in cursor.fetchall()}
            missing_tables = [t for t in tables if t not in present]
            results.append(check(f"schema tables ({len(tables)} expected)", len(missing_tables) == 0, f"missing: {', '.join(missing_tables)}" if missing_tables else "all present"))

            cursor.execute("SELECT id FROM organizations")
            orgs = [r[0] for r in cursor.fetchall()]
            results.append(check("organizations rows readable", True, f"ids: {', '.join(orgs) if orgs else '(none yet)'}"))

    except Exception as e:
        results.append(check("connect + query", False, str(e)))
    finally:
        if conn:
            conn.close()

    failed = sum(1 for r in results if not r)
    print("")
    print("RESULT: PASS (all checks green)" if failed == 0 else f"RESULT: FAIL ({failed} check(s) failed)")
    return 0 if failed == 0 else 1

if __name__ == "__main__":
    sys.exit(main())

