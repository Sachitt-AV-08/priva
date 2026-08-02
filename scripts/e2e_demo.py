"""PRIVA record-ready end-to-end demo test.

Drives the LIVE backend through the full judge arc:
  register -> OTP -> save note -> PRIVA offer SMS -> YES -> prefs -> picks -> buy -> order.

Usage:  python scripts/e2e_demo.py [--base http://127.0.0.1:8766] [--item "mechanical keyboard"]
Exit 0 = demo is record-ready. Prints each stage PASS/FAIL.
"""
import argparse
import json
import re
import sys
import time
import urllib.request
import urllib.error
import uuid

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

POLL_STEP = 2
OFFER_TIMEOUT = 40
REPLY_TIMEOUT = 40


def http(base, path, method="GET", body=None, token=""):
    url = base + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8", "replace")
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, {"detail": raw[:300]}
    except Exception as e:  # noqa: BLE001
        return 0, {"detail": f"network: {e}"}


def transcript_msgs(base, token):
    st, body = http(base, "/api/linq/transcript", token=token)
    if st != 200:
        return [], []
    return body.get("messages", []), body.get("inbound", [])


def wait_for(base, token, predicate, timeout, label):
    """Poll transcript until predicate(outbound, inbound) is truthy. Returns match or None."""
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        out, inc = transcript_msgs(base, token)
        last = predicate(out, inc)
        if last:
            return last
        time.sleep(POLL_STEP)
    print(f"  TIMEOUT waiting for: {label}")
    return None


def text_matches(needle):
    def pred(out, inc):
        for m in out:
            if needle.lower() in m.get("text", "").lower():
                return m
        return None
    return pred


def new_text_since(seen_ts):
    def pred(out, inc):
        fresh = [m for m in out + inc if m.get("ts", 0) > seen_ts]
        return sorted(fresh, key=lambda m: m.get("ts", 0))[-1] if fresh else None
    return pred


def answer_for(question):
    q = question.lower()
    if "color" in q or "colour" in q:
        return "black"
    if "size" in q:
        return "medium"
    if "budget" in q or "price range" in q:
        return "250"
    if "purpose" in q or "for " in q:
        return "travel"
    return "black"


def looks_like_results(q):
    ql = q.lower()
    return any(k in ql for k in ("found options", "best pick", "options:", "more options", "reply 1/2/3", "reply with a number", "1. ", "2. ", "3. "))


def purchased_guard_skipped(base, token, note_id):
    """True when the backend skipped our note because the item was bought before."""
    st, body = http(base, "/api/agent/activity")
    if st != 200:
        return False
    for ev in body.get("events", []):
        if ev.get("note_id") == note_id and "already purchased" in ev.get("message", ""):
            return True
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8766")
    ap.add_argument("--item", default="")
    args = ap.parse_args()
    base = args.base.rstrip("/")
    items = ["wireless mouse", "yoga mat", "coffee grinder", "desk lamp",
             "mechanical keyboard", "car phone mount", "electric toothbrush"]
    if args.item:
        items = [args.item]
    start_idx = (int(time.time()) // 60) % len(items)
    phone = "+1" + str(1000000000 + int(time.time()) % 1000000000)
    name = "E2E Judge"
    token = ""

    st, body = http(base, "/health")
    if st != 200:
        print(f"FAIL backend not up ({st})"); sys.exit(1)
    print(f"backend OK at {base}")

    # 1. register + OTP
    st, body = http(base, "/api/auth/otp", "POST", {"phone": phone, "name": name})
    otp = body.get("otp", "")
    if st != 200 or not otp:
        print(f"FAIL otp ({st}): {body.get('detail', body)}"); sys.exit(1)
    print(f"PASS 1/6 register -> inline OTP {otp} (delivery={body.get('delivery')})")

    # 2. verify -> token
    st, body = http(base, "/api/auth/verify", "POST", {"phone": phone, "otp": otp})
    token = body.get("token", "")
    if st != 200 or not token:
        print(f"FAIL verify ({st}): {body.get('detail', body)}"); sys.exit(1)
    print(f"PASS 2/6 verify -> token ({body.get('name')} / {body.get('user_id')})")

    # 3. save note -> offer arrives (retry once on the already-purchased guard)
    item = items[start_idx]
    note_id = ""
    offer = None
    for attempt in range(min(len(items), 3)):
        if attempt:
            item = items[(start_idx + attempt) % len(items)]
        note_id = "e2e-" + uuid.uuid4().hex[:8]
        st, body = http(base, "/api/notes", "POST",
                        {"id": note_id, "title": f"need a {item}",
                         "blocks": [{"type": "text", "content": f"need a {item} for travel under 300"}]},
                        token=token)
        if st != 200:
            print(f"FAIL note save ({st}): {body.get('detail', body)}"); sys.exit(1)
        print(f"PASS 3/6 note saved ({note_id}, '{item}') — waiting for PRIVA offer (<=40s)...")
        offer = wait_for(base, token, text_matches("PRIVA:"), OFFER_TIMEOUT, "offer SMS")
        if offer:
            break
        if purchased_guard_skipped(base, token, note_id):
            print(f"  '{item}' was bought in an earlier run — retrying with next item")
            continue
        print("  latest transcript:",
              json.dumps(transcript_msgs(base, token)[0][-3:], default=str)[:400])
        sys.exit(1)
    if not offer:
        print(f"FAIL no offer for any item ({items})"); sys.exit(1)
    print(f"  offer: {offer['text'][:90]}...")

    # 4. reply YES -> prefs questions (if any) -> options
    seen_ts = offer["ts"]
    st, _ = http(base, "/api/linq/simulate-reply", "POST", {"text": "YES"}, token=token)
    if st != 200:
        print(f"FAIL simulate YES ({st})"); sys.exit(1)
    nxt = wait_for(base, token, new_text_since(seen_ts), REPLY_TIMEOUT, "reply to YES")
    if not nxt:
        sys.exit(1)
    q = nxt["text"]
    print(f"  after YES -> {q[:90]}")
    guard = 0
    while "?" in q and not looks_like_results(q) and guard < 4:
        ans = answer_for(q)
        print(f"  pref question, answering '{ans}'")
        seen_ts = nxt["ts"]
        st, _ = http(base, "/api/linq/simulate-reply", "POST", {"text": ans}, token=token)
        if st != 200:
            print(f"FAIL simulate pref answer ({st})"); sys.exit(1)
        nxt = wait_for(base, token, new_text_since(seen_ts), REPLY_TIMEOUT, "pref answer")
        if not nxt:
            sys.exit(1)
        q = nxt["text"]
        print(f"  -> {q[:90]}")
        guard += 1
    if not looks_like_results(q):
        print("FAIL: never got product options; last reply was: " + q[:120])
        sys.exit(1)
    print("PASS 4/6 options received")

    # 5. reply 1 -> consent -> (APPROVE if cap) -> payment session -> Done!
    seen_ts = max(m.get("ts", 0) for m in transcript_msgs(base, token)[0]) or nxt["ts"]
    st, _ = http(base, "/api/linq/simulate-reply", "POST", {"text": "1"}, token=token)
    consent = wait_for(base, token, text_matches("Confirm purchase"), REPLY_TIMEOUT, "consent")
    if not consent:
        sys.exit(1)
    print("PASS 5/6 consent card received")
    if "APPROVE" in consent.get("text", ""):
        print("  budget cap shown — approving overspend")
        st, _ = http(base, "/api/linq/simulate-reply", "POST", {"text": "APPROVE"}, token=token)
    else:
        st, _ = http(base, "/api/linq/simulate-reply", "POST", {"text": "YES"}, token=token)
    sess = wait_for(base, token, text_matches("Payment session created"), REPLY_TIMEOUT * 2, "payment session")
    if not sess:
        sys.exit(1)
    print(f"  {sess['text'].splitlines()[0][:80]}")
    done = wait_for(base, token, text_matches("Done!"), 130, "order confirmation")
    if not done:
        sys.exit(1)
    print(f"  {done['text'][:90]}")

    # 6. transaction landed + order completed
    st, body = http(base, "/api/transactions", token=token)
    mine = body.get("transactions", [])
    latest = mine[-1] if mine else {}
    if st != 200 or not latest:
        print(f"FAIL transactions ({st})"); sys.exit(1)
    print(f"PASS 6/6 order #{latest.get('id')} — {latest.get('product_title')} "
          f"${latest.get('amount')} status={latest.get('status')} "
          f"shipping={latest.get('shipping_status')}")
    print("\nRECORD-READY: full loop green in one pass.")
    sys.exit(0)


if __name__ == "__main__":
    main()
