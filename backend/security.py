"""
Security middleware helpers for the FastAPI backend.
Port of server/security.ts.
"""
import hashlib
import hmac
import json
import re
import time
from collections import defaultdict
from typing import Optional

from fastapi import Header, HTTPException, Request, Response
from fastapi.responses import JSONResponse

from .config import (
    CFT_REQUIRE_AUTH, DEFAULT_ORG_ID, ENABLE_SCHEMA_ADMIN,
    ORG_API_KEYS_RAW, RATE_LIMIT_PER_MIN, SCHEMA_ADMIN_TOKEN,
    ALLOW_NGROK_ORIGINS, get_allowed_origins,
)

# ---------------------------------------------------------------------------
# Org ID validation
# ---------------------------------------------------------------------------

ORG_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$")


def is_valid_org_id(value: Optional[str]) -> bool:
    return isinstance(value, str) and bool(ORG_ID_PATTERN.match(value))


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

def _timing_safe_equal(a: str, b: str) -> bool:
    ha = hashlib.sha256(a.encode()).digest()
    hb = hashlib.sha256(b.encode()).digest()
    return hmac.compare_digest(ha, hb)


def _parse_org_api_keys() -> Optional[dict[str, list[str]]]:
    raw = ORG_API_KEYS_RAW
    if not raw or not raw.strip():
        return None
    try:
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            return None
        out: dict[str, list[str]] = {}
        for org, keys in parsed.items():
            if isinstance(keys, list):
                lst = [k for k in keys if isinstance(k, str) and k]
                if lst:
                    out[org] = lst
            elif isinstance(keys, str) and keys:
                out[org] = [keys]
        return out if out else None
    except Exception:
        return None


def validate_org(x_organization_id: Optional[str], authorization: Optional[str] = None) -> str:
    """Validates org id and (when configured) bearer token. Returns org_id or raises HTTPException."""
    org_id = x_organization_id or DEFAULT_ORG_ID
    if not is_valid_org_id(org_id):
        raise HTTPException(
            status_code=400,
            detail="Missing or invalid organization identity (X-Organization-Id header)."
        )

    keys = _parse_org_api_keys()
    if not keys and CFT_REQUIRE_AUTH:
        raise HTTPException(
            status_code=503,
            detail="Server authentication is not configured. Contact the administrator."
        )

    if keys:
        allowed = keys.get(org_id, [])
        token = ""
        if authorization and authorization.startswith("Bearer "):
            token = authorization[7:].strip()
        ok = bool(token) and any(_timing_safe_equal(token, k) for k in allowed)
        if not ok:
            raise HTTPException(status_code=401, detail="Invalid or missing organization credentials.")

    return org_id


# ---------------------------------------------------------------------------
# CORS helpers
# ---------------------------------------------------------------------------

def is_allowed_origin(origin: str) -> bool:
    normalized = origin.rstrip("/")
    if normalized in get_allowed_origins():
        return True
    if re.match(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$", normalized):
        return True
    if ALLOW_NGROK_ORIGINS and re.match(r"^https://[^/]+\.ngrok(?:-free)?\.(dev|app|io)$", normalized):
        return True
    return False


# ---------------------------------------------------------------------------
# Rate limiter (simple in-memory, per IP)
# ---------------------------------------------------------------------------

_rate_buckets: dict[str, dict] = defaultdict(lambda: {"count": 0, "reset_at": 0.0})
RATE_WINDOW_SECS = 60.0


def check_rate_limit(request: Request) -> Optional[JSONResponse]:
    max_req = RATE_LIMIT_PER_MIN
    if max_req <= 0:
        return None

    now = time.time()
    # Clean up if too large
    if len(_rate_buckets) > 10_000:
        _rate_buckets.clear()

    xff = request.headers.get("x-forwarded-for")
    if xff:
        ip = xff.split(",")[0].strip()
    else:
        ip = request.client.host if request.client else "unknown"

    bucket = _rate_buckets[ip]
    if now >= bucket["reset_at"]:
        bucket["count"] = 0
        bucket["reset_at"] = now + RATE_WINDOW_SECS

    bucket["count"] += 1
    if bucket["count"] > max_req:
        retry_after = max(1, int(bucket["reset_at"] - now))
        return JSONResponse(
            status_code=429,
            content={"error": "Too many requests. Please retry shortly."},
            headers={"Retry-After": str(retry_after)},
        )
    return None


# ---------------------------------------------------------------------------
# Schema admin
# ---------------------------------------------------------------------------

def validate_schema_admin(authorization: Optional[str]) -> None:
    if not ENABLE_SCHEMA_ADMIN:
        raise HTTPException(status_code=404, detail="Not found")
    token = SCHEMA_ADMIN_TOKEN
    if not token or len(token) < 16:
        raise HTTPException(status_code=403, detail="Schema administration is not configured.")
    presented = ""
    if authorization and authorization.startswith("Bearer "):
        presented = authorization[7:].strip()
    if not presented or not _timing_safe_equal(presented, token):
        raise HTTPException(status_code=404, detail="Not found")


# ---------------------------------------------------------------------------
# Request body validation
# ---------------------------------------------------------------------------

CONTROL_CHARS = re.compile(r"[\u0000-\u001f\u007f]")


def is_safe_id_string(value: object, max_len: int = 128) -> bool:
    return (
        isinstance(value, str)
        and value.strip()
        and len(value) <= max_len
        and not CONTROL_CHARS.search(value)
    )


def validate_order_body(body: dict) -> Optional[str]:
    if not isinstance(body, dict):
        return "Request body must be a JSON object."
    if not is_safe_id_string(body.get("id")):
        return "Missing or invalid field: id."
    if not is_safe_id_string(body.get("poNumber")):
        return "Missing or invalid field: poNumber."
    return None


def validate_config_body(body: dict) -> tuple[Optional[dict], Optional[str]]:
    if not isinstance(body, dict):
        return None, "Request body must be a JSON object."
    out: dict = {}
    for field in ("atRiskThresholdDays", "delayedThresholdDays"):
        if field in body:
            v = body[field]
            if not isinstance(v, (int, float)) or not (0 <= v <= 365):
                return None, f"Invalid field: {field} must be a number between 0 and 365."
            out[field] = round(v)
    if "offlineSyncQueue" in body:
        if not isinstance(body["offlineSyncQueue"], list):
            return None, "Invalid field: offlineSyncQueue must be an array."
        out["offlineSyncQueue"] = body["offlineSyncQueue"]
    if "enablePushNotifications" in body:
        if not isinstance(body["enablePushNotifications"], bool):
            return None, "Invalid field: enablePushNotifications must be a boolean."
        out["enablePushNotifications"] = body["enablePushNotifications"]
    return out, None

