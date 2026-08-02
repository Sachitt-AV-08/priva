"""JSON-file-backed notes store with buy-offer dedupe."""
import json
import os
import time

DATA_DIR = os.path.dirname(__file__)
NOTES_FILE = os.path.join(DATA_DIR, "notes.json")
OFFERS_FILE = os.path.join(DATA_DIR, "note_offers.json")


def _load(path: str) -> list:
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return []


def _save(path: str, data):
    try:
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2)
        os.replace(tmp, path)
    except OSError:
        pass


def list_notes(user_id: str = "") -> list[dict]:
    notes = _load(NOTES_FILE)
    if user_id:
        return [n for n in notes if n.get("user_id") == user_id]
    return notes


def get_note(note_id: str, user_id: str = "") -> dict | None:
    note = next((n for n in list_notes() if n.get("id") == note_id), None)
    if note and user_id and note.get("user_id") != user_id:
        return None
    return note


def save_note(note: dict, user_id: str = "local") -> dict:
    notes = list_notes()
    note["user_id"] = user_id or note.get("user_id", "local")
    note["updated_at"] = int(note.get("updated_at", time.time()))
    for i, n in enumerate(notes):
        if n.get("id") == note["id"]:
            notes[i] = note
            _save(NOTES_FILE, notes)
            return note
    notes.insert(0, note)
    _save(NOTES_FILE, notes)
    return note


def delete_note(note_id: str) -> bool:
    notes = list_notes()
    kept = [n for n in notes if n.get("id") != note_id]
    if len(kept) == len(notes):
        return False
    _save(NOTES_FILE, kept)
    return True


def was_offered(note_id: str, item: str) -> bool:
    offers = _load(OFFERS_FILE)
    return any(o.get("note_id") == note_id and o.get("item", "").lower() == item.lower() for o in offers)


def recently_offered(note_id: str, window_secs: int = 600) -> bool:
    """True if ANY offer was sent for this note within the cooldown window.

    Stops per-keystroke note saves from firing a fresh SMS for every
    intermediate version of an item phrase ("running" -> "running shoes").
    """
    cutoff = int(time.time()) - window_secs
    offers = _load(OFFERS_FILE)
    return any(o.get("note_id") == note_id and o.get("offered_at", 0) >= cutoff for o in offers)


def mark_offered(note_id: str, item: str, thread_id: str = ""):
    offers = _load(OFFERS_FILE)
    offers.append({
        "note_id": note_id,
        "item": item,
        "thread_id": thread_id,
        "offered_at": int(time.time()),
    })
    _save(OFFERS_FILE, offers)
