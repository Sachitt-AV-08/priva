"""Tests for PRIVA note analysis, notes API, reminders, and the Linq conversation flow."""
import asyncio
import sys
import time
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi.testclient import TestClient

from note_analyzer import analyze_note
import notes_store
import reminder_service


# ---------- note_analyzer ----------

def _note(title, lines):
    return {
        "id": "t1",
        "title": title,
        "blocks": [{"id": f"b{i}", "type": "text", "content": ln} for i, ln in enumerate(lines)],
    }


def test_buy_intent_with_price_hint():
    a = analyze_note(_note("Gear", ["need to buy a mechanical keyboard under $120"]))
    assert len(a["buy_intents"]) == 1
    it = a["buy_intents"][0]
    assert it["item"] == "mechanical keyboard"
    assert it["price_hint"] == 120.0
    assert a["category"] == "shopping"


def test_want_and_out_of_patterns():
    a = analyze_note(_note("Groceries", ["out of milk and eggs", "want new running shoes"]))
    items = {it["item"] for it in a["buy_intents"]}
    assert items == {"milk and eggs", "running shoes"}


def test_ignores_negations_and_errands():
    a = analyze_note(_note("Chores", ["don't buy anything this week", "pick up prescription"]))
    assert a["buy_intents"] == []
    assert any("prescription" in t for t in a["todos"])


def test_todo_extraction():
    a = analyze_note(_note("Week", ["call dentist", "- [ ] clean fridge", "todo: renew gym membership"]))
    assert any("call dentist" in t for t in a["todos"])
    assert any("clean fridge" in t for t in a["todos"])
    assert any("renew gym membership" in t for t in a["todos"])


def test_reminder_time_cues():
    now = int(time.time())
    a = analyze_note(_note("Plan", ["meeting with client tomorrow 5pm"]))
    assert len(a["reminders"]) == 1
    assert a["reminders"][0]["due_at"] > now + 3600

    a2 = analyze_note(_note("Plan", ["submit assignment by friday"]))
    assert len(a2["reminders"]) == 1

    a3 = analyze_note(_note("Plan", ["review deck in 2 hours"]))
    assert len(a3["reminders"]) == 1


def test_price_is_not_time():
    a = analyze_note(_note("Gear", ["need to buy a mechanical keyboard under $120"]))
    assert a["reminders"] == []


def test_category_health():
    a = analyze_note(_note("Health", ["book appointment with dentist"]))
    assert a["category"] == "health"


# ---------- notes_store ----------

def test_notes_crud(tmp_path, monkeypatch):
    monkeypatch.setattr(notes_store, "NOTES_FILE", str(tmp_path / "notes.json"))
    monkeypatch.setattr(notes_store, "OFFERS_FILE", str(tmp_path / "offers.json"))
    note = {"id": "n1", "title": "Gear", "blocks": [], "tags": [], "updated_at": 100}
    notes_store.save_note(note)
    assert notes_store.get_note("n1")["title"] == "Gear"
    assert notes_store.was_offered("n1", "keyboard") is False
    notes_store.mark_offered("n1", "keyboard", "t1")
    assert notes_store.was_offered("n1", "keyboard") is True
    assert notes_store.was_offered("n1", "headphones") is False
    notes_store.delete_note("n1")
    assert notes_store.get_note("n1") is None


# ---------- reminder_service ----------

def test_reminder_add_list_cancel(tmp_path, monkeypatch):
    monkeypatch.setattr(reminder_service, "REMINDERS_FILE", str(tmp_path / "reminders.json"))
    r = reminder_service.add_reminder("buy milk", int(time.time()) + 60)
    assert r["fired"] is False
    assert len(reminder_service.list_reminders()) == 1
    reminder_service.cancel_reminder(r["id"])
    assert reminder_service.list_reminders() == []


# ---------- server routes ----------

def test_notes_api(tmp_path, monkeypatch):
    monkeypatch.setattr(notes_store, "NOTES_FILE", str(tmp_path / "notes.json"))
    monkeypatch.setattr(notes_store, "OFFERS_FILE", str(tmp_path / "offers.json"))
    import server as srv
    with TestClient(srv.app) as client:
        r = client.post("/api/notes", json={
            "id": "n2", "title": "Gear", "blocks": [
                {"id": "b1", "type": "text", "content": "need to buy a usb hub under $50"}
            ],
            "tags": [], "created_at": 1, "updated_at": 1,
        })
        assert r.status_code == 200
        r2 = client.get("/api/notes/analyze?note_id=n2")
        assert r2.status_code == 200
        assert r2.json()["buy_intents"][0]["item"] == "usb hub"
        r3 = client.get("/api/notes")
        assert any(n["id"] == "n2" for n in r3.json()["notes"])


def test_reminders_api(tmp_path, monkeypatch):
    monkeypatch.setattr(reminder_service, "REMINDERS_FILE", str(tmp_path / "reminders.json"))
    import server as srv
    with TestClient(srv.app) as client:
        r = client.post("/api/reminders", json={"text": "buy milk", "due_at": int(time.time()) + 60})
        assert r.status_code == 200
        rid = r.json()["reminder"]["id"]
        r2 = client.get("/api/reminders")
        assert len(r2.json()["reminders"]) == 1
        r3 = client.delete(f"/api/reminders/{rid}")
        assert r3.json()["ok"] is True


def test_mirror_conversation_flow(tmp_path, monkeypatch):
    monkeypatch.setattr(notes_store, "NOTES_FILE", str(tmp_path / "notes.json"))
    monkeypatch.setattr(notes_store, "OFFERS_FILE", str(tmp_path / "offers.json"))
    monkeypatch.setattr(reminder_service, "REMINDERS_FILE", str(tmp_path / "reminders.json"))
    import server as srv
    # stage a note_offer conversation directly
    srv.conversations["mirror_t"] = {
        "step": "note_offer", "pending_item": "usb hub", "price_hint": None,
        "note_id": "n9", "from": "user@priva.app",
    }
    with TestClient(srv.app) as client:
        r = client.post("/api/linq/simulate-reply", json={"text": "NO", "thread_id": "mirror_t"})
        assert r.status_code == 200
        assert r.json()["result"] == "declined"
        # follow-up reminder should have been scheduled
        rem = client.get("/api/reminders").json()["reminders"]
        assert any("Still want to buy" in x["text"] for x in rem)


# ---------- more options (second batch) ----------

def _ten_products():
    return [{"id": f"p{i}", "title": f"Item {i}", "price": float(i), "merchant": "M"} for i in range(1, 11)]


def test_more_options_reveals_next_batch(monkeypatch):
    import server as srv
    sent = []
    async def fake_send_more_options(to, products, start, thread_id=""):
        sent.append((products, start, thread_id))
        return {}
    async def fake_send_message(to, text, thread_id=""):
        sent.append(("msg", text))
        return {}
    monkeypatch.setattr(srv, "send_more_options", fake_send_more_options)
    monkeypatch.setattr(srv, "send_message", fake_send_message)
    srv.conversations["more_t"] = {"step": "showing_results", "products": _ten_products(), "shown": 3}

    async def run():
        result = await srv.handle_choice("u", "more options", "more_t")
        return result, srv.conversations["more_t"]["shown"]

    result, shown = asyncio.run(run())
    assert shown == 8
    assert len(sent) == 1
    batch, start, tid = sent[0]
    assert start == 3
    assert len(batch) == 5
    assert batch[0]["title"] == "Item 4"
    srv.conversations.pop("more_t", None)


def test_more_options_exhausted_prompts_again(monkeypatch):
    import server as srv
    sent = []
    async def fake_send_message(to, text, thread_id=""):
        sent.append(text)
        return {}
    monkeypatch.setattr(srv, "send_message", fake_send_message)
    srv.conversations["more_t"] = {"step": "showing_results", "products": _ten_products(), "shown": 10}

    asyncio.run(srv.handle_choice("u", "more options", "more_t"))
    assert len(sent) == 1
    assert "That's all the options" in sent[0]
    assert srv.conversations["more_t"]["shown"] == 10
    srv.conversations.pop("more_t", None)


def test_choice_digit_accepts_second_batch_item(monkeypatch):
    import server as srv
    consents = []
    async def fake_send_consent(to, product, thread_id=""):
        consents.append(product)
        return {}
    monkeypatch.setattr(srv, "send_consent", fake_send_consent)
    srv.conversations["more_t"] = {"step": "showing_results", "products": _ten_products(), "shown": 10}

    asyncio.run(srv.handle_choice("u", "7", "more_t"))
    assert len(consents) == 1
    assert consents[0]["title"] == "Item 7"
    srv.conversations.pop("more_t", None)


# ---------- LLM analysis fallback ----------

def test_llm_analysis_falls_back_to_rules_when_no_key(monkeypatch):
    import config
    monkeypatch.setattr(config, "OPENAI_API_KEY", "")
    monkeypatch.setattr("note_analyzer.NOTE_LLM", "")
    from note_analyzer import analyze_note_llm
    a = asyncio.run(analyze_note_llm(_note("Gear", ["need to buy a mechanical keyboard under $120"])))
    assert a["buy_intents"][0]["item"] == "mechanical keyboard"
    assert a["buy_intents"][0]["price_hint"] == 120.0


# ---------- inbound thread resolution (chat_id -> internal key) ----------

def test_resolve_thread_id_roundtrip():
    import linq_client
    linq_client._chat_ids["note_n9"] = "chat-11111111-1111-1111-1111-111111111111"
    linq_client._chat_ids["+10000000000"] = "chat-11111111-1111-1111-1111-111111111111"
    assert linq_client.resolve_thread_id("chat-11111111-1111-1111-1111-111111111111") == "note_n9"
    assert linq_client.resolve_thread_id("chat-99999999-9999-9999-9999-999999999999") == ""
    ids = linq_client.resolve_thread_ids("chat-11111111-1111-1111-1111-111111111111")
    assert ids == ["+10000000000", "note_n9"]
    linq_client._chat_ids.pop("note_n9", None)
    linq_client._chat_ids.pop("+10000000000", None)


def test_inbound_reply_resolves_to_note_offer_conversation(monkeypatch):
    import server as srv
    import linq_client
    srv.conversations["note_n9"] = {
        "step": "note_offer", "pending_item": "usb hub", "price_hint": None,
        "note_id": "n9", "from": "user@priva.app",
    }
    # same chat id shared by a phone-keyed thread (reminder sends) + the note thread:
    # the resolver must pick the candidate that has live conversation state
    linq_client._chat_ids["+10000000000"] = "chat-11111111-1111-1111-1111-111111111111"
    linq_client._chat_ids["note_n9"] = "chat-11111111-1111-1111-1111-111111111111"
    sent = []
    async def fake_search(item, q, mx, limit, category=None):
        return []
    async def fake_send_message(to, text, thread_id=""):
        sent.append(text)
        return {}
    monkeypatch.setattr(srv, "search_deep", fake_search)
    monkeypatch.setattr(srv, "send_message", fake_send_message)

    # YES on a note offer now asks the preference questions first
    asyncio.run(srv.route_inbound("+1", "YES", "chat-11111111-1111-1111-1111-111111111111"))
    assert sent and "color preference" in sent[0]
    assert srv.conversations["note_n9"]["step"] == "asking_prefs"

    # skipping the question proceeds to the search
    asyncio.run(srv.route_inbound("+1", "skip", "chat-11111111-1111-1111-1111-111111111111"))
    assert sent and "Couldn't find options" in sent[-1]
    assert "note_n9" not in srv.conversations
    linq_client._chat_ids.pop("note_n9", None)
    linq_client._chat_ids.pop("+10000000000", None)


# ---------- SMS -> app mirror (webhook replies show up in the app chat) ----------

def test_webhook_reply_mirrors_to_app_chat(monkeypatch):
    import server as srv
    import linq_client
    linq_client._outbox.clear()
    linq_client._inbox.clear()
    srv.conversations["note_m1"] = {
        "step": "note_offer", "pending_item": "usb hub", "price_hint": None,
        "note_id": "m1", "from": "user@priva.app",
    }
    linq_client._chat_ids["note_m1"] = "chat-mirror-0001"
    sent = []
    async def fake_search(item, q, mx, limit, category=None):
        return []
    async def fake_send_message(to, text, thread_id=""):
        linq_client._record(to, text, thread_id)
        sent.append(text)
        return {}
    monkeypatch.setattr(srv, "search_deep", fake_search)
    monkeypatch.setattr(srv, "send_message", fake_send_message)

    # a real SMS reply arrives via the webhook (thread = Linq chat id)
    asyncio.run(srv.route_inbound("+1", "YES", "chat-mirror-0001"))
    assert sent and "color preference" in sent[0]
    # the app mirror chat shows the user's SMS AND PRIVA's reply
    assert any(m["text"] == "YES" and m["thread_id"] == "priva_mirror" for m in linq_client.inbox())
    assert any("color preference" in m["text"] and m["thread_id"] == "priva_mirror" for m in linq_client.outbox())
    linq_client._chat_ids.pop("note_m1", None)
    srv.conversations.pop("note_m1", None)
    linq_client._outbox.clear()
    linq_client._inbox.clear()


def test_app_reply_starts_fresh_flow_without_double_mirror(monkeypatch):
    import server as srv
    import linq_client
    linq_client._outbox.clear()
    linq_client._inbox.clear()
    srv._last_offer_thread = ""
    sent = []
    async def fake_search(item, q, mx, limit, category=None):
        return []
    async def fake_send_message(to, text, thread_id=""):
        linq_client._record(to, text, thread_id)
        sent.append(text)
        return {}
    monkeypatch.setattr(srv, "search_deep", fake_search)
    monkeypatch.setattr(srv, "send_message", fake_send_message)

    # fresh shop intent from the app: conversation lives on priva_mirror itself
    asyncio.run(srv.route_inbound("priva_user", "buy a usb hub", "priva_mirror"))
    assert sum(1 for m in linq_client.inbox() if m["thread_id"] == "priva_mirror") == 1
    linq_client._outbox.clear()
    linq_client._inbox.clear()
    srv.conversations.pop("priva_mirror", None)


# ---------- BUY NOW parity (deep pipeline, budget cap) ----------

def test_buy_now_uses_deep_pipeline_without_staged(monkeypatch):
    import server as srv
    import linq_client
    linq_client._outbox.clear()
    linq_client._inbox.clear()
    from models import Product
    srv.conversations["bn1"] = {
        "pending_item": "laptop", "price_hint": 2000, "note_id": "b1", "from": "user@priva.app",
    }
    products = [
        Product(id="p1", title="ASUS ROG Strix G18", price=1699.99, merchant="Best Buy",
                rating=4.6, reviews=500, product_url="http://x"),
        Product(id="p2", title="ASUS TUF F16", price=1649.99, merchant="Best Buy",
                rating=4.7, reviews=839, product_url="http://y"),
    ]
    calls = {"refine": [], "deep": [], "decide": []}
    async def fake_refine(item, purpose=None, max_price=None, category=None, prefs=None):
        calls["refine"].append((item, purpose))
        return "i9 laptop general use"
    async def fake_search_deep(item, q, mx, limit, category=None):
        calls["deep"].append(q)
        return products
    async def fake_decide_best(products, item, purpose=None, max_price=None, query="", category=None):
        calls["decide"].append(query)
        return {"index": 0, "reason": "best overall"}
    consents = []
    async def fake_send_consent(to, product, thread_id=""):
        consents.append(product)
        return {}
    async def fake_send_message(to, text, thread_id=""):
        linq_client._record(to, text, thread_id)
        return {}
    monkeypatch.setattr(srv, "refine_query", fake_refine)
    monkeypatch.setattr(srv, "search_deep", fake_search_deep)
    monkeypatch.setattr(srv, "decide_best", fake_decide_best)
    monkeypatch.setattr(srv, "send_consent", fake_send_consent)
    monkeypatch.setattr(srv, "send_message", fake_send_message)

    asyncio.run(srv.route_inbound("+1", "BUY NOW", "bn1"))
    assert calls["deep"], "BUY NOW must use the deep search pipeline"
    assert calls["decide"], "BUY NOW must run the LLM best-pick step"
    assert consents and consents[0]["title"] == "ASUS TUF F16"
    assert srv.conversations["bn1"]["step"] == "awaiting_consent"
    srv.conversations.pop("bn1", None)
    linq_client._outbox.clear()
    linq_client._inbox.clear()


def test_buy_now_staged_over_budget_dropped(monkeypatch):
    import server as srv
    import linq_client
    linq_client._outbox.clear()
    linq_client._inbox.clear()
    from models import Product
    staged = Product(id="p1", title="ROG Strix G18", price=1699.99, merchant="Best Buy",
                     product_url="http://x", rating=4.6, reviews=500)
    srv.conversations["bn2"] = {
        "pending_item": "laptop", "price_hint": 500, "note_id": "b2", "from": "user@priva.app",
        "products": [staged.model_dump()],
    }
    async def fake_search_deep(item, q, mx, limit, category=None):
        return []
    async def fake_refine(item, purpose=None, max_price=None, category=None, prefs=None):
        return ""
    sent = []
    async def fake_send_message(to, text, thread_id=""):
        linq_client._record(to, text, thread_id)
        sent.append(text)
        return {}
    monkeypatch.setattr(srv, "search_deep", fake_search_deep)
    monkeypatch.setattr(srv, "refine_query", fake_refine)
    monkeypatch.setattr(srv, "send_message", fake_send_message)

    # staged product is over the $500 cap -> dropped -> deep re-search finds nothing
    asyncio.run(srv.route_inbound("+1", "BUY NOW", "bn2"))
    assert any("couldn't re-find" in t for t in sent)
    srv.conversations.pop("bn2", None)
    linq_client._outbox.clear()
    linq_client._inbox.clear()


