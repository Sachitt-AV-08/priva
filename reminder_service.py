"""Reminder store + asyncio scheduler that fires due reminders via Linq."""
import asyncio
import json
import os
import time
import uuid

from linq_client import send_message
from config import LINQ_USER_ADDRESS

REMINDERS_FILE = os.path.join(os.path.dirname(__file__), "reminders.json")


def _load() -> list:
    try:
        with open(REMINDERS_FILE, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return []


def _save(data: list):
    try:
        tmp = REMINDERS_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2)
        os.replace(tmp, REMINDERS_FILE)
    except OSError:
        pass


def add_reminder(text: str, due_at: int, note_id: str = "", channel: str = "linq+toast") -> dict:
    reminder = {
        "id": f"rem_{uuid.uuid4().hex[:10]}",
        "note_id": note_id,
        "text": text,
        "due_at": int(due_at),
        "channel": channel,
        "fired": False,
        "created_at": int(time.time()),
    }
    reminders = _load()
    reminders.append(reminder)
    _save(reminders)
    return reminder


def list_reminders(include_fired: bool = False) -> list:
    reminders = _load()
    if not include_fired:
        reminders = [r for r in reminders if not r.get("fired")]
    return sorted(reminders, key=lambda r: r["due_at"])


def cancel_reminder(reminder_id: str) -> bool:
    reminders = _load()
    kept = [r for r in reminders if r["id"] != reminder_id]
    if len(kept) == len(reminders):
        return False
    _save(kept)
    return True


def _mark_fired(reminder_id: str):
    reminders = _load()
    for r in reminders:
        if r["id"] == reminder_id:
            r["fired"] = True
            r["fired_at"] = int(time.time())
            break
    _save(reminders)


def _outgoing_address() -> str:
    return LINQ_USER_ADDRESS


class ReminderScheduler:
    """Background task: every 20s, fire due reminders (Linq text when address known)."""

    def __init__(self):
        self._task: asyncio.Task | None = None
        self.address_fn = None

    def start(self):
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run())

    async def _run(self):
        while True:
            try:
                await self._tick()
            except Exception:
                pass
            await asyncio.sleep(20)

    async def _tick(self):
        now = int(time.time())
        due = [r for r in list_reminders(include_fired=True) if not r.get("fired") and r.get("due_at", 0) <= now]
        for reminder in due:
            address = self.address_fn() if self.address_fn else (LINQ_USER_ADDRESS or "")
            if address:
                try:
                    await send_message(address, f"⏰ Reminder: {reminder['text']}", "")
                except Exception:
                    pass
            _mark_fired(reminder["id"])


scheduler = ReminderScheduler()
