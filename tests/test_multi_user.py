"""Multi-user isolation + 3-way chat visibility (web app / desktop / SMS).

Each user gets a private mirror thread `priva_mirror_<uid>` that the web and
Electron apps poll; inbound SMS from the user's phone lands on that same
thread, and outbound replies are duplicated onto it — one conversation,
visible on every surface.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi.testclient import TestClient

import agent
import linq_client
import notes_store
import price_watch
import reminder_service
import server
import spending
import users


@pytest.fixture(autouse=True)
def _isolate(monkeypatch, tmp_path):
    import config
    import note_analyzer
    monkeypatch.setattr(note_analyzer, "NOTE_LLM", "")
    monkeypatch.setattr(config, "OPENAI_API_KEY", "")
    monkeypatch.setattr(users, "USERS_FILE", str(tmp_path / "users.json"))
    monkeypatch.setattr(server, "DEMO_MODE", True)
    monkeypatch.setattr(server, "LINQ_WEBHOOK_SECRET", "")
    monkeypatch.setattr(notes_store, "NOTES_FILE", str(tmp_path / "notes.json"))
    monkeypatch.setattr(notes_store, "OFFERS_FILE", str(tmp_path / "note_offers.json"))
    monkeypatch.setattr(price_watch, "WATCH_FILE", str(tmp_path / "watchlist.json"))
    monkeypatch.setattr(reminder_service, "REMINDERS_FILE", str(tmp_path / "reminders.json"))
    monkeypatch.setattr(spending, "BUDGET_FILE", str(tmp_path / "spending.json"))
    monkeypatch.setattr(agent, "_TXNS_FILE", str(tmp_path / "transactions.json"))
    agent.transaction_log.clear()
    linq_client._outbox.clear()
    linq_client._inbox.clear()

    async def fake_send(to, text, thread_id=""):
        linq_client._record(to, text, thread_id)
        return {}

    monkeypatch.setattr(server, "send_message", fake_send)
    yield
    agent.transaction_log.clear()
    linq_client._outbox.clear()
    linq_client._inbox.clear()


def _client():
    return TestClient(server.app)


def _register(client, phone, name):
    otp = client.post("/api/auth/otp", json={"phone": phone, "name": name}).json()["otp"]
    return client.post("/api/auth/verify", json={"phone": phone, "otp": otp}).json()


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _note(payload: dict) -> dict:
    return {
        "id": payload.get("id", "n1"),
        "title": payload.get("title", ""),
        "blocks": [{"id": "b1", "type": "text", "content": payload.get("text", "")}],
        "tags": [], "created_at": 0, "updated_at": 0,
    }


def test_notes_scoped_per_user():
    client = _client()
    alice = _register(client, "+19170000001", "Alice")
    bob = _register(client, "+19170000002", "Bob")
    res = client.post("/api/notes", json=_note({"id": "n_alice", "title": "buy running shoes"}),
                      headers=_auth(alice["token"]))
    assert res.status_code == 200
    assert res.json()["note"]["user_id"] == alice["user_id"]
    assert len(client.get("/api/notes", headers=_auth(alice["token"])).json()["notes"]) == 1
    assert len(client.get("/api/notes", headers=_auth(bob["token"])).json()["notes"]) == 0


def test_note_ownership_enforced():
    client = _client()
    alice = _register(client, "+19170000001", "Alice")
    bob = _register(client, "+19170000002", "Bob")
    client.post("/api/notes", json=_note({"id": "n_alice", "title": "laptop under 1000"}),
                headers=_auth(alice["token"]))
    assert client.put("/api/notes/n_alice", json=_note({"id": "n_alice", "title": "hacked"}),
                      headers=_auth(bob["token"])).status_code == 404
    assert client.delete("/api/notes/n_alice", headers=_auth(bob["token"])).status_code == 404
    assert len(client.get("/api/notes", headers=_auth(alice["token"])).json()["notes"]) == 1


def test_simulate_reply_lands_on_user_thread():
    client = _client()
    alice = _register(client, "+19170000001", "Alice")
    client.post("/api/linq/simulate-reply", json={"text": "buy running shoes under 60"},
                headers=_auth(alice["token"]))
    thread = f"priva_mirror_{alice['user_id']}"
    out = linq_client.outbox(thread)
    assert out, "outbound messages must land on the user's mirror thread"
    assert all(m["thread_id"] == thread for m in out)


def test_transcript_endpoint_scoped_to_user():
    client = _client()
    alice = _register(client, "+19170000001", "Alice")
    bob = _register(client, "+19170000002", "Bob")
    client.post("/api/linq/send", json={"text": "hello from web"}, headers=_auth(alice["token"]))
    alice_transcript = client.get("/api/linq/transcript", headers=_auth(alice["token"])).json()
    assert any("hello from web" in m["text"] for m in alice_transcript["messages"])
    bob_transcript = client.get("/api/linq/transcript", headers=_auth(bob["token"])).json()
    assert bob_transcript["messages"] == []
    assert bob_transcript["inbound"] == []


def test_webhook_inbound_mirrored_to_user_thread():
    client = _client()
    alice = _register(client, "+19170000001", "Alice")
    linq_client._outbox.clear()
    linq_client._inbox.clear()
    res = client.post("/priva/webhook", json={
        "event_type": "message.received",
        "event_id": "evt_abc123",
        "data": {
            "from": "+19170000001",
            "parts": [{"type": "text", "value": "hi priva"}],
        },
    })
    assert res.status_code == 200
    thread = f"priva_mirror_{alice['user_id']}"
    inbound = [m["text"] for m in linq_client.inbox(thread)]
    assert "hi priva" in inbound
    assert any(m["thread_id"] == thread for m in linq_client.outbox())


def test_send_records_to_registered_phone():
    client = _client()
    alice = _register(client, "+19170000001", "Alice")
    res = client.post("/api/linq/send", json={"text": "sneakers size 10"},
                      headers=_auth(alice["token"]))
    assert res.json()["thread_id"] == f"priva_mirror_{alice['user_id']}"
    entry = linq_client.outbox(f"priva_mirror_{alice['user_id']}")[-1]
    assert entry["to"] == "+19170000001"


def test_watchlist_and_reminders_scoped():
    client = _client()
    alice = _register(client, "+19170000001", "Alice")
    bob = _register(client, "+19170000002", "Bob")
    client.post("/api/reminders", json={"text": "water plants", "due_at": int(__import__("time").time()) + 3600},
                headers=_auth(alice["token"]))
    assert len(client.get("/api/reminders", headers=_auth(alice["token"])).json()["reminders"]) == 1
    assert len(client.get("/api/reminders", headers=_auth(bob["token"])).json()["reminders"]) == 0


def test_local_user_transactions_exclude_web_users():
    from models import Product
    agent.log_transaction("+19170000001", Product(id="p1", title="x", price=10, merchant="m"))
    agent.log_transaction("u_alice", Product(id="p2", title="y", price=20, merchant="m"))
    txns = agent.get_transactions("local")
    assert [t["user_id"] for t in txns] == ["+19170000001"]
    assert [t["user_id"] for t in agent.get_transactions("u_alice")] == ["u_alice"]


def test_admin_endpoints_gated_and_list_users():
    client = _client()
    alice = _register(client, "+19170000001", "Alice")
    assert client.get("/api/admin/users", headers=_auth(alice["token"])).status_code == 403
    assert client.get("/api/admin/users").status_code == 403
    client.post("/api/notes", json=_note({"id": "n_alice", "title": "buy a monitor"}),
                headers=_auth(alice["token"]))
    users.PRIVA_ADMIN_ADDRESS = "+19170000000"
    admin = _register(client, "+19170000000", "Sachitt")
    assert admin["is_admin"] is True
    res = client.get("/api/admin/users", headers=_auth(admin["token"]))
    assert res.status_code == 200
    entry = next(u for u in res.json()["users"] if u["user_id"] == alice["user_id"])
    assert entry["name"] == "Alice"
    assert entry["notes"] == 1
    t = client.get(f"/api/admin/users/{alice['user_id']}/transcript", headers=_auth(admin["token"]))
    assert t.status_code == 200
    assert client.get("/api/admin/activity", headers=_auth(admin["token"])).status_code == 200
