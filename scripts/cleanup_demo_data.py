"""Remove demo/test users + their data, keeping the owner account.

Keeps: admin/owner user. Removes: E2E Judge / DebugUser / DemoFix users,
their notes, transactions, spending purchases, and mirror-thread transcripts.
Run before the final recording:
    python scripts/cleanup_demo_data.py
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEEP = {"Owner"}  # name of the account to preserve (admin)
DROP_NAMES = {"E2E Judge", "DebugUser", "DemoFix"}


def load(name):
    path = os.path.join(ROOT, name)
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None


def save(name, data):
    path = os.path.join(ROOT, name)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)
    os.replace(tmp, path)


def main():
    users = load("users.json") or []
    drop_ids = {u["user_id"] for u in users if u.get("name") in DROP_NAMES}
    keep = [u for u in users if u["user_id"] not in drop_ids]
    save("users.json", keep)
    print(f"users: {len(users)} -> {len(keep)} (dropped {len(drop_ids)})")

    notes = load("notes.json")
    if isinstance(notes, dict):
        for key in list(notes):
            n = notes[key] if isinstance(notes[key], dict) else {}
            if isinstance(n, dict) and n.get("user_id") in drop_ids:
                del notes[key]
        save("notes.json", notes)

    txns = load("transactions.json") or {}
    txn_list = txns.get("transactions", []) if isinstance(txns, dict) else txns
    kept = [t for t in txn_list if t.get("user_id") not in drop_ids]
    if isinstance(txns, dict):
        txns["transactions"] = kept
        save("transactions.json", txns)
    else:
        save("transactions.json", kept)
    print(f"transactions: {len(txn_list)} -> {len(kept)}")

    spending = load("spending.json") or {}
    purchases = spending.get("purchases", [])
    kept = [p for p in purchases if p.get("user_id") not in drop_ids]
    spending["purchases"] = kept
    save("spending.json", spending)
    print(f"spending purchases: {len(purchases)} -> {len(kept)}")

    transcript = load("transcript.json") or {}
    for side in ("outbound", "inbound"):
        msgs = transcript.get(side) or []
        keep_msgs = [m for m in msgs if not any(m.get("thread_id", "").startswith(t) for t in ("priva_mirror_u_", "otp_"))]
        transcript[side] = keep_msgs
    save("transcript.json", transcript)
    print("transcript: test-user mirror threads removed (real chat history kept)")

    print("Done. E2E can re-run cleanly; owner account preserved.")


if __name__ == "__main__":
    main()
