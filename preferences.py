"""Rule-based preference extraction, query building, and priority ranking.

Turns free text ("black size 10 running shoes under $60") into structured
preferences ({size, color, brand, gender}) used by the SMS Q&A flow and the
SerpApi search query, and re-ranks results so preference-matching products
surface first.
"""
import re

PREF_QUESTIONS = {
    "size": "What size should I look for? (e.g. 10, M, XL) — reply SKIP if unsure",
    "color": "Any color preference? (e.g. black, navy) — reply SKIP for any",
    "purpose": "What will you use it for? (gaming, coding, video editing, work, school, general) — reply SKIP to let me decide",
}

SKIP_WORDS = {
    "skip", "none", "no preference", "no pref", "any", "anything",
    "whatever", "n/a", "na", "don't care", "dont care", "no",
}

_PURPOSE_MAP = [
    (("gaming", "game", "play", "esports", "fps", "rtx games"), "gaming"),
    (("coding", "programming", "program", "developer", "dev", "software", "engineering"), "coding"),
    (("video editing", "video", "editing", "youtube", "content creator", "creator", "stream"), "video editing"),
    (("photo", "photoshop", "design", "graphic", "creative"), "creative"),
    (("work", "office", "business", "professional", "meetings"), "work"),
    (("school", "college", "student", "study", "university"), "school"),
    (("travel", "portable", "light", "ultraportable"), "portable"),
]

_COMPLEX_ITEMS = re.compile(
    r"(?:laptop|notebook|netbook|pc\b|computer|desktop|workstation|"
    r"monitor|smartphone|\bphone\b|iphone|android|tablet|ipad|"
    r"camera|dslr|mirrorless|gopro|tv\b|television|console|playstation|xbox|"
    r"gpu|graphics card|graphics-card|processor|\bcpu\b|\bkeyboard\b|mechanical keyboard)",
    re.I,
)

_PURPOSE_KW = re.compile(
    r"\b(gaming|game|gamer|esports|coding|programming|programmer|developer|"
    r"video editing|video-editing|youtube|content creator|stream(?:ing)?|"
    r"photo(?:s)?|photoshop|design|graphic design|work|office|business|"
    r"school|college|student|study|travel|portable|lightweight|ultraportable)\b",
    re.I,
)

_SIZES = ["xxl", "xl", "xxs", "xs", "m-l", "s-m", "s", "m", "l"]

_COLORS = [
    "black", "white", "grey", "gray", "blue", "navy", "red", "green", "olive",
    "khaki", "brown", "tan", "beige", "cream", "yellow", "orange", "purple",
    "pink", "maroon", "burgundy", "teal", "turquoise", "silver", "gold",
    "copper", "rose", "coral", "mint", "lavender", "charcoal", "magenta",
    "violet", "indigo", "cyan", "peach", "lime", "ivory", "rust", "crimson",
    "scarlet", "amber", "bronze", "jade", "blush", "espresso", "denim",
    "pastel", "metallic", "neon",
]

_BRANDS = [
    "new balance", "under armour", "tommy hilfiger", "ralph lauren",
    "calvin klein", "nike", "adidas", "puma", "reebok", "jordan", "sketchers",
    "skechers", "converse", "vans", "asics", "brooks", "hoka", "saucony",
    "fila", "levis", "wrangler", "dockers", "gap", "uniqlo", "zara", "h&m",
    "hollister", "abercombie", "guess", "diesel", "lee", "apple", "samsung",
    "google", "pixel", "oneplus", "xiaomi", "realme", "oppo", "vivo",
    "motorola", "nokia", "sony", "jbl", "bose", "sennheiser", "beats",
    "skullcandy", "boAt", "boat", "noise", "dell", "hp", "lenovo", "asus",
    "acer", "msi", "razer", "logitech", "corsair", "keychron", "ducky",
    "cosmic byte", "evofox", "zebronics", "canon", "nikon", "fitbit", "garmin",
    "casio", "fossil", "titan", "swatch", "timex", "seiko", "lg",
    "panasonic", "whirlpool", "bosch", "philips",
]

_GENDER_WORDS = {
    "men's": "men", "mens": "men", "men": "men",
    "women's": "women", "womens": "women", "women": "women",
    "kids": "kids", "kid's": "kids", "kids'": "kids",
    "boy's": "boys", "boys": "boys", "girl's": "girls", "girls": "girls",
    "unisex": "unisex",
}

_SIZE_ELIGIBLE = re.compile(
    r"(?:shoe|sneaker|boot|sandal|heel|loafer|slipper|clog|apparel|shirt|"
    r"tee\b|tshirt|t-shirt|hoodie|jacket|coat|jeans|pants|trousers|shorts|"
    r"dress|skirt|suit|sweater|sweatshirt|leggings|socks|saree|kurta|jersey|"
    r"blazer|vest|uniform|glove|hat|cap|belt|swimsuit|bikini|tracksuit|chinos|"
    r"lingerie|underwear)",
    re.I,
)

_SIZE_KW_RE = re.compile(r"\b(?:size|sizes?)\s*(?:in)?\s*([0-9]+(?:\.[05])?)", re.I)
_SIZE_UNIT_RE = re.compile(r"\b(?:us|uk|eu)\s*([0-9]+(?:\.[05])?)", re.I)
_SIZE_SUFFIX_RE = re.compile(r"\b([0-9]+(?:\.[05])?)\s*(?:us|uk|eu)\b", re.I)
_SIZE_NUM_RE = re.compile(r"\b([0-9]+(?:\.[05])?)\b")


def _extract_size(text: str, bare_ok: bool = False) -> str | None:
    t = text.lower()
    m = _SIZE_KW_RE.search(t)
    if m:
        return m.group(1)
    m = _SIZE_UNIT_RE.search(t)
    if m:
        return m.group(1)
    m = _SIZE_SUFFIX_RE.search(t)
    if m:
        return m.group(1)
    for code in _SIZES:
        if re.search(rf"\b{re.escape(code)}\b", t):
            return code
    if bare_ok:
        m = _SIZE_NUM_RE.search(t)
        if m:
            return m.group(1)
    return None


def _extract_color(text: str) -> str | None:
    t = text.lower()
    hits = []
    for color in _COLORS:
        for m in re.finditer(rf"\b{re.escape(color)}\b", t):
            hits.append((len(color), -m.start(), color))
    if not hits:
        return None
    return sorted(hits, reverse=True)[0][2]


def _extract_brand(text: str) -> str | None:
    t = text.lower()
    best = None
    for brand in sorted(set(_BRANDS), key=lambda b: -len(b)):
        if re.search(rf"\b{re.escape(brand)}\b", t):
            best = brand
            break
    return best


def _extract_gender(text: str) -> str | None:
    t = text.lower()
    for word in sorted(_GENDER_WORDS, key=lambda w: -len(w)):
        if re.search(rf"\b{re.escape(word)}\b", t):
            return _GENDER_WORDS[word]
    return None


def extract_preferences(text: str) -> dict:
    """Pull {size, color, brand, gender, purpose} out of a line of text."""
    prefs = {}
    size = _extract_size(text)
    if size:
        prefs["size"] = size
    color = _extract_color(text)
    if color:
        prefs["color"] = color
    brand = _extract_brand(text)
    if brand:
        prefs["brand"] = brand
    gender = _extract_gender(text)
    if gender:
        prefs["gender"] = gender
    purpose = _extract_purpose(text)
    if purpose:
        prefs["purpose"] = purpose
    return prefs


def _extract_purpose(text: str) -> str | None:
    t = text.lower()
    m = _PURPOSE_KW.search(t)
    if not m:
        return None
    phrase = m.group(0)
    for keys, label in _PURPOSE_MAP:
        if any(k in phrase for k in keys):
            return label
    return None


def normalize_purpose(text: str) -> str | None:
    """Map a free-text purpose answer to a canonical label."""
    t = text.lower()
    for keys, label in _PURPOSE_MAP:
        if any(k in t for k in keys):
            return label
    return None


def clean_item(item: str, prefs: dict) -> str:
    """Strip already-known preference tokens out of the item phrase."""
    t = item
    for value in prefs.values():
        for tok in value.split():
            t = re.sub(rf"\b{re.escape(tok)}\b", " ", t, flags=re.I)
    if prefs.get("size"):
        t = re.sub(r"\b(?:size|sizes?|us|uk|eu)\b", " ", t, flags=re.I)
    return re.sub(r"\s+", " ", t).strip(" ,-;:")


def build_query(item: str, prefs: dict) -> str:
    """Compose the SerpApi query: 'nike black running shoes size 10'."""
    parts = []
    if prefs.get("brand"):
        parts.append(prefs["brand"])
    if prefs.get("gender"):
        parts.append(prefs["gender"])
    if prefs.get("color"):
        parts.append(prefs["color"])
    if item:
        parts.append(item)
    if prefs.get("size"):
        parts.append(f"size {prefs['size']}")
    if prefs.get("purpose"):
        parts.append(prefs["purpose"])
    return " ".join(parts)


def size_eligible(item: str) -> bool:
    return bool(item and _SIZE_ELIGIBLE.search(item))


def complex_item(item: str) -> bool:
    """Items where purpose matters more than size/color (laptop, phone, PC...)."""
    return bool(item and _COMPLEX_ITEMS.search(item))


def pref_questions(item: str, prefs: dict) -> list:
    """Which preferences are still missing for this item (size → color)."""
    questions = []
    if complex_item(item) and not prefs.get("purpose"):
        questions.append("purpose")
    if not complex_item(item) and size_eligible(item) and not prefs.get("size"):
        questions.append("size")
    if not complex_item(item) and not prefs.get("color"):
        questions.append("color")
    return questions


def parse_pref_answer(question: str, text: str) -> str | None:
    """Validate a free-text answer for the current question."""
    if question == "size":
        return _extract_size(text, bare_ok=True)
    if question == "color":
        return _extract_color(text)
    if question == "purpose":
        return normalize_purpose(text)
    return None


def pref_rank(products: list, prefs: dict) -> list:
    """Stable re-rank: titles containing preference tokens jump to the front."""
    tokens = [v for v in prefs.values() if v]
    if not tokens or not products:
        return list(products)

    def bonus(product) -> float:
        title = (product.get("title") or "") if isinstance(product, dict) else getattr(product, "title", "")
        low = str(title).lower()
        return 25 * sum(1 for tok in tokens if re.search(rf"\b{re.escape(tok)}\b", low))

    return sorted(products, key=bonus, reverse=True)
