#!/usr/bin/env python3
"""
Inspect database row counts and recent orders in Python.
"""
import io
import sys
from pathlib import Path

# Ensure UTF-8 output on Windows console
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

import pymysql
from backend.config import MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE

def main():
    try:
        conn = pymysql.connect(
            host=MYSQL_HOST,
            port=MYSQL_PORT,
            user=MYSQL_USER,
            password=MYSQL_PASSWORD,
            database=MYSQL_DATABASE,
            charset="utf8mb4",
            cursorclass=pymysql.cursors.DictCursor,
            connect_timeout=5,
        )
        print(f"Connected to MySQL -> {MYSQL_HOST}:{MYSQL_PORT}/{MYSQL_DATABASE}\n")

        with conn.cursor() as cursor:
            counts = {}
            for table in ("purchase_orders", "product_lines", "milestones", "product_catalog", "audit_logs"):
                try:
                    cursor.execute(f"SELECT COUNT(*) AS c FROM {table}")
                    counts[table] = cursor.fetchone()["c"]
                except Exception:
                    counts[table] = "N/A"

            print("--- Table Row Counts ---")
            for k, v in counts.items():
                print(f"  {k}: {v}")

            print("\n--- Recent Purchase Orders ---")
            cursor.execute("SELECT po_number, customer_name, status, po_date, updated_at FROM purchase_orders ORDER BY updated_at DESC LIMIT 10")
            rows = cursor.fetchall()
            if rows:
                for r in rows:
                    print(f"  {r.get('po_number')} | {r.get('customer_name')} | {r.get('status')} | {r.get('po_date')}")
            else:
                print("  (no orders in database)")

        conn.close()
    except Exception as e:
        print(f"Failed to query database: {e}")
        return 1
    return 0

if __name__ == "__main__":
    sys.exit(main())

