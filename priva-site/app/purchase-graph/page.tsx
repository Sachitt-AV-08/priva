"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "../../components/AppShell";
import PriceTag, { usd } from "../../components/PriceTag";
import Spinner from "../../components/Spinner";
import { useAuth } from "../../lib/auth";
import { apiFetch } from "../../lib/backend";

type Transaction = {
  id: string;
  product_title?: string;
  merchant?: string;
  amount?: number;
  status?: string;
  shipping_status?: string;
  created_at?: number | string;
};

function labelFor(key: string) {
  return key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function valueFor(key: string, value: unknown) {
  if (typeof value === "number" && /amount|spend|spent|budget|total|average|limit/i.test(key)) {
    return usd.format(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item && typeof item === "object") {
        return Object.entries(item as Record<string, unknown>)
          .map(([innerKey, innerValue]) => `${labelFor(innerKey)} ${String(innerValue)}`)
          .join(" · ");
      }
      return String(item);
    }).join("; ");
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([innerKey, innerValue]) => `${labelFor(innerKey)}: ${String(innerValue)}`)
      .join(" · ");
  }
  return String(value ?? "—");
}

function transactionDate(value: Transaction["created_at"]) {
  if (!value) return "Recent";
  const date = typeof value === "number"
    ? new Date(value < 1e12 ? value * 1000 : value)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? "Recent" : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function PurchaseGraphPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [analysis, setAnalysis] = useState<Record<string, unknown>>({});
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    let timer = 0;
    const load = async () => {
      try {
        const [analysisResponse, transactionsResponse] = await Promise.all([
          apiFetch("/api/spending/analysis"),
          apiFetch("/api/transactions"),
        ]);
        if (!alive) return;
        if (analysisResponse.ok) {
          const body = await analysisResponse.json();
          setAnalysis(body.analysis && typeof body.analysis === "object" ? body.analysis : body);
        }
        if (transactionsResponse.ok) {
          const body = await transactionsResponse.json();
          setTransactions(body.transactions || []);
        }
      } catch {
        // Keep the latest graph visible while reconnecting.
      } finally {
        if (alive) {
          setLoaded(true);
          timer = window.setTimeout(load, 10000);
        }
      }
    };
    load();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [user]);

  const completed = transactions.filter((transaction) => transaction.status === "completed");
  const total = useMemo(() => completed.reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0), [completed]);
  const merchants = new Set(transactions.map((transaction) => transaction.merchant).filter(Boolean)).size;
  const analysisEntries = Object.entries(analysis).filter(([key]) => !["analysis", "transactions"].includes(key));
  const merchantSpend = useMemo(() => {
    const totals = new Map<string, number>();
    for (const transaction of transactions.filter((item) => item.status === "completed")) {
      const merchant = transaction.merchant || "Other";
      totals.set(merchant, (totals.get(merchant) || 0) + Number(transaction.amount || 0));
    }
    return Array.from(totals.entries())
      .map(([merchant, amount]) => ({ merchant, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 6);
  }, [transactions]);
  const maxMerchantSpend = Math.max(...merchantSpend.map((item) => item.amount), 1);

  if (loading || !user || !loaded) {
    return <main className="loading-page"><Spinner /></main>;
  }

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <p className="page-kicker">Money, in context</p>
          <h1>Purchase Graph</h1>
          <p className="page-description">
            {transactions.length
              ? `${usd.format(total)} across ${completed.length} completed purchase${completed.length === 1 ? "" : "s"} and ${merchants} merchant${merchants === 1 ? "" : "s"}.`
              : "Your spending history will form here as PRIVA completes purchases."}
          </p>
        </div>
      </header>

      <div className="graph-layout">
        <section className="card graph-summary">
          <h2>Spend by merchant</h2>
          {merchantSpend.length === 0 ? (
            <div className="empty-state">Your first purchase begins the graph.</div>
          ) : (
            <div className="spend-chart" aria-label="Spending by merchant">
              {merchantSpend.map((item) => (
                <div className="spend-chart-row" key={item.merchant}>
                  <div className="spend-chart-label"><span>{item.merchant}</span><PriceTag value={item.amount} /></div>
                  <div className="spend-chart-track">
                    <div className="spend-chart-bar" style={{ width: `${Math.max(5, (item.amount / maxMerchantSpend) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
          <h3 className="graph-subhead">Analysis</h3>
          {analysisEntries.length === 0
            ? <p className="muted small">Insights appear once PRIVA has enough purchase context.</p>
            : (
              <div className="analysis-grid">
                {analysisEntries.map(([key, value]) => (
                  <div className="analysis-row" key={key}>
                    <span className="analysis-key">{labelFor(key)}</span>
                    <span className="analysis-value">{valueFor(key, value)}</span>
                  </div>
                ))}
              </div>
            )}
        </section>

        <section className="card graph-timeline">
          <h2>Purchase timeline</h2>
          {transactions.length === 0 ? (
            <div className="empty-state">No purchases yet. Your first completed checkout starts the graph.</div>
          ) : (
            <div className="purchase-timeline">
              {transactions.map((transaction) => (
                <article className="purchase-event" key={transaction.id}>
                  <div>
                    <p className="purchase-event-title">{transaction.product_title || "Purchase"}</p>
                    <p className="purchase-event-meta">
                      {transaction.merchant || "Merchant"} · {transactionDate(transaction.created_at)} · {(transaction.shipping_status || transaction.status || "pending").replaceAll("_", " ")}
                    </p>
                  </div>
                  <PriceTag value={Number(transaction.amount || 0)} />
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
