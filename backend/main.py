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
import sys
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
    ENABLE_SCHEMA_ADMIN, get_allowed_origins,
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
    validate_product_body, validate_audit_body, validate_cancellation_body,
    validate_template_body, mask_host, sanitize_text, is_safe_id_string,
    sanitize_payload, validate_shared_state_keys,
)

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
        sys.stderr.reconfigure(encoding="utf-8", line_buffering=True)
    except Exception:
        pass

LOG_FILE = Path(__file__).parent.parent / "backend.log"

# Multi-output logging: console + backend.log
_file_handler = logging.FileHandler(LOG_FILE, encoding="utf-8")
_stream_handler = logging.StreamHandler(sys.stdout)
_formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
_file_handler.setFormatter(_formatter)
_stream_handler.setFormatter(_formatter)

logging.basicConfig(level=logging.INFO, handlers=[_stream_handler, _file_handler])
logger = logging.getLogger("cft.server")

# Ensure uvicorn logs propagate to root handlers
for _name in ("uvicorn", "uvicorn.access", "uvicorn.error"):
    _l = logging.getLogger(_name)
    _l.propagate = True

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
    # Startup: ensure uvicorn loggers output to file and console immediately
    for _name in ("uvicorn", "uvicorn.access", "uvicorn.error"):
        _l = logging.getLogger(_name)
        _l.propagate = True
        if _file_handler not in _l.handlers:
            _l.addHandler(_file_handler)

    logger.info(f"[CFT Tracker] FastAPI Server starting on port {PORT}")
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
# CORS Middleware — restricted to configured origins and loopback dev
# ---------------------------------------------------------------------------

allowed_origins_list = get_allowed_origins()

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins_list,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Organization-Id", "Authorization", "ngrok-skip-browser-warning"],
    max_age=600,
)


# ---------------------------------------------------------------------------
# Security headers + payload size limit + rate limiting middleware
# ---------------------------------------------------------------------------

MAX_REQUEST_BODY_BYTES = 25 * 1024 * 1024  # 25 MB


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    # Enforce request body size limits to prevent Denial of Service (DoS / OOM)
    cl = request.headers.get("content-length")
    if cl:
        try:
            if int(cl) > MAX_REQUEST_BODY_BYTES:
                return JSONResponse(status_code=413, content={"detail": "Payload too large (maximum 25MB)."})
        except (ValueError, TypeError):
            pass

    # Rate limit per validated client IP
    rate_resp = check_rate_limit(request)
    if rate_resp:
        return rate_resp

    response: Response = await call_next(request)

    # Information Disclosure Protection: Override web server signature banners
    if "server" in response.headers:
        try:
            del response.headers["server"]
        except Exception:
            pass
    response.headers["Server"] = "Web"

    # Comprehensive HTTP Security Headers
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Permitted-Cross-Domain-Policies"] = "none"
    response.headers["Cross-Origin-Resource-Policy"] = "cross-origin"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["X-DNS-Prefetch-Control"] = "off"
    response.headers["X-Download-Options"] = "noopen"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com data:; "
        "img-src 'self' data: blob:; "
        "connect-src 'self' http://localhost:* http://127.0.0.1:* https://circor-tracker-api.onrender.com https://*.onrender.com; "
        "frame-ancestors 'none'; "
        "base-uri 'self'; "
        "form-action 'self';"
    )

    # Data Theft & Cache Poisoning Protection: Prevent caching of confidential enterprise manufacturing data
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, private"
        response.headers["Pragma"] = "no-cache"

    return response


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Prevents stack traces and server path leakage on unexpected errors."""
    if isinstance(exc, HTTPException):
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    logger.error(f"[Security] Unhandled exception on {request.method} {request.url.path}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "An internal server error occurred. Please contact the administrator."}
    )
 

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Prevents stack traces and server path leakage on unexpected errors."""
    if isinstance(exc, HTTPException):
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    logger.error(f"[Security] Unhandled exception on {request.method} {request.url.path}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "An internal server error occurred. Please contact the administrator."}
    )


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
            "host": mask_host(MYSQL_HOST),
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
    key_err = validate_shared_state_keys(update)
    if key_err:
        raise HTTPException(status_code=400, detail=key_err)
    update = sanitize_payload(update)

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
    if not is_safe_id_string(order_id):
        raise HTTPException(status_code=400, detail="Invalid order identifier format.")
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

    new_order = sanitize_payload(body)
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
    if not is_safe_id_string(order_id):
        raise HTTPException(status_code=400, detail="Invalid order identifier format.")
    org_id = _get_org_id(x_organization_id, authorization)
    order_update = await request.json()
    if not isinstance(order_update, dict):
        raise HTTPException(status_code=400, detail="Request body must be a JSON object.")
    order_update = sanitize_payload(order_update)

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
    if not is_safe_id_string(order_id):
        raise HTTPException(status_code=400, detail="Invalid order identifier format.")
    org_id = _get_org_id(x_organization_id, authorization)
    tombstone_order(order_id)

    conn = await _get_read_conn()
    if conn:
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, delete_order_from_db, conn, org_id, order_id)
        except Exception as e:
            logger.warning(f"delete_order db deletion error for {order_id}: {e}")
        finally:
            try:
                conn.close()
            except Exception:
                pass

    # Ensure memory state also purges the order if present
    mem = get_memory_state()
    current = mem.get("cft_pos") or []
    filtered = [o for o in current if o.get("id") != order_id]
    if len(filtered) != len(current):
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
    # Normalize product fields for frontend and DB compatibility
    if not prod.get("productName") and prod.get("name"):
        prod["productName"] = prod["name"]
    if not prod.get("productCode") and prod.get("code"):
        prod["productCode"] = prod["code"]
    if not prod.get("name") and prod.get("productName"):
        prod["name"] = prod["productName"]
    if not prod.get("code") and prod.get("productCode"):
        prod["code"] = prod["productCode"]

    validated, err = validate_product_body(prod)
    if err:
        raise HTTPException(status_code=400, detail=err)

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


@app.delete("/api/products/{product_id}", status_code=204)
async def delete_product(
    product_id: str,
    x_organization_id: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    if not is_safe_id_string(product_id):
        raise HTTPException(status_code=400, detail="Invalid product identifier format.")
    org_id = _get_org_id(x_organization_id, authorization)
    mem = get_memory_state()
    mem["cft_products"] = [p for p in (mem.get("cft_products") or []) if p.get("id") != product_id]
    schedule_state_save()
    _invalidate_cache(org_id)
    return Response(status_code=204)


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
    validated, err = validate_audit_body(entry)
    if err:
        raise HTTPException(status_code=400, detail=err)

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
    validated, err = validate_template_body(tmpl)
    if err:
        raise HTTPException(status_code=400, detail=err)

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
    validated, err = validate_cancellation_body(cancellation)
    if err:
        raise HTTPException(status_code=400, detail=err)

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
            "host": mask_host(MYSQL_HOST),
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


@app.get("/api/logs")
async def get_server_logs(
    limit: int = 150,
    authorization: Optional[str] = Header(None),
):
    """Retrieve recent backend execution and request logs (Admin Protected)."""
    validate_schema_admin(authorization)
    if not LOG_FILE.exists():
        return {"file": "backend.log", "total_lines": 0, "logs": []}
    try:
        with open(LOG_FILE, "r", encoding="utf-8", errors="replace") as f:
            lines = [line.rstrip() for line in f.readlines()]
        return {
            "file": "backend.log",
            "total_lines": len(lines),
            "logs": lines[-limit:]
        }
    except Exception as e:
        return {"file": "backend.log", "error": "Unable to read logs", "logs": []}


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
        # Security: Prevent Path Traversal attacks
        safe_rel_path = Path(full_path).as_posix().lstrip("/\\")
        try:
            target_file = (dist_path / safe_rel_path).resolve()
            if not target_file.is_relative_to(dist_path.resolve()):
                raise HTTPException(status_code=403, detail="Forbidden")
        except (ValueError, RuntimeError):
            raise HTTPException(status_code=403, detail="Forbidden")

        if target_file.exists() and target_file.is_file():
            return FileResponse(str(target_file))
        return FileResponse(str(dist_path / "index.html"))


# ===========================================================================
# Entry point (for direct uvicorn)
# ===========================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=PORT, reload=False)

