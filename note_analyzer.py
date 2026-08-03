"""Rule-based note analysis engine with optional LLM enhancement.

Extracts buy intents (with price hints), todo candidates, and reminder
cues (natural-language times) from a note's text. Deterministic and
offline by default; NOTE_LLM env can point to an OpenAI-compatible
endpoint for enhanced summaries (falls back to rules on any failure).
"""
import re
import time
from datetime import datetime, timedelta
from typing import Optional

import httpx

from config import NOTE_LLM
from preferences import extract_preferences

_WEEKDAYS = {
    "monday": 0, "mon": 0, "tuesday": 1, "tue": 1, "wednesday": 2, "wed": 2,
    "thursday": 3, "thu": 3, "friday": 4, "fri": 4, "saturday": 5, "sat": 5,
    "sunday": 6, "sun": 6,
}

_BUY_VERBS = r"(?:need to (?:buy|get|order|pick up)|want(?:s)? to (?:buy|get|order|pick up)|want(?:s)? (?:a|an|the|new)?\s*|gonna buy|going to buy|get me|buy|order|pick up|look(?:ing)? for|out of|low on|need a|need an|need new|need to restock|restock)"
_IGNORE_PREFIX = r"(?:don'?t|do not|won'?t|not|never|no)\s+buy"

_PRICE_RE = re.compile(r"(?:under|less than|max|budget(?: of)?|below|around)\s*\$?\s*(\d+(?:\.\d+)?)", re.I)
_TIME_RE = re.compile(
    r"(?:at\s+)?(\d{1,2}):(\d{2})\s*(am|pm)?\b|"
    r"(?:at\s+)?(\d{1,2})\s*(am|pm)\b|"
    r"(tomorrow|tonight|now|in\s+(\d+)\s*(?:h|hr|hrs|hour|hours|min|mins|minute|minutes))\b|"
    r"\b(" + "|".join(_WEEKDAYS) + r")\b",
    re.I,
)


def _note_text(title: str, blocks: list) -> str:
    parts = [title]
    for b in blocks:
        if isinstance(b, dict):
            content = str(b.get("content", ""))
        else:
            content = str(getattr(b, "content", b))
        if content:
            parts.append(content)
    return "\n".join(parts)


def _parse_price_hint(text: str) -> Optional[float]:
    m = _PRICE_RE.search(text)
    return float(m.group(1)) if m else None


_SHOP_TITLE_RE = re.compile(r"\b(shopping|grocery|groc? list|buy(?:ing)? list|to\s*buy|purchases?|wishlist|shopping list)\b", re.I)
# verbs that signal an action line (todo), not a bare shopping item
_BARE_ITEM_SKIP_VERBS = re.compile(
    r"\b(call|email|text|message|submit|finish|complete|pay|renew|cancel|book|schedule|"
    r"take|fix|clean|prepare|write|download|install|register|file|return|meet|send|"
    r"check|review|follow up|confirm|reserve|collect|drop off|apply|cook|make|buy|get|"
    r"order|pick|look|need|want|find|visit|read|watch|study)\b",
    re.I,
)


def _looks_like_bare_item(line: str) -> bool:
    """A short noun-phrase line with no action verbs, e.g. 'soccer ball' / 'vase'."""
    words = line.split()
    if not 1 <= len(words) <= 8:
        return False
    if not any(ch.isalnum() for ch in line):
        return False
    if re.search(r"\d{1,2}:\d{2}|am\b|pm\b|tomorrow|tonight|now\b", line, re.I):
        return False
    if _BARE_ITEM_SKIP_VERBS.search(line):
        return False
    # sentence with more than one clause / trailing action phrasing
    if re.search(r"\b(and|but|so|because|before|by|until)\b.*\b(v|go|do|buy|pay|call|send|make)\b", line, re.I):
        return False
    return True


def _extract_buy_intents(text: str, title: str = "") -> list:
    title_signal = bool(_SHOP_TITLE_RE.search(title or ""))
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    # The title itself is a shopping signal, never a shopping item.
    title_line = (title or "").strip()
    bare_lines = [ln for ln in lines if ln != title_line and _looks_like_bare_item(ln)]
    # A bare item is a buy intent when the title is shopping-flavoured, or the
    # note is mostly bare items (>=2), i.e. an implicit shopping list.
    implicit_list = title_signal or len(bare_lines) >= 2
    intents = []
    for line in lines:
        if re.match(_IGNORE_PREFIX, line, re.I):
            continue
        # todo-prefixed lines are todos, not buys
        if re.match(r"^[-*]?\s*\[[ xX]\]|^todo:|^to do:", line, re.I):
            continue
        m = re.search(
            r"(?<![a-z])(?:need to (?:buy|get|order|pick up)|want(?:s)? to (?:buy|get|order|pick up)|"
            r"want(?:s)?\s+(?!to\b)(?:a|an|the|new)?\s*|get me|gonna buy|going to buy|"
            r"buy(?: a| an| the| new)?|order(?: a| an| the| new)?|"
            r"pick up(?: a| an| the| new)?|look(?:ing)? for(?: a| an| the| new)?|"
            r"out of|low on|need (?:a|an|the|new)?|restock)(.+)$",
            line, re.I,
        )
        item = ""
        raw = line
        if m:
            item = m.group(1).strip(" .:;–-")
        elif implicit_list and line in bare_lines:
            item = line
        if item:
            item = re.split(r"\s+(?:under|less than|before|by|for\s+\$\d|since)\b", item, flags=re.I)[0].strip()
            item = re.sub(r"^(?:a|an|the)\s+", "", item, flags=re.I)
            item = re.sub(r"\s+", " ", item)
        if not item or len(item) > 60:
            continue
        if not any(ch.isalnum() for ch in item):
            continue
        if re.search(r"(?:prescription|medicine|medication|meds|dry clean|laundry)\b", item, re.I):
            continue
        intents.append({
            "item": item,
            "price_hint": _parse_price_hint(line),
            "prefs": extract_preferences(line),
            "raw": raw,
        })
    # dedupe by item
    seen, unique = set(), []
    for it in intents:
        key = it["item"].lower()
        if key not in seen:
            seen.add(key)
            unique.append(it)
    return unique


_TODO_VERBS = re.compile(
    r"^(?:call|email|text|message|submit|finish|complete|pay|renew|cancel|book|schedule|"
    r"take|fix|clean|prepare|write|download|install|register|file|return|meet|send|"
    r"check|review|follow up|confirm|reserve|collect|drop off|pick up prescription|apply)",
    re.I,
)


def _extract_todos(text: str, buy_intents: list) -> list:
    buy_items = {it["item"].lower() for it in buy_intents}
    buy_lines = {it["raw"].strip().lower() for it in buy_intents}
    todos = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.lower() in buy_lines:
            continue
        if re.match(r"^[-*]?\s*\[ \]", line):
            todos.append(re.sub(r"^[-*]?\s*\[ \]\s*", "", line))
            continue
        if re.match(r"^todo:|^to do:", line, re.I):
            todos.append(re.sub(r"^(?:todo|to do):\s*", "", line, flags=re.I))
            continue
        if _TODO_VERBS.match(line) and line.lower() not in buy_items:
            todos.append(line)
    return todos[:8]


def _next_weekday(target: int, base: datetime) -> datetime:
    days = (target - base.weekday()) % 7
    if days == 0:
        days = 7
    return base + timedelta(days=days)


def _parse_reminder_time(text: str) -> Optional[dict]:
    found = None
    for m in _TIME_RE.finditer(text):
        hh = mm = tz = None
        if m.group(1):  # HH:MM (colon required)
            hh, mm = int(m.group(1)), int(m.group(2))
            tz = (m.group(3) or "").lower()
        elif m.group(4):  # HHam
            hh, mm = int(m.group(4)), 0
            tz = (m.group(5) or "").lower()
        elif m.group(6):  # keyword
            kw = m.group(6).lower()
            if m.group(7):
                return {"kind": "in", "amount": int(m.group(7))}
            return {"kind": kw, "amount": 0}
        else:  # weekday name
            return {"kind": "weekday", "day": _WEEKDAYS[m.group(8).lower()]}
        if hh is not None:
            if tz == "pm" and hh < 12:
                hh += 12
            if tz == "am" and hh == 12:
                hh = 0
            return {"kind": "clock", "hour": hh, "minute": mm}
    return found


def _resolve_due(cue: dict, base: Optional[datetime] = None) -> Optional[float]:
    now = base or datetime.now()
    kind = cue.get("kind")
    if kind == "clock":
        due = now.replace(hour=cue["hour"], minute=cue["minute"], second=0, microsecond=0)
        if due <= now:
            due += timedelta(days=1)
    elif kind == "tomorrow":
        due = (now + timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
    elif kind == "tonight":
        due = now.replace(hour=21, minute=0, second=0, microsecond=0)
    elif kind == "now":
        due = now + timedelta(minutes=5)
    elif kind == "in":
        unit = cue.get("amount", 0)
        due = now + timedelta(minutes=unit)  # caller adjusts hours
    elif kind == "weekday":
        due = _next_weekday(cue["day"], now).replace(hour=9, minute=0, second=0, microsecond=0)
    else:
        return None
    return due.timestamp()


def _extract_reminders(text: str) -> list:
    reminders = []
    for line in text.splitlines():
        if not _TIME_RE.search(line):
            continue
        cue = _parse_reminder_time(line)
        if not cue:
            continue
        # "in N hours/minutes" — adjust
        due = _resolve_due(cue)
        if cue["kind"] == "in" and cue["amount"]:
            unit = "hour" if re.search(r"(\d+)\s*h", line, re.I) else "minute"
            due = (datetime.now() + timedelta(**{unit + "s": cue["amount"]})).timestamp()
        if not due:
            continue
        reminders.append({"text": line.strip()[:120], "due_at": int(due), "parsed_from": line.strip()[:120]})
    return reminders


def _categorize(text: str, buy_intents: list, todos: list) -> str:
    low = text.lower()
    if buy_intents:
        return "shopping"
    if any(w in low for w in ("doctor", "dentist", "gym", "medicine", "appointment", "workout", "health")):
        return "health"
    if any(w in low for w in ("meeting", "deadline", "project", "assignment", "report", "client", "email", "interview")):
        return "work"
    if todos:
        return "personal"
    return "general"


def analyze_note(note: dict) -> dict:
    title = str(note.get("title", ""))
    blocks = note.get("blocks", [])
    text = _note_text(title, blocks)
    buy_intents = _extract_buy_intents(text, title)
    todos = _extract_todos(text, buy_intents)
    reminders = _extract_reminders(text)
    category = _categorize(text, buy_intents, todos)
    first_text = next((b.get("content", "") for b in blocks if isinstance(b, dict) and b.get("content", "").strip()), "")
    summary = " ".join((title or first_text).split())[:80]
    return {
        "buy_intents": buy_intents,
        "todos": todos,
        "reminders": reminders,
        "category": category,
        "summary": summary or "Untitled note",
    }


async def analyze_note_llm(note: dict) -> dict:
    """Enhanced analysis via NOTE_LLM (OpenAI-compatible) or OpenAI directly. Falls back to rules."""
    from config import OPENAI_API_KEY, LLM_MODEL
    base_url = (NOTE_LLM or "https://api.openai.com").rstrip("/")
    if not NOTE_LLM and not OPENAI_API_KEY:
        return analyze_note(note)
    model = LLM_MODEL or ("gpt-4o-mini" if "api.openai.com" in base_url else "coda-note-analyzer")
    headers = {"Authorization": f"Bearer {OPENAI_API_KEY}"} if OPENAI_API_KEY else {}
    try:
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": (
                    "You analyze a user's personal note. Return ONLY JSON: "
                    '{"buy_intents":[{"item","price_hint","raw"}],"todos":[str],'
                    '"reminders":[{"text","due_at","parsed_from"}],"category":"shopping|work|personal|health|general",'
                    '"summary":"one line"}'
                    " If the note is a shopping list (even bare item names like "
                    "'soccer ball', 'vase', 'soap' with no buy verbs, or a title like "
                    "'Shopping list'), return EACH item as a buy_intent."
                )},
                {"role": "user", "content": str(note)},
            ],
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
        }
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(base_url + "/v1/chat/completions", json=payload, headers=headers)
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"]
        start, end = content.find("{"), content.rfind("}")
        import json
        parsed = json.loads(content[start:end + 1])
        base = analyze_note(note)
        for key in ("buy_intents", "todos", "reminders", "category", "summary"):
            if key in parsed and parsed[key]:
                base[key] = parsed[key]
        for it in base.get("buy_intents", []):
            it["prefs"] = extract_preferences(it.get("raw", ""))
            ph = it.get("price_hint")
            if isinstance(ph, str):
                m = _PRICE_RE.search(ph) or re.search(r"\d+(?:\.\d+)?", ph)
                it["price_hint"] = (
                    float(m.group(1) if m and m.group(1) else m.group(0)) if m else None
                )
        return base
    except Exception:
        return analyze_note(note)


_URGENCY_RE = re.compile(
    r"\b(before|by|ahead of|in time for|needed (by|for)|need it|urgent|asap|right away|"
    r"immediately|tonight|today|tomorrow|this week|this weekend|this evening|"
    r"soon|quickly|quick|emergency|flight|trip|travel|deadline|"
    r"running out|low on|out of)\b"
    r"|\bin \d+ (minutes?|hours?)\b",
    re.I,
)


def detect_urgency(text: str) -> bool:
    """True when a note clearly expresses time pressure (flight today, ASAP, ...).

    Used to decide whether PRIVA texts immediately (urgent) or waits the
    long NOTE_OFFER_DELAY (normal shopping intent).
    """
    if not text:
        return False
    return bool(_URGENCY_RE.search(text))
