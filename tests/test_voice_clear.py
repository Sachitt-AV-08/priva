"""Clear-chat + voice endpoint tests (model inference mocked — fast, offline)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi.testclient import TestClient

import linq_client
from linq_client import clear_thread, inbox, outbox, record_inbound


@pytest.fixture(autouse=True)
def clear_deques():
    linq_client._outbox.clear()
    linq_client._inbox.clear()
    yield
    linq_client._outbox.clear()
    linq_client._inbox.clear()


@pytest.fixture()
def client(monkeypatch):
    import server as srv
    monkeypatch.setattr(srv, "NOTE_OFFER_DELAY", 0)
    with TestClient(srv.app) as tc:
        yield tc


def test_clear_thread_only_removes_target_thread():
    record_inbound("+1", "hi", "thread_a")
    linq_client._record("+2", "hello", "thread_a")
    linq_client._record("+2", "other", "thread_b")
    removed = clear_thread("thread_a")
    assert removed == 2
    assert inbox() == []
    assert outbox("thread_a") == []
    assert [m["text"] for m in outbox("thread_b")] == ["other"]


def test_clear_thread_persists(tmp_path, monkeypatch):
    monkeypatch.setattr(linq_client, "_TRANSCRIPT_FILE", str(tmp_path / "transcript.json"))
    linq_client._record("+2", "keep", "thread_b")
    record_inbound("+1", "drop", "thread_a")
    clear_thread("thread_a")
    linq_client._outbox.clear()
    linq_client._inbox.clear()
    linq_client._load_transcript()
    assert [m["text"] for m in outbox()] == ["keep"]
    assert inbox() == []


def test_clear_endpoint_returns_removed_count(client):
    record_inbound("+1", "drop me", "priva_mirror")
    r = client.delete("/api/linq/transcript?thread_id=priva_mirror")
    assert r.status_code == 200
    assert r.json() == {"ok": True, "removed": 1}


def test_voice_stt_too_short_returns_400(client):
    r = client.post("/api/voice/stt", content=b"\x00\x00")
    assert r.status_code == 400


def test_voice_stt_transcribes(monkeypatch, client):
    import voice as voice_mod
    monkeypatch.setattr(voice_mod, "transcribe_pcm16", lambda data: "buy me running shoes")
    pcm = b"\x00\x00" * 5000
    r = client.post("/api/voice/stt", content=pcm)
    assert r.status_code == 200
    assert r.json()["text"] == "buy me running shoes"


def test_voice_stt_surfaces_errors(monkeypatch, client):
    import voice as voice_mod
    monkeypatch.setattr(voice_mod, "transcribe_pcm16", lambda data: (_ for _ in ()).throw(RuntimeError("boom")))
    pcm = b"\x00\x00" * 5000
    r = client.post("/api/voice/stt", content=pcm)
    assert r.status_code == 500
    assert "boom" in r.json()["detail"]


def test_voice_tts_returns_audio(monkeypatch, client):
    import voice as voice_mod

    async def fake_synth(text):
        return b"ID3fake-mp3"

    monkeypatch.setattr(voice_mod, "synthesize", fake_synth)
    r = client.get("/api/voice/tts", params={"text": "hello"})
    assert r.status_code == 200
    assert r.content == b"ID3fake-mp3"


def test_voice_tts_empty_returns_400(client):
    r = client.get("/api/voice/tts", params={"text": "   "})
    assert r.status_code == 400
