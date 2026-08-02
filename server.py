from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
import asyncio
import time
import json
import os
import re
import urllib.parse
from collections import deque
import httpx
from config import (
    PRIVA_SERVER_HOST, PRIVA_SERVER_PORT, LINQ_SANDBOX_NUMBER,
    LINQ_WEBHOOK_SECRET, LINQ_API_KEY, PRAVA_PUBLISHABLE_KEY,
    PRAVA_API_URL, SERPAPI_KEY, LINQ_USER_ADDRESS,
    NOTE_OFFER_DELAY, URGENT_OFFER_DELAY, SHIPPING_INTERVAL,
    DEMO_MODE,
)
import users
from linq_client import (
    send_message, send_shopping_results, send_more_options, send_consent,
    send_confirmation, verify_webhook, outbox as linq_outbox, inbox as linq_inbox,
    record_inbound, clear_thread, resolve_thread_ids, record_outbound_for,
)
from serpapi_client import search_products, search_deep
from prava_client import (
    create_payment_session, get_payment_status, complete_payment,
    report_payment_outcome,
)
from agent import (
    parse_intent, rank_products, filter_results, log_transaction, update_transaction,
    get_transactions,
)
from models import Product
from notes_store import list_notes, get_note, save_note, delete_note, was_offered, mark_offered, recently_offered
from note_analyzer import analyze_note, analyze_note_llm, detect_urgency
from reminder_service import (
    add_reminder, list_reminders, cancel_reminder, scheduler as reminder_scheduler,
)
from price_watch import add_watch, list_watches, check_watches, fire_alert
from preferences import (
    extract_preferences, clean_item, build_query, pref_questions,
    parse_pref_answer, pref_rank, SKIP_WORDS, PREF_QUESTIONS,
)
from purchase_advisor import refine_query, decide_best
import spending as spending_store
import voice

app = FastAPI(title="PRIVA Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

conversations: dict[str, dict] = {}
_agent_activity: deque[dict] = deque(maxlen=60)
_last_inbound_from: str = ""
_last_offer_thread: str = ""
_ADDRESS_OVERRIDE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "user_address_override.json")


def _load_address_override() -> str:
    try:
        with open(_ADDRESS_OVERRIDE_FILE, encoding="utf-8") as f:
            return str(json.load(f).get("address", ""))
    except Exception:
        return ""


def _save_address_override(address: str):
    try:
        with open(_ADDRESS_OVERRIDE_FILE, "w", encoding="utf-8") as f:
            json.dump({"address": address, "saved_at": time.time()}, f)
    except Exception:
        pass


_user_address_override: str = _load_address_override()
_webhook_log: deque[dict] = deque(maxlen=120)
_seen_event_ids: deque[str] = deque(maxlen=200)
_thread_locks: dict[str, asyncio.Lock] = {}
_offer_tasks: dict[str, asyncio.Task] = {}


def emit_activity(agent: str, message: str, detail: str = "", note_id: str = ""):
    event = {
        "agent": agent,
        "message": message,
        "detail": detail,
        "note_id": note_id,
        "ts": int(time.time()),
    }
    _agent_activity.appendleft(event)
    return event


def outgoing_address() -> str:
    if _user_address_override:
        return _user_address_override
    return LINQ_USER_ADDRESS or _last_inbound_from or ""


_bearer = HTTPBearer(auto_error=False)


def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict:
    """Resolve the bearer token to a user (defaults to the local SMS-only user)."""
    if credentials:
        user = users.user_by_token(credentials.credentials)
        if user:
            return user
    return {"user_id": "local", "name": "", "phone": "", "is_admin": False}


def require_admin(user: dict = Depends(current_user)) -> dict:
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def user_phone(user: dict) -> str:
    """The phone PRIVA should text for this user (falls back to the owner address)."""
    if user.get("user_id") and user["user_id"] != "local":
        return users.phone_for(user["user_id"])
    return outgoing_address()


def user_thread(user: dict) -> str:
    """The per-user mirror thread the web/desktop chat polls."""
    if user.get("user_id") and user["user_id"] != "local":
        return f"priva_mirror_{user['user_id']}"
    return "priva_mirror"

@app.get("/health")
async def health():
    return {"status": "ok", "service": "PRIVA"}

@app.get("/api/config")
async def api_config():
    prava_healthy = False
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.get(f"{PRAVA_API_URL.rsplit('/v1', 1)[0]}/health")
            prava_healthy = resp.status_code == 200
    except Exception:
        pass
    return {
        "prava_publishable_key": PRAVA_PUBLISHABLE_KEY,
        "prava_configured": bool(PRAVA_PUBLISHABLE_KEY),
        "prava_healthy": prava_healthy,
        "linq_configured": bool(LINQ_API_KEY),
        "linq_sandbox_number": LINQ_SANDBOX_NUMBER,
        "serpapi_configured": bool(SERPAPI_KEY),
    }

@app.post("/api/auth/otp")
async def api_auth_otp(payload: dict):
    """Request a login code: {phone, name?}. New phones register on first login.

    DEMO_MODE returns the code inline (no SMS infrastructure needed for
    judges). Real mode delivers it via Linq SMS.
    """
    phone = users.normalize_phone(str(payload.get("phone", "")))
    if not phone:
        raise HTTPException(status_code=400, detail="Enter a valid phone number (digits only, country code first)")
    name = str(payload.get("name", "")).strip()
    user = users.issue_otp(phone, name)
    otp = user.get("otp", "")
    sent = False
    delivery = "inline"
    if not DEMO_MODE and LINQ_API_KEY:
        try:
            await send_message(phone, f"PRIVA verification code: {otp}", f"otp_{user['user_id']}")
            sent = True
            delivery = "sms"
        except Exception as exc:
            emit_activity("LINQ", f"OTP SMS to {phone} failed: {exc}")
    emit_activity("AUTH", f"OTP requested for {phone}")
    resp = {
        "ok": True,
        "user_id": user["user_id"],
        "delivery": delivery,
        "sent": sent or DEMO_MODE,
        "expires_in": users.OTP_TTL,
    }
    if DEMO_MODE:
        resp["otp"] = otp
    return resp


class OtpVerifyIn(BaseModel):
    phone: str
    otp: str


@app.post("/api/auth/verify")
async def api_auth_verify(req: OtpVerifyIn):
    user = users.verify_otp(req.phone, req.otp)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired code")
    emit_activity("AUTH", f"{user.get('name') or user['phone']} logged in", "admin" if user.get("is_admin") else "user")
    return {**users.public_user(user), "token": user.get("token", "")}


@app.post("/api/auth/demo-login")
async def api_auth_demo_login(payload: dict):
    """DEMO_MODE only: mint a token for an existing user id (QR deep-link flow)."""
    if not DEMO_MODE:
        raise HTTPException(status_code=403, detail="DEMO_MODE is off")
    user = users.mint_token(str(payload.get("user_id", "")))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    emit_activity("AUTH", f"demo deep-link login: {user.get('name') or user['phone']}")
    return {**users.public_user(user), "token": user["token"]}


@app.get("/api/auth/me")
async def api_auth_me(user: dict = Depends(current_user)):
    if user.get("user_id") == "local":
        return {"user": None, "authenticated": False}
    return {"user": users.public_user(user), "authenticated": True}


@app.get("/api/transactions")
async def list_transactions(user: dict = Depends(current_user)):
    return {"transactions": get_transactions(user["user_id"])}

@app.post("/api/transactions/{txn_id}/status")
async def update_txn_status(txn_id: str, status: str):
    update_transaction(txn_id, status=status)
    return {"ok": True}


SHIPPING_STEPS = ["confirmed", "shipped", "out_for_delivery", "delivered"]


async def _shipping_worker():
    """Silent stage auto-advance every SHIPPING_INTERVAL; one 'delivered' SMS.

    Real mode: ~3h per stage (matches the 3-day ETA). Demo mode: 3 min per
    stage so the timeline visibly moves during a recording.
    """
    while True:
        await asyncio.sleep(SHIPPING_INTERVAL)
        try:
            for txn in get_transactions():
                cur = txn.get("shipping_status") or "confirmed"
                if cur == "delivered":
                    continue
                idx = SHIPPING_STEPS.index(cur) if cur in SHIPPING_STEPS else 0
                if idx >= len(SHIPPING_STEPS) - 1:
                    continue
                nxt = SHIPPING_STEPS[idx + 1]
                update_transaction(txn["id"], shipping_status=nxt)
                emit_activity("DELIVERY", f"order {nxt.replace('_', ' ')}", txn["id"], note_id=txn.get("note_id", ""))
                if nxt == "delivered":
                    uid = txn.get("user_id", "")
                    address = users.phone_for(uid) or outgoing_address()
                    if address:
                        thread_id = f"priva_mirror_{uid}" if users.user_by_id(uid) else "priva_mirror"
                        try:
                            await send_message(
                                address,
                                f"Your {txn.get('product_title', 'order')} was delivered. Enjoy!",
                                thread_id,
                            )
                        except Exception:
                            pass
        except Exception:
            pass


@app.post("/api/transactions/{txn_id}/shipping/advance")
async def api_shipping_advance(txn_id: str):
    txn = next((t for t in get_transactions() if t["id"] == txn_id), None)
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    current = txn.get("shipping_status") or "confirmed"
    idx = SHIPPING_STEPS.index(current) if current in SHIPPING_STEPS else 0
    if idx < len(SHIPPING_STEPS) - 1:
        nxt = SHIPPING_STEPS[idx + 1]
        update_transaction(txn_id, shipping_status=nxt)
        emit_activity("DELIVERY", f"order {nxt.replace('_', ' ')}", txn_id, note_id=txn.get("note_id", ""))
        return {"shipping_status": nxt}
    return {"shipping_status": current}


class BudgetIn(BaseModel):
    limit: float


@app.get("/api/budget")
async def api_budget():
    limit = spending_store.get_budget()
    return {
        "limit": limit,
        "spent_this_month": spending_store.spent_this_month(),
        "remaining": spending_store.remaining(),
        "month": spending_store._month(),
    }


@app.put("/api/budget")
async def api_budget_set(req: BudgetIn):
    spending_store.set_budget(req.limit)
    emit_activity("BUDGET", f"monthly limit set", f"${req.limit:.2f}")
    return await api_budget()


@app.get("/api/spending/analysis")
async def api_spending_analysis():
    return {"analysis": spending_store.analysis()}

class SearchRequest(BaseModel):
    query: str
    max_price: float | None = None
    limit: int = 10

class PayRequest(BaseModel):
    product_id: str
    title: str
    price: float
    merchant: str
    thumbnail: str = ""
    product_url: str = ""
    user_id: str = "web-user"
    budget_excess: float | None = None

@app.post("/api/search")
async def api_search(req: SearchRequest, user: dict = Depends(current_user)):
    products = await search_products(req.query, req.max_price, req.limit, ns=user["user_id"])
    return {"products": [p.model_dump() for p in products]}

@app.post("/api/pay")
async def api_pay(req: PayRequest):
    # Three-stage budget: refuse to open a session that blows the cap until
    # the user explicitly approves borrowing from next month.
    tier = spending_store.tier_for(req.price)
    if tier.get("tier") == "exceeds" and not req.budget_excess:
        raise HTTPException(
            status_code=409,
            detail=json.dumps({"tier": "exceeds", "excess": tier["excess"], "limit": tier["limit"]}),
        )
    result = await create_payment_session(
        user_id=req.user_id,
        user_email="user@priva.app",
        total_amount=str(req.price),
        currency="USD",
        merchant_name=req.merchant,
        merchant_url=req.product_url or "https://www.google.com/search?q=" + urllib.parse.quote(req.title) + "&tbm=shop",
        product_title=req.title,
        product_price=str(req.price),
    )
    session_id = result.get("session_id", "")
    txn = log_transaction(
        req.user_id,
        Product(id=req.product_id, title=req.title, price=req.price, merchant=req.merchant,
                thumbnail=req.thumbnail, product_url=req.product_url),
        session_id,
    )
    if req.budget_excess:
        emit_activity("BUDGET", "overspend approved — borrow from next month", f"${req.budget_excess:.2f}")
    result["transaction_id"] = txn.id
    result["budget_tier"] = tier.get("tier")
    return result

@app.get("/api/pay/status")
async def api_pay_status(session_id: str):
    return await get_payment_status(session_id)

class PayCompleteRequest(BaseModel):
    session_id: str
    transaction_id: str = ""
    amount: float | None = None
    budget_excess: float | None = None

@app.post("/api/pay/complete")
async def api_pay_complete(req: PayCompleteRequest):
    result = await complete_payment(req.session_id, str(req.amount) if req.amount else None)
    if req.transaction_id:
        status = result.get("status", "pending")
        update_transaction(
            req.transaction_id,
            status="completed" if status == "completed" else "pending",
            prava_status=result.get("prava_status", ""),
        )
        if status == "completed":
            txn = next((t for t in get_transactions() if t["id"] == req.transaction_id), None)
            if txn:
                txn_uid = txn.get("user_id", "local")
                spending_store.record_purchase(
                    txn.get("product_title", ""), txn.get("merchant", ""),
                    float(txn.get("amount", 0) or 0), req.transaction_id,
                    user_id=txn_uid,
                )
                if req.budget_excess:
                    spending_store.record_borrow(req.budget_excess)
                    emit_activity("BUDGET", "borrowed from next month", f"${req.budget_excess:.2f}")
    return result

@app.post("/api/transactions/refresh")
async def api_transactions_refresh():
    for txn in get_transactions():
        if txn.get("status") == "pending" and txn.get("prava_session_id"):
            prava = await get_payment_status(txn["prava_session_id"])
            update_transaction(
                txn["id"],
                prava_status=prava.get("status", ""),
            )
    return {"transactions": get_transactions()}

@app.get("/api/agent/activity")
async def api_activity(note_id: str = ""):
    if note_id:
        return {"events": [e for e in _agent_activity if e.get("note_id") == note_id]}
    return {"events": list(_agent_activity)}


@app.get("/api/linq/address")
async def api_linq_address():
    return {"address": outgoing_address(), "configured": bool(LINQ_USER_ADDRESS), "last_inbound": _last_inbound_from}


@app.get("/api/linq/transcript")
async def api_linq_transcript(thread_id: str = "", user: dict = Depends(current_user)):
    if user.get("user_id") != "local" and not user.get("is_admin"):
        thread_id = user_thread(user)
    return {"messages": linq_outbox(thread_id), "inbound": linq_inbox(thread_id)}


class LinqSendIn(BaseModel):
    text: str
    thread_id: str = ""


@app.post("/api/linq/send")
async def api_linq_send(req: LinqSendIn, user: dict = Depends(current_user)):
    """Send an SMS from the web/desktop chat (real phone delivery via Linq)."""
    to = user_phone(user)
    if not to:
        raise HTTPException(status_code=400, detail="No SMS destination configured")
    thread_id = user_thread(user) if user["user_id"] != "local" else (req.thread_id or "priva_mirror")
    result = await send_message(to, req.text, thread_id)
    error = result.get("error") if isinstance(result, dict) else None
    emit_activity("LINQ", "web chat -> SMS", req.text[:60])
    return {"ok": True, "sent": not error, "error": error, "thread_id": thread_id}


@app.delete("/api/linq/transcript")
async def api_linq_clear(thread_id: str = "priva_mirror"):
    """Mirror chat 'clear' — drop the transcript for one thread (keeps others)."""
    removed = clear_thread(thread_id or "priva_mirror")
    emit_activity("NOTES", "chat cleared", f"{removed} messages")
    return {"ok": True, "removed": removed}


@app.post("/api/voice/stt")
async def api_voice_stt(request: Request):
    """Local Whisper STT — raw 16 kHz mono int16 PCM body -> {text}."""
    body = await request.body()
    if len(body) < 3200:  # < 100 ms of audio
        raise HTTPException(status_code=400, detail="audio too short (min ~100ms of 16kHz PCM16)")
    try:
        text = await asyncio.wait_for(asyncio.to_thread(voice.transcribe_pcm16, body), timeout=45)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="transcription timed out")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"transcription failed: {exc}")
    return {"text": text}


@app.get("/api/voice/tts")
async def api_voice_tts(text: str):
    """Speak a line — edge-tts neural voice (SAPI fallback offline)."""
    if not text.strip():
        raise HTTPException(status_code=400, detail="empty text")
    try:
        data = await asyncio.wait_for(voice.synthesize(text), timeout=30)
    except asyncio.TimeoutError:
        data = b""
    if not data:
        raise HTTPException(status_code=502, detail="TTS unavailable")
    return Response(content=data, media_type="audio/mpeg")


class NoteIn(BaseModel):
    id: str
    title: str = ""
    blocks: list = []
    tags: list = []
    created_at: int = 0
    updated_at: int = 0


@app.get("/api/notes")
async def api_notes(user: dict = Depends(current_user)):
    return {"notes": list_notes(user["user_id"])}


@app.post("/api/notes")
async def api_note_create(note: NoteIn, user: dict = Depends(current_user)):
    stored = save_note(note.model_dump(), user["user_id"])
    emit_activity("NOTES", f"note saved: {note.title or 'untitled'}", note_id=stored["id"])
    _schedule_note_offer(stored)
    return {"note": stored}


@app.put("/api/notes/{note_id}")
async def api_note_update(note_id: str, note: NoteIn, user: dict = Depends(current_user)):
    if not get_note(note_id, user["user_id"]):
        raise HTTPException(status_code=404, detail="Note not found")
    stored = save_note({**note.model_dump(), "id": note_id}, user["user_id"])
    _schedule_note_offer(stored)
    return {"note": stored}


@app.delete("/api/notes/{note_id}")
async def api_note_delete(note_id: str, user: dict = Depends(current_user)):
    if not get_note(note_id, user["user_id"]):
        raise HTTPException(status_code=404, detail="Note not found")
    task = _offer_tasks.pop(note_id, None)
    if task and not task.done():
        task.cancel()
    return {"ok": delete_note(note_id)}


@app.get("/api/notes/analyze")
async def api_note_analyze(note_id: str = "", user: dict = Depends(current_user)):
    if note_id:
        note = get_note(note_id, user["user_id"])
        if not note:
            raise HTTPException(status_code=404, detail="Note not found")
        return analyze_note(note)
    return {"notes": [{"id": n["id"], **analyze_note(n)} for n in list_notes(user["user_id"])]}  


@app.post("/api/notes/analyze-text")
async def api_note_analyze_text(note: NoteIn):
    """Analyze arbitrary note text (used by the public web demo)."""
    return await analyze_note_llm(note.model_dump())


@app.get("/api/demo/register-phone")
async def api_demo_register_status():
    return {
        "registered": bool(_user_address_override),
        "address": _user_address_override,
        "config_address": LINQ_USER_ADDRESS,
        "effective": outgoing_address(),
    }


@app.post("/api/demo/register-phone")
async def api_demo_register_phone(payload: dict):
    phone = str(payload.get("phone", "")).strip()
    if not phone:
        raise HTTPException(status_code=400, detail="phone is required")
    digits = re.sub(r"\D", "", phone)
    if not re.match(r"^[1-9]\d{7,14}$", digits):
        raise HTTPException(status_code=400, detail="Enter a valid phone number (digits only, country code first)")
    normalized = "+" + digits
    users.get_or_create(normalized)
    global _user_address_override
    _user_address_override = normalized
    _save_address_override(normalized)
    emit_activity("LINQ", f"test number registered: {normalized}")
    if payload.get("send_test"):
        try:
            send_message(normalized, "PRIVA connected \u2014 I'll text you when your notes need shopping or reminders. Reply anything to chat.")
        except Exception as exc:
            emit_activity("LINQ", f"test SMS to {normalized} failed: {exc}")
    return {"ok": True, "registered": True, "address": normalized, "effective": outgoing_address()}


@app.get("/api/linq/webhook-log")
async def api_webhook_log(limit: int = 20):
    return {"events": list(_webhook_log)[:limit]}


def _schedule_note_offer(note: dict):
    """Debounced offer: fires NOTE_OFFER_DELAY after the user STOPS editing.

    Context-aware:
      - time-pressure notes (flight today, ASAP) -> URGENT_OFFER_DELAY (seconds)
      - normal shopping intent -> NOTE_OFFER_DELAY (3h real / 150s demo)
      - item already purchased in the app -> no SMS at all (checked at fire time)

    Every note save resets the timer for that note, so PRIVA never texts
    while the user is still typing.
    """
    note_id = note["id"]
    task = _offer_tasks.pop(note_id, None)
    if task and not task.done():
        task.cancel()
    blocks = note.get("blocks") or []
    text = " ".join(b.get("content", "") for b in blocks if isinstance(b, dict))
    text = f"{note.get('title', '')} {text}"
    urgent = detect_urgency(text)
    delay = URGENT_OFFER_DELAY if urgent else NOTE_OFFER_DELAY
    emit_activity(
        "NOTE ANALYZER",
        f"{'urgent' if urgent else 'scheduled'} buy intent offer",
        f"+{delay}s",
        note_id=note_id,
    )

    async def _run():
        try:
            await asyncio.sleep(delay)
            stored = get_note(note_id)
            if stored:
                await _maybe_offer_from_note(stored, urgent=urgent)
        except Exception as exc:
            emit_activity("NOTE ANALYZER", "offer failed", f"{type(exc).__name__}: {exc}"[:120], note_id=note_id)

    _offer_tasks[note_id] = asyncio.create_task(_run())


def _already_purchased(item: str) -> bool:
    """True when the user already bought a matching product (app checkout or SMS arc)."""
    item = (item or "").lower().strip()
    if not item:
        return False
    item_tokens = {w for w in item.split() if len(w) > 2}

    def matches(title: str) -> bool:
        title = (title or "").lower()
        if item in title:
            return True
        shared = item_tokens & {w for w in title.split() if len(w) > 2}
        return len(shared) >= 2 or any(len(w) >= 8 for w in shared)

    for txn in get_transactions():
        if txn.get("status") == "completed" and matches(txn.get("product_title", "")):
            return True
    for p in spending_store.purchases():
        if matches(p.get("title", "")):
            return True
    return False


async def _maybe_offer_from_note(note: dict, urgent: bool = False):
    """Text the user about a buy intent found in a freshly saved note (deduped)."""
    analysis = await analyze_note_llm(note)
    buy_intents = analysis.get("buy_intents", [])
    if not buy_intents:
        return
    note_user = note.get("user_id", "local")
    address = users.phone_for(note_user) or outgoing_address()
    if not address:
        emit_activity("LINQ", "buy intent detected — no address configured", note["id"], note_id=note["id"])
        return
    first = buy_intents[0]
    prefs = first.get("prefs") or {}
    item = clean_item(first["item"], prefs) or first["item"]
    if was_offered(note["id"], item):
        return
    if recently_offered(note["id"]):
        emit_activity("NOTE ANALYZER", "offer cooldown — skipping", item, note_id=note["id"])
        return
    if len(item) < 4:
        return
    if _already_purchased(item):
        mark_offered(note["id"], item, "")
        emit_activity("NOTE ANALYZER", "already purchased — skipping offer", item, note_id=note["id"])
        return
    hint = ""
    if first.get("price_hint"):
        try:
            hint = f" under ${float(first['price_hint']):.0f}"
        except (TypeError, ValueError):
            hint = ""
    thread_id = f"note_{note['id']}"
    global _last_offer_thread
    _last_offer_thread = thread_id
    conversations[thread_id] = {
        "step": "note_offer",
        "pending_item": item,
        "price_hint": first.get("price_hint"),
        "prefs": prefs,
        "note_id": note["id"],
        "from": address,
        "user_id": note_user,
    }
    pref_txt = ""
    if prefs.get("color") or prefs.get("size"):
        bits = []
        if prefs.get("color"):
            bits.append(prefs["color"])
        if prefs.get("size"):
            bits.append(f"size {prefs['size']}")
        pref_txt = f" — noted: {', '.join(bits)}"
    urgency_txt = "⚡ URGENT — " if urgent else ""
    text = (
        f"{urgency_txt}PRIVA: I noticed your note mentions buying {item}{hint}{pref_txt}. "
        f"Want me to find the best options? Reply YES to search, or NO to skip."
    )
    emit_activity("NOTE ANALYZER", f"saw buy intent: {item}" + hint, note_id=note["id"])
    before = len(linq_outbox())
    result = await send_message(address, text, thread_id)
    if isinstance(result, dict) and result.get("error"):
        emit_activity("LINQ", "send failed", str(result.get("error"))[:120], note_id=note["id"])
        return
    if note_user not in ("", "local"):
        mirror = f"priva_mirror_{note_user}"
        if mirror != thread_id:
            for entry in linq_outbox()[before:]:
                if entry.get("thread_id") == thread_id:
                    record_outbound_for(entry, mirror)
    mark_offered(note["id"], item, thread_id)
    emit_activity("LINQ", "texted you on iMessage", text[:60], note_id=note["id"])


@app.get("/api/reminders")
async def api_reminders(include_fired: bool = False, user: dict = Depends(current_user)):
    return {"reminders": list_reminders(include_fired, user["user_id"])}


class ReminderIn(BaseModel):
    text: str
    due_at: int
    note_id: str = ""


@app.post("/api/reminders")
async def api_reminder_create(reminder: ReminderIn, user: dict = Depends(current_user)):
    created = add_reminder(
        reminder.text, reminder.due_at, reminder.note_id,
        user_id=user["user_id"], address=user_phone(user),
    )
    emit_activity("REMINDER", f"set for {time.strftime('%a %H:%M', time.localtime(created['due_at']))}", reminder.text[:60], note_id=created.get("note_id", ""))
    return {"reminder": created}


@app.delete("/api/reminders/{reminder_id}")
async def api_reminder_delete(reminder_id: str):
    return {"ok": cancel_reminder(reminder_id)}


class SimulateReply(BaseModel):
    text: str
    thread_id: str = ""


@app.post("/api/linq/simulate-reply")
async def api_simulate_reply(req: SimulateReply, user: dict = Depends(current_user)):
    """In-app mirror of an inbound iMessage reply — same conversation machine."""
    from_ = user_phone(user) or "priva_user"
    if user["user_id"] != "local":
        thread_id = user_thread(user)
    else:
        thread_id = req.thread_id or "priva_mirror"
    result = await route_inbound(from_, req.text, thread_id)
    return {"ok": True, "result": result}


@app.get("/api/watchlist")
async def api_watchlist(user: dict = Depends(current_user)):
    return {"watches": list_watches(user["user_id"])}


class DemoDrop(BaseModel):
    item: str
    drop_pct: float = 12.0


@app.post("/api/demo/price-drop")
async def api_demo_price_drop(req: DemoDrop):
    """Demo-mode surprise beat: fire a staged price-drop alert now."""
    from config import DEMO_MODE
    if not DEMO_MODE:
        raise HTTPException(status_code=403, detail="DEMO_MODE is off")
    address = outgoing_address()
    watch = next((w for w in list_watches() if w["item"].lower() == req.item.lower()), None)
    watch_note = (watch or {}).get("note_id", "")
    old_price = watch["price"] if watch else 99.99
    new_price = old_price * (1 - req.drop_pct / 100)
    thread_id = "priva_mirror"
    conversations[thread_id] = {
        "step": "awaiting_buy_now",
        "pending_item": req.item,
        "note_id": watch_note,
        "from": address,
    }
    emit_activity("PRICE WATCH", f"{req.item} -{req.drop_pct:.0f}% detected", f"${new_price:.2f}", note_id=watch_note)
    emit_activity("LINQ", "price-drop alert sent", req.item, note_id=watch_note)
    ok = await fire_alert(address, req.item, new_price, req.drop_pct, thread_id)
    if not ok:
        emit_activity("LINQ", "no address for alert — mirror will show it", req.item, note_id=watch_note)
    return {"ok": ok, "item": req.item, "old_price": old_price, "new_price": round(new_price, 2)}

@app.post("/priva/webhook")
async def webhook_handler(request: Request):
    body = await request.body()
    if LINQ_WEBHOOK_SECRET:
        if not verify_webhook(body, request.headers, LINQ_WEBHOOK_SECRET):
            raise HTTPException(status_code=401, detail="Invalid signature")
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    event_type = data.get("event_type") or data.get("type", "")
    event_id = data.get("event_id") or data.get("id", "")
    event_data = data.get("data", {}) or {}
    sender_handle = event_data.get("sender_handle") or {}
    from_ = sender_handle.get("handle", "") or event_data.get("from", "")
    chat_id = (event_data.get("chat") or {}).get("id", "") or event_data.get("chat_id", "")
    parts = event_data.get("parts") or []
    text = "".join(p.get("value", "") for p in parts if p.get("type") == "text")
    log_entry = {
        "event_id": event_id, "event_type": event_type, "from": from_,
        "text": text, "chat_id": chat_id,
        "ts": int(time.time()),
        "headers": {k: v for k, v in request.headers.items() if k.lower() in ("webhook-id", "webhook-timestamp", "webhook-signature", "x-webhook-event")},
    }
    if event_type != "message.received":
        err = event_data.get("error") or {}
        log_entry["error"] = err.get("message", "") or event_data.get("failure_reason", "")
        log_entry["status"] = event_data.get("status", "")
    if event_id and event_id in _seen_event_ids:
        log_entry["result"] = "duplicate_skipped"
        _webhook_log.appendleft(log_entry)
        return {"ok": True, "result": "duplicate_skipped"}
    if event_id:
        _seen_event_ids.append(event_id)
    if event_type != "message.received":
        log_entry["result"] = f"ignored:{event_type}"
        _webhook_log.appendleft(log_entry)
        return {"ok": True, "ignored": event_type}
    if event_data.get("direction") and event_data.get("direction") != "inbound":
        log_entry["result"] = "ignored:direction"
        _webhook_log.appendleft(log_entry)
        return {"ok": True, "ignored": f"direction:{event_data.get('direction')}"}
    if event_data.get("reconciled_at"):
        log_entry["result"] = "ignored:reconciled_history"
        _webhook_log.appendleft(log_entry)
        return {"ok": True, "ignored": "reconciled_history"}
    health = (event_data.get("chat") or {}).get("health_status") or {}
    if health.get("status") == "OPTED_OUT":
        log_entry["result"] = "ignored:opted_out"
        _webhook_log.appendleft(log_entry)
        return {"ok": True, "ignored": "opted_out"}
    if not text:
        log_entry["result"] = "ignored:empty"
        _webhook_log.appendleft(log_entry)
        return {"ok": True, "ignored": "empty"}
    if not from_:
        log_entry["result"] = "ignored:no_sender"
        _webhook_log.appendleft(log_entry)
        return {"ok": True, "ignored": "no_sender"}
    global _last_inbound_from
    _last_inbound_from = from_
    thread_id = chat_id or f"linq_{from_}"
    asyncio.create_task(_process_inbound_task(log_entry, from_, text, thread_id))
    return {"ok": True, "result": "processing_async"}


async def _process_inbound_task(log_entry: dict, from_: str, text: str, thread_id: str):
    lock = _thread_locks.setdefault(thread_id, asyncio.Lock())
    async with lock:
        try:
            t0 = time.time()
            result = await route_inbound(from_, text, thread_id)
            log_entry["result"] = result
        except Exception as exc:
            result = f"error:{type(exc).__name__}:{exc}"
            log_entry["result"] = result
        log_entry["duration_ms"] = int((time.time() - t0) * 1000)
        _webhook_log.appendleft(log_entry)


async def route_inbound(from_: str, text: str, thread_id: str):
    """Entry point for any inbound text (webhook or mirror).

    Mirror rule: a reply that lands on a real conversation (either a webhook
    SMS that resolved to a known thread, or a short app-mirror reply routed to
    the last note offer) has its inbound recorded on the mirror chat and its
    outbound duplicated onto the mirror chat, so the app shows the FULL
    conversation no matter which side the user typed on.
    """
    mirror_to = ""
    if thread_id not in conversations:
        for candidate in resolve_thread_ids(thread_id):
            if candidate in conversations:
                thread_id = candidate
                mirror_to = "priva_mirror"
                break
    if thread_id not in conversations and _last_offer_thread:
        # App mirror / unknown thread: a SHORT reply almost certainly targets
        # the most recent note offer. New shop intents never redirect.
        last = _last_offer_thread
        is_short_reply = parse_intent(text).action != "shop" and len(text.strip().split()) <= 3
        if is_short_reply and last in conversations and conversations[last].get("step") in ("note_offer", "asking_prefs", "showing_results"):
            mirror_to = thread_id
            thread_id = last
    user = users.user_by_phone(from_)
    user_thread = f"priva_mirror_{user['user_id']}" if user else ""
    record_inbound(from_, text, thread_id)
    if mirror_to and mirror_to != thread_id:
        record_inbound(from_, text, mirror_to)
    if user_thread and user_thread != thread_id and user_thread != mirror_to:
        record_inbound(from_, text, user_thread)
    before = len(linq_outbox())
    try:
        result = await _handle_inbound(from_, text, thread_id)
    finally:
        for entry in linq_outbox()[before:]:
            if entry.get("thread_id") == thread_id:
                if mirror_to and mirror_to != thread_id:
                    record_outbound_for(entry, mirror_to)
                if user_thread and user_thread != thread_id and user_thread != mirror_to:
                    record_outbound_for(entry, user_thread)
    return result


async def _handle_inbound(from_: str, text: str, thread_id: str):
    conv = conversations.get(thread_id, {})
    step = conv.get("step", "")
    if text.strip().upper() == "BUY NOW":
        return await handle_buy_now(from_, text, thread_id, conv)
    intent = parse_intent(text)
    if step == "note_offer":
        return await handle_note_offer_reply(from_, text, thread_id, conv)
    if step == "asking_prefs":
        return await handle_pref_answer(from_, text, thread_id, conv)
    if intent.action == "shop" and (not step or step in ("payment_pending", "payment_failed")):
        return await _start_shop_flow(from_, intent, thread_id)
    if intent.action == "reminder":
        await send_message(from_, f"Reminder noted: {intent.query}", thread_id)
        return "reminder"
    return await handle_choice(from_, text, thread_id)


def _pref_question_text(item: str, question: str) -> str:
    return f"{item} — {PREF_QUESTIONS[question]}"


async def _ask_next_pref(from_: str, thread_id: str, conv: dict, item: str):
    queue = conv.get("pref_queue") or []
    if not queue:
        return await _run_search_and_show(from_, thread_id, conv)
    conv["current_question"] = queue[0]
    conversations[thread_id] = conv
    await send_message(from_, _pref_question_text(item, queue[0]), thread_id)
    return "asking_prefs"


async def _start_shop_flow(from_: str, intent, thread_id: str, note_id: str = ""):
    """Direct shop intent: pull any preferences from the message, ask what's missing."""
    raw_prefs = extract_preferences(intent.query)
    item = clean_item(intent.query, raw_prefs) or intent.query
    conv = {
        "step": "asking_prefs" if pref_questions(item, raw_prefs) else "search_pending",
        "pending_item": item,
        "price_hint": intent.max_price,
        "prefs": raw_prefs,
        "pref_queue": pref_questions(item, raw_prefs),
        "from": from_,
        "note_id": note_id,
    }
    conversations[thread_id] = conv
    if conv["step"] == "asking_prefs":
        return await _ask_next_pref(from_, thread_id, conv, item)
    return await _run_search_and_show(from_, thread_id, conv)


async def _search_and_pick(
    item: str,
    price_hint: float | None,
    prefs: dict,
    category=None,
    query: str = "",
) -> tuple:
    """Shared deep-search → filter → rank → pick pipeline (shop + buy-now).

    Returns (ranked, best_reason, over_budget). When nothing fits the budget
    the closest-to-budget items are surfaced with over_budget=True and the
    LLM best-pick step is skipped (closest = best).
    """
    purpose = prefs.get("purpose") if prefs else None
    if not query:
        query = build_query(item, prefs or {})
        refined = await refine_query(item, purpose, price_hint, category=category, prefs=prefs)
        if refined:
            query = refined
    products = await search_deep(item, query, price_hint, 10, category=category)
    if not products:
        products = await search_deep(item, query, None, 10, category=category)
    if not products:
        return [], "", False
    raw_count = len(products)
    products = filter_results(products, item, price_hint, category=category)
    over_budget = False
    if not products:
        # Nothing fits the budget: re-search uncapped and surface the closest.
        over_budget = True
        products = await search_deep(item, query, None, 10, category=category)
        products = filter_results(products, item, None, category=category)
        if not products:
            return [], "", True
        budget = price_hint or 0
        products.sort(key=lambda p: abs((p.price or 0) - budget) if budget else (p.price or 0))
        products = products[:6]
        for p in products:
            p.over_budget = True
    else:
        if raw_count != len(products):
            emit_activity("FILTER", f"kept {len(products)} of {raw_count} after spam/merchant filtering")
    ranked = pref_rank(rank_products(products, price_hint, query, item=item, category=category), prefs or {})
    best_reason = ""
    if over_budget:
        if ranked:
            ranked.sort(key=lambda p: abs((p.price or 0) - (price_hint or 0)))
            best_reason = f"Closest to your ${float(price_hint):.0f} budget." if price_hint else ""
        return ranked, best_reason, True
    decision = await decide_best(ranked, item, purpose, price_hint, query, category=category)
    if decision.get("index", -1) >= 0 and decision.get("index", -1) < len(ranked):
        best_reason = decision.get("reason", "") or ""
        best = ranked.pop(decision["index"])
        ranked.insert(0, best)
    return ranked, best_reason, False


async def _run_search_and_show(from_: str, thread_id: str, conv: dict) -> str:
    """Compose the preference query, deep search, filter, rank, and send options."""
    item = conv.get("pending_item", "")
    price_hint = conv.get("price_hint")
    prefs = conv.get("prefs") or {}
    purpose = prefs.get("purpose")
    from catalog import detect_category
    category = detect_category(item)
    query = build_query(item, prefs)
    refined = await refine_query(item, purpose, price_hint, category=category, prefs=prefs)
    if refined:
        query = refined
    if conv.get("from_qa"):
        extra = f" under ${float(price_hint):.0f}" if price_hint else ""
        await send_message(from_, f"On it — searching for {query}{extra}...", thread_id)
    note_id = conv.get("note_id", "")
    emit_activity("SERPAPI", f"searching '{query}'", f"under ${float(price_hint):.0f}" if price_hint else "", note_id=note_id)
    ranked, best_reason, over_budget = await _search_and_pick(
        item, price_hint, prefs, category=category, query=query,
    )
    if not ranked:
        await send_message(from_, "Couldn't find options for that item. Try a different phrasing.", thread_id)
        conversations.pop(thread_id, None)
        return "no_products"
    conversations[thread_id] = {
        "step": "showing_results",
        "products": [p.model_dump() for p in ranked],
        "shown": 3,
        "from": from_,
        "note_id": conv.get("note_id", ""),
        "pending_item": item,
    }
    emit_activity("SERPAPI", f"found {len(ranked)} options", query, note_id=note_id)
    emit_activity("RANKER", "best pick computed", ranked[0].title if ranked else "", note_id=note_id)
    if over_budget:
        emit_activity("BUDGET", "no in-budget options — showing closest", ranked[0].title if ranked else "", note_id=note_id)
    await send_shopping_results(from_, ranked, thread_id, best_reason=best_reason)
    return "showing_results"


async def handle_pref_answer(from_: str, text: str, thread_id: str, conv: dict) -> str:
    """One answer in the size/color Q&A: validate, save, ask next or search."""
    t = text.strip()
    intent = parse_intent(text)
    if intent.action == "shop":
        return await _start_shop_flow(from_, intent, thread_id)
    question = conv.get("current_question", "")
    low = t.lower()
    if low in SKIP_WORDS:
        conv["prefs"].pop(question, None)
    else:
        answer = parse_pref_answer(question, t)
        if not answer:
            await send_message(
                from_,
                _pref_question_text(conv.get("pending_item", ""), question) + "\n(That didn't look like an answer — reply SKIP to move on)",
                thread_id,
            )
            return "asking_prefs"
        conv["prefs"][question] = answer
    queue = conv.get("pref_queue") or []
    if queue:
        queue.pop(0)
    conv["pref_queue"] = queue
    conv["from_qa"] = True
    conversations[thread_id] = conv
    return await _ask_next_pref(from_, thread_id, conv, conv.get("pending_item", ""))


async def handle_note_offer_reply(from_: str, text: str, thread_id: str, conv: dict):
    reply = text.strip().upper()
    if reply == "YES":
        item = conv.get("pending_item", "")
        price_hint = conv.get("price_hint")
        prefs = conv.get("prefs") or {}
        questions = pref_questions(item, prefs)
        emit_activity("LINQ", "you said YES — configuring purchase", item)
        if questions:
            conv.update({"step": "asking_prefs", "prefs": prefs, "pref_queue": questions})
            conversations[thread_id] = conv
            return await _ask_next_pref(from_, thread_id, conv, item)
        return await _run_search_and_show(from_, thread_id, conv)
    if reply == "NO":
        await schedule_followup(conv)
        await send_message(from_, "No problem — I'll remind you about it later. Anything else?", thread_id)
        conversations.pop(thread_id, None)
        return "declined"
    await send_message(from_, "Reply YES to search for the best options, or NO to skip.", thread_id)
    return "note_offer"


async def schedule_followup(conv: dict):
    item = conv.get("pending_item", "")
    if not item:
        return
    for existing in list_reminders(include_fired=False, user_id=conv.get("user_id", "local")):
        if existing.get("note_id") == conv.get("note_id", "") or item.lower() in existing.get("text", "").lower():
            cancel_reminder(existing["id"])
    due = int(time.time()) + 60 * 45
    add_reminder(
        f"Still want to buy {item}? Reply BUY NOW to checkout instantly.",
        due,
        note_id=conv.get("note_id", ""),
        user_id=conv.get("user_id", "local"),
        address=conv.get("from", ""),
    )
    emit_activity("REMINDER", f"follow-up scheduled for {item}", "in 45 min", note_id=conv.get("note_id", ""))


async def handle_buy_now(from_: str, text: str, thread_id: str, conv: dict):
    """Jump straight to consent for a known watchlist/follow-up item.

    Uses the same deep pipeline as a normal search (refine → deep search →
    filter → rank → best pick). Staged results from a previous search are
    reused when they still exist, but the strict budget cap applies and the
    LLM best-pick step runs exactly like the shop flow.
    """
    item = conv.get("pending_item", "")
    if not item:
        await send_message(
            from_,
            "PRIVA: which item should I grab? Tell me what to buy and I'll find the current best price.",
            thread_id,
        )
        return "need_item"
    price_hint = conv.get("price_hint")
    emit_activity("PRICE WATCH", "BUY NOW received", item, note_id=conv.get("note_id", ""))
    from catalog import detect_category
    category = detect_category(item)
    prefs = conv.get("prefs") or {}
    staged = conv.get("products") or []
    if staged:
        products = [Product(**p) for p in staged]
        products = filter_results(products, item, price_hint, category=category)
        if products:
            ranked = pref_rank(rank_products(products, price_hint, item, item=item, category=category), prefs)
            best_reason = ""
            over_budget = any(getattr(p, "over_budget", False) for p in ranked)
            if over_budget and price_hint:
                best_reason = f"Closest to your ${float(price_hint):.0f} budget."
            best = ranked[0]
            conversations[thread_id] = {
                "step": "awaiting_consent",
                "selected_product": best.model_dump(),
                "from": from_,
            }
            await send_consent(from_, best.model_dump(), thread_id)
            return "awaiting_consent"
    ranked, best_reason, over_budget = await _search_and_pick(item, price_hint, prefs, category=category)
    if not ranked:
        await send_message(from_, "Sorry, I couldn't re-find that item. Ask me to search for it again.", thread_id)
        return "no_products"
    best = ranked[0]
    conversations[thread_id] = {
        "step": "awaiting_consent",
        "selected_product": best.model_dump(),
        "from": from_,
    }
    await send_consent(from_, best.model_dump(), thread_id)
    return "awaiting_consent"

async def _prava_error_summary(status: dict) -> str:
    """Pull the first Prava error code/message from a payment-result dump."""
    for txn in status.get("transactions", []) or []:
        err = txn.get("error") or {}
        if err.get("code") or err.get("message"):
            return f"{err.get('code', '')}: {err.get('message', '')}"[:140]
    return ""


async def _notify_payment_failed(thread_id: str, address: str, txn_id: str, session_id: str):
    """Mark the transaction failed, move the conversation to retryable state, notify."""
    update_transaction(txn_id, status="pending", prava_status="failed")
    conv = conversations.get(thread_id, {})
    conv["step"] = "payment_failed"
    conv["transaction_id"] = txn_id
    conversations[thread_id] = conv
    detail = ""
    try:
        detail = await _prava_error_summary(await get_payment_status(session_id))
    except Exception:
        pass
    if detail:
        await send_message(
            address,
            f"Payment failed ({detail}). Reply RETRY to try again, or tell me what else to shop for.",
            thread_id,
        )
    else:
        await send_message(
            address,
            "Payment could not be completed. Reply RETRY to try again, or tell me what else to shop for.",
            thread_id,
        )


async def _check_payment_status(thread_id: str, from_: str, conv: dict):
    """STATUS handler: concise reply, and finalize the transaction if the user paid."""
    txn_id = conv.get("transaction_id", "")
    txn = next((t for t in get_transactions() if t["id"] == txn_id), None)
    if not txn:
        await send_message(from_, "Transaction not found.", thread_id)
        return
    prava_status = await get_payment_status(txn["prava_session_id"])
    st = prava_status.get("status", "unknown")
    if st in ("awaiting_result", "completed") and txn.get("status") != "completed":
        final = await complete_payment(txn["prava_session_id"], str(txn.get("amount", 0)))
        if final.get("status") == "completed":
            update_transaction(txn_id, status="completed", prava_status=final.get("prava_status", ""))
            eta = time.strftime("%a %b %d", time.localtime(time.time() + 3 * 86400))
            update_transaction(txn_id, shipping_status="confirmed", shipping_eta=eta)
            txn_uid = txn.get("user_id", "local")
            spending_store.record_purchase(txn.get("product_title", ""), txn.get("merchant", ""), float(txn.get("amount", 0) or 0), txn_id, user_id=txn_uid)
            excess = conv.get("budget_excess")
            if excess:
                spending_store.record_borrow(excess)
                emit_activity("BUDGET", "borrowed from next month", f"${excess:.2f}")
            emit_activity("PRAVA", "payment APPROVED", txn.get("prava_session_id", "")[:24], note_id=txn.get("note_id", ""))
            emit_activity("PAID", f"{txn.get('product_title', '')} paid", f"${txn.get('amount')}", note_id=txn.get("note_id", ""))
            add_watch(txn.get("product_title", ""), float(txn.get("amount", 0) or 0))
            await send_confirmation(from_, txn.get("product_title", ""), float(txn.get("amount", 0)), txn_id, thread_id)
            await send_message(from_, f"Order confirmed — ETA {eta}. Reply TRACK for delivery updates.", thread_id)
            cur = conversations.get(thread_id, {})
            if cur.get("step") in ("payment_pending", "payment_failed"):
                conversations.pop(thread_id, None)
            return
        st = final.get("status", st)
    if st == "awaiting_result":
        await send_message(from_, "Payment received — finalizing your order now.", thread_id)
    elif st == "failed":
        await _notify_payment_failed(thread_id, from_, txn_id, txn.get("prava_session_id", ""))
    elif st == "completed":
        await send_message(from_, "Payment status: completed.", thread_id)
    else:
        await send_message(from_, f"Payment status: {st}. Reply STATUS to refresh.", thread_id)


async def _create_payment_flow(thread_id: str, from_: str, product: dict) -> str:
    """Create a Prava payment session, notify the user, arm the poller. Returns txn id."""
    uniq = f"{int(time.time() * 1000)}"
    result = await create_payment_session(
        user_id=f"priva_{uniq}",
        user_email=f"priva_{uniq}@priva.app",
        total_amount=str(product.get("price", 0)),
        currency="USD",
        merchant_name=product.get("merchant", "Merchant"),
        merchant_url=product.get("merchant_url") or "https://www.google.com/search?q=" + urllib.parse.quote(product.get("title", "")) + "&tbm=shop",
        product_title=product.get("title", ""),
        product_price=str(product.get("price", 0)),
    )
    session_id = result.get("session_id", "")
    payment_url = result.get("payment_url", "")
    note_id = (conversations.get(thread_id, {}) or {}).get("note_id", "")
    conv_user = (conversations.get(thread_id, {}) or {}).get("user_id", "")
    uid = conv_user or (users.user_by_phone(from_) or {}).get("user_id") or from_
    txn = log_transaction(uid, Product(**product), session_id, note_id=note_id)
    add_watch(product.get("title", ""), float(product.get("price", 0) or 0), note_id=note_id, user_id=uid if uid.startswith("u_") else "local")
    emit_activity("PRAVA", "payment session live", session_id[:24], note_id=note_id)
    conv = conversations.get(thread_id, {})
    if payment_url:
        await send_message(
            from_,
            f"Payment session created. Approve with passkey:\n{payment_url}\n\n"
            f"Reply STATUS to check payment status, or send transaction ID: {txn.id}",
            thread_id,
        )
        emit_activity("LINQ", "tap-to-pay link sent", txn.id, note_id=note_id)
    else:
        await send_message(from_, "Payment session created but no URL returned. Check Prava dashboard.", thread_id)
    conv["step"] = "payment_pending"
    conv["transaction_id"] = txn.id
    conversations[thread_id] = conv
    asyncio.create_task(_poll_payment_and_notify(thread_id, from_, session_id, txn.id, product))
    return txn.id


async def handle_choice(from_: str, text: str, thread_id: str):
    conv = conversations.get(thread_id, {})
    step = conv.get("step", "")
    if step == "showing_results":
        choice = text.strip()
        if choice.isdigit():
            idx = int(choice) - 1
            products = conv.get("products", [])
            if 0 <= idx < len(products):
                selected = products[idx]
                conv["step"] = "awaiting_consent"
                conv["selected_product"] = selected
                try:
                    from spending import tier_for
                    _tier = tier_for(float(selected.get("price", 0) or 0))
                    if _tier.get("tier") == "exceeds":
                        conv["budget_excess"] = _tier["excess"]
                except Exception:
                    pass
                conversations[thread_id] = conv
                await send_consent(from_, selected, thread_id)
            else:
                await send_message(from_, "Invalid choice. Please reply with a number 1-5.", thread_id)
        elif "more" in choice.lower():
            products = conv.get("products", [])
            shown = conv.get("shown", 5)
            batch = products[shown:shown + 5]
            if batch:
                conv["shown"] = shown + len(batch)
                conversations[thread_id] = conv
                await send_more_options(from_, batch, shown, thread_id)
                emit_activity("RANKER", "more options revealed", f"#{shown + 1}-#{shown + len(batch)}", note_id=conv.get("note_id", ""))
            else:
                await send_message(
                    from_,
                    "That's all the options I found for this search. Ask again with different words — "
                    "e.g. 'find a cheaper usb hub' or 'wireless earbuds under $80'.",
                    thread_id,
                )
        else:
            await send_message(from_, "Reply with a number (1-5) to buy, or say 'more options'.", thread_id)
    elif step == "awaiting_consent":
        t = text.strip().upper()
        if t in ("YES", "APPROVE"):
            product = conv.get("selected_product", {})
            await _create_payment_flow(thread_id, from_, product)
        elif t == "NO":
            await schedule_followup(conv)
            product = conv.get("selected_product", {})
            if product:
                add_watch(product.get("title", ""), float(product.get("price", 0) or 0),
                          note_id=conv.get("note_id", ""), user_id=conv.get("user_id", "local"))
                emit_activity("PRICE WATCH", f"watching {product.get('title', '')}", "declined", note_id=conv.get("note_id", ""))
            await send_message(from_, "Purchase cancelled — I'll check back with you later. Anything else?", thread_id)
            conversations.pop(thread_id, None)
        else:
            await send_message(from_, "Reply YES to confirm purchase, or NO to cancel.", thread_id)
    elif step == "payment_pending":
        if text.strip().upper() == "STATUS":
            await _check_payment_status(thread_id, from_, conv)
        elif text.strip().upper() == "TRACK":
            txn_id = conv.get("transaction_id", "")
            txn = next((t for t in get_transactions() if t["id"] == txn_id), None)
            if txn:
                await send_message(
                    from_,
                    f"Order {txn['id']}: {txn.get('shipping_status') or 'pending'} · "
                    f"ETA {txn.get('shipping_eta') or 'TBD'}",
                    thread_id,
                )
            else:
                await send_message(from_, "Transaction not found.", thread_id)
        elif text.strip().upper() == "RETRY":
            product = conv.get("selected_product", {})
            if product:
                await _create_payment_flow(thread_id, from_, product)
            else:
                conversations.pop(thread_id, None)
                await send_message(from_, "Tell me what to buy and I'll find it for you.", thread_id)
        else:
            await send_message(from_, "Reply STATUS to check payment, RETRY to pay again, or TRACK for delivery.", thread_id)
    elif step == "payment_failed":
        t = text.strip().upper()
        if t == "RETRY":
            product = conv.get("selected_product", {})
            if product:
                await _create_payment_flow(thread_id, from_, product)
            else:
                conversations.pop(thread_id, None)
                await send_message(from_, "Tell me what to buy and I'll find it for you.", thread_id)
        elif t == "STATUS":
            await _check_payment_status(thread_id, from_, conv)
        elif t == "TRACK":
            txn_id = conv.get("transaction_id", "")
            txn = next((t for t in get_transactions() if t["id"] == txn_id), None)
            if txn:
                await send_message(
                    from_,
                    f"Order {txn['id']}: {txn.get('shipping_status') or 'pending'} · "
                    f"ETA {txn.get('shipping_eta') or 'TBD'}",
                    thread_id,
                )
            else:
                await send_message(from_, "Transaction not found.", thread_id)
        else:
            await send_message(
                from_,
                "Reply RETRY to try that payment again, or describe what else you'd like to shop for.",
                thread_id,
            )
    else:
        await send_message(
            from_,
            "Hi! I can help you shop. Try: 'buy running shoes under $100'",
            thread_id,
        )

async def _poll_payment_and_notify(thread_id: str, address: str, session_id: str, txn_id: str, product: dict):
    """Background: watch the Prava session; when the user pays, report APPROVED and notify.

    Keeps polling for up to ~10 minutes so slow payers are still finalized
    (the SDK's single wait_for_payment_result call can time out first).
    """
    amount = str(product.get("price", 0))
    for attempt in range(40):
        if attempt:
            await asyncio.sleep(15)
        status = await get_payment_status(session_id)
        st = status.get("status", "unknown")
        if st in ("awaiting_result", "completed"):
            result = await complete_payment(session_id, amount)
            if result.get("status") == "completed":
                update_transaction(txn_id, status="completed", prava_status=result.get("prava_status", ""))
                _conv = conversations.get(thread_id, {}) or {}
                _excess = _conv.get("budget_excess")
                txn_uid = _conv.get("user_id") or (users.user_by_phone(address) or {}).get("user_id") or "local"
                spending_store.record_purchase(product.get("title", ""), product.get("merchant", ""), float(product.get("price", 0) or 0), txn_id, user_id=txn_uid)
                if _excess:
                    spending_store.record_borrow(_excess)
                    emit_activity("BUDGET", "borrowed from next month", f"${_excess:.2f}")
                emit_activity("PRAVA", "payment APPROVED", session_id[:24], note_id=_conv.get("note_id", ""))
                emit_activity("PAID", f"{product.get('title', '')} paid", f"${product.get('price', 0)}", note_id=_conv.get("note_id", ""))
                add_watch(product.get("title", ""), float(product.get("price", 0) or 0),
                          user_id=txn_uid if txn_uid.startswith("u_") else "local")
                eta = time.strftime("%a %b %d", time.localtime(time.time() + 3 * 86400))
                update_transaction(txn_id, shipping_status="confirmed", shipping_eta=eta)
                await send_confirmation(
                    address,
                    product.get("title", ""),
                    float(product.get("price", 0)),
                    txn_id,
                    thread_id,
                )
                await send_message(
                    address,
                    f"Order confirmed — ETA {eta}. Reply TRACK for delivery updates.",
                    thread_id,
                )
                conv = conversations.get(thread_id, {})
                if conv.get("step") == "payment_pending":
                    conversations.pop(thread_id, None)
                return
            if result.get("status") == "failed":
                await _notify_payment_failed(thread_id, address, txn_id, session_id)
                return
        elif st == "failed":
            await _notify_payment_failed(thread_id, address, txn_id, session_id)
            return
    conv = conversations.get(thread_id, {})
    if conv.get("step") in ("payment_pending", "payment_failed"):
        await send_message(
            address,
            "Payment session is still waiting. Reply STATUS to check, or RETRY to create a new one.",
            thread_id,
        )


@app.get("/api/admin/users")
async def api_admin_users(admin: dict = Depends(require_admin)):
    out = []
    for u in users.list_users():
        uid = u["user_id"]
        thread = f"priva_mirror_{uid}"
        out.append({
            **users.public_user(u),
            "notes": len(list_notes(uid)),
            "transactions": len(get_transactions(uid)),
            "messages": len(linq_outbox(thread)) + len(linq_inbox(thread)),
        })
    return {"users": out}


@app.get("/api/admin/users/{user_id}/transcript")
async def api_admin_user_transcript(user_id: str, admin: dict = Depends(require_admin)):
    thread = f"priva_mirror_{user_id}"
    user = users.user_by_id(user_id)
    return {
        "user": users.public_user(user) if user else None,
        "messages": linq_outbox(thread),
        "inbound": linq_inbox(thread),
    }


@app.get("/api/admin/activity")
async def api_admin_activity(admin: dict = Depends(require_admin)):
    return {"events": list(_agent_activity)}


@app.on_event("startup")
async def _startup():
    reminder_scheduler.start()
    reminder_scheduler.address_fn = outgoing_address
    asyncio.create_task(_shipping_worker())
    # Preload the Whisper model off the request path: the first STT call
    # otherwise blocks ~30s (base.en load) and the UI looks frozen.
    asyncio.create_task(asyncio.to_thread(voice._load_whisper))

if __name__ == "__main__":
    import uvicorn
    import os as _os
    port = int(_os.getenv("PORT", PRIVA_SERVER_PORT))
    uvicorn.run(app, host=PRIVA_SERVER_HOST, port=port)
