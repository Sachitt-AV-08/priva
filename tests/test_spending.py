"""Tests for PRIVA spend budget + ledger + API endpoints."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi.testclient import TestClient

import spending


@pytest.fixture(autouse=True)
def isolated_store(tmp_path, monkeypatch):
    monkeypatch.setattr(spending, "BUDGET_FILE", str(tmp_path / "spending.json"))
    yield
    monkeypatch.delattr(spending, "BUDGET_FILE", raising=False)


def test_set_and_get_budget():
    assert spending.get_budget() is None
    spending.set_budget(150)
    assert spending.get_budget() == 150.0
    spending.set_budget(0)  # falsy but valid
    assert spending.get_budget() == 0.0


def test_record_purchase_and_monthly_spend():
    spending.record_purchase("adidas shoe", "adidas", 35.0, "txn1")
    spending.record_purchase("soap", "amazon", 12.5, "txn2")
    assert spending.spent_this_month() == 47.5
    assert len(spending.purchases()) == 2


def test_remaining_and_would_exceed():
    spending.set_budget(100)
    spending.record_purchase("a", "m1", 30.0)
    assert spending.remaining() == 70.0
    exceeds, after = spending.would_exceed(50.0)
    assert exceeds is False
    assert after == 20.0
    exceeds, after = spending.would_exceed(80.0)
    assert exceeds is True
    assert after == -10.0


def test_would_exceed_without_limit():
    exceeds, after = spending.would_exceed(500.0)
    assert exceeds is False
    assert after is None
    assert spending.remaining() is None


def test_analysis_shape_and_merchants():
    spending.set_budget(200)
    spending.record_purchase("k1", "kroger", 10.0)
    spending.record_purchase("k2", "kroger", 15.0)
    spending.record_purchase("n1", "nike", 90.0)
    a = spending.analysis()
    assert a["monthly_limit"] == 200.0
    assert a["spent_this_month"] == 115.0
    assert a["remaining"] == 85.0
    assert a["purchase_count"] == 3
    assert a["avg_purchase"] == pytest.approx(round(115.0 / 3, 2))
    top = a["by_merchant"]
    assert top[0]["merchant"] == "nike"  # highest total first
    assert top[0]["total"] == 90.0
    assert len(a["by_day"]) <= 7
    assert all("day" in d and "total" in d for d in a["by_day"])


def test_api_budget_get_put_and_analysis(tmp_path, monkeypatch):
    monkeypatch.setattr(spending, "BUDGET_FILE", str(tmp_path / "spending.json"))
    from server import app
    client = TestClient(app)
    r = client.get("/api/budget")
    assert r.status_code == 200
    body = r.json()
    assert body["limit"] is None
    r = client.put("/api/budget", json={"limit": 75})
    assert r.status_code == 200
    assert r.json()["limit"] == 75.0
    r = client.get("/api/spending/analysis")
    assert r.status_code == 200
    a = r.json()["analysis"]
    assert a["monthly_limit"] == 75.0
    assert a["purchase_count"] == 0
