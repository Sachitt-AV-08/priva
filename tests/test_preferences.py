"""Tests for PRIVA preference extraction and the SMS preference Q&A flow."""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

from preferences import (
    extract_preferences, clean_item, build_query, size_eligible,
    pref_questions, parse_pref_answer, pref_rank,
)
from models import Product


def _sample_products(under_budget=False):
    return [
        Product(id="p1", title="Black Running Shoes Size 10", price=(39.0 if under_budget else 55.0),
                merchant="M", rating=4.5, reviews=200,
                product_url="https://shop.test/p1"),
        Product(id="p2", title="White Running Shoes", price=(35.0 if under_budget else 50.0),
                merchant="M", rating=4.0, reviews=100,
                product_url="https://shop.test/p2"),
    ]


# ---------- extraction ----------

def test_extract_size_variants():
    assert extract_preferences("buy size 10 running shoes")["size"] == "10"
    assert extract_preferences("us 9.5 sneakers")["size"] == "9.5"
    assert extract_preferences("running shoes 10 us")["size"] == "10"
    assert extract_preferences("black shirt size M")["size"] == "m"
    assert extract_preferences("hoodie in XL")["size"] == "xl"


def test_extract_color():
    assert extract_preferences("black running shoes")["color"] == "black"
    assert extract_preferences("dark blue jeans")["color"] == "blue"
    assert extract_preferences("navy tee")["color"] == "navy"


def test_extract_brand_and_gender():
    p = extract_preferences("nike black running shoes")
    assert p["brand"] == "nike"
    p2 = extract_preferences("men's running shoes size 10")
    assert p2["gender"] == "men"


def test_no_prefs_in_plain_text():
    assert extract_preferences("buy running shoes under 60") == {}


def test_brand_not_color_confusion():
    assert extract_preferences("redmi note phone") == {}
    assert extract_preferences("red running shoes")["color"] == "red"


# ---------- query building / cleaning ----------

def test_clean_item_strips_prefs():
    prefs = extract_preferences("black size 10 running shoes")
    assert clean_item("black size 10 running shoes", prefs) == "running shoes"


def test_build_query_order():
    prefs = {"brand": "nike", "gender": "men", "color": "black", "size": "10"}
    assert build_query("running shoes", prefs) == "nike men black running shoes size 10"


def test_size_eligible():
    assert size_eligible("running shoes")
    assert size_eligible("tshirt")
    assert not size_eligible("usb hub")
    assert not size_eligible("headphones")


def test_pref_questions_only_missing():
    assert pref_questions("running shoes", {}) == ["size", "color"]
    assert pref_questions("running shoes", {"size": "10"}) == ["color"]
    assert pref_questions("running shoes", {"size": "10", "color": "black"}) == []
    assert pref_questions("usb hub", {}) == ["color"]


def test_parse_pref_answer():
    assert parse_pref_answer("size", "10") == "10"
    assert parse_pref_answer("size", "us 11") == "11"
    assert parse_pref_answer("size", "medium") is None
    assert parse_pref_answer("color", "black") == "black"
    assert parse_pref_answer("color", "dark grey") == "grey"
    assert parse_pref_answer("color", "yes please") is None


# ---------- priority ranking ----------

def test_pref_rank_surfaces_matches():
    prefs = {"color": "black", "size": "10"}
    products = [
        {"id": "a", "title": "White Running Shoes", "price": 50.0},
        {"id": "b", "title": "Black Running Shoes Size 10", "price": 60.0},
        {"id": "c", "title": "Black Sneakers", "price": 55.0},
    ]
    ranked = pref_rank(products, prefs)
    assert ranked[0]["id"] == "b"
    assert ranked[1]["id"] == "c"
    assert ranked[2]["id"] == "a"


def test_pref_rank_stable_without_prefs():
    products = [{"id": f"p{i}", "title": f"Item {i}"} for i in range(3)]
    assert [p["id"] for p in pref_rank(products, {})] == ["p0", "p1", "p2"]


# ---------- conversation Q&A (route_inbound) ----------

async def _run(coro):
    return await coro


def _stub_sends(monkeypatch, sent):
    import server as srv

    async def fake_send_message(to, text, thread_id=""):
        sent.append(("msg", text, thread_id))
        return {}

    async def fake_send_shopping_results(to, products, thread_id="", best_reason=""):
        sent.append(("results", [p.title if hasattr(p, "title") else p.get("title") for p in products[:5]], thread_id))
        return {}

    monkeypatch.setattr(srv, "send_message", fake_send_message)
    monkeypatch.setattr(srv, "send_shopping_results", fake_send_shopping_results)


def _note_conv(item="running shoes", prefs=None, price_hint=60.0):
    return {
        "step": "note_offer", "pending_item": item, "price_hint": price_hint,
        "prefs": prefs or {}, "note_id": "np1", "from": "+10000000000",
    }


def test_note_yes_asks_size_then_color(monkeypatch):
    import server as srv
    sent = []
    _stub_sends(monkeypatch, sent)
    searches = []

    async def fake_search(item, q, mx, limit, category=None):
        searches.append((q, mx))
        return _sample_products()
    monkeypatch.setattr(srv, "search_deep", fake_search)
    srv.conversations["pref_t1"] = _note_conv()

    asyncio.run(_run(srv.route_inbound("+1", "YES", "pref_t1")))
    assert sent[0][1].startswith("running shoes —")
    assert "size" in sent[0][1]
    assert srv.conversations["pref_t1"]["step"] == "asking_prefs"

    asyncio.run(_run(srv.route_inbound("+1", "10", "pref_t1")))
    assert "color" in sent[1][1]
    assert srv.conversations["pref_t1"]["prefs"] == {"size": "10"}

    asyncio.run(_run(srv.route_inbound("+1", "black", "pref_t1")))
    assert searches == [("black running shoes size 10", 60.0)]
    assert sent[2][1].startswith("On it — searching for black running shoes size 10")
    assert srv.conversations["pref_t1"]["step"] == "showing_results"
    srv.conversations.pop("pref_t1", None)


def test_note_with_prefs_skips_questions(monkeypatch):
    import server as srv
    sent = []
    _stub_sends(monkeypatch, sent)
    searches = []

    async def fake_search(item, q, mx, limit, category=None):
        searches.append(q)
        return _sample_products()
    monkeypatch.setattr(srv, "search_deep", fake_search)
    srv.conversations["pref_t2"] = _note_conv(prefs={"size": "10", "color": "black"})

    asyncio.run(_run(srv.route_inbound("+1", "YES", "pref_t2")))
    assert searches == ["black running shoes size 10"]
    assert sent[0][0] == "results"  # straight to options, no questions asked
    srv.conversations.pop("pref_t2", None)


def test_skip_moves_past_question(monkeypatch):
    import server as srv
    sent = []
    _stub_sends(monkeypatch, sent)
    searches = []

    async def fake_search(item, q, mx, limit, category=None):
        searches.append(q)
        return _sample_products()
    monkeypatch.setattr(srv, "search_deep", fake_search)
    srv.conversations["pref_t3"] = _note_conv()

    asyncio.run(_run(srv.route_inbound("+1", "YES", "pref_t3")))
    asyncio.run(_run(srv.route_inbound("+1", "skip", "pref_t3")))
    assert "color" in sent[1][1]
    asyncio.run(_run(srv.route_inbound("+1", "none", "pref_t3")))
    assert searches == ["running shoes"]
    srv.conversations.pop("pref_t3", None)


def test_garbage_answer_reasks(monkeypatch):
    import server as srv
    sent = []
    _stub_sends(monkeypatch, sent)
    srv.conversations["pref_t4"] = _note_conv()

    asyncio.run(_run(srv.route_inbound("+1", "YES", "pref_t4")))
    asyncio.run(_run(srv.route_inbound("+1", "yes please", "pref_t4")))
    assert "didn't look like an answer" in sent[1][1]
    assert srv.conversations["pref_t4"]["step"] == "asking_prefs"
    assert "size" not in srv.conversations["pref_t4"]["prefs"]
    srv.conversations.pop("pref_t4", None)


def test_direct_shop_intent_asks_prefs(monkeypatch):
    import server as srv
    sent = []
    _stub_sends(monkeypatch, sent)
    srv.conversations.pop("pref_t5", None)

    asyncio.run(_run(srv.route_inbound("+1", "buy running shoes under 60", "pref_t5")))
    assert srv.conversations["pref_t5"]["step"] == "asking_prefs"
    assert "size" in sent[0][1]
    srv.conversations.pop("pref_t5", None)


def test_direct_intent_with_prefs_searches_directly(monkeypatch):
    import server as srv
    sent = []
    _stub_sends(monkeypatch, sent)
    searches = []

    async def fake_search(item, q, mx, limit, category=None):
        searches.append((q, mx))
        return _sample_products()
    monkeypatch.setattr(srv, "search_deep", fake_search)
    srv.conversations.pop("pref_t6", None)

    asyncio.run(_run(srv.route_inbound("+1", "buy black size 10 running shoes under 60", "pref_t6")))
    assert srv.conversations["pref_t6"]["step"] == "showing_results"
    assert searches == [("black running shoes size 10", 60.0)]
    srv.conversations.pop("pref_t6", None)


def test_pref_answer_new_intent_restarts(monkeypatch):
    import server as srv
    sent = []
    _stub_sends(monkeypatch, sent)
    srv.conversations["pref_t7"] = _note_conv()

    asyncio.run(_run(srv.route_inbound("+1", "YES", "pref_t7")))
    asyncio.run(_run(srv.route_inbound("+1", "buy headphones under 40", "pref_t7")))
    assert srv.conversations["pref_t7"]["pending_item"] == "headphones"
    assert srv.conversations["pref_t7"]["price_hint"] == 40.0
    assert "color" in sent[1][1]
    srv.conversations.pop("pref_t7", None)


# ---------- links in result messages ----------

def test_shopping_results_include_links(monkeypatch):
    import linq_client
    sent = []

    async def fake_send_message(to, text, thread_id=""):
        sent.append(text)
        return {}
    monkeypatch.setattr(linq_client, "send_message", fake_send_message)
    products = [
        {"id": "p1", "title": "Black Sneakers", "price": 55.0, "merchant": "M",
         "product_url": "https://shop.example/p1", "rating": 4, "reviews": 12},
        {"id": "p2", "title": "White Shoes", "price": 50.0, "merchant": "M",
         "product_url": "https://shop.example/p2", "rating": 3, "reviews": 5},
    ]
    asyncio.run(linq_client.send_shopping_results("+1", products, "link_t"))
    assert sent[0] == "Found options for you:"
    joined = "\n".join(sent)
    assert "https://shop.example/p1" in joined
    assert "https://shop.example/p2" in joined


# ---------- note-offer path cleans preference words ----------

def test_note_offer_cleans_item_before_query(monkeypatch):
    import server as srv
    sent = []
    _stub_sends(monkeypatch, sent)
    searches = []

    async def fake_search(item, q, mx, limit, category=None):
        searches.append((q, mx))
        return _sample_products(under_budget=True)
    monkeypatch.setattr(srv, "search_deep", fake_search)
    monkeypatch.setattr(srv, "outgoing_address", lambda: "+10000000000")
    monkeypatch.setattr(srv, "was_offered", lambda *a: False)
    monkeypatch.setattr(srv, "recently_offered", lambda *a: False)
    monkeypatch.setattr(srv, "mark_offered", lambda *a: None)
    srv.conversations.pop("pref_note_clean", None)

    note = {
        "id": "clean1",
        "title": "Hoodie",
        "blocks": [{"id": "b1", "type": "text", "content": "need to buy a black hoodie under 40"}],
    }
    asyncio.run(_run(srv._maybe_offer_from_note(note)))
    conv = srv.conversations["note_clean1"]
    assert conv["pending_item"] == "hoodie"  # color stripped, no "black black"

    asyncio.run(_run(srv.route_inbound("+1", "YES", "note_clean1")))
    assert conv["step"] == "asking_prefs"  # size still missing for a hoodie
    asyncio.run(_run(srv.route_inbound("+1", "M", "note_clean1")))
    assert searches == [("black hoodie size m", 40.0)]
    srv.conversations.pop("note_clean1", None)


