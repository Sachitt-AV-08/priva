"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CreditCard, ExternalLink, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "../../components/AppShell";
import PriceTag from "../../components/PriceTag";
import Spinner from "../../components/Spinner";
import { useAuth } from "../../lib/auth";
import { apiFetch } from "../../lib/backend";

type PendingPayment = {
  user_id?: string;
  session_id: string;
  transaction_id?: string;
  title: string;
  price: number;
  merchant?: string;
  payment_url?: string;
  budget_excess?: number;
};
type Transaction = {
  id: string;
  product_title?: string;
  merchant?: string;
  amount?: number;
  status?: string;
  shipping_status?: string;
  created_at?: number | string;
};
type PaymentResult = { status?: string; error?: string; detail?: string };

function safePaymentUrl(value?: string) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export default function CheckoutPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [pending, setPending] = useState<PendingPayment | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [result, setResult] = useState<PaymentResult | null>(null);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    try {
      const stored = window.sessionStorage.getItem("priva_pending");
      if (stored) {
        const parsed: PendingPayment = JSON.parse(stored);
        if (parsed.user_id === user.user_id) setPending(parsed);
        else window.sessionStorage.removeItem("priva_pending");
      }
    } catch {
      window.sessionStorage.removeItem("priva_pending");
    }
  }, [user]);

  const loadTransactions = useCallback(async () => {
    try {
      const response = await apiFetch("/api/transactions");
      if (response.ok) setTransactions((await response.json()).transactions || []);
    } catch {
      // ReconnectPill reports transient failures.
    }
  }, []);

  useEffect(() => {
    if (user) loadTransactions();
  }, [loadTransactions, user]);

  const completePayment = async () => {
    if (!pending || completing) return;
    if (!user || pending.user_id !== user.user_id) {
      window.sessionStorage.removeItem("priva_pending");
      setPending(null);
      setError("This payment session belongs to a different account");
      return;
    }
    setCompleting(true);
    setError("");
    try {
      const response = await apiFetch("/api/pay/complete", {
        method: "POST",
        body: JSON.stringify({
          session_id: pending.session_id,
          transaction_id: pending.transaction_id,
          amount: pending.price,
          ...(pending.budget_excess != null ? { budget_excess: pending.budget_excess } : {}),
        }),
      });
      const body: PaymentResult = await response.json();
      if (!response.ok) throw new Error(body.detail || body.error || "Payment was not completed");
      setResult(body);
      if (body.status === "completed") {
        window.sessionStorage.removeItem("priva_pending");
        setPending(null);
        await loadTransactions();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Payment was not completed");
    } finally {
      setCompleting(false);
    }
  };

  if (loading || !user) return <main className="loading-page"><Spinner /></main>;

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <p className="page-kicker">Secure handoff</p>
          <h1>Checkout</h1>
          <p className="page-description">Review the session, complete payment, and keep the order in one place.</p>
        </div>
      </header>

      <div className="checkout-grid">
        <section className="card checkout-card">
          {pending ? (
            <>
              <span className="checkout-icon"><CreditCard size={21} strokeWidth={1.6} aria-hidden="true" /></span>
              <h2>{pending.title}</h2>
              {pending.merchant && <p className="muted small">{pending.merchant}</p>}
              <PriceTag className="checkout-price" value={Number(pending.price || 0)} />
              <span className="session-code mono">Session {pending.session_id}</span>
              {pending.budget_excess != null && (
                <p className="muted tiny">Includes your approved next-month budget adjustment.</p>
              )}
              <div className="btn-row checkout-actions">
                {safePaymentUrl(pending.payment_url) && (
                  <a className="btn btn-ghost" href={safePaymentUrl(pending.payment_url)} target="_blank" rel="noreferrer">
                    Open payment page <ExternalLink size={13} aria-hidden="true" />
                  </a>
                )}
                <button className="btn btn-primary btn-lg" type="button" onClick={completePayment} disabled={completing}>
                  <CreditCard size={15} aria-hidden="true" />
                  {completing ? "Completing..." : "Complete payment"}
                </button>
              </div>
            </>
          ) : result?.status === "completed" ? (
            <div className="checkout-complete">
              <CheckCircle2 size={30} strokeWidth={1.5} aria-hidden="true" />
              <h2>Payment complete</h2>
              <p>Your budget is updated and the order is now being tracked.</p>
              <Link className="btn btn-primary" href="/shop">Return to shop</Link>
            </div>
          ) : (
            <div className="checkout-complete">
              <ShoppingBag size={28} strokeWidth={1.5} aria-hidden="true" />
              <h2>No active payment</h2>
              <p>Choose a product in Shop to begin a checkout session.</p>
              <Link className="btn btn-primary" href="/shop">Go to shop</Link>
            </div>
          )}
          {result && result.status !== "completed" && (
            <p className="muted small" role="status">Status: {result.status || "pending"}{result.error ? ` · ${result.error}` : ""}</p>
          )}
          {error && <p className="err small" role="alert">{error}</p>}
        </section>

        <aside className="card checkout-transactions">
          <h2>Recent transactions</h2>
          {transactions.length === 0 ? (
            <div className="empty-state">Your completed checkouts will appear here.</div>
          ) : (
            <div className="summary-list">
              {[...transactions].sort((a, b) => {
                const time = (value: Transaction["created_at"]) => {
                  if (typeof value === "number") return value;
                  return value ? new Date(value).getTime() : 0;
                };
                return time(b.created_at) - time(a.created_at);
              }).slice(0, 7).map((transaction) => (
                <div className="summary-row" key={transaction.id}>
                  <div className="summary-row-title">
                    <span>{transaction.product_title || "Purchase"}</span>
                    <PriceTag value={Number(transaction.amount || 0)} />
                  </div>
                  <div className="summary-row-meta">
                    <span>{transaction.merchant || "Merchant"}</span>
                    <span className={`badge tag-${transaction.status || "pending"}`}>
                      {(transaction.shipping_status || transaction.status || "pending").replaceAll("_", " ")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </AppShell>
  );
}
