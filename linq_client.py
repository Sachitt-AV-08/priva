import base64
import asyncio
import httpx
import hmac
import hashlib
import json
import os
import re
import time
from collections import deque
from config import LINQ_API_KEY, LINQ_SANDBOX_NUMBER, DEMO_MODE

LINQ_API_BASE = "https://api.linqapp.com/api/partner/v3"

HEADERS = {
    "Authorization": f"Bearer {LINQ_API_KEY}",
    "Content-Type": "application/json",
}

_outbox: deque = deque(maxlen=500)
_inbox: deque = deque(maxlen=500)

# thread_key -> Linq chat_id (v3 chats are keyed on from+to; we cache per internal thread)
_chat_ids: dict[str, str] = {}

_link_cache: dict[str, str] = {}
_LINK_CACHE_FILE = os.path.join(os.path.dirname(__file__), "link_cache.json")
_TRANSCRIPT_FILE = os.path.join(os.path.dirname(__file__), "transcript.json")


def _load_link_cache():
    try:
        with open(_LINK_CACHE_FILE, encoding="utf-8") as fh:
            _link_cache.update(json.load(fh))
    except (OSError, ValueError):
        pass


def _save_link_cache():
    try:
        tmp = _LINK_CACHE_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(_link_cache, fh)
        os.replace(tmp, _LINK_CACHE_FILE)
    except OSError:
        pass


def _load_transcript():
    """Seed in-memory outbox/inbox from disk so history survives restarts."""
    try:
        with open(_TRANSCRIPT_FILE, encoding="utf-8-sig") as fh:
            data = json.load(fh)
        for m in data.get("outbound", []):
            _outbox.append(m)
        for m in data.get("inbound", []):
            _inbox.append(m)
    except (OSError, ValueError):
        pass


def _save_transcript():
    try:
        tmp = _TRANSCRIPT_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump({"outbound": list(_outbox), "inbound": list(_inbox)}, fh)
        os.replace(tmp, _TRANSCRIPT_FILE)
    except OSError:
        pass


_load_transcript()


async def _shorten_link(url: str) -> str:
    """Shorten long product links (tinyurl, no key) with cache + silent fallback."""
    if not url or len(url) <= 60:
        return url
    cached = _link_cache.get(url)
    if cached:
        return cached
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get("https://tinyurl.com/api-create.php", params={"url": url})
            if resp.status_code == 200:
                short = resp.text.strip()
                if short.startswith("http"):
                    _link_cache[url] = short
                    _save_link_cache()
                    return short
    except Exception:
        pass
    return url


def outbox(thread_id: str = "") -> list:
    """Record of every outbound message (for the in-app mirror transcript)."""
    if thread_id:
        return [m for m in _outbox if m["thread_id"] == thread_id]
    return list(_outbox)


def inbox(thread_id: str = "") -> list:
    """Record of every inbound message (webhook + mirror), newest first."""
    if thread_id:
        return [m for m in _inbox if m["thread_id"] == thread_id]
    return list(_inbox)


def record_inbound(from_: str, text: str, thread_id: str) -> dict:
    """Persist an inbound message so the mirror can show the full timeline."""
    entry = {"from": from_, "text": text, "thread_id": thread_id, "ts": time.time()}
    _inbox.append(entry)
    _save_transcript()
    return entry


def clear_thread(thread_id: str) -> int:
    """Drop every transcript entry for a thread (mirror chat 'clear' action)."""
    outbound = list(_outbox)
    inbound = list(_inbox)
    removed = sum(
        1 for m in outbound + inbound if m.get("thread_id") == thread_id
    )
    _outbox.clear()
    _outbox.extend(m for m in outbound if m.get("thread_id") != thread_id)
    _inbox.clear()
    _inbox.extend(m for m in inbound if m.get("thread_id") != thread_id)
    _save_transcript()
    return removed


def _record(to: str, text: str, thread_id: str) -> dict:
    entry = {"to": to, "text": text, "thread_id": thread_id, "ts": time.time()}
    _outbox.append(entry)
    _save_transcript()
    return entry


def record_outbound_for(entry: dict, thread_id: str) -> dict:
    """Duplicate an outbound entry onto another thread (mirror redirect)."""
    copy = dict(entry, thread_id=thread_id)
    _outbox.append(copy)
    _save_transcript()
    return copy


def _thread_chat_id(key: str) -> str:
    """When the webhook hands us the chat id, use it directly for replies."""
    if key and re.fullmatch(r"[0-9a-fA-F-]{36}", key):
        return key
    return _chat_ids.get(key, "")


def resolve_thread_id(chat_id: str) -> str:
    """Reverse-map a Linq chat_id back to the internal thread key.

    Inbound webhook replies arrive keyed by the Linq chat id, but
    conversations (e.g. note offers) are stored under our own thread key —
    this lets us find the right conversation for an inbound SMS.
    """
    for key, cid in _chat_ids.items():
        if cid == chat_id:
            return key
    return ""


def resolve_thread_ids(chat_id: str) -> list:
    """All internal thread keys that have used this Linq chat id (most recent first).

    Linq keys chats by from+to, so several internal threads can share one
    chat id; callers should pick the candidate that has live conversation
    state.
    """
    return [key for key, cid in reversed(list(_chat_ids.items())) if cid == chat_id]


async def send_message(to: str, text: str, thread_id: str = "") -> dict:
    """Send via Linq Partner API v3.

    First message to a recipient: POST /v3/chats (creates the chat, sends the
    message). Follow-ups: POST /v3/chats/{chatId}/messages. Chat ids are cached
    per thread so every reply lands in the same conversation.
    """
    _record(to, text, thread_id)
    key = thread_id or to
    parts = [{"type": "text", "value": text}]
    try:
        async with httpx.AsyncClient() as client:
            chat_id = _thread_chat_id(key)
            if chat_id:
                resp = await client.post(
                    f"{LINQ_API_BASE}/chats/{chat_id}/messages",
                    headers=HEADERS,
                    json={"message": {"parts": parts}},
                )
            else:
                resp = await client.post(
                    f"{LINQ_API_BASE}/chats",
                    headers=HEADERS,
                    json={
                        "from": LINQ_SANDBOX_NUMBER,
                        "to": [to],
                        "message": {"parts": parts},
                    },
                )
                data = resp.json()
                if resp.status_code < 400 and data.get("chat", {}).get("id"):
                    _chat_ids[key] = data["chat"]["id"]
            if DEMO_MODE and resp.status_code >= 400:
                # Demo sandbox: pretend delivery worked. The outbound entry is
                # already recorded; callers mirror it onto the user's thread.
                return {"ok": True, "demo": True}
            return resp.json()
    except Exception as exc:
        if DEMO_MODE:
            return {"ok": True, "demo": True}
        return {"error": {"message": f"send failed: {exc}"}}


def pop_outbound(text: str, thread_id: str = "") -> int:
    """Drop the most recent outbound entry matching text (demo direction rewrite)."""
    outbound = list(_outbox)
    removed = 0
    for i in range(len(outbound) - 1, -1, -1):
        m = outbound[i]
        if m.get("text") == text and (not thread_id or m.get("thread_id") == thread_id):
            outbound.pop(i)
            removed += 1
            break
    _outbox.clear()
    _outbox.extend(outbound)
    _save_transcript()
    return removed


def _g(product, key, default=None):
    return product.get(key, default) if isinstance(product, dict) else getattr(product, key, default)


def _stars(product) -> str:
    rating = _g(product, "rating", 0) or 0
    if rating < 0.5:
        return "—"
    r = int(rating)
    return "★" * r + "☆" * (5 - r)


def _labels(product) -> str:
    """Condition tags for SMS: (used), (refurb), (over budget) etc."""
    tags = []
    if _g(product, "is_used"):
        title = (_g(product, "title") or "").lower()
        tags.append("refurb" if any(w in title for w in ("refurb", "renew", "re-cert", "reconditioned", "open box")) else "used")
    if _g(product, "over_budget"):
        tags.append("over budget")
    return (" (" + " ".join(tags) + ")") if tags else ""


async def send_shopping_results(to: str, products: list, thread_id: str = "", best_reason: str = "") -> dict:
    _load_link_cache()
    lines = []
    for i, p in enumerate(products[:3], 1):
        link = _g(p, "product_url") or _g(p, "merchant_url") or ""
        lines.append((i, _g(p, "title"), _g(p, "price", 0), _g(p, "merchant"), _stars(p), _labels(p), link))
    short_links = (
        await asyncio.gather(*[_shorten_link(l) for (_, _, _, _, _, _, l) in lines])
        if lines else []
    )
    # Short per-product messages keep every text under SMS length limits
    # (a single long options blob gets rejected by the carrier fallback).
    results = []
    if lines:
        opener = "Found options for you:"
        if best_reason:
            opener += f"\n{best_reason}"
        results.append(await send_message(to, opener, thread_id))
        for (i, title, price, merchant, stars, labels, _), short in zip(lines, short_links):
            text = f"{i}. {title}{labels} — ${price:.2f} ({merchant}) {stars}"
            if short:
                text += f"\n{short}"
            results.append(await send_message(to, text, thread_id))
    best = products[0]
    avg = sum(_g(p, "price", 0) for p in products[:3]) / max(len(products[:3]), 1)
    savings = (1 - _g(best, "price", 0) / avg) * 100 if avg else 0
    best_txt = f"Best pick: {_g(best, 'title')} at ${_g(best, 'price', 0):.2f}"
    if savings >= 5:
        best_txt += f" — {savings:.0f}% below the average of these options"
    results.append(await send_message(to, best_txt, thread_id))
    results.append(await send_message(to, "Reply 1/2/3 to buy, or say 'more options'", thread_id))
    return results[-1] if results else {"error": {"message": "no products"}}


async def send_more_options(to: str, products: list, start: int, thread_id: str = "") -> dict:
    """Reveal the next batch of options (continuing numbering from the first list)."""
    _load_link_cache()
    lines = []
    for i, p in enumerate(products[:5], start + 1):
        link = _g(p, "product_url") or _g(p, "merchant_url") or ""
        lines.append((i, _g(p, "title"), _g(p, "price", 0), _g(p, "merchant"), _stars(p), _labels(p), link))
    short_links = (
        await asyncio.gather(*[_shorten_link(l) for (_, _, _, _, _, _, l) in lines])
        if lines else []
    )
    results = []
    if lines:
        results.append(await send_message(to, "More options:", thread_id))
        for (i, title, price, merchant, stars, labels, _), short in zip(lines, short_links):
            text = f"{i}. {title}{labels} — ${price:.2f} ({merchant}) {stars}"
            if short:
                text += f"\n{short}"
            results.append(await send_message(to, text, thread_id))
    results.append(await send_message(to, "Reply with a number to buy it.", thread_id))
    return results[-1] if results else {"error": {"message": "no products"}}


async def send_consent(to: str, product: dict, thread_id: str = "", user_id: str = "") -> dict:
    tier = {}
    budget_line = ""
    try:
        from spending import tier_for, get_budget
        price = _g(product, "price", 0)
        # Budgets are per-user: resolve the owner of this conversation so the
        # check uses only their spending, not everyone's combined totals.
        if not user_id:
            try:
                import users
                user_id = (users.user_by_phone(to) or {}).get("user_id", "") or ""
            except Exception:
                user_id = ""
        tier = tier_for(price, user_id=user_id) or {}
        limit = get_budget(user_id) if user_id else get_budget()
        if tier.get("tier") == "exceeds":
            # Stage 2 — cap confirmation: user must explicitly approve the overspend
            budget_line = (
                f"\n\n⚠ Budget cap: this exceeds your remaining budget by "
                f"${tier['excess']:.2f} (${tier['limit']:.2f} monthly limit).\n"
                "Reply APPROVE to borrow from next month, or NO to cancel."
            )
        elif tier.get("tier") == "near_limit":
            # Stage 1 — 90% warning with the remainder shown
            budget_line = (
                f"\n\n⚠ Budget check: this puts you at 90%+ of your ${tier['limit']:.2f} "
                f"monthly limit — ${tier['left']:.2f} left."
            )
        elif limit is not None:
            budget_line = f"\n\nBudget: ${tier['left']:.2f} left of your ${tier['limit']:.2f} monthly limit."
    except Exception:
        budget_line = ""
    reply_hint = (
        "Reply APPROVE to confirm the overspend, NO to cancel"
        if tier.get("tier") == "exceeds"
        else "Reply YES to approve, NO to cancel"
    )
    text = (
        f"Confirm purchase: {_g(product, 'title')} for ${_g(product, 'price', 0):.2f} from {_g(product, 'merchant')}"
        f"{budget_line}\n\n"
        f"{reply_hint}"
    )
    return await send_message(to, text, thread_id)


async def send_confirmation(to: str, product_title: str, amount: float, order_id: str, thread_id: str = "") -> dict:
    text = f"Done! {product_title} ordered for ${amount:.2f}. Order #{order_id}"
    return await send_message(to, text, thread_id)


def verify_webhook(body: bytes, headers, secret: str) -> bool:
    """Verify a Linq webhook using the Standard Webhooks signing scheme.

    Headers: webhook-id, webhook-timestamp, webhook-signature (v1,{base64}).
    Signed content: "{webhook-id}.{webhook-timestamp}.{body}" using the raw
    request body bytes. Rejects timestamps older than 5 minutes (replay guard).
    """
    msg_id = headers.get("webhook-id", "")
    timestamp = headers.get("webhook-timestamp", "")
    signature = headers.get("webhook-signature", "")
    if not (msg_id and timestamp and signature):
        return False
    try:
        if abs(int(time.time()) - int(timestamp)) > 300:
            return False
    except (TypeError, ValueError):
        return False
    try:
        secret_str = secret[6:] if secret.startswith("whsec_") else secret
        key = base64.b64decode(secret_str + "=" * (-len(secret_str) % 4))
        signed_content = f"{msg_id}.{timestamp}.{body.decode('utf-8')}"
        expected = base64.b64encode(
            hmac.new(key, signed_content.encode("utf-8"), hashlib.sha256).digest()
        ).decode()
        for sig in signature.split(" "):
            if sig.startswith("v1,") and hmac.compare_digest(expected, sig[3:]):
                return True
        return False
    except (ValueError, UnicodeDecodeError):
        return False
