"""Tests for the universal product-reach system: category taxonomy,
deep search (variants/merge/expansion), result filtering, and
category-aware quality ranking."""
import asyncio

import pytest

from catalog import detect_category, band_specs, spec_tier_query, category_name
from models import Product


def _p(id, title, price, merchant="Best Buy", rating=4.0, reviews=100,
       url="https://shop.test/x", used=False, trust=0):
    return Product(id=id, title=title, price=price, merchant=merchant,
                   rating=rating, reviews=reviews, product_url=url,
                   is_used=used, trust=trust)


# ---------- category taxonomy ----------

def test_category_detection():
    assert category_name("gaming laptop") == "laptop"
    assert category_name("iphone 15") == "phone"
    assert category_name("galaxy s24") == "phone"
    assert category_name("4k tv") == "tv"
    assert category_name("airpods pro") == "headphones"
    assert category_name("running shoes size 10") == "shoes"
    assert category_name("mechanical keyboard") == "keyboard"
    assert category_name("apple watch") == "smartwatch"
    assert category_name("nintendo switch") == "console"
    assert category_name("rtx 4070") == "gpu"
    assert category_name("usb hub") == "generic"
    assert category_name("headphones") != "phone"


def test_size_eligibility():
    assert detect_category("running shoes")["size"] is True
    assert detect_category("usb hub")["size"] is False
    assert detect_category("hoodie")["size"] is True
    assert detect_category("laptop")["size"] is False


def test_complexity():
    assert detect_category("laptop")["complex"] is True
    assert detect_category("phone")["complex"] is True
    assert detect_category("shoes")["complex"] is False


def test_band_specs_by_budget():
    laptop = detect_category("laptop")
    assert "RTX 4080" in band_specs(laptop, 2500)
    assert "RTX 4070" in band_specs(laptop, 1500)
    assert "RTX 4050" in band_specs(laptop, 900)
    assert "i3" in band_specs(laptop, 300)
    assert band_specs(detect_category("shoes"), 900) == ""


def test_spec_tier_query():
    laptop = detect_category("laptop")
    assert "RTX 4070" in spec_tier_query("laptop", laptop, 1500)
    assert spec_tier_query("shoes", detect_category("shoes"), 1500) is None


# ---------- filter_results ----------

def test_filter_drops_no_link():
    from agent import filter_results
    p = Product(id="x", title="Shoes", price=50.0, merchant="Nike")
    assert filter_results([p], "shoes") == []


def test_filter_used_flag_and_resale_drop():
    from agent import filter_results
    refurb = _p("a", "iPhone 15 Pro (Renewed)", 500.0, merchant="Amazon")
    pawn = _p("b", "ASUS ROG Laptop", 900.0, merchant="Pawn America")
    kept = filter_results([refurb, pawn], "iphone 15 pro")
    assert [p.id for p in kept] == ["a"]
    assert kept[0].is_used is True
    assert kept[0].trust == -6 + 2  # used penalty + trusted merchant


def test_filter_keeps_resale_when_user_asks_used():
    from agent import filter_results
    pawn = _p("b", "ASUS ROG Laptop", 900.0, merchant="Pawn America")
    kept = filter_results([pawn], "used laptop")
    assert kept and kept[0].trust <= -2


def test_filter_marketplace_3p_neutral():
    from agent import filter_results
    p3p = _p("c", "Laptop", 900.0, merchant="Walmart - NIPOGI Official Store")
    direct = _p("d", "Laptop", 920.0, merchant="Walmart")
    kept = filter_results([p3p, direct], "laptop")
    by_id = {p.id: p for p in kept}
    assert by_id["c"].trust == -1
    assert by_id["d"].trust == 2


def test_filter_category_floor_spam():
    from agent import filter_results
    fake = _p("f", "iPhone 15 Pro Max 512GB", 45.0, merchant="SmartBuy")
    real = _p("g", "iPhone 15 Pro 256GB", 999.0, merchant="Apple")
    kept = filter_results([fake, real], "iphone 15 pro")
    assert [p.id for p in kept] == ["g"]


def test_filter_keeps_budget_shoes():
    from agent import filter_results
    cheap = _p("h", "Running Shoes", 6.0, merchant="Nike")
    assert filter_results([cheap], "running shoes") == [cheap]


def test_filter_drops_over_budget():
    from agent import filter_results
    in_budget = _p("a", "Laptop X", 900.0, merchant="Best Buy")
    over = _p("b", "ROG Strix G18", 1699.99, merchant="Best Buy")
    kept = filter_results([over, in_budget], "laptop", 1000)
    assert [p.id for p in kept] == ["a"]


def test_filter_no_cap_keeps_all():
    from agent import filter_results
    cheap = _p("a", "Laptop X", 900.0, merchant="Best Buy")
    over = _p("b", "ROG Strix G18", 1699.99, merchant="Best Buy")
    kept = filter_results([over, cheap], "laptop", None)
    assert {p.id for p in kept} == {"a", "b"}


def test_search_and_pick_over_budget_fallback(monkeypatch):
    """Nothing fits the budget -> closest items surfaced with over_budget=True."""
    import server as srv
    from models import Product

    async def fake_refine(item, purpose=None, max_price=None, category=None, prefs=None):
        return "laptop general use"

    async def fake_search_deep(item, q, mx, limit, category=None):
        if mx:  # capped pass: only over-budget machines exist
            return [
                Product(id="a", title="GeekBook Celeron", price=984.72, merchant="Amazon",
                        product_url="http://a", rating=4.5, reviews=136),
                Product(id="b", title="MacBook Air M1", price=999.0, merchant="Apple",
                        product_url="http://b", rating=4.8, reviews=900),
            ]
        return [Product(id="a", title="GeekBook Celeron", price=984.72, merchant="Amazon",
                        product_url="http://a", rating=4.5, reviews=136),
                Product(id="b", title="MacBook Air M1", price=999.0, merchant="Apple",
                        product_url="http://b", rating=4.8, reviews=900)]

    decide_called = []

    async def fake_decide_best(*args, **kwargs):
        decide_called.append(1)
        return {"index": -1, "reason": ""}

    monkeypatch.setattr(srv, "refine_query", fake_refine)
    monkeypatch.setattr(srv, "search_deep", fake_search_deep)
    monkeypatch.setattr(srv, "decide_best", fake_decide_best)

    ranked, best_reason, over_budget = asyncio.run(srv._search_and_pick("laptop", 500, {}, None))
    assert over_budget is True
    assert ranked, "closest over-budget items must be surfaced"
    assert all(getattr(p, "over_budget", False) for p in ranked)
    assert not decide_called, "LLM best-pick must be skipped in over-budget mode"
    assert "Closest to your $500 budget" in best_reason


def test_labels_renders_over_budget_tag():
    import linq_client
    from models import Product
    p = Product(id="x", title="ROG Strix G18", price=1699.99, merchant="Best Buy", over_budget=True)
    assert linq_client._labels(p) == " (over budget)"


# ---------- rank_products (category-aware) ----------

def test_rank_trusted_merchant_bonus():
    from agent import rank_products
    trusted = _p("a", "Laptop X", 900.0, merchant="Best Buy", rating=4.5, reviews=100, trust=2)
    unknown = _p("b", "Laptop X", 899.0, merchant="RandomShop", rating=4.6, reviews=120, trust=0)
    ranked = rank_products([unknown, trusted], 2000, "laptop", item="laptop")
    assert ranked[0].id == "a"


def test_rank_phone_brand_relevance():
    from agent import rank_products
    galaxy = _p("a", "Samsung Galaxy S24 256GB", 800.0, rating=4.6, reviews=500)
    random = _p("b", "Smartphone 4G", 780.0, rating=4.8, reviews=900)
    ranked = rank_products([random, galaxy], 1000, "samsung galaxy s24", item="galaxy s24")
    assert ranked[0].id == "a"


def test_rank_used_penalty():
    from agent import rank_products
    new = _p("a", "Laptop X", 1000.0, rating=4.4, reviews=100)
    used = _p("b", "Laptop X Used", 800.0, rating=4.7, reviews=150, used=True, trust=-4)
    ranked = rank_products([used, new], 2000, "laptop", item="laptop")
    assert ranked[0].id == "a"


def test_rank_entry_class_penalty_on_big_budget():
    from agent import rank_products
    chromebook = _p("a", "Acer Chromebook 315 Celeron 4GB", 240.0, rating=4.2, reviews=900)
    real_laptop = _p("b", "Lenovo Legion i9 32GB RTX Laptop", 1549.99, rating=4.3, reviews=66)
    ranked = rank_products([chromebook, real_laptop], 2000, "i9 32GB laptop coding", item="laptop")
    assert ranked[0].id == "b"


def test_rank_premium_near_cap_surfaces_on_big_budget():
    from agent import rank_products
    value_pick = _p("a", "GeekBook Ultra 9 32GB 1TB OLED", 984.72, rating=4.5, reviews=136)
    near_cap = _p("b", "ASUS TUF Gaming F16 Gaming Laptop", 1649.99, rating=4.7, reviews=839, merchant="Best Buy", trust=2)
    ranked = rank_products([value_pick, near_cap], 2000, "i9 32GB laptop coding", item="laptop")
    assert ranked[0].id == "b"


def test_rank_mid_budget_untouched():
    from agent import rank_products
    cheap = _p("a", "Everyday Sneakers", 44.5, rating=4.4, reviews=2000)
    pricier = _p("b", "Trail Runner GTX", 119.0, rating=4.6, reviews=600)
    ranked = rank_products([cheap, pricier], 100, "running shoes", item="running shoes")
    assert ranked[0].id == "b"


# ---------- search_deep (variants + merge + adaptive) ----------

def test_search_deep_merges_and_dedupes(monkeypatch):
    import serpapi_client as sc
    calls = []

    async def fake_search(query, max_price=None, limit=5, start=0):
        calls.append((query, start))
        if query == "running shoes":
            return [_p("1", "Shoe A", 60.0), _p("2", "Shoe B", 70.0)]
        if start == 0:
            return [_p("1", "Shoe A", 60.0), _p("3", "Shoe C", 80.0)]
        return [_p("4", "Shoe D", 90.0)]

    monkeypatch.setattr(sc, "search_products", fake_search)
    monkeypatch.setattr(sc, "SERPAPI_KEY", "test-key")
    pool = asyncio.run(sc.search_deep("running shoes", "nike running shoes", 100.0, 10))
    ids = [p.id for p in pool]
    assert ids.count("1") == 1
    assert {"1", "2", "3"} <= set(ids)
    assert any(q == "running shoes" for q, _ in calls)


def test_search_deep_expands_when_underspending(monkeypatch):
    import serpapi_client as sc
    calls = []

    async def fake_search(query, max_price=None, limit=5, start=0):
        calls.append((query, start))
        return [_p(f"p{start + i}", "Laptop", 100 + start + i) for i in range(2)]

    monkeypatch.setattr(sc, "search_products", fake_search)
    monkeypatch.setattr(sc, "SERPAPI_KEY", "test-key")
    pool = asyncio.run(sc.search_deep("laptop", "laptop", 2000.0, 10))
    assert len(pool) >= 4
    assert len(calls) >= 3  # variants + page-2 expansion fired (pool weak + underspend)


def test_search_deep_no_expansion_on_good_pool(monkeypatch):
    import serpapi_client as sc
    calls = []

    async def fake_search(query, max_price=None, limit=5, start=0):
        calls.append((query, start))
        return [_p(f"p{i}", "Laptop", 1500 + i * 50) for i in range(10)]

    monkeypatch.setattr(sc, "search_products", fake_search)
    monkeypatch.setattr(sc, "SERPAPI_KEY", "test-key")
    pool = asyncio.run(sc.search_deep("laptop", "gaming laptop", 2000.0, 10))
    assert len(pool) == 10
    assert len(calls) == 2  # primary + generic, no expansion


# ---------- advisor with category/prefs (LLM off) ----------

def test_refine_query_fallback_uses_prefs():
    from purchase_advisor import refine_query
    q = asyncio.run(refine_query("shoes", None, 100.0,
                                 category=detect_category("shoes"),
                                 prefs={"brand": "nike", "color": "black", "size": "10"}))
    assert "nike" in q and "black" in q and "size 10" in q


def test_decide_best_general_purpose(monkeypatch):
    import purchase_advisor as pa
    products = [
        _p("p1", "Cheap Laptop", 500.0),
        _p("p2", "Premium Laptop", 1800.0, rating=4.9, reviews=800),
    ]
    monkeypatch.setattr(pa, "_available", lambda: True)
    async def fake_llm(system, user, timeout=12.0):
        return {"id": "p2", "reason": "best overall quality"}
    monkeypatch.setattr(pa, "_llm_json", fake_llm)
    d = asyncio.run(pa.decide_best(products, "laptop", None, 2000.0))
    assert d["index"] == 1


def test_llm_auto_disables_after_rate_limits(monkeypatch):
    import purchase_advisor as pa
    monkeypatch.setattr(pa, "OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(pa, "_available",
                        lambda: bool(pa.OPENAI_API_KEY) and pa._LLM_FAILURES < pa._LLM_MAX_FAILURES)
    pa._LLM_FAILURES = 0
    assert pa._available() is True
    pa._LLM_FAILURES = 2
    assert pa._available() is False
    pa._LLM_FAILURES = 0


def test_llm_json_counts_rate_limit(monkeypatch):
    import purchase_advisor as pa
    monkeypatch.setattr(pa, "OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(pa, "_available", lambda: True)
    pa._LLM_FAILURES = 0

    class FakeResp:
        status_code = 429
        def json(self):
            return {}

    class FakeClient:
        def __init__(self, *a, **k):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return False
        async def post(self, *a, **k):
            return FakeResp()

    monkeypatch.setattr(pa.httpx, "AsyncClient", FakeClient)
    assert asyncio.run(pa._llm_json("s", "u")) is None
    assert pa._LLM_FAILURES == 1
    pa._LLM_FAILURES = 0
