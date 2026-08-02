"""Price watch: snapshots prices of bought/declined items, alerts on drops >=5%.

Real re-checks use the SerpApi cache (cheap, no quota burn). Demo mode
(`POST /api/demo/price-drop`) seeds a synthetic drop so the surprise beat
can be staged on demand during the pitch.
"""
import json
import os
import time
import uuid

from linq_client import send_message
from serpapi_client import search_products

WATCH_FILE = os.path.join(os.path.dirname(__file__), "watchlist.json")
DROP_THRESHOLD_PCT = 5.0


def _load() -> list:
    try:
        with open(WATCH_FILE, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return []


def _save(data: list):
    try:
        tmp = WATCH_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2)
        os.replace(tmp, WATCH_FILE)
    except OSError:
        pass


def add_watch(item: str, price: float, note_id: str = "") -> dict:
    watches = _load()
    existing = next((w for w in watches if w["item"].lower() == item.lower() and not w.get("alerted")), None)
    if existing:
        if note_id and not existing.get("note_id"):
            existing["note_id"] = note_id
            _save(watches)
        return existing
    watch = {
        "id": f"watch_{uuid.uuid4().hex[:8]}",
        "item": item,
        "price": price,
        "note_id": note_id,
        "added_at": int(time.time()),
        "alerted": False,
        "demo_drop_pct": 0.0,
    }
    watches.append(watch)
    _save(watches)
    return watch


def list_watches() -> list:
    return _load()


async def check_watches(address: str = "") -> list:
    """Re-check watched items; alert if price dropped >=5% (or demo seed set)."""
    alerts = []
    watches = _load()
    for watch in watches:
        if watch.get("alerted"):
            continue
        new_price = None
        if watch.get("demo_drop_pct"):
            new_price = watch["price"] * (1 - watch["demo_drop_pct"] / 100)
        else:
            products = await search_products(watch["item"], None, 5)
            prices = [p.price for p in products if p.price]
            if not prices:
                continue
            new_price = min(prices)
        if new_price and watch["price"] > 0:
            drop = (1 - new_price / watch["price"]) * 100
            if drop >= DROP_THRESHOLD_PCT:
                alerts.append({**watch, "new_price": new_price, "drop_pct": drop})
    return alerts


async def fire_alert(address: str, item: str, new_price: float, drop_pct: float, thread_id: str = "priva_mirror") -> bool:
    """Send the price-drop surprise text (conversation staging done by caller)."""
    if not address:
        return False
    text = (
        f"PRIVA: {item} just dropped {drop_pct:.0f}% (${new_price:.2f}). "
        f"Reply BUY NOW to grab it at this price."
    )
    await send_message(address, text, thread_id)
    watches = _load()
    for w in watches:
        if w["item"].lower() == item.lower():
            w["alerted"] = True
            break
    _save(watches)
    return True
