"""
Start the FastAPI backend — run this directly or via:
  python start_backend.py
"""
import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import uvicorn
from backend.config import PORT

if __name__ == "__main__":
    uvicorn.run(
        "backend.main:app",
        host="127.0.0.1",
        port=PORT,
        reload=False,
        log_level="info",
    )

