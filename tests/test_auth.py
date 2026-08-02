"""Auth flow: phone + name + OTP -> bearer token -> authenticated endpoints."""
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi.testclient import TestClient

import agent
import linq_client
import notes_store
import price_watch
import reminder_service
import server
import spending
import users


@pytest.fixture(autouse=True)
def _isolate(monkeypatch, tmp_path):
    import config
    import note_analyzer
    monkeypatch.setattr(note_analyzer, "NOTE_LLM", "")
    monkeypatch.setattr(config, "OPENAI_API_KEY", "")
    monkeypatch.setattr(users, "USERS_FILE", str(tmp_path / "users.json"))
    monkeypatch.setattr(server, "DEMO_MODE", True)
    monkeypatch.setattr(server, "LINQ_WEBHOOK_SECRET", "")
    monkeypatch.setattr(notes_store, "NOTES_FILE", str(tmp_path / "notes.json"))
    monkeypatch.setattr(notes_store, "OFFERS_FILE", str(tmp_path / "note_offers.json"))
    monkeypatch.setattr(price_watch, "WATCH_FILE", str(tmp_path / "watchlist.json"))
    monkeypatch.setattr(reminder_service, "REMINDERS_FILE", str(tmp_path / "reminders.json"))
    monkeypatch.setattr(spending, "BUDGET_FILE", str(tmp_path / "spending.json"))
    monkeypatch.setattr(agent, "_TXNS_FILE", str(tmp_path / "transactions.json"))
    agent.transaction_log.clear()
    linq_client._outbox.clear()
    linq_client._inbox.clear()

    async def fake_send(to, text, thread_id=""):
        linq_client._record(to, text, thread_id)
        return {}

    monkeypatch.setattr(server, "send_message", fake_send)
    yield
    agent.transaction_log.clear()
    linq_client._outbox.clear()
    linq_client._inbox.clear()


def _client():
    return TestClient(server.app)


def _register(client, phone, name="Alice", admin_phone=""):
    if admin_phone:
        import users as u
        u.PRIVA_ADMIN_ADDRESS = admin_phone
    res = client.post("/api/auth/otp", json={"phone": phone, "name": name})
    assert res.status_code == 200
    otp = res.json()["otp"]
    res = client.post("/api/auth/verify", json={"phone": phone, "otp": otp})
    assert res.status_code == 200
    return res.json()


def test_otp_issued_inline_in_demo_mode():
    client = _client()
    res = client.post("/api/auth/otp", json={"phone": "1 917 384 2736", "name": "Alice"})
    assert res.status_code == 200
    body = res.json()
    assert body["delivery"] == "inline"
    assert body["sent"] is True
    assert body["otp"].isdigit() and len(body["otp"]) == 6


def test_invalid_phone_rejected():
    client = _client()
    assert client.post("/api/auth/otp", json={"phone": "12"}).status_code == 400
    assert client.post("/api/auth/otp", json={"phone": "abc"}).status_code == 400
    assert client.post("/api/auth/otp", json={"phone": ""}).status_code == 400


def test_verify_returns_token_and_name():
    client = _client()
    data = _register(client, "+19173842736", "Alice")
    assert data["user_id"].startswith("u_")
    assert data["name"] == "Alice"
    assert data["phone"] == "+19173842736"
    assert data["is_admin"] is False
    assert len(data["token"]) >= 32


def test_wrong_otp_rejected():
    client = _client()
    client.post("/api/auth/otp", json={"phone": "+19173842736", "name": "A"})
    res = client.post("/api/auth/verify", json={"phone": "+19173842736", "otp": "000000"})
    assert res.status_code == 401


def test_expired_otp_rejected():
    client = _client()
    client.post("/api/auth/otp", json={"phone": "+19173842736", "name": "A"})
    user = users.user_by_phone("+19173842736")
    user["otp_expiry"] = 1
    import json
    with open(users.USERS_FILE, "w", encoding="utf-8") as fh:
        json.dump([u for u in users.list_users() if u["user_id"] == user["user_id"]], fh)
    res = client.post("/api/auth/verify", json={"phone": "+19173842736", "otp": user["otp"]})
    assert res.status_code == 401


def test_me_endpoint():
    client = _client()
    assert client.get("/api/auth/me").json()["authenticated"] is False
    data = _register(client, "+19173842736", "Alice")
    res = client.get("/api/auth/me", headers={"Authorization": f"Bearer {data['token']}"})
    body = res.json()
    assert body["authenticated"] is True
    assert body["user"]["name"] == "Alice"
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer garbage"}).json()["authenticated"] is False


def test_admin_phone_gets_admin():
    client = _client()
    data = _register(client, "+19170000000", "Sachitt", admin_phone="+19170000000")
    assert data["is_admin"] is True


def test_otp_sms_delivery_when_not_demo(monkeypatch):
    monkeypatch.setattr(server, "DEMO_MODE", False)
    monkeypatch.setattr(server, "LINQ_API_KEY", "test-key")
    calls = []

    async def fake_send(to, text, thread_id=""):
        calls.append((to, text, thread_id))
        return {"ok": True, "message_id": "m1"}

    monkeypatch.setattr(server, "send_message", fake_send)
    client = _client()
    res = client.post("/api/auth/otp", json={"phone": "+19173842736", "name": "A"})
    assert res.status_code == 200
    body = res.json()
    assert "otp" not in body
    assert body["delivery"] == "sms"
    assert body["sent"] is True
    assert len(calls) == 1
    to, text, thread_id = calls[0]
    assert to == "+19173842736"
    assert "PRIVA verification code:" in text
    assert thread_id.startswith("otp_")


def test_otp_inline_fallback_when_sms_fails(monkeypatch):
    monkeypatch.setattr(server, "DEMO_MODE", True)
    monkeypatch.setattr(server, "LINQ_API_KEY", "test-key")

    async def fake_send(to, text, thread_id=""):
        return {"ok": True, "demo": True}

    monkeypatch.setattr(server, "send_message", fake_send)
    client = _client()
    res = client.post("/api/auth/otp", json={"phone": "+19173842736", "name": "A"})
    assert res.status_code == 200
    body = res.json()
    assert body["delivery"] == "inline"
    assert body["sent"] is True
    assert re.fullmatch(r"\d{6}", body["otp"])


def test_otp_rate_limited_per_phone(monkeypatch):
    monkeypatch.setattr(server, "DEMO_MODE", True)
    monkeypatch.setattr(server, "LINQ_API_KEY", "")

    async def fake_send(to, text, thread_id=""):
        return {"ok": True, "demo": True}

    monkeypatch.setattr(server, "send_message", fake_send)
    client = _client()
    for _ in range(3):
        assert client.post("/api/auth/otp", json={"phone": "+19173842736"}).status_code == 200
    res = client.post("/api/auth/otp", json={"phone": "+19173842736"})
    assert res.status_code == 429
    assert "try again in" in res.json()["detail"].lower()


def test_otp_wrong_attempts_invalidate_code(monkeypatch):
    monkeypatch.setattr(server, "DEMO_MODE", True)
    monkeypatch.setattr(server, "LINQ_API_KEY", "")
    client = _client()
    client.post("/api/auth/otp", json={"phone": "+19173842736"})
    for i in range(users.OTP_MAX_ATTEMPTS):
        res = client.post("/api/auth/verify", json={"phone": "+19173842736", "otp": "000000"})
        if i < users.OTP_MAX_ATTEMPTS - 1:
            assert res.status_code == 401
        else:
            assert res.status_code == 429
            assert "new code" in res.json()["detail"].lower()
    res = client.post("/api/auth/verify", json={"phone": "+19173842736", "otp": "000000"})
    assert res.status_code == 401


def test_demo_search_public_and_rate_limited(monkeypatch):
    import serpapi_client as sc

    async def fake_search(query, max_price=None, limit=5, start=0, ns=""):
        from models import Product
        return [Product(id="d1", title=f"Demo {query}", price=25.0, merchant="Shop")]

    monkeypatch.setattr(server, "search_products", fake_search)
    client = _client()
    res = client.post("/api/demo/search", json={"query": "sneakers", "limit": 2})
    assert res.status_code == 200
    products = res.json()["products"]
    assert len(products) == 1
    assert products[0]["title"].startswith("Demo")
    for _ in range(server._DEMO_SEARCH_MAX_PER_MIN):
        client.post("/api/demo/search", json={"query": "sneakers"})
    assert client.post("/api/demo/search", json={"query": "sneakers"}).status_code == 429


def test_config_exposes_quota_and_demo_mode():
    client = _client()
    body = client.get("/api/config").json()
    assert body["serpapi_daily_cap"] > 0
    assert body["serpapi_daily_remaining"] <= body["serpapi_daily_cap"]
    assert "demo_mode" in body
    assert body["otp_max_attempts"] == users.OTP_MAX_ATTEMPTS


def test_serpapi_quota_guard(monkeypatch):
    import serpapi_client as sc
    monkeypatch.setattr(sc, "_load_usage", lambda: {time.strftime("%Y-%m-%d"): sc.DAILY_CAP})
    assert sc.quota_daily_remaining() == 0
    assert sc._charge_quota() is False
    assert sc._quota_blocked() is False or sc._quota_exhausted is False


def test_demo_login_mints_token_for_existing_user():
    client = _client()
    data = _register(client, "+19173842736", "Alice")
    res = client.post("/api/auth/demo-login", json={"user_id": data["user_id"]})
    assert res.status_code == 200
    body = res.json()
    assert body["user_id"] == data["user_id"]
    assert body["name"] == "Alice"
    assert len(body["token"]) >= 32
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['token']}"})
    assert me.json()["authenticated"] is True
    assert client.post("/api/auth/demo-login", json={"user_id": "nope"}).status_code == 404


def test_demo_login_gated_off_in_production(monkeypatch):
    monkeypatch.setattr(server, "DEMO_MODE", False)
    client = _client()
    assert client.post("/api/auth/demo-login", json={"user_id": "u_whatever"}).status_code == 403
