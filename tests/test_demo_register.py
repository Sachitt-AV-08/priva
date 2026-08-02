"""Tests for the public web-demo endpoints: analyze-text + phone registration."""
import json
import os
import re as _re

import pytest

import server


@pytest.fixture(autouse=True)
def _reset_override(monkeypatch, tmp_path):
    import config
    import note_analyzer
    import users
    monkeypatch.setattr(note_analyzer, "NOTE_LLM", "")
    monkeypatch.setattr(config, "OPENAI_API_KEY", "")
    monkeypatch.setattr(users, "USERS_FILE", str(tmp_path / "users.json"))
    server._ADDRESS_OVERRIDE_FILE = str(tmp_path / "user_address_override.json")
    server._user_address_override = ""
    yield


def _client():
    from fastapi.testclient import TestClient
    return TestClient(server.app)


def test_analyze_text_detects_buy_intent():
    res = _client().post("/api/notes/analyze-text", json={
        "id": "t1", "title": "need a usb-c hub for travel, under 300",
        "blocks": [{"id": "b1", "type": "text", "content": ""}],
        "tags": [], "created_at": 0, "updated_at": 0,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["category"] == "shopping"
    assert any("usb" in it["item"].lower() for it in data["buy_intents"])
    assert data["buy_intents"][0]["price_hint"] == 300


def test_analyze_text_todos_and_category():
    res = _client().post("/api/notes/analyze-text", json={
        "id": "t2", "title": "weekend",
        "blocks": [{"id": "b1", "type": "text", "content": "call the dentist\ngym tomorrow at 7am"}],
        "tags": [], "created_at": 0, "updated_at": 0,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["category"] == "health"
    assert any("dentist" in t for t in data["todos"])
    assert any("gym" in r["text"] for r in data["reminders"])


def test_register_phone_requires_valid_number():
    client = _client()
    assert client.post("/api/demo/register-phone", json={"phone": ""}).status_code == 400
    assert client.post("/api/demo/register-phone", json={"phone": "12"}).status_code == 400
    assert client.post("/api/demo/register-phone", json={"phone": "abc"}).status_code == 400


def test_register_phone_normalizes_and_persists(tmp_path):
    client = _client()
    res = client.post("/api/demo/register-phone", json={"phone": "1 917 384 2736", "send_test": False})
    assert res.status_code == 200
    body = res.json()
    assert body["address"] == "+19173842736"
    assert body["registered"] is True
    assert server.outgoing_address() == "+19173842736"
    assert os.path.exists(server._ADDRESS_OVERRIDE_FILE)


def test_register_phone_status_endpoint():
    client = _client()
    status = client.get("/api/demo/register-phone").json()
    assert status["registered"] is False
    client.post("/api/demo/register-phone", json={"phone": "917384273605", "send_test": False})
    status = client.get("/api/demo/register-phone").json()
    assert status["registered"] is True
    assert status["effective"] == "+917384273605"
