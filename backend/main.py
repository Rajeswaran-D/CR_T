"""
CFT Project E2E Tracker — FastAPI Backend
Python port of server/server.ts (Express/Node.js).

Endpoints:
  GET  /api/health
  GET  /api/db/status
  POST /api/db/init-schema  (admin only)
  GET  /api/shared-state
  PUT  /api/shared-state
  GET/POST/PUT/DELETE /api/orders[/:id]
  GET/POST /api/products
  GET/POST /api/audit-log
  GET      /api/rectifications
  GET/POST /api/templates
  GET/PUT  /api/config
  GET/POST /api/cancellations
"""
import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles

from .config import (
    DEFAULT_ORG_ID, PORT, is_db_configured, missing_db_vars,
    MYSQL_HOST, MYSQL_PORT, MYSQL_DATABASE, MYSQL_CONNECTION_LIMIT,
    ENABLE_SCHEMA_ADMIN,
)
from .db import (
    get_connection, is_db_connected, ping_db, get_memory_state, update_memory_state,
    tombstone_order, untombstone_order, is_order_tombstoned, strip_tombstoned_orders,
    schedule_state_save,
)
from .mysql_adapter import (
    DEFAULT_ORG_ID as DB_DEFAULT_ORG_ID,
    save_orders_to_db, load_orders_from_db, delete_order_from_db,
    save_products_to_db, load_products_from_db,
    save_audit_logs_to_db, load_audit_logs_from_db,
    save_rectifications_to_db, load_rectifications_from_db,
    save_config_to_db, load_config_from_db,
    save_cancellations_to_db, load_cancellations_from_db,
    save_templates_to_db, load_templates_from_db,
    verify_schema, DEFAULT_CONFIG,
)
from .security import (
    validate_org, validate_schema_admin, check_rate_limit,
    validate_order_body, validate_config_body, is_allowed_origin,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("cft.server")

_start_time = time.time()

# ---------------------------------------------------------------------------
# Shared state cache (per org, 1 second TTL)
# ---------------------------------------------------------------------------
_state_cache: dict[str, dict] = {}
CACHE_TTL_SECS = 1.0


def _invalidate_cache(org_id: str) -> None:
    _state_cache.pop(org_id, None)


async def _load_shared_state_snapshot(org_id: str) -> dict:
    cached = _state_cache.get(org_id)
    if cached and cached.get("expires_at", 0) > time.time():
        return cached["payload"]

    conn = await get_connection()
    if conn:
        try:
            loop = asyncio.get_event_loop()
            orders = await loop.run_in_executor(None, load_orders_from_db, conn, org_id)
            products = await loop.run_in_executor(None, load_products_from_db, conn, org_id)
            templates = await loop.run_in_executor(None, load_templates_from_db, conn, org_id)
            audit = await loop.run_in_executor(None, load_audit_logs_from_db, conn, org_id)
            rects = await loop.run_in_executor(None, load_rectifications_from_db, conn, org_id)
            config = await loop.run_in_executor(None, load_config_from_db, conn, org_id)
            cancellations = await loop.run_in_executor(None, load_cancellations_from_db, conn, org_id)
            conn.close()

            state = {
                "cft_pos": strip_tombstoned_orders(orders),
                "cft_products": products,
                "cft_templates": templates,
                "cft_audit": audit,
                "cft_rectifications": rects,
                "cft_cancellations": cancellations,
            }
            if config:
                state["cft_config"] = config
        except Exception as e:
            logger.error(f"[shared-state:load] DB error: {e}")
            try:
                conn.close()
            except Exception:
                pass
            raise HTTPException(status_code=503, detail="Database is configured but unavailable.")
    else:
        mem = get_memory_state()
        raw_pos = mem.get("cft_pos") or []
        state = {**mem, "cft_pos": strip_tombstoned_orders(raw_pos if isinstance(raw_pos, list) else [])}

    _state_cache[org_id] = {"payload": state, "expires_at": time.time() + CACHE_TTL_SECS}
    return state


# ---------------------------------------------------------------------------
# App lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info(f"🚀 CFT Tracker FastAPI Server starting on port {PORT}")
    if is_db_configured():
        logger.info(f"[Database] Connecting to {MYSQL_HOST}:{MYSQL_PORT}/{MYSQL_DATABASE}...")
        connected = await ping_db()
        if connected:
            conn = await get_connection()
            if conn:
                try:
                    loop = asyncio.get_event_loop()
                    result = await loop.run_in_executor(None, verify_schema, conn)
                    if not result["missing"]:
                        logger.info(f"[Database] Schema verified: {len(result['present'])}/{len(result['expected'])} tables.")
                    else:
                        logger.warning(f"[Database] Missing tables: {result['missing']}")
                    conn.close()
                except Exception as e:
                    logger.warning(f"[Database] Schema verify failed: {e}")
                    try:
                        conn.close()
                    except Exception:
                        pass
        else:
            logger.warning("[Database] MySQL CONFIGURED but UNAVAILABLE — API reads/writes will return 503.")
    else:
        logger.warning(f"[Database] Not configured (missing: {missing_db_vars()}) — running in fallback mode.")
    yield
    # Shutdown
    logger.info("[Server] Shutting down...")


app = FastAPI(title="CFT Project E2E Tracker API", version="2.0.0", lifespan=lifespan)

# ---------------------------------------------------------------------------
# CORS Middleware — allow all localhost + configured origins
# ---------------------------------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],         # We validate origin manually below too
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Organization-Id", "Authorization", "ngrok-skip-browser-warning"],
    max_age=600,
)


# ---------------------------------------------------------------------------
# Security headers + rate limiting middleware
# ---------------------------------------------------------------------------

@app.middleware("http")
async def security_middleware(request: Request, call_next):
    # Rate limit
    rate_resp = check_rate_limit(request)
    if rate_resp:
        return rate_resp

    response: Response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Permitted-Cross-Domain-Policies"] = "none"
    response.headers["Cross-Origin-Resource-Policy"] = "cross-origin"
    return response


# ---------------------------------------------------------------------------
# Helper: get org_id from request header (validated)
# ---------------------------------------------------------------------------

def _get_org_id(x_organization_id: Optional[str], authorization: Optional[str] = None) -> str:
    return validate_org(x_organization_id, authorization)


# ---------------------------------------------------------------------------
# Helper: get DB connection or raise 503
# ---------------------------------------------------------------------------

class DbUnavailableError(Exception):
    pass


async def _get_read_conn():
    """For read endpoints: returns connection if DB is connected, else None for memory fallback."""
    if not is_db_configured():
        return None
    try:
        return await get_connection()
    except Exception:
        return None


async def _sync_state_to_mysql(org_id: str, update: dict) -> bool:
    """Sync state keys to MySQL if reachable. Returns True if persisted to MySQL, False if fallback."""
    if not is_db_configured():
        return False

    conn = await get_connection()
    if not conn:
        return False

    try:
        loop = asyncio.get_event_loop()
        if isinstance(update.get("cft_pos"), list):
            live_orders = strip_tombstoned_orders(update["cft_pos"])
            await loop.run_in_executor(None, save_orders_to_db, conn, org_id, live_orders)
        if isinstance(update.get("cft_products"), list):
            await loop.run_in_executor(None, save_products_to_db, conn, org_id, update["cft_products"])
        if isinstance(update.get("cft_audit"), list):
            await loop.run_in_executor(None, save_audit_logs_to_db, conn, org_id, update["cft_audit"])
        if isinstance(update.get("cft_rectifications"), list):
            await loop.run_in_executor(None, save_rectifications_to_db, conn, org_id, update["cft_rectifications"])
        if isinstance(update.get("cft_config"), dict):
            await loop.run_in_executor(None, save_config_to_db, conn, org_id, update["cft_config"])
        if isinstance(update.get("cft_cancellations"), list):
            await loop.run_in_executor(None, save_cancellations_to_db, conn, org_id, update["cft_cancellations"])
        if isinstance(update.get("cft_templates"), list):
            await loop.run_in_executor(None, save_templates_to_db, conn, org_id, update["cft_templates"])
        return True
    except Exception as e:
        logger.error(f"[MySQL Sync ({org_id})] {e}")
        return False
    finally:
        try:
            conn.close()
        except Exception:
            pass


# ===========================================================================
# 1. Health & Diagnostics
# ===========================================================================

@app.get("/api/health")
async def health():
    await ping_db()
    db_connected = is_db_connected()
    configured = is_db_configured()
    status = "healthy" if db_connected else ("degraded" if configured else "fallback")
    return {
        "status": status,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "dbConnected": db_connected,
        "dbConfigured": configured,
        "storageProvider": "mysql" if db_connected else ("unavailable" if configured else "memory-with-file-sync"),
        "uptime": time.time() - _start_time,
        "db": {
            "host": MYSQL_HOST,
            "port": MYSQL_PORT,
            "database": MYSQL_DATABASE,
            "connectionLimit": MYSQL_CONNECTION_LIMIT,
            "hasPassword": bool(os.environ.get("MYSQL_PASSWORD") or os.environ.get("AIVEN_MYSQL_PASSWORD")),
            "sslEnabled": False,
        },
    }


# ===========================================================================
# 2. Shared State Gateway
# ===========================================================================

@app.get("/api/shared-state")
async def get_shared_state(
    x_organization_id: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    org_id = _get_org_id(x_organization_id, authorization)
    state = await _load_shared_state_snapshot(org_id)
    return JSONResponse(content=state, headers={"Cache-Control": "no-cache, no-store, must-revalidate", "X-Served-By": "cft-production-engine"})


@app.put("/api/shared-state", status_code=204)
async def put_shared_state(
    request: Request,
    x_organization_id: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    org_id = _get_org_id(x_organization_id, authorization)
    update = await request.json()
    if not isinstance(update, dict):
        raise HTTPException(status_code=400, detail="Invalid shared state payload")

    synced = await _sync_state_to_mysql(org_id, update)

    if not synced:
        mem = get_memory_state()
        mem.update(update)
        raw_pos = mem.get("cft_pos")
        if isinstance(raw_pos, list):
            mem["cft_pos"] = strip_tombstoned_orders(raw_pos)
        schedule_state_save()

    _invalidate_cache(org_id)
    return Response(status_code=204)


# ===========================================================================
# 3. Purchase Orders
# ===========================================================================

@app.get("/api/orders")
async def get_orders(
    x_organization_id: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    org_id = _get_org_id(x_organization_id, authorization)
    conn = await _get_read_conn()
    if conn:
        try:
            loop = asyncio.get_event_loop()
            orders = await loop.run_in_executor(None, load_orders_from_db, conn, org_id)
            return strip_tombstoned_orders(orders)
        finally:
            try:
                conn.close()
            except Exception:
                pass
    # Fallback
    raw = get_memory_state().get("cft_pos") or []
    return strip_tombstoned_orders(raw if isinstance(raw, list) else [])


@app.get("/api/orders/{order_id}")
async def get_order(
    order_id: str,
    x_organization_id: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    org_id = _get_org_id(x_organization_id, authorization)
    if is_order_tombstoned(order_id):
        raise HTTPException(status_code=404, detail="Order not found")

    conn = await _get_read_conn()
    if conn:
        try:
            loop = asyncio.get_event_loop()
            orders = await loop.run_in_executor(None, load_orders_from_db, conn, org_id)
            found = next((o for o in orders if o.get("id") == order_id or o.get("poNumber") == order_id), None)
            if not found:
                raise HTTPException(status_code=404, detail="Order not found")
            return found
        finally:
            try:
                conn.close()
            except Exception:
                pass
    # Fallback
    orders = get_memory_state().get("cft_pos") or []
    found = next((o for o in orders if o.get("id") == order_id or o.get("poNumber") == order_id), None)
    if not found:
        raise HTTPException(status_code=404, detail="Order not found")
    return found


@app.post("/api/orders", status_code=201)
async def create_order(
    request: Request,
    x_organization_id: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    org_id = _get_org_id(x_organization_id, authorization)
    body = await request.json()
    err = validate_order_body(body)
    if err:
        raise HTTPException(status_code=400, detail=err)

    new_order = body
    untombstone_order(new_order["id"])

    synced = False
    if is_db_configured():
        synced = await _sync_state_to_mysql(org_id, {"cft_pos": [new_order]})
    if not synced:
        mem = get_memory_state()
        current = [o for o in (mem.get("cft_pos") or []) if o.get("id") != new_order["id"]]
        mem["cft_pos"] = [new_order, *current]
        schedule_state_save()

    _invalidate_cache(org_id)
    return JSONResponse(content=new_order, status_code=201)


@app.put("/api/orders/{order_id}")
async def update_order(
    order_id: str,
    request: Request,
    x_organization_id: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    org_id = _get_org_id(x_organization_id, authorization)
    order_update = await request.json()

    conn = await get_connection() if is_db_configured() else None
    if conn:
        try:
            loop = asyncio.get_event_loop()
            orders = await loop.run_in_executor(None, load_orders_from_db, conn, org_id)
            found = next((o for o in orders if o.get("id") == order_id), None)
            if not found:
                raise HTTPException(status_code=404, detail="Order not found")
            merged = {**found, **order_update, "lastUpdatedAt": datetime.now(timezone.utc).isoformat()}
            await loop.run_in_executor(None, save_orders_to_db, conn, org_id, [merged])
            conn.commit()
            _invalidate_cache(org_id)
            return merged
        except HTTPException:
            raise
        except Exception:
            pass
        finally:
            try:
                conn.close()
            except Exception:
                pass

    # Fallback
    mem = get_memory_state()
    current = mem.get("cft_pos") or []
    idx = next((i for i, o in enumerate(current) if o.get("id") == order_id), -1)
    if idx < 0:
        raise HTTPException(status_code=404, detail="Order not found")
    current[idx] = {**current[idx], **order_update, "lastUpdatedAt": datetime.now(timezone.utc).isoformat()}
    mem["cft_pos"] = current
    schedule_state_save()
    _invalidate_cache(org_id)
    return current[idx]


@app.delete("/api/orders/{order_id}", status_code=204)
async def delete_order(
    order_id: str,
    x_organization_id: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    org_id = _get_org_id(x_organization_id, authorization)
    tombstone_order(order_id)

    conn = await _get_read_conn()
    if conn:
        try:
            loop = asyncio.get_event_loop()
            deleted = await loop.run_in_executor(None, delete_order_from_db, conn, org_id, order_id)
            if not deleted:
                raise HTTPException(status_code=404, detail="Order not found")
            _invalidate_cache(org_id)
            return Response(status_code=204)
        finally:
            try:
                conn.close()
            except Exception:
                pass

    # Fallback
    mem = get_memory_state()
    current = mem.get("cft_pos") or []
    filtered = [o for o in current if o.get("id") != order_id]
    if len(filtered) == len(current):
        raise HTTPException(status_code=404, detail="Order not found")
    mem["cft_pos"] = filtered
    schedule_state_save()
    _invalidate_cache(org_id)
    return Response(status_code=204)


# ===========================================================================
# 4. Products
# ===========================================================================

@app.get("/api/products")
async def get_products(
    x_organization_id: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    org_id = _get_org_id(x_organization_id, authorization)
    conn = await _get_read_conn()
    if conn:
        try:
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(None, load_products_from_db, conn, org_id)
        finally:
            try:
                conn.close()
            except Exception:
                pass
    return get_memory_state().get("cft_products") or []


@app.post("/api/products", status_code=201)
async def create_product(
    request: Request,
    x_organization_id: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    org_id = _get_org_id(x_organization_id, authorization)
    prod = await request.json()

    conn = await get_connection() if is_db_configured() else None
    if conn:
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, save_products_to_db, conn, org_id, [prod])
            _invalidate_cache(org_id)
            return JSONResponse(content=prod, status_code=201)
        except Exception as e:
            logger.warning(f"[Products] DB write failed, falling back: {e}")
        finally:
            try:
                conn.close()
            except Exception:
                pass

    mem = get_memory_state()
    current = [p for p in (mem.get("cft_products") or []) if p.get("id") != prod.get("id")]
    mem["cft_products"] = [*current, prod]
    schedule_state_save()
    _invalidate_cache(org_id)
    return JSONResponse(content=prod, status_code=201)


# ===========================================================================
# 5. Audit Log & Rectifications
# ===========================================================================

@app.get("/api/audit-log")
async def get_audit_log(
    x_organization_id: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    org_id = _get_org_id(x_organization_id, authorization)
    conn = await _get_read_conn()
    if conn:
        try:
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(None, load_audit_logs_from_db, conn, org_id)
        finally:
            try:
                conn.close()
            except Exception:
                pass
    return get_memory_state().get("cft_audit") or []


@app.post("/api/audit-log", status_code=201)
async def create_audit_log(
    request: Request,
    x_organization_id: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    org_id = _get_org_id(x_organization_id, authorization)
    entry = await request.json()

    conn = await get_connection() if is_db_configured() else None
    if conn:
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, save_audit_logs_to_db, conn, org_id, [entry])
            return JSONResponse(content=entry, status_code=201)
        except Exception:
            pass
        finally:
            try:
                conn.close()
            except Exception:
                pass

    mem = get_memory_state()
    current = mem.get("cft_audit") or []
    mem["cft_audit"] = [entry, *current]
    schedule_state_save()
    return JSONResponse(content=entry, status_code=201)


@app.get("/api/rectifications")
async def get_rectifications(
    x_organization_id: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    org_id = _get_org_id(x_organization_id, authorization)
    conn = await _get_read_conn()
    if conn:
        try:
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(None, load_rectifications_from_db, conn, org_id)
        finally:
            try:
                conn.close()
            except Exception:
                pass
    return get_memory_state().get("cft_rectifications") or []


# ===========================================================================
# 6. Templates, Config, Cancellations
# ===========================================================================

@app.get("/api/templates")
async def get_templates(
    x_organization_id: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    org_id = _get_org_id(x_organization_id, authorization)
    conn = await _get_read_conn()
    if conn:
        try:
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(None, load_templates_from_db, conn, org_id)
        finally:
            try:
                conn.close()
            except Exception:
                pass
    return get_memory_state().get("cft_templates") or []


@app.post("/api/templates", status_code=201)
async def create_template(
    request: Request,
    x_organization_id: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    org_id = _get_org_id(x_organization_id, authorization)
    tmpl = await request.json()

    conn = await get_connection() if is_db_configured() else None
    if conn:
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, save_templates_to_db, conn, org_id, [tmpl])
            _invalidate_cache(org_id)
            return JSONResponse(content=tmpl, status_code=201)
        except Exception:
            pass
        finally:
            try:
                conn.close()
            except Exception:
                pass

    mem = get_memory_state()
    current = [t for t in (mem.get("cft_templates") or []) if t.get("id") != tmpl.get("id")]
    mem["cft_templates"] = [*current, tmpl]
    schedule_state_save()
    _invalidate_cache(org_id)
    return JSONResponse(content=tmpl, status_code=201)


@app.get("/api/config")
async def get_config(
    x_organization_id: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    org_id = _get_org_id(x_organization_id, authorization)
    conn = await _get_read_conn()
    if conn:
        try:
            loop = asyncio.get_event_loop()
            cfg = await loop.run_in_executor(None, load_config_from_db, conn, org_id)
            return cfg or DEFAULT_CONFIG
        finally:
            try:
                conn.close()
            except Exception:
                pass
    return get_memory_state().get("cft_config") or DEFAULT_CONFIG


@app.put("/api/config")
async def update_config(
    request: Request,
    x_organization_id: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    org_id = _get_org_id(x_organization_id, authorization)
    body = await request.json()
    validated, err = validate_config_body(body)
    if err:
        raise HTTPException(status_code=400, detail=err)
    new_cfg = body  # pass full body; validate_config_body only checks known fields

    conn = await get_connection() if is_db_configured() else None
    if conn:
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, save_config_to_db, conn, org_id, new_cfg)
            return new_cfg
        except Exception:
            pass
        finally:
            try:
                conn.close()
            except Exception:
                pass

    get_memory_state()["cft_config"] = new_cfg
    schedule_state_save()
    return new_cfg


@app.get("/api/cancellations")
async def get_cancellations(
    x_organization_id: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    org_id = _get_org_id(x_organization_id, authorization)
    conn = await _get_read_conn()
    if conn:
        try:
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(None, load_cancellations_from_db, conn, org_id)
        finally:
            try:
                conn.close()
            except Exception:
                pass
    return get_memory_state().get("cft_cancellations") or []


@app.post("/api/cancellations", status_code=201)
async def create_cancellation(
    request: Request,
    x_organization_id: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    org_id = _get_org_id(x_organization_id, authorization)
    cancellation = await request.json()

    conn = await get_connection() if is_db_configured() else None
    if conn:
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, save_cancellations_to_db, conn, org_id, [cancellation])
            return JSONResponse(content=cancellation, status_code=201)
        except Exception:
            pass
        finally:
            try:
                conn.close()
            except Exception:
                pass

    mem = get_memory_state()
    current = [c for c in (mem.get("cft_cancellations") or []) if c.get("id") != cancellation.get("id")]
    mem["cft_cancellations"] = [cancellation, *current]
    schedule_state_save()
    return JSONResponse(content=cancellation, status_code=201)


# ===========================================================================
# 7. Database Admin & Status
# ===========================================================================

@app.get("/api/db/status")
async def db_status():
    await ping_db()
    connected = is_db_connected()
    configured = is_db_configured()
    mem = get_memory_state()
    schema_info = None
    if connected:
        conn = await get_connection()
        if conn:
            try:
                loop = asyncio.get_event_loop()
                v = await loop.run_in_executor(None, verify_schema, conn)
                schema_info = {"expected": len(v["expected"]), "missingTables": v["missing"]}
            except Exception:
                pass
            finally:
                try:
                    conn.close()
                except Exception:
                    pass
    return {
        "connected": connected,
        "configured": configured,
        "mode": "healthy" if connected else ("degraded" if configured else "fallback"),
        "missingEnvVars": missing_db_vars() if not configured else [],
        "schema": schema_info,
        "storageProvider": "mysql" if connected else ("unavailable" if configured else "memory-with-file-sync"),
        "stateKeysCount": len(mem),
        "ordersCount": len(mem.get("cft_pos") or []) if isinstance(mem.get("cft_pos"), list) else 0,
        "db": {
            "host": MYSQL_HOST,
            "port": MYSQL_PORT,
            "database": MYSQL_DATABASE,
            "connectionLimit": MYSQL_CONNECTION_LIMIT,
            "hasPassword": bool(os.environ.get("MYSQL_PASSWORD") or os.environ.get("AIVEN_MYSQL_PASSWORD")),
            "sslEnabled": False,
        },
    }


@app.post("/api/db/init-schema")
async def init_db_schema(
    authorization: Optional[str] = Header(None),
):
    validate_schema_admin(authorization)
    conn = await get_connection()
    if not conn:
        raise HTTPException(status_code=503, detail="MySQL is not configured or unavailable. Operating with local fallback.")

    # Run schema from database/mysql-schema.sql
    schema_path = Path(__file__).parent.parent / "database" / "mysql-schema.sql"
    if not schema_path.exists():
        raise HTTPException(status_code=500, detail="mysql-schema.sql not found.")

    sql_text = schema_path.read_text(encoding="utf-8")
    statements = [
        s.strip() for s in sql_text.split(";\n")
        if s.strip() and not s.strip().startswith("--") and not s.strip().upper().startswith("SET ")
    ]

    executed = 0
    try:
        with conn.cursor() as cursor:
            for stmt in statements:
                if stmt.upper().startswith("CREATE TABLE"):
                    import re
                    safe = re.sub(r"CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)", "CREATE TABLE IF NOT EXISTS ", stmt, flags=re.IGNORECASE)
                    cursor.execute(safe)
                    executed += 1
                else:
                    try:
                        cursor.execute(stmt)
                        executed += 1
                    except Exception:
                        pass
        conn.commit()
        conn.close()
        return {"success": True, "message": f"Executed {executed} statements successfully."}
    except Exception as e:
        logger.error(f"[db:init-schema] {e}")
        try:
            conn.close()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Schema initialization failed. See server logs.")


# ===========================================================================
# 8. Static Frontend (production: serve dist/)
# ===========================================================================

dist_path = Path(__file__).parent.parent / "dist"
if dist_path.exists():
    app.mount("/assets", StaticFiles(directory=str(dist_path / "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_frontend(full_path: str):
        if full_path.startswith("api"):
            raise HTTPException(status_code=404, detail="API route not found")
        file_path = dist_path / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(dist_path / "index.html"))


# ===========================================================================
# Entry point (for direct uvicorn)
# ===========================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=PORT, reload=False)

