import asyncio
import json
import os
import time
from collections import OrderedDict
from typing import Optional

import httpx
from config import SERPAPI_KEY
from models import Product
from preferences import extract_preferences

CACHE_TTL = 24 * 60 * 60
CACHE_FILE = os.path.join(os.path.dirname(__file__), "search_cache.json")
_MAX_MEM_CACHE = 64

_mem_cache: OrderedDict[str, dict] = OrderedDict()
_quota_exhausted = False


def _load_disk_cache() -> dict:
    try:
        with open(CACHE_FILE, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return {}


def _save_disk_cache(cache: dict):
    try:
        tmp = CACHE_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(cache, fh)
        os.replace(tmp, CACHE_FILE)
    except OSError:
        pass


def _cache_key(query: str, max_price: Optional[float], limit: int, start: int = 0) -> str:
    if max_price is not None:
        if float(max_price).is_integer():
            max_price = int(max_price)
        else:
            max_price = round(float(max_price), 2)
    return f"{query.strip().lower()}|{max_price}|{limit}|{start}"


def _cached(query: str, max_price: Optional[float], limit: int, start: int = 0) -> Optional[list[dict]]:
    key = _cache_key(query, max_price, limit, start)
    mem = _mem_cache.get(key)
    if mem and time.time() - mem["ts"] < CACHE_TTL:
        return mem["products"]
    disk = _load_disk_cache()
    entry = disk.get(key)
    if entry and time.time() - entry["ts"] < CACHE_TTL:
        _mem_cache[key] = entry
        return entry["products"]
    return None


def _store_cache(query: str, max_price: Optional[float], limit: int, products: list[dict], start: int = 0):
    key = _cache_key(query, max_price, limit, start)
    entry = {"ts": time.time(), "products": products}
    _mem_cache[key] = entry
    _mem_cache.move_to_end(key)
    while len(_mem_cache) > _MAX_MEM_CACHE:
        _mem_cache.popitem(last=False)
    disk = _load_disk_cache()
    disk[key] = entry
    _save_disk_cache(disk)


def _sample_products(query: str, limit: int) -> list[dict]:
    q = query.lower()
    prefs = extract_preferences(query)
    suffix = ""
    if prefs.get("color") or prefs.get("size"):
        bits = []
        if prefs.get("color"):
            bits.append(prefs["color"])
        if prefs.get("size"):
            bits.append(f"Size {prefs['size']}")
        suffix = f" ({', '.join(bits)})"
    if any(w in q for w in ("headphone", "earbud", "audio", "sound")):
        items = [
            ("Wireless Noise-Cancelling Headphones", 89.99, "SoundCore", 4.5, 12340),
            ("Studio Over-Ear Headphones", 149.00, "AudioSense", 4.7, 8921),
            ("True Wireless Earbuds Pro", 59.99, "AudioWave", 4.3, 15230),
            ("Open-Back Reference Headphones", 199.00, "HiFiWorks", 4.8, 4310),
            ("Sports Wireless Earbuds", 39.99, "MoveFit", 4.1, 21300),
        ]
    elif any(w in q for w in ("shoe", "sneaker", "running", "footwear")):
        items = [
            ("Cloudfoam Running Shoes", 64.99, "RunAce", 4.6, 18450),
            ("Trail Runner GTX", 119.00, "SummitWear", 4.7, 6210),
            ("Everyday Sneakers", 49.99, "StreetStep", 4.2, 27600),
            ("Marathon Carbon Racer", 199.99, "RunAce", 4.8, 5230),
            ("Cushion Walkers", 44.50, "MoveFit", 4.0, 9800),
        ]
    elif any(w in q for w in ("keyboard", "key", "mechanical")):
        items = [
            ("Mechanical Keyboard TKL", 89.99, "KeyTech", 4.7, 7420),
            ("Low-Profile Wireless Keyboard", 69.00, "KeyTech", 4.4, 5120),
            ("Compact 60% Mechanical", 79.99, "KeyCo", 4.6, 8930),
            ("Ergonomic Split Keyboard", 129.00, "ErgoWorks", 4.5, 2340),
            ("Silent Office Keyboard", 39.99, "WorkDesk", 4.2, 11000),
        ]
    elif any(w in q for w in ("usb", "hub", "dock", "adapter")):
        items = [
            ("7-in-1 USB-C Hub", 45.99, "PortPlus", 4.6, 10230),
            ("10-in-1 Docking Station", 89.00, "DeskHub", 4.7, 4310),
            ("USB-C to HDMI Adapter", 24.99, "PortPlus", 4.5, 15600),
            ("Thunderbolt 4 Dock", 199.00, "DeskHub", 4.8, 2980),
            ("USB 3.0 4-Port Hub", 19.99, "PortPlus", 4.3, 24500),
        ]
    else:
        items = [
            (f"{query.title()} Essentials Kit", 49.99, "SmartBuy", 4.4, 8760),
            (f"Premium {query.title()}", 89.99, "SmartBuy", 4.6, 5430),
            (f"{query.title()} Pro Edition", 129.00, "TechSource", 4.7, 3210),
            (f"Compact {query.title()}", 34.99, "TechSource", 4.2, 12800),
            (f"{query.title()} Bundle", 69.50, "SmartBuy", 4.5, 6900),
        ]
    return [
        {
            "id": f"sample_{i}",
            "title": title + suffix,
            "price": price,
            "merchant": merchant,
            "merchant_url": "https://example.com",
            "rating": rating,
            "reviews": reviews,
            "thumbnail": "",
            "product_url": "https://example.com",
        }
        for i, (title, price, merchant, rating, reviews) in enumerate(items[:limit])
    ]


def quota_exhausted() -> bool:
    return _quota_exhausted


def _price_aware(products: list[Product], max_price: Optional[float], limit: int) -> list[Product]:
    """Never return empty on a price cap: exact match -> 25% tolerance -> cheapest."""
    if not products or not max_price:
        return products[:limit]
    capped = [p for p in products if p.price <= max_price]
    if capped:
        return capped[:limit]
    near = [p for p in products if p.price <= max_price * 1.25]
    if near:
        return near[:limit]
    return products[:limit]


def _shopping_search_url(query: str) -> str:
    """Real, clickable Google Shopping search link for fallback results —
    never a dead example.com placeholder in an SMS."""
    from urllib.parse import quote
    return f"https://www.google.com/search?q={quote(query + ' product')}&tbm=shop"


def _fallback_products(query: str, max_price: Optional[float], limit: int) -> list[Product]:
    search_url = _shopping_search_url(query)
    samples = [
        Product(
            id=p["id"],
            title=p["title"],
            price=p["price"],
            merchant=p["merchant"],
            merchant_url=search_url,
            rating=p["rating"],
            reviews=p["reviews"],
            thumbnail="",
            product_url=search_url,
        )
        for p in _sample_products(query, limit * 2)
    ]
    return _price_aware(samples, max_price, limit) or samples[:limit]


async def search_products(query: str, max_price: Optional[float] = None, limit: int = 5, start: int = 0) -> list[Product]:
    if not SERPAPI_KEY:
        return _fallback_products(query, max_price, limit)
    cached = _cached(query, max_price, limit, start)
    if cached is not None:
        return [Product(**p) for p in cached]
    try:
        params = {
            "engine": "google_shopping",
            "q": query,
            "api_key": SERPAPI_KEY,
            "num": limit * 4,
        }
        if start > 0:
            params["start"] = start
        if max_price:
            params["tbs"] = f"mr:1,price:1,ppr_min:0,ppr_max:{int(max_price)}"
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get("https://serpapi.com/search.json", params=params)
            results = resp.json()
        err = results.get("error")
        if err:
            if "quota" in str(err).lower() or "limit" in str(err).lower():
                _quota_exhausted = True
            print(f"[serpapi] API error for '{query}': {err}", flush=True)
            return _fallback_products(query, max_price, limit)
        shopping = results.get("shopping_results", []) or []
        raw = []
        for item in shopping:
            price = _parse_price(item.get("price", "$0"))
            raw.append((price, item))
        raw.sort(key=lambda t: t[0])
        products = [
            Product(
                id=item.get("product_id", item.get("product_link", "")),
                title=item.get("title", ""),
                price=price,
                merchant=item.get("source", item.get("merchant", "Unknown")),
                merchant_url=item.get("link", ""),
                rating=item.get("rating", 0),
                reviews=item.get("reviews", 0),
                thumbnail=item.get("thumbnail", ""),
                product_url=item.get("product_link", ""),
            )
            for price, item in raw[: limit * 4]
        ]
        products = _price_aware(products, max_price, limit)
        if products:
            _store_cache(query, max_price, limit, [p.model_dump() for p in products], start)
        return products
    except Exception as exc:
        print(f"[serpapi] exception for '{query}': {exc!r}", flush=True)
        return _fallback_products(query, max_price, limit)


def _parse_price(price_str: str) -> float:
    import re
    match = re.search(r"[\d.]+", price_str.replace(",", ""))
    return float(match.group(0)) if match else 0.0


# ---------- deep search: multi-variant, adaptive expansion ----------

_MAX_SEARCHES_PER_PURCHASE = 4


def _norm_title(title: str) -> str:
    import re
    t = re.sub(r"[^a-z0-9]+", " ", (title or "").lower())
    return " ".join(t.split())


def _merge_pool(pool: list[Product], products: list[Product]) -> None:
    """Dedupe by product_id first, then by normalized title + merchant + price
    (same listing at different prices are kept as distinct options)."""
    known_ids = {p.id for p in pool}
    seen_titles = {}
    for p in pool:
        key = (p.merchant or "").lower(), _norm_title(p.title), round(p.price or 0)
        seen_titles[key] = True
    for p in products:
        if p.id and p.id in known_ids:
            continue
        key = (p.merchant or "").lower(), _norm_title(p.title), round(p.price or 0)
        if key in seen_titles:
            continue
        if p.id:
            known_ids.add(p.id)
        seen_titles[key] = True
        pool.append(p)


def _underspends(pool: list[Product], max_price: float | None) -> bool:
    """Results cluster far below the budget -> need a higher-spec query."""
    if not max_price or not pool:
        return False
    prices = sorted(p.price for p in pool if p.price)
    if not prices:
        return False
    med = prices[len(prices) // 2]
    return med < max_price * 0.5


async def search_deep(item: str, query: str, max_price: Optional[float] = None,
                      limit: int = 10, category=None) -> list[Product]:
    """Deep product reach: fetch several query variants (primary, generic item,
    rule-based spec-tier), merge + dedupe, then adaptively expand (page 2 /
    more variants) only when the pool is weak or underspends the budget.
    Hard caps total searches so the monthly quota is never blown by one
    purchase. Returns raw merged candidates; filtering happens downstream.
    """
    if not SERPAPI_KEY:
        return _fallback_products(query, max_price, limit)
    from catalog import detect_category, spec_tier_query
    cat = category or detect_category(item)

    variants = []
    q = (query or "").strip()
    base = (item or "").strip()
    for v in (q, base):
        if v and v.lower() not in {x.lower() for x in variants}:
            variants.append(v)
    spec = spec_tier_query(item, cat, max_price)
    if spec and spec.lower() not in {x.lower() for x in variants}:
        variants.append(spec)

    pool: list[Product] = []
    searches = 0

    async def fetch(variant: str, start: int) -> list[Product]:
        nonlocal searches
        searches += 1
        try:
            return await search_products(variant, max_price, limit, start=start)
        except Exception:
            return []

    for variant in variants[:2]:
        got = await fetch(variant, 0)
        _merge_pool(pool, got)
    if len(pool) < 8 or _underspends(pool, max_price):
        if len(variants) > 2 and searches < _MAX_SEARCHES_PER_PURCHASE:
            got = await fetch(variants[2], 0)
            _merge_pool(pool, got)
        if len(pool) < 6 and searches < _MAX_SEARCHES_PER_PURCHASE:
            got = await fetch(variants[0], 40)
            _merge_pool(pool, got)
    return pool[: max(limit * 4, 40)]
