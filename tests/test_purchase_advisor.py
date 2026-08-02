"""Tests for the LLM purchase advisor: purpose-based query refinement and
best-pick decision, including rule-based fallbacks."""
import asyncio

import pytest


@pytest.fixture(autouse=True)
def _no_llm(monkeypatch):
    import purchase_advisor as pa
    monkeypatch.setattr(pa, "_available", lambda: False)


def _products():
    from models import Product
    return [
        Product(id="p1", title="Lenovo IdeaPad 3i Chromebook", price=245.90, merchant="Best Buy",
                rating=4.4, reviews=3120),
        Product(id="p2", title="Acer Nitro V RTX 4050 Laptop", price=899.00, merchant="Walmart",
                rating=4.6, reviews=1890),
        Product(id="p3", title="MacBook Air M3", price=1099.00, merchant="Apple",
                rating=4.7, reviews=4210),
    ]


def test_refine_query_appends_purpose_keyword():
    from purchase_advisor import refine_query
    assert asyncio.run(refine_query("laptop", "gaming")) == "laptop gaming"
    assert asyncio.run(refine_query("laptop", "video editing")) == "laptop video editing"
    assert asyncio.run(refine_query("laptop", None)) == "laptop"


def test_refine_query_does_not_include_price():
    from purchase_advisor import refine_query
    q = asyncio.run(refine_query("laptop", "gaming", 2000.0))
    assert "2000" not in q


def test_decide_best_fallback_picks_gpu_laptop_for_gaming():
    from purchase_advisor import decide_best
    products = _products()
    d = asyncio.run(decide_best(products, "laptop", "gaming", 2000.0, "gaming laptop"))
    assert 0 <= d["index"] < len(products)
    assert products[d["index"]].id == "p2"
    assert d["reason"]


def test_decide_best_empty_products():
    from purchase_advisor import decide_best
    d = asyncio.run(decide_best([], "laptop", "gaming", 2000.0))
    assert d["index"] == -1


def test_decide_best_budget_blocks_over_budget_pick():
    from purchase_advisor import decide_best
    products = _products()
    d = asyncio.run(decide_best(products, "laptop", "gaming", 250.0, "laptop"))
    assert 0 <= d["index"] < len(products)
    assert products[d["index"]].price <= 250.0


def test_llm_json_bad_response_returns_none(monkeypatch):
    import purchase_advisor as pa
    monkeypatch.setattr(pa, "_available", lambda: True)
    calls = []

    async def fake_llm(system, user, timeout=12.0):
        calls.append(user)
        return None
    monkeypatch.setattr(pa, "_llm_json", fake_llm)
    q = asyncio.run(pa.refine_query("laptop", "gaming"))
    assert q == "laptop gaming"


def test_decide_best_llm_pick_respected(monkeypatch):
    import purchase_advisor as pa
    products = _products()
    monkeypatch.setattr(pa, "_available", lambda: True)
    async def fake_llm(system, user, timeout=12.0):
        return {"id": "p3", "reason": "best reviews"}
    monkeypatch.setattr(pa, "_llm_json", fake_llm)
    d = asyncio.run(pa.decide_best(products, "laptop", "gaming", 2000.0))
    assert d["index"] == 2
    assert "best reviews" in d["reason"]


def test_decide_best_llm_bad_id_falls_back(monkeypatch):
    import purchase_advisor as pa
    products = _products()
    monkeypatch.setattr(pa, "_available", lambda: True)
    async def fake_llm(system, user, timeout=12.0):
        return {"id": "does_not_exist", "reason": "whatever"}
    monkeypatch.setattr(pa, "_llm_json", fake_llm)
    d = asyncio.run(pa.decide_best(products, "laptop", "gaming", 2000.0))
    assert 0 <= d["index"] < len(products)

def test_filter_implausible_drops_fake_tier_listings():
    from agent import filter_implausible
    from models import Product
    P = Product
    ps = [
        P(id="a", title="Gaming Laptop RTX 4080 i7 32GB", price=89.99, merchant="SmartBuy", rating=4.0, reviews=10,
          product_url="https://x.test/a"),
        P(id="b", title="MacBook Air M3", price=999.00, merchant="Apple", rating=4.7, reviews=4000,
          product_url="https://x.test/b"),
        P(id="c", title="ASUS ROG Strix G16 RTX 4070", price=1649.99, merchant="Staples", rating=5.0, reviews=100,
          product_url="https://x.test/c"),
        P(id="d", title="Running Shoes", price=49.99, merchant="Nike", rating=4.5, reviews=200,
          product_url="https://x.test/d"),
    ]
    ids = [p.id for p in filter_implausible(ps)]
    assert "a" not in ids
    assert "b" in ids and "c" in ids and "d" in ids
