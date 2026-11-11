"""
Start the FastAPI backend — run this directly or via:
  python start_backend.py
"""
import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Ensure immediate unbuffered console logging
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
        sys.stderr.reconfigure(encoding="utf-8", line_buffering=True)
    except Exception:
        pass

import socket
import uvicorn
from backend.config import PORT

def check_port_free(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((host, port)) != 0

if __name__ == "__main__":
    if not check_port_free(PORT):
        print(f"\n❌ Error: Port {PORT} is already in use by another process!")
        print(f"👉 Please close the existing server process before starting a new one.")
        print(f"   In PowerShell: Stop-Process -Id (Get-NetTCPConnection -LocalPort {PORT} -State Listen).OwningProcess -Force\n")
        sys.exit(1)

    uvicorn.run(
        "backend.main:app",
        host="127.0.0.1",
        port=PORT,
        reload=False,
        log_level="info",
    )

