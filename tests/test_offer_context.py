"""Context-aware note offers: urgency detection, urgent scheduling, already-purchased gate."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi.testclient import TestClient

import linq_client
from note_analyzer import detect_urgency


@pytest.fixture(autouse=True)
def clean_state():
    linq_client._outbox.clear()
    linq_client._inbox.clear()
    yield
    linq_client._outbox.clear()
    linq_client._inbox.clear()


# ---------- urgency detection ----------

@pytest.mark.parametrize("text,expected", [
    ("Need a charger before my flight today", True),
    ("buy umbrella ASAP", True),
    ("need running shoes by tomorrow morning", True),
    ("urgent: laptop charger", True),
    ("running out of toothpaste", True),
    ("Need new running shoes", False),
    ("buy noise cancelling headphones under $100", False),
    ("", False),
])
def test_detect_urgency(text, expected):
    assert detect_urgency(text) is expected


# ---------- already-purchased gate ----------

def test_already_purchased_matches_completed_transaction(monkeypatch):
    import server as srv
    monkeypatch.setattr(srv, "get_transactions", lambda: [{
        "id": "t1", "status": "completed", "product_title": "Cloudfoam Running Shoes (black, Size 11)",
    }])
    monkeypatch.setattr(srv.spending_store, "purchases", lambda: [])
    assert srv._already_purchased("running shoes") is True
    assert srv._already_purchased("usb hub") is False


def test_already_purchased_matches_spending_ledger(monkeypatch):
    import server as srv
    monkeypatch.setattr(srv, "get_transactions", lambda: [])
    monkeypatch.setattr(srv.spending_store, "purchases", lambda: [{"title": "Sports Wireless Earbuds"}])
    assert srv._already_purchased("wireless earbuds") is True
    assert srv._already_purchased("hoodie") is False


def test_pending_transaction_does_not_block_offer(monkeypatch):
    import server as srv
    monkeypatch.setattr(srv, "get_transactions", lambda: [{
        "id": "t2", "status": "pending", "product_title": "Cloudfoam Running Shoes",
    }])
    monkeypatch.setattr(srv.spending_store, "purchases", lambda: [])
    assert srv._already_purchased("running shoes") is False


def test_already_purchased_is_scoped_to_user(monkeypatch):
    import server as srv
    txn = {"id": "t3", "user_id": "u_bob", "status": "completed", "product_title": "Cloudfoam Running Shoes"}
    monkeypatch.setattr(srv, "get_transactions", lambda: [txn])
    monkeypatch.setattr(srv.spending_store, "purchases", lambda: [{"user_id": "u_bob", "title": "Sports Wireless Earbuds"}])
    # Bob's own purchases block Bob...
    assert srv._already_purchased("running shoes", "u_bob") is True
    assert srv._already_purchased("wireless earbuds", "u_bob") is True
    # ...but never Alice
    assert srv._already_purchased("running shoes", "u_alice") is False
    assert srv._already_purchased("wireless earbuds", "u_alice") is False


def test_already_purchased_matches_user_phone(monkeypatch):
    import server as srv
    txn = {"id": "t4", "user_id": "+12025550123", "status": "completed", "product_title": "Desk Lamp"}
    monkeypatch.setattr(srv, "get_transactions", lambda: [txn])
    monkeypatch.setattr(srv.spending_store, "purchases", lambda: [])
    monkeypatch.setattr(srv.users, "phone_for", lambda uid: "+12025550123" if uid == "u_owner" else "")
    assert srv._already_purchased("desk lamp", "u_owner") is True
    assert srv._already_purchased("desk lamp", "u_stranger") is False


# ---------- urgent offer fires fast, normal offer waits ----------

def test_urgent_note_fires_immediately(monkeypatch):
    import asyncio
    import server as srv
    monkeypatch.setattr(srv, "URGENT_OFFER_DELAY", 0.05)
    monkeypatch.setattr(srv, "NOTE_OFFER_DELAY", 60)

    fired = []
    async def fake_offer(note, urgent=False):
        fired.append(urgent)

    monkeypatch.setattr(srv, "_maybe_offer_from_note", fake_offer)
    monkeypatch.setattr(srv, "get_note", lambda nid: {"id": nid, "title": "", "blocks": []})

    async def scenario():
        srv._schedule_note_offer({"id": "n_urgent", "title": "charger", "blocks": [{"type": "text", "content": "Need a charger before my flight today"}]})
        await asyncio.sleep(0.2)
        assert fired == [True]

        srv._offer_tasks.clear()
        srv._schedule_note_offer({"id": "n_normal", "title": "shoes", "blocks": [{"type": "text", "content": "Need new running shoes"}]})
        await asyncio.sleep(0.05)
        assert fired == [True]  # urgent one only so far

    asyncio.run(scenario())


def test_urgent_sms_has_prefix(monkeypatch, tmp_path):
    """Full-path: urgent note -> SMS contains 'URGENT', normal note -> not."""
    import server as srv
    monkeypatch.setattr(linq_client, "_TRANSCRIPT_FILE", str(tmp_path / "tr.json"))
    monkeypatch.setattr(srv, "URGENT_OFFER_DELAY", 0.05)
    monkeypatch.setattr(srv, "NOTE_OFFER_DELAY", 60)
    monkeypatch.setattr(srv, "detect_urgency", lambda t: "flight" in t)
    monkeypatch.setattr(srv, "outgoing_address", lambda: "+15550001111")
    monkeypatch.setattr(srv, "recently_offered", lambda nid, **kw: False)
    monkeypatch.setattr(srv, "was_offered", lambda nid, item: False)
    monkeypatch.setattr(srv, "mark_offered", lambda nid, item, tid: None)
    monkeypatch.setattr(srv, "_already_purchased", lambda item, user_id="local": False)

    from note_analyzer import analyze_note

    async def fake_analyze(note):
        return analyze_note(note)

    monkeypatch.setattr(srv, "analyze_note_llm", fake_analyze)

    import asyncio
    asyncio.run(
        srv._maybe_offer_from_note({"id": "n1", "title": "flight charger", "blocks": [
            {"type": "text", "content": "Need a charger before my flight today under $40"}
        ]}, urgent=True)
    )
    texts = [m["text"] for m in linq_client.outbox()]
    assert texts and "URGENT" in texts[0]
