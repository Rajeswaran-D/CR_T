"""
Configuration loader for the CFT Tracker FastAPI backend.
Reads from the repository-local .env file (same file the Node server used).
"""
import os
import re
from pathlib import Path
from typing import Optional

# Resolve .env relative to this file (backend/ lives inside project root)
ENV_FILE = Path(__file__).parent.parent / ".env"

def _load_env() -> None:
    """Load .env file into os.environ if not already set."""
    if not ENV_FILE.exists():
        return
    with open(ENV_FILE, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, val = line.partition("=")
                key = key.strip()
                val = val.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = val

_load_env()


# ---------------------------------------------------------------------------
# Database config
# ---------------------------------------------------------------------------

MYSQL_HOST: str = os.environ.get("MYSQL_HOST") or os.environ.get("AIVEN_MYSQL_HOST") or "127.0.0.1"
MYSQL_PORT: int = int(os.environ.get("MYSQL_PORT") or os.environ.get("AIVEN_MYSQL_PORT") or 3306)
MYSQL_USER: str = os.environ.get("MYSQL_USER") or os.environ.get("AIVEN_MYSQL_USER") or "cft_app"
MYSQL_PASSWORD: str = os.environ.get("MYSQL_PASSWORD") or os.environ.get("AIVEN_MYSQL_PASSWORD") or ""
MYSQL_DATABASE: str = os.environ.get("MYSQL_DATABASE") or os.environ.get("AIVEN_MYSQL_DATABASE") or "cft_tracker"
MYSQL_CONNECTION_LIMIT: int = int(os.environ.get("MYSQL_CONNECTION_LIMIT") or 10)

# SSL / TLS
MYSQL_SSL_CA_PATH: Optional[str] = os.environ.get("MYSQL_SSL_CA_PATH") or os.environ.get("AIVEN_MYSQL_CA_PATH")
MYSQL_SSL_CA_INLINE: Optional[str] = os.environ.get("MYSQL_SSL_CA") or os.environ.get("AIVEN_MYSQL_CA_CERT")

# ---------------------------------------------------------------------------
# Server config
# ---------------------------------------------------------------------------

PORT: int = int(os.environ.get("PORT") or 5000)
DEFAULT_ORG_ID: str = "circor-flow-technologies"
STATE_FILE_PATH: str = os.environ.get("STATE_FILE_PATH") or str(
    Path.home() / ".cft-project-e2e-tracker-shared-state.json"
)

# CORS
CORS_ORIGINS_RAW: Optional[str] = os.environ.get("CORS_ORIGINS")
ALLOW_NGROK_ORIGINS: bool = os.environ.get("ALLOW_NGROK_ORIGINS", "").lower() == "true"

DEFAULT_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "http://localhost:5175",
    "http://127.0.0.1:5175",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    "https://circor-tracker.vercel.app",
    "https://circor-tracker-api.onrender.com",
]

def get_allowed_origins() -> list[str]:
    if CORS_ORIGINS_RAW and CORS_ORIGINS_RAW.strip():
        return [s.strip().rstrip("/") for s in CORS_ORIGINS_RAW.split(",") if s.strip()]
    return DEFAULT_ALLOWED_ORIGINS

# Auth
ORG_API_KEYS_RAW: Optional[str] = os.environ.get("ORG_API_KEYS")
CFT_REQUIRE_AUTH: bool = os.environ.get("CFT_REQUIRE_AUTH", "").lower() == "true"

# Schema admin
ENABLE_SCHEMA_ADMIN: bool = os.environ.get("ENABLE_SCHEMA_ADMIN", "").lower() == "true"
SCHEMA_ADMIN_TOKEN: Optional[str] = os.environ.get("SCHEMA_ADMIN_TOKEN")

# Rate limiting
RATE_LIMIT_PER_MIN: int = int(os.environ.get("RATE_LIMIT_PER_MIN") or 300)


def is_db_configured() -> bool:
    """All four MySQL credentials must be present."""
    return bool(MYSQL_HOST and MYSQL_DATABASE and MYSQL_USER and MYSQL_PASSWORD)


def missing_db_vars() -> list[str]:
    missing = []
    if not (os.environ.get("MYSQL_HOST") or os.environ.get("AIVEN_MYSQL_HOST")):
        missing.append("MYSQL_HOST")
    if not (os.environ.get("MYSQL_DATABASE") or os.environ.get("AIVEN_MYSQL_DATABASE")):
        missing.append("MYSQL_DATABASE")
    if not (os.environ.get("MYSQL_USER") or os.environ.get("AIVEN_MYSQL_USER")):
        missing.append("MYSQL_USER")
    if not (os.environ.get("MYSQL_PASSWORD") or os.environ.get("AIVEN_MYSQL_PASSWORD")):
        missing.append("MYSQL_PASSWORD")
    return missing

