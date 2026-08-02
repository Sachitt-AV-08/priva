"""PRIVA watchdog daemon — keeps the demo stack alive unattended.

Every 30s:
  1. Backend health on :8766 -> restart (hidden) when down.
  2. ngrok tunnel -> restart when dead; re-register the Linq webhook
     subscription and update .env when the URL changes.
  3. Heartbeat + events appended to watchdog.log.

Run:  python scripts/watchdog.py   (launch hidden for the demo laptop)
"""
import json
import os
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG = os.path.join(ROOT, "watchdog.log")
PORT = 8766
BACKEND_URL = f"http://127.0.0.1:{PORT}/health"
NGROK_API = "http://127.0.0.1:4040/api/tunnels"
WEBHOOK_PATH = "/priva/webhook"
POLL_SECONDS = 30

CREATE_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0


def log(msg: str):
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    try:
        with open(LOG, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except OSError:
        pass
    print(line, flush=True)


def backend_up() -> bool:
    try:
        with urllib.request.urlopen(BACKEND_URL, timeout=4) as resp:
            return resp.status == 200
    except Exception:
        return False


def start_backend():
    log("backend down -> starting")
    try:
        subprocess.Popen(
            [sys.executable, "server.py"],
            cwd=ROOT,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=CREATE_NO_WINDOW,
        )
    except Exception as exc:
        log(f"backend start FAILED: {exc!r}")


def tunnel_url() -> str:
    try:
        with urllib.request.urlopen(NGROK_API, timeout=4) as resp:
            data = json.loads(resp.read().decode())
        for t in data.get("tunnels", []):
            url = t.get("public_url", "")
            if url.startswith("https://"):
                return url
    except Exception:
        pass
    return ""


def start_ngrok():
    log("tunnel down -> starting ngrok")
    try:
        subprocess.Popen(
            ["ngrok", "http", str(PORT)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=CREATE_NO_WINDOW,
        )
    except Exception as exc:
        log(f"ngrok start FAILED: {exc!r}")


def _env_value(key: str) -> str:
    try:
        for line in open(os.path.join(ROOT, ".env"), encoding="utf-8"):
            if line.startswith(key + "="):
                return line.strip().split("=", 1)[1]
    except OSError:
        pass
    return ""


def _env_set(key: str, value: str):
    path = os.path.join(ROOT, ".env")
    try:
        lines = open(path, encoding="utf-8").read().splitlines()
        for i, l in enumerate(lines):
            if l.startswith(key + "="):
                lines[i] = f"{key}={value}"
                break
        else:
            lines.append(f"{key}={value}")
        open(path, "w", encoding="utf-8").write("\n".join(lines) + "\n")
    except OSError as exc:
        log(f".env update FAILED: {exc!r}")


def register_webhook(url: str):
    """Create/update the Linq webhook-subscription to point at the live tunnel."""
    key = _env_value("LINQ_API_KEY")
    if not key:
        log("no LINQ_API_KEY - skipping webhook registration")
        return
    sandbox = _env_value("LINQ_SANDBOX_NUMBER") or "+12134768016"
    target = f"{url}{WEBHOOK_PATH}?version=2026-02-03"
    try:
        import httpx
        h = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        base = "https://api.linqapp.com/api/partner/v3"
        subs = httpx.get(f"{base}/webhook-subscriptions", headers=h, timeout=10).json().get("subscriptions", [])
        sub = next((s for s in subs if "message.received" in (s.get("subscribed_events") or [])), None)
        body = {
            "target_url": target,
            "subscribed_events": ["message.received", "message.delivered", "message.failed"],
            "phone_numbers": [sandbox],
        }
        if sub:
            r = httpx.patch(f"{base}/webhook-subscriptions/{sub['id']}", headers=h, json=body, timeout=10)
        else:
            r = httpx.post(f"{base}/webhook-subscriptions", headers=h, json=body, timeout=10)
        log(f"linq webhook {r.status_code}: {r.text[:100]}")
    except Exception as exc:
        log(f"webhook registration FAILED: {exc!r}")


def main():
    log(f"watchdog started (poll {POLL_SECONDS}s) cwd={ROOT}")
    last_webhook_url = ""
    while True:
        try:
            if not backend_up():
                start_backend()
            url = tunnel_url()
            if not url:
                start_ngrok()
            elif url != last_webhook_url:
                prev = _env_value("PRIVA_WEBHOOK_URL")
                if url + WEBHOOK_PATH != prev:
                    log(f"tunnel URL {url} -> registering webhook")
                    register_webhook(url)
                    _env_set("PRIVA_WEBHOOK_URL", f"{url}{WEBHOOK_PATH}")
                last_webhook_url = url
        except Exception as exc:
            log(f"watchdog loop error: {exc!r}")
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
