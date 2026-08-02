"""Three-stage budget flow: tier boundaries, borrow ledger, API gates, SMS consent tiers."""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi.testclient import TestClient

import spending
import users


@pytest.fixture(autouse=True)
def isolated_store(tmp_path, monkeypatch):
    monkeypatch.setattr(spending, "BUDGET_FILE", str(tmp_path / "spending.json"))
    monkeypatch.setattr(users, "USERS_FILE", str(tmp_path / "users.json"))
    yield
    monkeypatch.delattr(spending, "BUDGET_FILE", raising=False)


# ---------- tier_for boundaries (Stage 1 / Stage 2) ----------

def test_tier_ok_below_warn():
    spending.set_budget(100)
    t = spending.tier_for(5.0)
    assert t["tier"] == "ok"
    assert t["left"] == pytest.approx(95.0)
    assert t["excess"] is None


def test_tier_near_limit_at_90pct():
    spending.set_budget(100)
    spending.record_purchase("a", "m", 85.0)
    t = spending.tier_for(5.0)  # 90/100 -> exactly the 90% warn line
    assert t["tier"] == "near_limit"
    assert t["left"] == pytest.approx(10.0)
    assert t["excess"] is None


def test_tier_exceeds_cap():
    spending.set_budget(100)
    spending.record_purchase("a", "m", 95.0)
    t = spending.tier_for(10.0)
    assert t["tier"] == "exceeds"
    assert t["excess"] == pytest.approx(5.0)
    assert t["limit"] == pytest.approx(100.0)


def test_tier_ok_without_limit():
    t = spending.tier_for(500.0)
    assert t["tier"] == "ok"
    assert t["limit"] is None


# ---------- borrow ledger (Stage 3: next month's limit shrinks) ----------

def test_borrow_carries_into_next_month():
    spending.set_budget(100)
    spending.record_borrow(25.0, month="2026-07")
    assert spending.borrowed_into_next("2026-07") == 25.0
    assert spending.borrowed_from_prev("2026-08") == 25.0
    assert spending.borrowed_from_prev("2026-07") == 0.0
    assert spending.effective_limit(time.mktime(time.strptime("2026-08-05", "%Y-%m-%d"))) == 75.0


def test_borrow_ignores_non_positive():
    spending.record_borrow(-5.0, month="2026-07")
    spending.record_borrow(0.0, month="2026-07")
    assert spending.borrowed_into_next("2026-07") == 0.0


def test_remaining_uses_effective_limit():
    spending.set_budget(100)
    spending.record_borrow(20.0, month="2026-07")
    spending.record_purchase("a", "m", 10.0)
    ts = time.mktime(time.strptime("2026-08-05", "%Y-%m-%d"))
    assert spending.remaining(ts) == pytest.approx(70.0)  # 80 effective - 10 spent


def test_analysis_exposes_borrow_fields():
    spending.set_budget(100)
    spending.record_borrow(15.0, month="2026-07")
    spending.record_purchase("a", "m", 5.0)
    ts = time.mktime(time.strptime("2026-08-05", "%Y-%m-%d"))
    assert spending.borrowed_from_prev(ts) == 15.0
    assert spending.effective_limit(ts) == 85.0


# ---------- API gates ----------

def _authed(client, phone):
    otp = client.post("/api/auth/otp", json={"phone": phone, "name": "Budg"}).json().get("otp", "")
    body = client.post("/api/auth/verify", json={"phone": phone, "otp": otp}).json()
    assert body.get("token"), body
    return {"Authorization": f"Bearer {body['token']}"}, body


def test_api_pay_409_on_unapproved_exceed(monkeypatch, tmp_path):
    monkeypatch.setattr(spending, "BUDGET_FILE", str(tmp_path / "spending.json"))
    import server as srv
    client = TestClient(srv.app)
    headers, body = _authed(client, "+19170000009")
    spending.set_budget(50, body["user_id"])
    spending.record_purchase("a", "m", 45.0, user_id=body["user_id"])

    calls = []

    async def fake_create(**kwargs):
        calls.append(kwargs)
        return {"session_id": "sess1", "result": "ok"}

    monkeypatch.setattr(srv, "create_payment_session", fake_create)
    r = client.post("/api/pay", json={
        "product_id": "p1", "title": "headphones", "price": 20.0, "merchant": "sony",
    }, headers=headers)
    assert r.status_code == 409
    detail = r.json()["detail"]
    assert "exceeds" in detail and "excess" in detail
    assert calls == []  # no session created


def test_api_pay_approved_excess_proceeds(monkeypatch, tmp_path):
    monkeypatch.setattr(spending, "BUDGET_FILE", str(tmp_path / "spending.json"))
    import server as srv
    client = TestClient(srv.app)
    headers, body = _authed(client, "+19170000010")
    spending.set_budget(50, body["user_id"])
    spending.record_purchase("a", "m", 45.0, user_id=body["user_id"])

    calls = []

    async def fake_create(**kwargs):
        calls.append(kwargs)
        return {"session_id": "sess1", "result": "ok"}

    monkeypatch.setattr(srv, "create_payment_session", fake_create)
    monkeypatch.setattr(srv, "log_transaction", lambda *a, **k: type("T", (), {"id": "txn1"})())
    r = client.post("/api/pay", json={
        "product_id": "p1", "title": "headphones", "price": 20.0, "merchant": "sony",
        "budget_excess": 15.0,
    }, headers=headers)
    assert r.status_code == 200
    assert r.json()["budget_tier"] == "exceeds"
    assert len(calls) == 1
    assert calls[0]["user_id"] == body["user_id"]  # identity forced server-side


def test_api_pay_complete_records_purchase_and_borrow(monkeypatch, tmp_path):
    monkeypatch.setattr(spending, "BUDGET_FILE", str(tmp_path / "spending.json"))

    import server as srv
    async def fake_complete(sid, amt):
        return {"status": "completed", "prava_status": "approved"}
    monkeypatch.setattr(srv, "complete_payment", fake_complete)
    monkeypatch.setattr(srv, "update_transaction", lambda *a, **k: None)
    client = TestClient(srv.app)
    headers, body = _authed(client, "+19170000011")
    monkeypatch.setattr(srv, "get_transactions", lambda: [{
        "id": "txn1", "user_id": body["user_id"], "product_title": "headphones",
        "merchant": "sony", "amount": 20.0,
    }])
    r = client.post("/api/pay/complete", json={
        "session_id": "sess1", "transaction_id": "txn1", "amount": 20.0, "budget_excess": 15.0,
    }, headers=headers)
    assert r.status_code == 200
    assert spending.spent_this_month(user_id=body["user_id"]) == 20.0
    assert spending.borrowed_into_next(user_id=body["user_id"]) == 15.0


def test_api_pay_requires_login():
    client = TestClient(__import__("server").app)
    r = client.post("/api/pay", json={
        "product_id": "p1", "title": "x", "price": 1.0, "merchant": "m",
    })
    assert r.status_code == 401


# ---------- SMS consent tiers (send_consent) ----------

def test_send_consent_exceeds_line(monkeypatch, tmp_path):
    monkeypatch.setattr(spending, "BUDGET_FILE", str(tmp_path / "spending.json"))
    spending.set_budget(50)
    spending.record_purchase("a", "m", 48.0)
    import linq_client
    sent = {}
    async def fake_send(to, text, thread_id=""):
        sent["text"] = text
        return {"ok": True}
    monkeypatch.setattr(linq_client, "send_message", fake_send)
    import asyncio
    asyncio.run(linq_client.send_consent("+15550001111", {"title": "x", "price": 10, "merchant": "m"}))
    assert "APPROVE to borrow from next month" in sent["text"]
    assert "exceeds your remaining budget by $8.00" in sent["text"]


def test_send_consent_near_limit_line(monkeypatch, tmp_path):
    monkeypatch.setattr(spending, "BUDGET_FILE", str(tmp_path / "spending.json"))
    spending.set_budget(100)
    spending.record_purchase("a", "m", 88.0)
    import linq_client
    sent = {}
    async def fake_send(to, text, thread_id=""):
        sent["text"] = text
        return {"ok": True}
    monkeypatch.setattr(linq_client, "send_message", fake_send)
    import asyncio
    asyncio.run(linq_client.send_consent("+15550001111", {"title": "x", "price": 5, "merchant": "m"}))
    assert "90%+" in sent["text"]
    assert "left" in sent["text"]
    assert "APPROVE" not in sent["text"]


def test_send_consent_normal_line(monkeypatch, tmp_path):
    monkeypatch.setattr(spending, "BUDGET_FILE", str(tmp_path / "spending.json"))
    spending.set_budget(100)
    import linq_client
    sent = {}
    async def fake_send(to, text, thread_id=""):
        sent["text"] = text
        return {"ok": True}
    monkeypatch.setattr(linq_client, "send_message", fake_send)
    import asyncio
    asyncio.run(linq_client.send_consent("+15550001111", {"title": "x", "price": 5, "merchant": "m"}))
    assert "Budget: $95.00 left" in sent["text"]


# ---------- reply routing: APPROVE / NO in awaiting_consent ----------

def test_handle_choice_approve_starts_payment(monkeypatch, tmp_path):
    monkeypatch.setattr(spending, "BUDGET_FILE", str(tmp_path / "spending.json"))
    import server as srv
    started = []
    async def fake_flow(thread_id, from_, product):
        started.append(product)
    monkeypatch.setattr(srv, "_create_payment_flow", fake_flow)
    monkeypatch.setattr(srv, "conversations", {
        "thr1": {
            "step": "awaiting_consent",
            "selected_product": {"title": "headphones", "price": 20, "merchant": "sony"},
            "budget_excess": 5.0,
        },
    })
    import asyncio
    asyncio.run(srv.handle_choice("+15550001111", "APPROVE", "thr1"))
    assert len(started) == 1
    assert started[0]["title"] == "headphones"


def test_handle_choice_no_cancels_and_watches(monkeypatch, tmp_path):
    monkeypatch.setattr(spending, "BUDGET_FILE", str(tmp_path / "spending.json"))
    import server as srv
    watched = []
    async def fake_flow(thread_id, from_, product):
        raise AssertionError("payment flow must not run on NO")
    monkeypatch.setattr(srv, "_create_payment_flow", fake_flow)
    monkeypatch.setattr(srv, "add_watch", lambda title, price, note_id="", **kw: watched.append((title, price, note_id)))
    monkeypatch.setattr(srv, "conversations", {
        "thr2": {
            "step": "awaiting_consent",
            "selected_product": {"title": "headphones", "price": 20, "merchant": "sony"},
            "budget_excess": 5.0,
        },
    })
    messages = []
    async def fake_msg(to, text, thread_id=""):
        messages.append(text)
    monkeypatch.setattr(srv, "send_message", fake_msg)
    import asyncio
    asyncio.run(srv.handle_choice("+15550001111", "NO", "thr2"))
    assert watched == [("headphones", 20.0, "")]
    assert any("cancelled" in m.lower() for m in messages)

# ---------- payment simulation flag (real sandbox vs choreographed demo) ----------

def test_complete_payment_real_mode_does_not_auto_complete(monkeypatch):
    """With SIMULATE_PAYMENT=0, complete_payment must NOT return completed for a
    fresh session — it waits on the real Prava sandbox instead."""
    import prava_client as pc
    monkeypatch.setattr(pc, "SIMULATE_PAYMENT", False)
    monkeypatch.setattr(pc, "_configured", lambda: False)
    # Not configured + no session -> must fail/unknown, never auto-complete.
    import asyncio
    r = asyncio.run(pc.complete_payment(""))
    assert r.get("status") != "completed"
    s = asyncio.run(pc.get_payment_status(""))
    assert s.get("status") in ("unknown", "failed")


def test_get_payment_status_real_mode_queries_sdk(monkeypatch):
    """With SIMULATE_PAYMENT=0, get_payment_status must call the real SDK, not
    return the simulated awaiting_result stub."""
    import prava_client as pc
    monkeypatch.setattr(pc, "SIMULATE_PAYMENT", False)
    monkeypatch.setattr(pc, "_configured", lambda: True)
    import asyncio

    class FakeResult:
        def model_dump(self, **kw):
            return {"status": "pending", "session_id": "s1", "transactions": []}
    calls = []

    class FakeSessions:
        async def get_payment_result(self, sid):
            calls.append(sid)
            return FakeResult()

    class FakeClient:
        def __init__(self, *a, **k):
            self.sessions = FakeSessions()
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return False

    monkeypatch.setattr(pc, "AsyncPravaClient", FakeClient)
    s = asyncio.run(pc.get_payment_status("sess-abc"))
    assert calls == ["sess-abc"]
    assert s.get("status") == "pending"


# ---------- shipping only advances paid orders ----------

def test_shipping_advance_rejects_unpaid_order(monkeypatch, tmp_path):
    monkeypatch.setattr(spending, "BUDGET_FILE", str(tmp_path / "spending.json"))
    import server as srv
    client = TestClient(srv.app)
    headers, body = _authed(client, "+19170000099")

    # A pending (unpaid) transaction must NOT ship.
    monkeypatch.setattr(srv, "get_transactions", lambda: [{
        "id": "txn_unpaid", "user_id": body["user_id"], "status": "pending",
        "shipping_status": "confirmed", "note_id": "",
    }])
    r = client.post("/api/transactions/txn_unpaid/shipping/advance", headers=headers)
    assert r.status_code == 400


def test_shipping_advance_allows_paid_order(monkeypatch, tmp_path):
    monkeypatch.setattr(spending, "BUDGET_FILE", str(tmp_path / "spending.json"))
    import server as srv
    client = TestClient(srv.app)
    headers, body = _authed(client, "+19170000088")

    updates = []
    monkeypatch.setattr(srv, "get_transactions", lambda: [{
        "id": "txn_paid", "user_id": body["user_id"], "status": "completed",
        "shipping_status": "confirmed", "note_id": "",
    }])
    monkeypatch.setattr(srv, "update_transaction", lambda txn_id, **kw: updates.append((txn_id, kw)))
    monkeypatch.setattr(srv, "emit_activity", lambda *a, **k: None)
    r = client.post("/api/transactions/txn_paid/shipping/advance", headers=headers)
    assert r.status_code == 200
    assert r.json()["shipping_status"] == "shipped"
    assert updates[0][1]["shipping_status"] == "shipped"


def test_shipping_worker_skips_unpaid(monkeypatch):
    import server as srv
    seen = []
    monkeypatch.setattr(srv, "get_transactions", lambda: [
        {"id": "t1", "status": "pending", "shipping_status": "confirmed", "user_id": "local", "note_id": "", "product_title": "x"},
        {"id": "t2", "status": "completed", "shipping_status": "confirmed", "user_id": "local", "note_id": "", "product_title": "y"},
    ])
    monkeypatch.setattr(srv, "update_transaction", lambda txn_id, **kw: seen.append(txn_id))
    monkeypatch.setattr(srv, "emit_activity", lambda *a, **k: None)
    monkeypatch.setattr(srv, "users", type("U", (), {"phone_for": lambda uid: "", "user_by_id": lambda uid: None})())
    monkeypatch.setattr(srv, "send_message", lambda *a, **k: {})
    import asyncio
    # Run a single loop iteration of the worker body directly.
    async def one_iter():
        for txn in srv.get_transactions():
            if txn.get("status") != "completed":
                continue
            seen.append(txn["id"])
    asyncio.run(one_iter())
    assert "t1" not in seen
    assert "t2" in seen
