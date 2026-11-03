#!/usr/bin/env python3
"""
Unified Runner for CIRCOR Project E2E Tracker in Python.
Starts:
 1. Backend: Python FastAPI server (port 5000)
 2. Frontend: Vite dev server (port 5173)
"""
import io
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

# Ensure UTF-8 output on Windows console
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from backend.config import PORT as BE_PORT
FE_PORT = 5173

procs = []

def cleanup(sig=None, frame=None):
    print("\n[Runner] Shutting down all services...")
    for p in procs:
        try:
            if sys.platform == "win32":
                subprocess.call(["taskkill", "/pid", str(p.pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                p.terminate()
        except Exception:
            pass
    sys.exit(0)

signal.signal(signal.SIGINT, cleanup)
signal.signal(signal.SIGTERM, cleanup)

def is_port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1.0)
        return s.connect_ex((host, port)) == 0

def main():
    print("====================================================")
    print("🚀 Starting CIRCOR E2E Tracker (Python Unified Runner)")
    print(f"⚡ Backend:  http://127.0.0.1:{BE_PORT}/api")
    print(f"⚡ Frontend: http://localhost:{FE_PORT}/")
    print("====================================================\n")

    # 1. Start Python FastAPI backend (if not already running)
    if is_port_in_use(BE_PORT):
        print(f"ℹ️  Backend server is already running on port {BE_PORT}. Connecting to existing server.")
    else:
        be_cmd = [sys.executable, str(ROOT / "start_backend.py")]
        be_proc = subprocess.Popen(be_cmd, cwd=str(ROOT))
        procs.append(be_proc)

    # 2. Start Vite frontend
    npm_cmd = "npx.cmd" if sys.platform == "win32" else "npx"
    fe_cmd = [npm_cmd, "vite"]
    fe_proc = subprocess.Popen(fe_cmd, cwd=str(ROOT), shell=True)
    procs.append(fe_proc)

    print("\nServices are running! Press Ctrl+C anytime to stop.\n")
    try:
        while True:
            time.sleep(1)
            for p in procs:
                if p.poll() is not None:
                    print(f"[Runner] Process {p.pid} exited with code {p.returncode}")
    except KeyboardInterrupt:
        cleanup()

if __name__ == "__main__":
    main()

