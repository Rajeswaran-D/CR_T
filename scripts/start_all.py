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

# Ensure UTF-8 output and immediate line buffering on Windows console
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
        sys.stderr.reconfigure(encoding='utf-8', line_buffering=True)
    except Exception:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace', line_buffering=True)
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace', line_buffering=True)
else:
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
    use_vite = "--dev" in sys.argv or "--vite" in sys.argv or os.environ.get("USE_VITE") == "1"

    print("====================================================")
    print("🚀 CIRCOR E2E Tracker (100% Python Runtime)")
    print(f"🌐 Application: http://127.0.0.1:{BE_PORT}/")
    print(f"⚡ API Gateway: http://127.0.0.1:{BE_PORT}/api")
    if use_vite:
        print(f"🛠️  Vite Dev:    http://localhost:{FE_PORT}/ (Hot Reloading)")
    else:
        print("✅ Zero Node.js runtime required — Frontend served via Python!")
    print("====================================================\n")

    # 1. Check if port is in use and release if held by a stale process
    if is_port_in_use(BE_PORT):
        print(f"⚠️  Port {BE_PORT} is currently occupied. Attempting to release stale process...")
        try:
            if sys.platform == "win32":
                out = subprocess.check_output(
                    f'powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort {BE_PORT} -State Listen -ErrorAction SilentlyContinue).OwningProcess"',
                    shell=True
                ).decode().strip()
                if out:
                    for pid in out.split():
                        if pid.isdigit() and int(pid) != os.getpid():
                            print(f"   Terminating stale process (PID {pid})...")
                            subprocess.call(["taskkill", "/pid", pid, "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    time.sleep(1.2)
        except Exception:
            pass

    if is_port_in_use(BE_PORT):
        print(f"❌ Error: Port {BE_PORT} is still in use by another application. Please free port {BE_PORT} and restart.")
        return

    # 2. Start server
    if not use_vite:
        # Launch browser to port 5000 automatically
        import webbrowser
        import threading
        def open_browser():
            time.sleep(1.2)
            try:
                webbrowser.open(f"http://127.0.0.1:{BE_PORT}/")
            except Exception:
                pass
        threading.Thread(target=open_browser, daemon=True).start()

        print(f"System is live at http://127.0.0.1:{BE_PORT}/ ! Press Ctrl+C anytime to stop.\n")
        # Run uvicorn directly in main thread so all logs stream live to console
        import uvicorn
        uvicorn.run(
            "backend.main:app",
            host="127.0.0.1",
            port=BE_PORT,
            reload=False,
            log_level="info",
        )
        return

    # If Vite dev mode is requested (--dev / --vite):
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    be_cmd = [sys.executable, str(ROOT / "start_backend.py")]
    be_proc = subprocess.Popen(be_cmd, cwd=str(ROOT), env=env)
    procs.append(be_proc)

    npm_cmd = "npx.cmd" if sys.platform == "win32" else "npx"
    fe_cmd = [npm_cmd, "vite"]
    try:
        fe_proc = subprocess.Popen(fe_cmd, cwd=str(ROOT), shell=True)
        procs.append(fe_proc)
    except Exception as e:
        print(f"⚠️  Could not start Vite dev server ({e}). Serving static frontend from Python.")

    print(f"\nSystem is live at http://127.0.0.1:{BE_PORT}/ ! Press Ctrl+C anytime to stop.\n")
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

