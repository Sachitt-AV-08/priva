"""User registry + OTP auth store (JSON-backed).

Registration: name + phone + OTP. Phone is the only identity key; OTPs are
delivered by Linq SMS (inline in DEMO_MODE). Tokens are 7-day bearer tokens
used by the web app, the Electron app, and the admin view.
"""
import json
import os
import random
import re
import secrets
import time
import uuid

from config import PRIVA_ADMIN_ADDRESS

USERS_FILE = os.path.join(os.path.dirname(__file__), "users.json")

OTP_TTL = 600          # seconds an OTP stays valid
TOKEN_TTL = 7 * 86400  # seconds a bearer token stays valid


def _load() -> list:
    try:
        with open(USERS_FILE, encoding="utf-8") as fh:
            data = json.load(fh)
            if isinstance(data, list):
                return data
    except (OSError, json.JSONDecodeError):
        pass
    return []


def _save(users: list):
    try:
        tmp = USERS_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(users, fh, indent=2)
        os.replace(tmp, USERS_FILE)
    except OSError:
        pass


def normalize_phone(phone: str) -> str:
    """'+1 202 555 0100' -> '+12025550100'; '' when invalid."""
    digits = re.sub(r"\D", "", str(phone or ""))
    if not re.match(r"^[1-9]\d{7,14}$", digits):
        return ""
    return "+" + digits


def get_or_create(phone: str, name: str = "") -> dict:
    """Find the user by normalized phone, or create one (name captured at first signup)."""
    phone = normalize_phone(phone)
    users = _load()
    for u in users:
        if u.get("phone") == phone:
            if name and not u.get("name"):
                u["name"] = name.strip()
                _save(users)
            return u
    user = {
        "user_id": "u_" + uuid.uuid4().hex[:10],
        "name": (name or "").strip(),
        "phone": phone,
        "otp": "",
        "otp_expiry": 0,
        "token": "",
        "token_expiry": 0,
        "is_admin": bool(PRIVA_ADMIN_ADDRESS and phone == normalize_phone(PRIVA_ADMIN_ADDRESS)),
        "created_at": int(time.time()),
        "last_active": int(time.time()),
    }
    users.append(user)
    _save(users)
    return user


def issue_otp(phone: str, name: str = "") -> dict:
    """Set a fresh 6-digit OTP for the user (creates the user if new)."""
    user = get_or_create(phone, name)
    users = _load()
    for u in users:
        if u["user_id"] == user["user_id"]:
            u["otp"] = f"{random.randint(0, 999999):06d}"
            u["otp_expiry"] = int(time.time()) + OTP_TTL
            break
    _save(users)
    return user_by_id(user["user_id"])


def mint_token(user_id: str) -> dict | None:
    """DEMO flow: issue a fresh bearer token for an existing user (QR deep-link)."""
    users = _load()
    for u in users:
        if u.get("user_id") != user_id:
            continue
        u["token"] = secrets.token_hex(24)
        u["token_expiry"] = int(time.time()) + TOKEN_TTL
        u["last_active"] = int(time.time())
        _save(users)
        return u
    return None


def verify_otp(phone: str, otp: str) -> dict | None:
    """Check the OTP; on success rotate in a fresh bearer token and clear the OTP."""
    phone = normalize_phone(phone)
    users = _load()
    for u in users:
        if u.get("phone") != phone:
            continue
        if not u.get("otp") or not otp or u.get("otp") != str(otp).strip():
            return None
        if int(time.time()) > int(u.get("otp_expiry", 0)):
            return None
        u["otp"] = ""
        u["otp_expiry"] = 0
        u["token"] = secrets.token_hex(24)
        u["token_expiry"] = int(time.time()) + TOKEN_TTL
        u["last_active"] = int(time.time())
        _save(users)
        return u
    return None


def user_by_token(token: str) -> dict | None:
    if not token:
        return None
    users = _load()
    for u in users:
        if u.get("token") == token:
            if int(time.time()) > int(u.get("token_expiry", 0)):
                continue
            u["last_active"] = int(time.time())
            _save(users)
            return u
    return None


def user_by_phone(phone: str) -> dict | None:
    phone = normalize_phone(phone)
    return next((u for u in _load() if u.get("phone") == phone), None)


def user_by_id(user_id: str) -> dict | None:
    return next((u for u in _load() if u.get("user_id") == user_id), None)


def phone_for(user_id: str) -> str:
    """Resolve a user_id to its registered phone ("" when unknown).

    Also passes through raw phone strings (SMS-only 'local' flow stores the
    phone as the transaction user_id).
    """
    if not user_id:
        return ""
    user = user_by_id(user_id)
    if user:
        return user.get("phone", "")
    if isinstance(user_id, str) and user_id.startswith("+"):
        return user_id
    return ""


def list_users() -> list:
    return _load()


def public_user(u: dict) -> dict:
    """A user dict safe to return to clients (no OTP/token internals)."""
    return {
        "user_id": u.get("user_id"),
        "name": u.get("name", ""),
        "phone": u.get("phone", ""),
        "is_admin": bool(u.get("is_admin")),
        "created_at": u.get("created_at"),
        "last_active": u.get("last_active"),
    }
