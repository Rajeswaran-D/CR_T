#!/usr/bin/env python3
"""
CIRCOR E2E Tracker — 100% Python Standalone Launcher.
Starts the FastAPI server which serves both:
  1. Frontend UI at http://127.0.0.1:5000/
  2. REST API & MySQL at http://127.0.0.1:5000/api

Zero Node.js runtime required!
Usage:
  python run.py
"""
import sys
from pathlib import Path

ROOT = Path(__file__).parent.resolve()
sys.path.insert(0, str(ROOT))

if __name__ == "__main__":
    from scripts.start_all import main
    main()

