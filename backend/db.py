"""
MySQL connection pool for the FastAPI backend.
Uses PyMySQL (pure Python) with a simple pool.
Falls back to in-memory + file storage when MySQL is not configured.
"""
import asyncio
import json
import logging
import time
from pathlib import Path
from typing import Any, Optional

import pymysql
import pymysql.cursors

from .config import (
    MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE,
    MYSQL_CONNECTION_LIMIT, STATE_FILE_PATH, is_db_configured
)

logger = logging.getLogger("cft.db")

# ---------------------------------------------------------------------------
# Simple synchronous connection pool (thread-safe via lock)
# ---------------------------------------------------------------------------

_pool: list[pymysql.connections.Connection] = []
_pool_lock = asyncio.Lock()
_is_connected = False
_warned_missing_env = False
_last_failed_connect_time: float = 0.0
DB_RETRY_COOLDOWN_SECS: float = 15.0


def _make_connection(force: bool = False) -> Optional[pymysql.connections.Connection]:
    global _last_failed_connect_time
    now = time.time()
    if not force and (now - _last_failed_connect_time < DB_RETRY_COOLDOWN_SECS):
        return None

    try:
        conn = pymysql.connect(
            host=MYSQL_HOST,
            port=MYSQL_PORT,
            user=MYSQL_USER,
            password=MYSQL_PASSWORD,
            database=MYSQL_DATABASE,
            charset="utf8mb4",
            cursorclass=pymysql.cursors.DictCursor,
            autocommit=False,
            connect_timeout=3,
        )
        _last_failed_connect_time = 0.0
        return conn
    except Exception as e:
        _last_failed_connect_time = time.time()
        logger.error(f"[DB] Connection failed: {e}")
        return None


async def get_connection(force: bool = False) -> Optional[pymysql.connections.Connection]:
    """Get a fresh connection. Returns None if DB is not configured or in cooldown."""
    global _is_connected, _warned_missing_env

    if not is_db_configured():
        if not _warned_missing_env:
            _warned_missing_env = True
            logger.warning("[DB] MySQL not fully configured — running in fallback mode.")
        _is_connected = False
        return None

    loop = asyncio.get_event_loop()
    conn = await loop.run_in_executor(None, _make_connection, force)
    if conn:
        _is_connected = True
    else:
        _is_connected = False
    return conn


def is_db_connected() -> bool:
    return _is_connected


async def ping_db() -> bool:
    """Ping DB to verify connection. Updates _is_connected."""
    global _is_connected
    if not is_db_configured():
        _is_connected = False
        return False
    conn = await get_connection()
    if conn:
        try:
            conn.close()
        except Exception:
            pass
        _is_connected = True
        return True
    _is_connected = False
    return False


# ---------------------------------------------------------------------------
# In-Memory + File fallback state (mirrors Node server behaviour)
# ---------------------------------------------------------------------------

_memory_state: dict[str, Any] = {}
_is_dirty = False
_state_file = Path(STATE_FILE_PATH)


def _load_state_from_disk() -> None:
    global _memory_state
    if _state_file.exists():
        try:
            _memory_state = json.loads(_state_file.read_text(encoding="utf-8"))
            logger.info(f"[Storage] Loaded state from {_state_file} ({len(_memory_state)} keys)")
        except Exception as e:
            logger.warning(f"[Storage] Could not read state file: {e}")
            _memory_state = {}


def _save_state_to_disk() -> None:
    global _is_dirty
    try:
        _state_file.write_text(json.dumps(_memory_state, indent=2), encoding="utf-8")
        _is_dirty = False
    except Exception as e:
        logger.error(f"[Storage] Failed to write state: {e}")
        _is_dirty = False


def schedule_state_save() -> None:
    global _is_dirty
    if not _is_dirty:
        _is_dirty = True
        # Defer to background task
        asyncio.create_task(_deferred_save())


async def _deferred_save() -> None:
    await asyncio.sleep(0.1)
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _save_state_to_disk)


def get_memory_state() -> dict[str, Any]:
    return _memory_state


def update_memory_state(update: dict[str, Any]) -> None:
    _memory_state.update(update)
    schedule_state_save()


# ---------------------------------------------------------------------------
# Tombstones
# ---------------------------------------------------------------------------

TOMBSTONE_KEY = "__deleted_order_ids__"
TOMBSTONE_TTL_MS = 7 * 24 * 60 * 60 * 1000  # 7 days
TOMBSTONE_MAX = 1000


def _get_tombstones() -> dict[str, str]:
    raw = _memory_state.get(TOMBSTONE_KEY)
    if isinstance(raw, dict):
        return dict(raw)
    return {}


def _prune_tombstones(ts_map: dict[str, str]) -> dict[str, str]:
    cutoff = time.time() * 1000 - TOMBSTONE_TTL_MS
    entries = [
        (k, v) for k, v in ts_map.items()
        if _parse_iso_ms(v) >= cutoff
    ]
    if len(entries) > TOMBSTONE_MAX:
        entries = entries[-TOMBSTONE_MAX:]
    return dict(entries)


def _parse_iso_ms(iso: str) -> float:
    try:
        from datetime import datetime, timezone
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return dt.timestamp() * 1000
    except Exception:
        return 0.0


def tombstone_order(order_id: str) -> None:
    from datetime import datetime, timezone
    current = _get_tombstones()
    current[order_id] = datetime.now(timezone.utc).isoformat()
    _memory_state[TOMBSTONE_KEY] = _prune_tombstones(current)
    schedule_state_save()


def untombstone_order(order_id: str) -> None:
    current = _get_tombstones()
    if order_id in current:
        del current[order_id]
        _memory_state[TOMBSTONE_KEY] = current
        schedule_state_save()


def is_order_tombstoned(order_id: str) -> bool:
    ts_map = _get_tombstones()
    iso = ts_map.get(order_id)
    if not iso:
        return False
    age_ms = time.time() * 1000 - _parse_iso_ms(iso)
    return age_ms < TOMBSTONE_TTL_MS


def strip_tombstoned_orders(orders: list[dict]) -> list[dict]:
    return [o for o in orders if o and o.get("id") and not is_order_tombstoned(o["id"])]


# Initialize state from disk on import
_load_state_from_disk()

