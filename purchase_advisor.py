"""LLM purchase advisor: turns purpose into a search query and picks the best
option with a one-line reason. Falls back to rules when OpenAI is unavailable
or the LLM misbehaves — the SMS flow must never break because of the advisor.
"""
import json

import httpx

from config import NOTE_LLM, OPENAI_API_KEY, LLM_MODEL
from preferences import normalize_purpose


def _available() -> bool:
    return bool(NOTE_LLM or OPENAI_API_KEY) and _LLM_FAILURES < _LLM_MAX_FAILURES


_CACHE: dict = {}
_CACHE_MAX = 256
_LLM_FAILURES = 0
_LLM_MAX_FAILURES = 2


async def _llm_json(system: str, user: str, timeout: float = 12.0) -> dict | None:
    """OpenAI chat completion that returns a parsed JSON dict — or None.
    Tries gpt-4o-mini first, falls back to gpt-4o on rate limits, caches
    results so repeated (item, purpose, budget) flows don't burn quota, and
    auto-disables the LLM for the session after repeated rate-limit hits."""
    global _LLM_FAILURES
    if not _available():
        return None
    base_url = (NOTE_LLM or "https://api.openai.com").rstrip("/")
    models = [LLM_MODEL] if LLM_MODEL else (
        ["gpt-4o-mini", "gpt-4o"] if "api.openai.com" in base_url else ["coda-purchase-advisor"]
    )
    key = (base_url, system, user)
    if key in _CACHE:
        return _CACHE[key]
    headers = {"Authorization": f"Bearer {OPENAI_API_KEY}"} if OPENAI_API_KEY else {}
    try:
        saw_429 = False
        for model in models:
            payload = {
                "model": model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "temperature": 0.2,
                "response_format": {"type": "json_object"},
            }
            try:
                async with httpx.AsyncClient(timeout=timeout) as client:
                    resp = await client.post(base_url + "/v1/chat/completions", json=payload, headers=headers)
                if resp.status_code == 429:
                    saw_429 = True
                    continue
                resp.raise_for_status()
                content = resp.json()["choices"][0]["message"]["content"]
                start, end = content.find("{"), content.rfind("}")
                if start < 0 or end < start:
                    _LLM_FAILURES = 0
                    return None
                data = json.loads(content[start:end + 1])
                _LLM_FAILURES = 0
                if len(_CACHE) >= _CACHE_MAX:
                    _CACHE.clear()
                _CACHE[key] = data
                return data
            except httpx.TimeoutException:
                continue
        if saw_429:
            _LLM_FAILURES += 1
        return None
    except Exception:
        return None


_PURPOSE_QUERY = {
    "gaming": "gaming",
    "coding": "developer",
    "video editing": "video editing",
    "creative": "photo editing",
    "work": "business",
    "school": "student",
    "portable": "ultraportable",
}


async def refine_query(item: str, purpose: str | None = None, max_price: float | None = None,
                       category=None, prefs: dict | None = None) -> str:
    """LLM turns 'laptop' + 'gaming' + budget into 'gaming laptop RTX 4070'
    (spec tier matching the budget band) — or falls back to the rule-based
    query with a purpose keyword appended. Runs for EVERY product (not just
    purpose answers): bare items get a category-typical attribute, prefs
    (brand/color/size) are folded in. The budget is NOT put in the query text
    (it biases shopping engines toward cheap items); it's only used to choose
    how high a spec tier to name. The actual price is applied as a hard
    filter + in ranking instead."""
    from catalog import band_specs, category_hint
    from preferences import build_query
    base = build_query(item, prefs or {}) if prefs else f"{item} {_PURPOSE_QUERY.get(purpose or '', '')}".strip()
    if not _available():
        return base
    band = ""
    if max_price and max_price > 0:
        if max_price >= 2000:
            band = "budget: high-end"
        elif max_price >= 1200:
            band = "budget: upper-mid"
        elif max_price >= 600:
            band = "budget: mid"
        else:
            band = "budget: entry"
        cat_band = band_specs(category, max_price) if category else ""
        if cat_band:
            band += f" — what this budget buys: {cat_band}"
    hint = category_hint(category) if category else ""
    user = f"item: {item}\npurpose: {purpose or 'general use'}"
    if band:
        user += f"\n{band}"
    if hint:
        user += f"\nhint: {hint}"
    if prefs:
        bits = " ".join(f"{k}: {v}" for k, v in prefs.items() if v)
        if bits:
            user += f"\npreferences: {bits} (include these in the query)"
    data = await _llm_json(
        "You build a concise Google Shopping search query from an item, its use case "
        "and budget. Return ONLY JSON: {\"query\": \"...\"}. Max 5 words. Do NOT write "
        "price or budget words (under, budget, price, affordable, cheap, expensive, tier, "
        "high-end, mid-range, entry-level) and do NOT write category labels. Include at "
        "MOST ONE spec part — the one that matters most for the purpose (GPU for gaming, "
        "RAM for coding/video editing, OLED/display for creative work) — plus the item "
        f"word and maybe the purpose word. Real spec names only, e.g. RTX 4070, i7, 32GB.",
        user,
    )
    if not data or not data.get("query"):
        return base
    _BANNED = {"under", "budget", "price", "affordable", "cheap", "expensive", "tier",
               "high-end", "high", "end", "mid-range", "mid", "range", "entry-level",
               "entry", "upper-mid", "upper", "best"}
    q = " ".join(w for w in str(data["query"]).split() if w.lower() not in _BANNED)
    return q if len(q) > 3 else base


async def decide_best(
    products: list,
    item: str,
    purpose: str | None = None,
    max_price: float | None = None,
    query: str = "",
    category=None,
) -> dict:
    """Pick the single best option + one-line reason. Runs for EVERY purchase;
    purpose=None means 'best overall quality'. Returns {"index": int,
    "reason": str} with rule-based ranking as fallback."""
    if not products:
        return {"index": -1, "reason": ""}
    if not _available():
        return _rule_best(products, item, purpose, max_price, query, category)
    catalog = [
        {"id": p.id, "title": p.title, "price": p.price, "merchant": p.merchant,
         "rating": p.rating, "reviews": p.reviews}
        for p in products
    ]
    budget = f"under ${float(max_price):.0f}" if max_price else "no limit"
    from catalog import category_hint
    hint = category_hint(category) if category else ""
    user = f"purpose: {purpose or 'general use — best overall quality'}\nbudget: {budget} (all listed products qualify)"
    if hint:
        user += f"\nhint: {hint}"
    user += f"\nproducts: {json.dumps(catalog, ensure_ascii=False)}"
    data = await _llm_json(
        "You are a shopping advisor. From the product list, pick the single best fit "
        "for the user's stated purpose. Return ONLY JSON: "
        '{"id": "<exact product id from the list>", "reason": "<one short sentence>"}. '
        "EVERY product in the list is already within the user's budget — do not filter or "
        "downgrade by price. Choose the BEST QUALITY product for the purpose (better specs, "
        "rating, reviews); for laptops prefer a dedicated GPU for gaming, high RAM for coding. "
        "Spending more of the budget for meaningfully better quality is fine and preferred. "
        "Only avoid products that are clearly worse. The id must be an exact match.",
        user,
    )
    if data:
        want = data.get("id")
        idx = next((i for i, p in enumerate(products) if p.id == want), -1)
        if idx >= 0:
            chosen = products[idx]
            if max_price is None or (chosen.price or 0) <= max_price:
                reason = str(data.get("reason", "")).strip()
                return {"index": idx, "reason": reason[:160]}
    return _rule_best(products, item, purpose, max_price, query, category)


def _rule_best(products: list, item: str, purpose: str | None, max_price: float | None,
               query: str, category=None) -> dict:
    """Deterministic fallback: budget-aware relevance ranking."""
    from agent import rank_products
    within_budget = list(products)
    if max_price:
        within_budget = [p for p in products if (p.price or 0) <= max_price]
    if not within_budget:
        within_budget = list(products)
    ranked = rank_products(within_budget, max_price, query or item, item=item, category=category)
    best = ranked[0]
    idx = next(i for i, p in enumerate(products) if p.id == best.id)
    purpose_txt = purpose or ""
    if purpose_txt == "gaming":
        reason = f"Best gaming pick: solid specs and reviews within your budget."
    elif purpose_txt:
        reason = f"Best pick for {purpose_txt}: best balance of specs, reviews and price."
    else:
        reason = "Best balance of specs, reviews and price."
    return {"index": idx, "reason": reason}
