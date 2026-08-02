"""Global test config: keep the LLM purchase advisor OFF by default so test
flows never hit the live OpenAI API or burn quota. Tests that want the LLM
explicitly flip `purchase_advisor._available` back on (see test_purchase_advisor).
"""
import pytest


@pytest.fixture(autouse=True)
def _no_llm(monkeypatch):
    import purchase_advisor as pa
    monkeypatch.setattr(pa, "_available", lambda: False)
