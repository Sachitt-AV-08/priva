"""Monthly spend budget + purchase ledger (JSON-backed).

Tracks completed purchases so PRIVA can warn before an overspend and
show spending analysis in the UI. Purchases are recorded on payment
completion by the caller (STATUS finalize / poller).
"""
import json
import os
import time
from datetime import datetime, timedelta
from typing import Optional

DATA_DIR = os.path.dirname(__file__)
BUDGET_FILE = os.path.join(DATA_DIR, "spending.json")

_MONTH_FMT = "%Y-%m"


def _load() -> dict:
    try:
        with open(BUDGET_FILE, encoding="utf-8") as fh:
            data = json.load(fh)
            if isinstance(data, dict):
                return data
    except (OSError, json.JSONDecodeError):
        pass
    return {"budget": {}, "purchases": []}


def _save(data: dict):
    try:
        tmp = BUDGET_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2)
        os.replace(tmp, BUDGET_FILE)
    except OSError:
        pass


def _month(ts: Optional[int] = None) -> str:
    return datetime.fromtimestamp(ts if ts is not None else time.time()).strftime(_MONTH_FMT)


def _as_month(m) -> str:
    """Accept a month string ('2026-08'), a timestamp, or None -> month string."""
    if m is None:
        return _month()
    if isinstance(m, (int, float)):
        return _month(m)
    return str(m)


def _month_prev(month: Optional[str] = None) -> str:
    m = month or _month()
    d = datetime.strptime(m, _MONTH_FMT)
    prev = d.replace(day=1) - timedelta(days=1)
    return prev.strftime(_MONTH_FMT)


def set_budget(limit: float) -> float:
    data = _load()
    data["budget"]["monthly"] = float(limit)
    _save(data)
    return float(limit)


def get_budget() -> Optional[float]:
    data = _load()
    return data["budget"].get("monthly")


def record_borrow(excess: float, month: Optional[str] = None) -> float:
    """Overspend in `month` is borrowed from next month (3-stage budget flow).

    Stored per overspent month; next month's effective limit shrinks by it.
    """
    excess = round(float(excess), 2)
    if excess <= 0:
        return 0.0
    data = _load()
    m = month or _month()
    data.setdefault("borrow", {})[m] = excess
    _save(data)
    return excess


def borrowed_into_next(month=None) -> float:
    """Debt this month carries INTO next month (excess of the current month)."""
    data = _load()
    return float(data.get("borrow", {}).get(_as_month(month), 0) or 0)


def borrowed_from_prev(month=None) -> float:
    """Debt carried INTO this month from the previous one."""
    data = _load()
    return float(data.get("borrow", {}).get(_month_prev(_as_month(month)), 0) or 0)


def effective_limit(ts: Optional[int] = None) -> Optional[float]:
    """Monthly limit minus any borrow-from-previous-month debt."""
    limit = get_budget()
    if limit is None:
        return None
    return round(limit - borrowed_from_prev(ts), 2)


def purchases(month: Optional[str] = None, user_id: str = "") -> list:
    data = _load()
    target = month or _month()
    out = [p for p in data.get("purchases", []) if _month(p.get("ts", 0)) == target]
    if user_id:
        out = [p for p in out if p.get("user_id") == user_id]
    return out


def record_purchase(title: str, merchant: str, amount: float, txn_id: str = "",
                    user_id: str = "local") -> dict:
    entry = {
        "ts": int(time.time()),
        "title": title,
        "merchant": merchant,
        "amount": float(amount),
        "txn_id": txn_id,
        "user_id": user_id,
    }
    data = _load()
    data.setdefault("purchases", []).append(entry)
    _save(data)
    return entry


def spent_this_month(ts: Optional[int] = None) -> float:
    return round(sum(p["amount"] for p in purchases(_month(ts))), 2)


def remaining(ts: Optional[int] = None) -> Optional[float]:
    el = effective_limit(ts)
    if el is None:
        return None
    return round(el - spent_this_month(ts), 2)


def would_exceed(amount: float, ts: Optional[int] = None) -> tuple[bool, Optional[float]]:
    """(exceeds_remaining_budget, remaining_after). No limit -> (False, None)."""
    el = effective_limit(ts)
    if el is None:
        return False, None
    rem = remaining(ts)
    return (rem is not None and float(amount) > rem), (round((rem or 0) - float(amount), 2))


BUDGET_WARN_PCT = 0.9


def tier_for(amount: float, ts: Optional[int] = None) -> dict:
    """Three-stage budget check for a prospective purchase.

    Returns {"tier": "ok"|"near_limit"|"exceeds", "left": float|None,
             "excess": float|None, "limit": float|None, "spent": float|None}
      near_limit -> spending would cross 90% of the limit (warn, remainder shown)
      exceeds    -> would blow past the limit (cap confirmation + borrow)
    """
    el = effective_limit(ts)
    spent = spent_this_month(ts)
    if el is None:
        return {"tier": "ok", "left": None, "excess": None, "limit": None, "spent": spent}
    after = round(spent + float(amount), 2)
    if after > el:
        return {"tier": "exceeds", "left": None, "excess": round(after - el, 2),
                "limit": el, "spent": spent}
    left = round(el - after, 2)
    if after >= BUDGET_WARN_PCT * el:
        return {"tier": "near_limit", "left": left, "excess": None, "limit": el, "spent": spent}
    return {"tier": "ok", "left": left, "excess": None, "limit": el, "spent": spent}


def analysis() -> dict:
    """Monthly budget state + spend breakdown for the dashboard."""
    limit = get_budget()
    spent = spent_this_month()
    by_merchant: dict[str, float] = {}
    by_day: dict[str, float] = {}
    for p in purchases():
        by_merchant[p["merchant"] or "Other"] = round(by_merchant.get(p["merchant"] or "Other", 0) + p["amount"], 2)
        day = datetime.fromtimestamp(p["ts"]).strftime("%a %d")
        by_day[day] = round(by_day.get(day, 0) + p["amount"], 2)
    top_merchants = sorted(by_merchant.items(), key=lambda kv: -kv[1])[:5]
    days = sorted(by_day.items(), key=lambda kv: datetime.strptime(kv[0], "%a %d"))
    purchases_all = purchases()
    return {
        "month": _month(),
        "monthly_limit": limit,
        "effective_limit": effective_limit(),
        "borrowed_into_next": borrowed_into_next(),
        "spent_this_month": spent,
        "remaining": round(effective_limit() - spent, 2) if effective_limit() is not None else None,
        "purchase_count": len(purchases_all),
        "avg_purchase": round(sum(p["amount"] for p in purchases_all) / len(purchases_all), 2) if purchases_all else 0.0,
        "by_merchant": [{"merchant": m, "total": t} for m, t in top_merchants],
        "by_day": [{"day": d, "total": t} for d, t in days[-7:]],
    }
