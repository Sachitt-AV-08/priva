"""Tests for the Linq mirror transcript: inbound recording, endpoint shape, persistence."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi.testclient import TestClient

import linq_client
from linq_client import inbox, outbox, record_inbound


@pytest.fixture(autouse=True)
def clear_deques():
    linq_client._outbox.clear()
    linq_client._inbox.clear()
    yield
    linq_client._outbox.clear()
    linq_client._inbox.clear()


def test_record_inbound_roundtrip():
    record_inbound("+10000000000", "YES", "priva_mirror")
    record_inbound("+10000000000", "M", "priva_mirror")
    msgs = inbox("priva_mirror")
    assert [m["text"] for m in msgs] == ["YES", "M"]
    assert all(m["from"] == "+10000000000" for m in msgs)
    assert all(m["ts"] > 0 for m in msgs)
    assert outbox() == []


def test_inbox_outbox_separate_threads():
    record_inbound("+1", "hi", "thread_a")
    linq_client._record("+2", "hello", "thread_a")
    linq_client._record("+2", "world", "thread_b")
    assert len(inbox("thread_a")) == 1
    assert len(outbox("thread_a")) == 1
    assert len(outbox("thread_b")) == 1
    assert inbox("thread_b") == []


def test_transcript_persists_across_reload(tmp_path, monkeypatch):
    monkeypatch.setattr(linq_client, "_TRANSCRIPT_FILE", str(tmp_path / "transcript.json"))
    record_inbound("+1", "persist me", "priva_mirror")
    linq_client._record("+2", "reply", "priva_mirror")
    linq_client._outbox.clear()
    linq_client._inbox.clear()
    linq_client._load_transcript()
    assert [m["text"] for m in inbox()] == ["persist me"]
    assert [m["text"] for m in outbox()] == ["reply"]


def test_transcript_endpoint_returns_both_lists(tmp_path, monkeypatch):
    monkeypatch.setattr(linq_client, "_TRANSCRIPT_FILE", str(tmp_path / "transcript.json"))
    import server as srv
    srv.conversations["trx_t1"] = {
        "step": "note_offer", "pending_item": "usb hub", "price_hint": None,
        "note_id": "trx1", "from": "user@priva.app",
    }
    with TestClient(srv.app) as client:
        r = client.post("/api/linq/simulate-reply", json={"text": "NO", "thread_id": "trx_t1"})
        assert r.status_code == 200
        r = client.get("/api/linq/transcript?thread_id=trx_t1")
        assert r.status_code == 200
        body = r.json()
        assert any(m["text"] == "NO" and m.get("from") for m in body["inbound"])
        assert all(m["thread_id"] == "trx_t1" for m in body["inbound"])
        assert "messages" in body  # outbound list preserved for compatibility
    srv.conversations.pop("trx_t1", None)
