"""Prava payment client using the official typed SDK (prava-sdk).

Keeps the same async function signatures used by server.py.
"""
import asyncio
import logging
from decimal import Decimal

from prava_sdk import AsyncPravaClient
from prava_sdk.models.sessions import IntegrationType, TransactionStatus

from config import PRAVA_SECRET_KEY, DEMO_MODE

logger = logging.getLogger("priva.prava")


def _configured() -> bool:
    return bool(PRAVA_SECRET_KEY)


def _error_dict(message: str) -> dict:
    return {
        "error": message,
        "session_id": "",
        "session_token": "",
        "iframe_url": "",
        "order_id": "",
        "expires_at": "",
        "payment_url": "",
    }


async def create_payment_session(
    user_id: str,
    user_email: str,
    total_amount: str,
    currency: str,
    merchant_name: str,
    merchant_url: str,
    product_title: str,
    product_price: str,
    quantity: int = 1,
) -> dict:
    if not _configured():
        return _error_dict("PRAVA_SECRET_KEY not configured. Add it to priva/.env to enable payments.")
    try:
        async with AsyncPravaClient(PRAVA_SECRET_KEY) as client:
            session = await client.sessions.create(
                user_id=user_id,
                user_email=user_email,
                total_amount=Decimal(str(total_amount)),
                currency=currency,
                purchase_context=[
                    {
                        "merchant_details": {
                            "name": merchant_name,
                            "url": merchant_url or "https://example.com",
                            "country_code_iso2": "US",
                        },
                        "product_details": [
                            {
                                "description": product_title,
                                "unit_price": str(product_price),
                                "quantity": quantity,
                            }
                        ],
                    }
                ],
                integration_type=IntegrationType.EMBEDDING,
            )
        return {
            "session_id": session.session_id,
            "session_token": session.session_token,
            "iframe_url": session.iframe_url,
            "order_id": session.order_id,
            "expires_at": session.expires_at.isoformat() if session.expires_at else "",
            "payment_url": session.iframe_url,
        }
    except Exception as exc:  # PravaError hierarchy
        logger.warning("Prava session creation failed: %s", exc)
        return _error_dict(f"Prava session creation failed: {exc}")


async def get_payment_status(session_id: str) -> dict:
    if DEMO_MODE and session_id:
        # Demo pacing: a fresh sandbox session reports pending until the
        # simulated passkey approval (complete_payment) flips it to completed.
        return {"status": "awaiting_result", "demo": True}
    if not _configured() or not session_id:
        return {"status": "unknown", "error": "PRAVA_SECRET_KEY not configured"}
    try:
        async with AsyncPravaClient(PRAVA_SECRET_KEY) as client:
            result = await client.sessions.get_payment_result(session_id)
        data = result.model_dump(mode="json", exclude_none=True)
        for txn in data.get("transactions", []):
            for line in txn.get("line_items", []):
                if line.get("token"):
                    line["token"] = f"****{str(line['token'])[-4:]}"
                if line.get("dynamic_cvv"):
                    line["dynamic_cvv"] = "***"
        return data
    except Exception as exc:
        logger.warning("Prava status check failed: %s", exc)
        return {"status": "unknown", "error": str(exc)}


async def report_payment_outcome(
    session_id: str,
    status: str,
    txn_ref_id: str = "",
    amount_paid: str | None = None,
) -> dict:
    if not _configured() or not session_id:
        return {"error": "PRAVA_SECRET_KEY not configured"}
    txn_status = TransactionStatus.APPROVED if str(status).upper() == "APPROVED" else TransactionStatus.DECLINED
    try:
        async with AsyncPravaClient(PRAVA_SECRET_KEY) as client:
            result = await client.sessions.report_status(
                session_id,
                txn_ref_id=txn_ref_id,
                txn_status=txn_status,
                amount_paid=Decimal(amount_paid) if amount_paid else None,
            )
        return result.model_dump(mode="json") if hasattr(result, "model_dump") else {"ok": True}
    except Exception as exc:
        logger.warning("Prava report failed: %s", exc)
        return {"error": str(exc)}


async def complete_payment(session_id: str, amount_paid: str | None = None) -> dict:
    """Poll for payment credentials, then report APPROVED (checkout simulated).

    Credentials (network token + dynamic CVV) are logged server-side only and
    never returned to the client.

    DEMO_MODE: simulates the user tapping the passkey ~5s after the session is
    created so a recorded demo completes end-to-end without waiting for the
    sandbox's slow auto-approval. Real mode waits on the SDK.
    """
    if DEMO_MODE:
        await asyncio.sleep(5)
        return {"status": "completed", "prava_status": "completed",
                "credential_issued": True, "reported": "simulated"}
    if not _configured() or not session_id:
        return {"status": "failed", "error": "PRAVA_SECRET_KEY not configured"}
    try:
        async with AsyncPravaClient(PRAVA_SECRET_KEY) as client:
            result = await client.sessions.wait_for_payment_result(session_id, timeout=120.0, poll_interval=3.0)
            session_status = str(result.status).split(".")[-1].lower()
            txn_ref_id = ""
            credential_issued = False
            for txn in result.transactions:
                for line in txn.line_items:
                    if line.txn_ref_id:
                        txn_ref_id = line.txn_ref_id
                    if line.token is not None:
                        credential_issued = True
                        logger.info(
                            "Prava credentials issued for %s (token ****%s, cvv %s, exp %s/%s) — never surfaced to UI",
                            session_id,
                            str(line.token)[-4:],
                            str(line.dynamic_cvv),
                            line.expiry_month,
                            line.expiry_year,
                        )
            if session_status in ("awaiting_result", "completed") and txn_ref_id:
                report = await client.sessions.report_status(
                    session_id,
                    txn_ref_id=txn_ref_id,
                    txn_status=TransactionStatus.APPROVED,
                    amount_paid=Decimal(amount_paid) if amount_paid else None,
                )
                return {
                    "status": "completed",
                    "prava_status": session_status,
                    "credential_issued": credential_issued,
                    "reported": str(report.status) if report else "ok",
                }
            if session_status == "failed":
                return {"status": "failed", "prava_status": session_status, "credential_issued": credential_issued}
            return {"status": "pending", "prava_status": session_status, "credential_issued": credential_issued}
    except Exception as exc:
        logger.warning("Prava completion failed: %s", exc)
        return {"status": "failed", "error": str(exc)}
