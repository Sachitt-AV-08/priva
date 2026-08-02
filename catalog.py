"""Category taxonomy for universal product reach.

Every item ("gaming laptop", "running shoes", "4K TV", "iphone") maps to a
category that drives:
  - spec-tier query hints for the LLM/rule refine step (budget band -> specs)
  - relevance keyword classes for quality ranking (per-category spec tokens)
  - price floors for spam filtering ("$89 RTX 4080 laptop" class of junk)
  - size/color vs purpose preference questions

The generic category is the safe fallback for anything unrecognized.
"""
import re


def _cat(name, patterns, complex=False, size=False, spec=None, floors=None,
         hint="", bands=None, entry=None, premium=None):
    return {
        "name": name,
        "patterns": [re.compile(p, re.I) for p in patterns],
        "complex": complex,
        "size": size,
        "spec": spec or {},          # label -> (query_tokens, title_tokens)
        "floors": floors or [],      # (tokens, floor)
        "hint": hint,
        "bands": bands or {},
        "entry": entry or [],        # entry-class tokens (downranked on big budgets)
        "premium": premium or [],    # premium tokens (boosted on big budgets)
    }


_LAPTOP_SPEC = {
    "cpu": (("i9", "i7", "ryzen 9", "ryzen 7", "ultra 9", "ultra 7"),
            ("i9", "i7", "ryzen 9", "ryzen 7", "ultra 9", "ultra 7")),
    "gpu": (("gpu", "graphics", "gaming", "rtx", "radeon", "geforce"),
            ("gpu", "rtx", "graphics", "gaming", "geforce", "radeon")),
    "ram": (("ram", "memory"), ("ram", "memory", "16gb", "32gb", "8gb")),
    "display": (("oled", "display", "screen", "fhd", "4k"),
                ("oled", "display", "touch", "4k", "fhd", "screen")),
    "storage": (("ssd", "storage", "drive"), ("ssd", "nvme", "storage", "512gb", "1tb")),
    "portable": (("portable", "thin", "light", "battery"),
                 ("battery", "thin", "light", "portable")),
}
_DESKTOP_SPEC = {k: v for k, v in _LAPTOP_SPEC.items() if k in ("gpu", "ram", "storage")}
_PHONE_SPEC = {
    "brand": (("iphone", "galaxy", "pixel", "oneplus", "xiaomi", "realme", "samsung"),
              ("iphone", "galaxy", "pixel", "oneplus", "xiaomi", "realme", "samsung")),
    "storage": (("256gb", "512gb", "1tb", "128gb"), ("256gb", "512gb", "1tb", "128gb")),
    "display": (("120hz", "pro motion", "oled", "amoled"), ("120hz", "pro motion", "oled", "amoled")),
}
_TV_SPEC = {"resolution": (("4k", "8k", "uhd", "oled", "qled"), ("4k", "8k", "uhd", "oled", "qled"))}
_AUDIO_SPEC = {
    "anc": (("noise cancelling", "anc", "cancel"), ("noise cancelling", "anc", "cancel")),
    "brand": (("sony", "bose", "airpods", "sennheiser", "jbl", "soundcore", "beats"),
              ("sony", "bose", "airpods", "sennheiser", "jbl", "soundcore", "beats")),
}
_CAMERA_SPEC = {
    "sensor": (("full frame", "aps-c", "mirrorless", "dslr"), ("full frame", "aps-c", "mirrorless", "dslr")),
    "video": (("4k", "8k"), ("4k", "8k")),
}
_GPU_SPEC = {
    "chip": (("4090", "4080", "4070", "4060", "3090", "3080", "3070", "3060"),
             ("4090", "4080", "4070", "4060", "3090", "3080", "3070", "3060")),
    "memory": (("24gb", "16gb", "12gb", "8gb", "vram"), ("24gb", "16gb", "12gb", "8gb", "vram")),
}
_WATCH_SPEC = {
    "gen": (("ultra", "series 9", "series 8", "series 10", "galaxy watch"),
            ("ultra", "series 9", "series 8", "series 10", "galaxy watch")),
    "conn": (("gps", "cellular", "lte"), ("gps", "cellular", "lte")),
}
_KEYBOARD_SPEC = {
    "switch": (("mechanical", "hot-swap", "hotswap"),
               ("mechanical", "hot-swap", "hotswap", "brown", "red", "blue")),
    "layout": (("60%", "65%", "75%", "tkl", "compact"), ("60%", "65%", "75%", "tkl", "compact")),
}
_MOUSE_SPEC = {
    "type": (("wireless", "gaming", "ergonomic", "vertical", "bluetooth"),
             ("wireless", "gaming", "ergonomic", "vertical", "bluetooth")),
}
_SHOE_SPEC = {
    "activity": (("running", "trail", "basketball", "soccer", "golf", "hiking", "casual"),
                 ("running", "trail", "basketball", "soccer", "golf", "hiking", "casual")),
    "tech": (("gore-tex", "flyknit", "boost", "cloudfoam", "waterproof"),
             ("gore-tex", "flyknit", "boost", "cloudfoam", "waterproof")),
}
_MONITOR_SPEC = {
    "resolution": (("4k", "1440p", "1080p", "oled", "240hz", "144hz", "gsync"),
                   ("4k", "1440p", "1080p", "oled", "240hz", "144hz", "gsync")),
}
_CONSOLE_SPEC = {
    "gen": (("pro", "slim", "oled", "series x", "series s"),
            ("pro", "slim", "oled", "series x", "series s")),
}
_SPEAKER_SPEC = {
    "type": (("smart", "portable", "soundbar", "bluetooth"),
             ("smart", "portable", "soundbar", "bluetooth")),
}
_APPLIANCE_SPEC = {
    "type": (("smart", "inverter", "energy star"), ("smart", "inverter", "energy star")),
}

CATEGORIES = [
    _cat("laptop",
         [r"\b(laptop|notebook|netbook|ultrabook|macbook|chromebook)\b"],
         complex=True, spec=_LAPTOP_SPEC, floors=[("laptop", 100.0)],
         hint="for laptops name the real GPU/CPU/RAM tier",
         bands={"high": "RTX 4080/4090, i9, 32GB+", "upper_mid": "RTX 4070, i7, 16-32GB",
                "mid": "RTX 4050/4060, i5/i7, 16GB", "entry": "i3/i5, 8-16GB"},
         entry=["chromebook", "celeron", "n100", "n200", "n50", "n3050", "athlon silver", "ryzen 3", "4gb ram", "64gb ssd", "128gb ssd", "e series", "aspire 1", "ideapad 1", "essential", "basic"],
         premium=["rtx 4080", "rtx 4090", "rtx 4070", "i9", "ryzen 9", "ryzen 7", "ultra 9", "ultra 7", "32gb", "64gb", "2tb", "4k", "oled", "rtx 4060", "rtx 4050", "16gb"]),
    _cat("desktop",
         [r"\b(pc|desktop|workstation|tower|all-in-one)\b"],
         complex=True, spec=_DESKTOP_SPEC, floors=[("desktop", 150.0)],
         hint="for desktops name the GPU/CPU/RAM tier",
         bands={"high": "RTX 4080/4090, i9/7950X, 32GB+", "upper_mid": "RTX 4070, i7/7700X, 32GB",
                "mid": "RTX 4060, i5/7600, 16-32GB", "entry": "integrated GPU, 16GB"}),
    _cat("phone",
         [r"\b(smartphone|phone|iphone|android|galaxy|pixel|oneplus|xiaomi|realme|redmi|moto)\b"],
         complex=True, spec=_PHONE_SPEC,
         floors=[("iphone 15 pro", 600.0), ("iphone 15", 400.0), ("iphone 14", 300.0),
                 ("iphone 13", 200.0), ("iphone 12", 120.0), ("iphone se", 80.0),
                 ("iphone 11", 80.0), ("galaxy s24", 350.0), ("galaxy s23", 250.0),
                 ("galaxy s22", 150.0), ("galaxy s21", 100.0), ("pixel 8", 250.0),
                 ("pixel 7", 150.0), ("pixel 6", 80.0), ("oneplus 12", 350.0),
                 ("oneplus 11", 250.0), ("galaxy a54", 100.0), ("redmi note", 70.0),
                 ("phone", 30.0)],
         hint="for phones name the exact model generation (iPhone 15, Galaxy S24, Pixel 8)",
         bands={"high": "iPhone 15 Pro Max / Galaxy S24 Ultra, 256GB+",
                "upper_mid": "iPhone 15 / Galaxy S24, 256GB",
                "mid": "iPhone 13/14, Galaxy S22/S23", "entry": "iPhone SE, Galaxy A54, Moto G"}),
    _cat("tablet",
         [r"\b(tablet|ipad)\b"],
         complex=True, spec=_PHONE_SPEC,
         floors=[("ipad pro", 400.0), ("ipad air", 250.0), ("ipad mini", 150.0),
                 ("ipad", 150.0), ("galaxy tab", 80.0), ("tablet", 40.0)],
         hint="for tablets name the model generation (iPad Pro, iPad Air, Galaxy Tab)",
         bands={"high": "iPad Pro, 256GB+", "upper_mid": "iPad Air, 128GB+",
                "mid": "iPad 9th/10th gen", "entry": "Android tablet, 64GB+"}),
    _cat("tv",
         [r"\b(tv|television|smart tv|led tv|oled tv)\b"],
         complex=True, spec=_TV_SPEC,
         floors=[("8k", 400.0), ("oled", 200.0), ("4k", 80.0), ("tv", 40.0)],
         hint="for TVs name resolution and size (4K OLED 65)",
         bands={"high": "OLED 65-85, 4K 120Hz", "upper_mid": "4K QLED 55-75",
                "mid": "4K 50-65", "entry": "HD/4K 32-50"}),
    _cat("monitor",
         [r"\b(monitor|computer screen)\b"],
         complex=True, spec=_MONITOR_SPEC,
         floors=[("4k", 80.0), ("144hz", 60.0), ("oled", 250.0), ("monitor", 50.0)],
         hint="for monitors name resolution and refresh rate (4K 144Hz)",
         bands={"high": "4K 144Hz+ OLED/IPS", "upper_mid": "1440p 144-240Hz",
                "mid": "1080p 144Hz+", "entry": "1080p 60-75Hz"}),
    _cat("headphones",
         [r"\b(headphone|earbud|earphone|airpod|airpods|audio|sound)\b"],
         spec=_AUDIO_SPEC,
         floors=[("airpods pro", 120.0), ("airpods max", 300.0), ("airpods", 70.0),
                 ("wh-1000", 150.0), ("qc45", 150.0), ("qc ultra", 200.0),
                 ("beats", 60.0), ("headphone", 8.0)],
         hint="for audio name the tier (ANC over-ear, true wireless, studio monitor)",
         bands={"high": "flagship ANC (Sony WH-1000XM5, Bose QC Ultra)",
                "upper_mid": "premium ANC (WH-1000XM4, QC45, AirPods Pro)",
                "mid": "mid ANC (Soundcore Q30, AirPods 3)", "entry": "budget earbuds"}),
    _cat("camera",
         [r"\b(camera|dslr|mirrorless|gopro|canon|nikon|sony alpha)\b"],
         complex=True, spec=_CAMERA_SPEC,
         floors=[("dslr", 120.0), ("mirrorless", 200.0), ("gopro", 80.0),
                 ("camera", 50.0)],
         hint="for cameras name the format (full-frame mirrorless, APS-C, action cam)",
         bands={"high": "full-frame mirrorless (Sony A7 IV, Canon R6 II)",
                "upper_mid": "APS-C mirrorless (A6700, R10)", "mid": "entry mirrorless (Z30, A6100)",
                "entry": "compact / action cam"}),
    _cat("console",
         [r"\b(console|playstation|ps5|ps4|xbox|nintendo|switch|steam deck)\b"],
         complex=True, spec=_CONSOLE_SPEC,
         floors=[("ps5", 250.0), ("ps4", 50.0), ("xbox series", 250.0), ("xbox one", 40.0),
                 ("switch", 100.0), ("steam deck", 200.0), ("console", 40.0)],
         hint="for consoles name the exact model (PS5 Pro, Xbox Series X, Switch OLED)",
         bands={"high": "PS5 Pro / Xbox Series X", "upper_mid": "PS5 / Series X / Switch OLED",
                "mid": "PS5 Digital / Series S / Switch", "entry": "PS4 / Switch Lite"}),
    _cat("gpu",
         [r"\b(gpu|graphics card|graphics-card|rtx|radeon|geforce)\b"],
         complex=True, spec=_GPU_SPEC,
         floors=[("4090", 900.0), ("4080", 700.0), ("4070", 400.0), ("4060", 200.0),
                 ("3090", 400.0), ("3080", 300.0), ("3070", 200.0), ("3060", 150.0),
                 ("2060", 100.0), ("1660", 80.0), ("1050", 40.0), ("gpu", 30.0)],
         hint="for GPUs name the exact chip (RTX 4070, RX 7800 XT)",
         bands={"high": "RTX 4090/4080 Super, 16-24GB", "upper_mid": "RTX 4070 Ti/4070, 12-16GB",
                "mid": "RTX 4060/4070, 8-12GB", "entry": "RTX 3050/4060, 8GB"}),
    _cat("smartwatch",
         [r"\b(smart ?watch|apple watch|galaxy watch|fitbit|garmin)\b"],
         complex=True, spec=_WATCH_SPEC,
         floors=[("apple watch", 120.0), ("galaxy watch", 80.0), ("fitbit", 30.0),
                 ("garmin", 80.0), ("smartwatch", 20.0)],
         hint="for smartwatches name the series (Apple Watch Series 9, Galaxy Watch 6)",
         bands={"high": "Apple Watch Ultra 2 / Galaxy Watch Ultra",
                "upper_mid": "Apple Watch Series 9/10, Galaxy Watch 6/7",
                "mid": "Apple Watch SE, Galaxy Watch 5/6", "entry": "Fitbit, budget"}),
    _cat("keyboard",
         [r"\b(keyboard)\b"],
         spec=_KEYBOARD_SPEC, floors=[("mechanical", 15.0), ("keyboard", 10.0)],
         hint="for keyboards name the switch type and layout (mechanical TKL, hot-swap 75%)",
         bands={"mid": "mechanical, hot-swap, RGB", "entry": "mechanical TKL"}),
    _cat("mouse",
         [r"\b(mouse)\b"],
         spec=_MOUSE_SPEC, floors=[("mouse", 5.0)],
         hint="for mice name the type (wireless gaming, ergonomic)"),
    _cat("shoes",
         [r"\b(shoes?|sneakers?|boots?|sandal|heel|loafer|slipper|clog|running|"
          r"apparel|shirt|tee|tshirt|t-shirt|hoodie|jacket|coat|jeans|pants|"
          r"trousers|shorts|dress|skirt|suit|sweater|sweatshirt|leggings|socks|"
          r"saree|kurta|jersey|blazer|vest|uniform|glove|hat|cap|belt|swimsuit|"
          r"bikini|tracksuit|chinos|lingerie|underwear)\b"],
         size=True, spec=_SHOE_SPEC,
         floors=[("jordan", 50.0), ("hoka", 70.0), ("asics", 40.0),
                 ("new balance", 30.0), ("nike", 12.0), ("adidas", 12.0), ("shoes", 4.0)],
         hint="for shoes/apparel name the style and use (running, trail, formal)"),
    _cat("speaker",
         [r"\b(speaker|soundbar|echo|sonos|boombox|home theater)\b"],
         spec=_SPEAKER_SPEC,
         floors=[("sonos", 80.0), ("bose", 80.0), ("soundbar", 30.0),
                 ("echo", 15.0), ("jbl", 20.0), ("speaker", 10.0)],
         hint="for speakers name the type (smart, portable, soundbar)"),
    _cat("appliance",
         [r"\b(refrigerator|fridge|washer|dryer|dishwasher|microwave|air conditioner|"
          r"oven|stove|vacuum|toaster|air fryer)\b"],
         spec=_APPLIANCE_SPEC,
         floors=[("refrigerator", 100.0), ("washer", 150.0), ("dryer", 150.0),
                 ("dishwasher", 150.0), ("microwave", 30.0),
                 ("air conditioner", 80.0), ("vacuum", 30.0)],
         hint="for appliances name size/capacity and smart features"),
    _cat("generic", [r".*"],
         spec={}, floors=[], hint=""),
]

GENERIC = CATEGORIES[-1]


def detect_category(item: str) -> dict:
    """Map an item phrase to its category (generic fallback)."""
    t = (item or "").strip().lower()
    if not t:
        return GENERIC
    for cat in CATEGORIES[:-1]:
        if any(p.search(t) for p in cat["patterns"]):
            return cat
    return GENERIC


def category_name(item: str) -> str:
    return detect_category(item)["name"]


def is_complex(category: dict) -> bool:
    return bool(category.get("complex"))


def is_size_eligible(category: dict) -> bool:
    return bool(category.get("size"))


def band_specs(category: dict, max_price: float | None) -> str:
    """The spec tier a budget buys for this category (LLM/rule query hint)."""
    bands = category.get("bands") or {}
    if not bands:
        return ""
    if max_price and max_price > 0:
        if max_price >= 2000:
            return bands.get("high", "")
        if max_price >= 1200:
            return bands.get("upper_mid", bands.get("high", ""))
        if max_price >= 600:
            return bands.get("mid", "")
        return bands.get("entry", "")
    return bands.get("mid", "")


def band_name(category: dict, max_price: float | None) -> str:
    """The budget band label ('high' | 'upper_mid' | 'mid' | 'entry') — shared
    by query hints and ranking so both agree on what a budget buys."""
    bands = category.get("bands") or {}
    if not bands:
        return ""
    if max_price and max_price > 0:
        if max_price >= 2000:
            return "high"
        if max_price >= 1200:
            return "upper_mid"
        if max_price >= 600:
            return "mid"
        return "entry"
    return "mid"


def spec_tier_query(item: str, category: dict, max_price: float | None) -> str | None:
    """Rule-based fallback: 'laptop' + $2000 + gaming -> 'gaming laptop RTX 4070'.
    Only for complex categories with explicit band specs; skips bare chip labels
    ('i7', 'RTX') that carry no model info."""
    if not category.get("complex"):
        return None
    specs = band_specs(category, max_price)
    if not specs:
        return None
    head = specs.split(",")[0].strip()
    if len(head.split()) < 2:
        return None
    return f"{item} {specs}".strip()


def category_hint(category: dict) -> str:
    return category.get("hint", "")
