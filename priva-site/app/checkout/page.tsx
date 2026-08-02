"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AppShell from "../../components/AppShell";
import { useAuth } from "../../lib/auth";
import { apiFetch } from "../../lib/constants";

export default function CheckoutPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [pending, setPending] = useState<any>(null);
  const [completing, setCompleting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [txns, setTxns] = useState<any[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem("priva_pending");
      if (raw) setPending(JSON.parse(raw));
    } catch {
      /* none */
    }
  }, []);

  const loadTxns = () =>
    apiFetch("/api/transactions")
      .then(async (res) => {
        if (res.ok) setTxns((await res.json()).transactions || []);
      })
      .catch(() => {});

  useEffect(() => {
    if (user) loadTxns();
  }, [user]);

  const complete = async () => {
    if (!pending || completing) return;
    setCompleting(true);
    setError("");
    try {
      const res = await apiFetch("/api/pay/complete", {
        method: "POST",
        body: JSON.stringify({
          session_id: pending.session_id,
          transaction_id: pending.transaction_id,
          amount: pending.price,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || "Completion failed");
      setResult(body);
      if (body.status === "completed") {
        window.sessionStorage.removeItem("priva_pending");
        setPending(null);
        loadTxns();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backend unreachable");
    } finally {
      setCompleting(false);
    }
  };

  return (
    <AppShell>
      <section className="section">
        <h2>Checkout</h2>

        {pending && (
          <div className="card">
            <h3>💳 Paying for: {pending.title}</h3>
            <p className="price big-price">${Number(pending.price).toFixed(2)}</p>
            <p className="dim small">
              Payment session <code>{pending.session_id}</code> — via Prava (Visa Intelligent Commerce) sandbox.
            </p>
            <div className="btn-row">
              {pending.payment_url && (
                <a className="btn" href={pending.payment_url} target="_blank" rel="noreferrer">
                  Open payment page
                </a>
              )}
              <button className="btn primary" disabled={completing} onClick={complete}>
                {completing ? "Waiting for Prava…" : "Complete payment (simulated)"}
              </button>
            </div>
            {result && (
              <p className={result.status === "completed" ? "ok" : "err"}>
                {result.status === "completed"
                  ? "✓ Payment completed — budget updated, order tracked."
                  : `Status: ${result.status}${result.error ? ` (${result.error})` : ""}`}
              </p>
            )}
          </div>
        )}

        {!pending && (
          <div className="card">
            <h3>No active payment</h3>
            <p className="dim small">Find something in the Shop, then come back here to complete the checkout.</p>
            <Link className="btn" href="/shop">Go to shop</Link>
          </div>
        )}

        {error && <p className="err">{error}</p>}

        <div className="card">
          <h3>🧾 Your transactions</h3>
          {txns.length === 0 && <p className="dim small">None yet.</p>}
          <ul className="list">
            {txns.map((t) => (
              <li key={t.id} className="item">
                <b>{t.product_title}</b>
                <span className="tag">${t.amount}</span>
                <span className={`tag tag-${t.status || "pending"}`}>{t.status || "pending"}</span>
                {t.shipping_status && <span className="dim tiny">→ {t.shipping_status}</span>}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </AppShell>
  );
}
