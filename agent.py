import re
import json
import math
import os
import time
from models import Intent, Product, Transaction

transaction_log: list[Transaction] = []

_TXNS_FILE = os.path.join(os.path.dirname(__file__), "transactions.json")


def _load_transactions():
    """Persist transactions across restarts (mirror-chat style JSON store)."""
    try:
        with open(_TXNS_FILE, encoding="utf-8") as fh:
            for d in json.load(fh).get("transactions", []):
                transaction_log.append(Transaction(**d))
    except (OSError, ValueError, TypeError):
        pass


def _save_transactions():
    try:
        tmp = _TXNS_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump({"transactions": [t.model_dump() for t in transaction_log]}, fh)
        os.replace(tmp, _TXNS_FILE)
    except OSError:
        pass

_load_transactions()

def parse_intent(text: str) -> Intent:
    text = text.lower().strip()
    max_price = None
    price_match = re.search(r"(?:under|less than|max|budget|below)\s*\$?(\d+[.]?\d*)", text)
    if price_match:
        max_price = float(price_match.group(1))
    buy_match = re.search(r"(?:buy|get|purchase|order|shop|find|search)\s+(.+?)(?:\s+(?:under|less|for|from|at)\s|$)", text)
    if buy_match:
        return Intent(action="shop", query=buy_match.group(1).strip(), max_price=max_price, category="shopping")
    if re.search(r"(?:remind|reminder)", text):
        return Intent(action="reminder", query=text)
    return Intent(action="unknown", query=text)

_TIER_FLOORS = [
    (("rtx 4090", "rtx4090", "4080", "4090"), 1200.0),
    (("rtx 4070", "4070", "4070 ti"), 900.0),
    (("rtx 4060", "4060", "4050", "rtx 3050", "3050"), 600.0),
    (("i9", "core i9"), 800.0),
    (("i7", "core i7", "ryzen 7"), 450.0),
    (("i5", "core i5", "ryzen 5"), 300.0),
    (("m3", "m3 pro", "m3 max"), 900.0),
    (("m2", "m2 pro", "m2 max"), 800.0),
    (("m1", "m1 pro", "m1 max"), 600.0),
    (("32gb", "64gb", "128gb"), 600.0),
    (("16gb",), 300.0),
]

_TRUSTED_MERCHANTS = {
    "walmart", "best buy", "amazon", "target", "b&h", "bhphotovideo", "newegg",
    "staples", "dell", "apple", "hp", "lenovo", "asus", "adorama", "costco",
    "sams club", "sam's club", "home depot", "lowes", "nordstrom", "zappos",
    "macys", "macy's", "kohls", "tj maxx", "marshalls", "office depot",
    "micro center", "microcenter", "cdw", "crutchfield", "prodirect",
    "jd sports", "foot locker", "finish line", "dick's sporting goods", "dicks",
    "bestbuy", "costco.com", "target.com", "amazon.com", "walmart.com",
}

_MARKETPLACE_PREFIX = re.compile(r"^(walmart|amazon|target|newegg|ebay|best ?buy)\s*-\s*(.+)$", re.I)

_RESALE_MERCHANTS = {
    "pawn america", "jawa", "jawa.gg", "tech for less", "mercari", "poshmark",
    "grailed", "offerup", "letgo", "craigslist", "facebook marketplace",
    "ebay classifieds", "backmarket", "swappa",
}

_USED_RE = re.compile(
    r"\b(refurbished|refurb|renewed|open box|pre-owned|preowned|second ?hand|"
    r"reconditioned|re-certified|recertified|grade [ab]|used)\b",
    re.I,
)

_USED_ASK_RE = re.compile(
    r"\b(used|refurbished|refurb|renewed|open box|pre-owned|second ?hand)\b",
    re.I,
)


def _asked_used(item: str) -> bool:
    return bool(item and _USED_ASK_RE.search(item))


def _is_used(title: str) -> bool:
    t = (title or "").lower()
    if "backpack use" in t or "used to" in t:
        return False
    return bool(_USED_RE.search(t))


def _merchant_trust(merchant: str, title: str = "") -> int:
    """+2 trusted retailer, -1 marketplace 3P, -2 pawn/resale."""
    m = (merchant or "").strip()
    low = m.lower()
    if any(r in low for r in _RESALE_MERCHANTS):
        return -2
    if low in _TRUSTED_MERCHANTS or any(low.endswith(s) for s in ("",)):
        if low in _TRUSTED_MERCHANTS:
            return 2
    match = _MARKETPLACE_PREFIX.match(m)
    if match:
        seller = match.group(2).strip().lower()
        if seller not in _TRUSTED_MERCHANTS:
            return -1
        return 2
    return 0


def filter_implausible(products: list[Product]) -> list[Product]:
    """Deprecated alias — kept for tests/back-compat."""
    return filter_results(products)


def filter_results(products: list[Product], item: str = "", max_price: float | None = None,
                   category=None) -> list[Product]:
    """Full product-quality filter (Phase 3):

    - drop listings with no clickable link (SMS needs it)
    - flag used/refurb titles (downranked, labeled in SMS)
    - merchant trust classification (+2 trusted / -1 3P marketplace / -2 resale)
    - resale/pawn dropped when the user is buying NEW (item doesn't mention used)
    - price-floor spam: global tier claims (RTX 4080) + per-category floors
      ('iPhone 15 Pro' for $45 is fake)
    - strict budget cap: anything above max_price is dropped (callers re-search
      without the cap and label the closest items over_budget when nothing fits)
    """
    if not products:
        return list(products)
    from catalog import detect_category
    cat = category or detect_category(item)
    asking_used = _asked_used(item)
    if max_price and max_price > 0:
        products = [p for p in products if not p.price or p.price <= max_price]

    kept = []
    for p in products:
        title = (p.title or "")
        if not (p.product_url or p.merchant_url):
            continue
        used = _is_used(title)
        raw_trust = _merchant_trust(p.merchant, title)
        trust = raw_trust - 6 if used else raw_trust
        if raw_trust <= -2 and not asking_used:
            continue
        if _spam_price(title, p.price, cat):
            continue
        p.is_used = used
        p.trust = trust
        kept.append(p)
    return kept


def _spam_price(title: str, price: float, category) -> bool:
    """Impossible price for claimed specs (global tiers + category floors)."""
    t = ((title or "") + " ").lower()
    if price and price > 0:
        for toks, floor in _TIER_FLOORS:
            if any(tok in t for tok in toks) and price < floor * 0.4:
                return True
        for toks, floor in (category.get("floors") or []):
            toks = toks if isinstance(toks, tuple) else (toks,)
            if any(tok in t for tok in toks) and price < floor * 0.5:
                return True
    return False


def rank_products(products: list[Product], max_price: float | None = None, query: str = "",
                  item: str = "", category=None) -> list[Product]:
    """Rank by quality + how well the item matches what the user asked for.

    score = rating (40) + reviews (15, log-scaled) + query relevance (up to 35,
    category-aware spec classes) + merchant trust (-16..+8) + budget value (2,
    tiebreak only) + class fit (entry penalty -25 / premium bonus +15 on big
    budgets). Quality dominates so the best product within budget wins —
    price never demotes a strong product (a $1000 GPU laptop does not outrank a
    $1500 one when the budget is $2000).
    """
    if not products:
        return list(products)
    from catalog import detect_category, band_name
    cat = category or detect_category(item or query)
    band = band_name(cat, max_price)
    big_budget = band in ("high", "upper_mid")
    entry_tokens = cat.get("entry") or []
    premium_tokens = cat.get("premium") or []

    _STOP = {"a", "an", "the", "with", "and", "for", "under", "new", "proper", "good", "of", "in", "on", "to", "buy", "need", "want", "best"}
    q = (query or "").lower()
    spec = cat.get("spec") or {}
    active = {
        label: ttoks
        for label, (qtoks, ttoks) in spec.items()
        if any(t in q for t in qtoks)
    }
    generic = {w for w in q.split() if len(w) > 3 and w not in _STOP}
    premium_asked = [t for t in premium_tokens if t in q]

    def score(p: Product) -> float:
        rating_score = (p.rating or 3.0) / 5.0 * 40
        log_reviews = min(math.log10((p.reviews or 0) + 1) / 3.0, 1.0) * 15
        title = ((p.title or "") + " " + (p.merchant or "")).lower()
        class_hits = sum(1 for toks in active.values() if any(t in title for t in toks))
        generic_hits = min(sum(1 for w in generic if w in title), 4)
        relevance = class_hits * 15 + generic_hits * 5
        trust_bonus = (p.trust or 0) * 4
        budget = max_price if max_price and max_price > 0 else max((x.price or 0) for x in products) or 1.0
        value = (1.0 - min((p.price or 0) / budget, 1.0)) * 2
        class_fit = 0.0
        if big_budget:
            has_entry = any(t in title for t in entry_tokens)
            has_premium = any(t in title for t in premium_tokens)
            if has_entry and not has_premium:
                class_fit -= 25
            if has_premium:
                class_fit += 15
                if premium_asked and any(t in title for t in premium_asked):
                    class_fit += 15
            price_frac = (p.price or 0) / budget if budget else 0
            if price_frac >= 0.5:
                class_fit += (price_frac - 0.5) * 2 * 25
            if price_frac >= 0.7 and (p.rating or 0) >= 4.2:
                class_fit += 25
        return rating_score + log_reviews + relevance + trust_bonus + value + class_fit
    return sorted(products, key=score, reverse=True)

def log_transaction(user_id: str, product: Product, prava_session_id: str = "", note_id: str = "") -> Transaction:
    txn = Transaction(
        id=f"txn_{int(time.time())}_{hash(product.id) % 10000}",
        user_id=user_id,
        product_id=product.id,
        product_title=product.title,
        merchant=product.merchant,
        amount=product.price,
        status="pending",
        prava_session_id=prava_session_id,
        thumbnail=product.thumbnail,
        product_url=product.product_url,
        note_id=note_id,
        created_at=int(time.time()),
    )
    transaction_log.append(txn)
    _save_transactions()
    return txn

def update_transaction(txn_id: str, **kwargs):
    for txn in transaction_log:
        if txn.id == txn_id:
            for k, v in kwargs.items():
                setattr(txn, k, v)
            _save_transactions()
            break

def get_transactions(user_id: str = "") -> list[dict]:
    if user_id:
        return [t.model_dump() for t in transaction_log if t.user_id == user_id]
    return [t.model_dump() for t in transaction_log]
