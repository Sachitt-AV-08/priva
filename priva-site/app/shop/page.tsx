"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ExternalLink,
  ImageOff,
  RefreshCw,
  Search,
  Star,
  Truck,
  Wallet,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import AppShell from "../../components/AppShell";
import PriceTag, { usd } from "../../components/PriceTag";
import Spinner from "../../components/Spinner";
import { useAuth } from "../../lib/auth";
import { apiFetch } from "../../lib/backend";

type Product = {
  id: string;
  title: string;
  price: number;
  currency?: string;
  merchant: string;
  merchant_url?: string;
  rating?: number;
  reviews?: number;
  thumbnail?: string;
  product_url?: string;
  is_used?: boolean;
  trust?: string | number;
  over_budget?: boolean;
};
type Budget = {
  limit: number;
  spent_this_month: number;
  remaining: number;
  month?: string;
};
type Transaction = {
  id: string;
  product_title?: string;
  merchant?: string;
  amount?: number;
  status?: string;
  prava_session_id?: string;
  prava_status?: string;
  shipping_status?: string;
  product_url?: string;
};
type BudgetExcess = { excess: number; limit: number; product: Product };

function readableLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function safeExternalUrl(value?: string) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function analysisLines(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      const rendered = item && typeof item === "object"
        ? Object.entries(item as Record<string, unknown>).map(([innerKey, innerValue]) => `${readableLabel(innerKey)} ${String(innerValue)}`).join(" · ")
        : Array.isArray(item) ? item.join(", ") : String(item ?? "—");
      return `${readableLabel(key)}: ${rendered}`;
    });
  }
  return [String(value)];
}

function ProductImage({ product }: { product: Product }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [product.thumbnail]);
  if (!product.thumbnail || failed) {
    return <div className="product-img-placeholder"><ImageOff size={24} strokeWidth={1.4} aria-hidden="true" /></div>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="product-img"
      src={product.thumbnail}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function ShopInner() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const queryFromUrl = params.get("q")?.trim() || "";
  const maxFromUrl = params.get("max")?.trim() || "";
  const lastAutoSearch = useRef("");
  const payingRef = useRef(false);
  const searchRequest = useRef(0);
  const [query, setQuery] = useState(queryFromUrl || "usb-c hub for travel");
  const [maxPrice, setMaxPrice] = useState(maxFromUrl);
  const [products, setProducts] = useState<Product[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [budgetLimit, setBudgetLimit] = useState("");
  const [spendAnalysis, setSpendAnalysis] = useState<unknown>(null);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [payingId, setPayingId] = useState("");
  const [expandedId, setExpandedId] = useState("");
  const [actionId, setActionId] = useState("");
  const [orderNotice, setOrderNotice] = useState("");
  const [excess, setExcess] = useState<BudgetExcess | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const loadTransactions = useCallback(async () => {
    try {
      const response = await apiFetch("/api/transactions");
      if (response.ok) setTransactions((await response.json()).transactions || []);
    } catch {
      // ReconnectPill reports transient failures.
    }
  }, []);

  const loadOrderHistory = useCallback(async () => {
    try {
      const [budgetResponse, analysisResponse, transactionResponse] = await Promise.all([
        apiFetch("/api/budget"),
        apiFetch("/api/spending/analysis"),
        apiFetch("/api/transactions"),
      ]);
      if (budgetResponse.ok) {
        const body: Budget = await budgetResponse.json();
        setBudget(body);
        setBudgetLimit(String(body.limit ?? ""));
      }
      if (analysisResponse.ok) {
        const body = await analysisResponse.json();
        setSpendAnalysis(body.analysis ?? body);
      }
      if (transactionResponse.ok) {
        setTransactions((await transactionResponse.json()).transactions || []);
      }
    } catch {
      // The page remains usable while history reconnects.
    }
  }, []);

  const searchProducts = useCallback(async (searchQuery?: string, priceOverride?: string) => {
    const value = (searchQuery ?? query).trim();
    const price = priceOverride ?? maxPrice;
    if (!value) return;
    setSearching(true);
    setError("");
    setExcess(null);
    setProducts([]);
    const requestId = ++searchRequest.current;
    try {
      const response = await apiFetch("/api/search", {
        method: "POST",
        body: JSON.stringify({
          query: value,
          ...(price.trim() ? { max_price: Number(price) } : {}),
          limit: 10,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || "Search failed");
      if (searchRequest.current === requestId) {
        setProducts(body.products || []);
        setSearched(true);
      }
    } catch (reason) {
      if (searchRequest.current === requestId) {
        setError(reason instanceof Error ? reason.message : "Search failed");
        setSearched(true);
      }
    } finally {
      if (searchRequest.current === requestId) setSearching(false);
    }
  }, [maxPrice, query]);

  useEffect(() => {
    if (user) loadOrderHistory();
  }, [loadOrderHistory, user]);

  useEffect(() => {
    if (!user) return;
    const autoKey = `${queryFromUrl}|${maxFromUrl}`;
    if (queryFromUrl && lastAutoSearch.current !== autoKey) {
      lastAutoSearch.current = autoKey;
      setQuery(queryFromUrl);
      setMaxPrice(maxFromUrl);
      searchProducts(queryFromUrl, maxFromUrl);
    }
  }, [maxFromUrl, queryFromUrl, searchProducts, user]);

  const updateBudget = async () => {
    const limit = Number(budgetLimit);
    if (!Number.isFinite(limit) || limit < 0) {
      setError("Enter a valid monthly limit");
      return;
    }
    setActionId("budget");
    setError("");
    try {
      const response = await apiFetch("/api/budget", {
        method: "PUT",
        body: JSON.stringify({ limit }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || "Budget was not updated");
      setBudget(body);
      setBudgetLimit(String(body.limit));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Budget was not updated");
    } finally {
      setActionId("");
    }
  };

  const pay = async (product: Product, budgetExcess?: number) => {
    if (payingRef.current) return;
    payingRef.current = true;
    setPayingId(product.id);
    setError("");
    let navigating = false;
    try {
      const response = await apiFetch("/api/pay", {
        method: "POST",
        body: JSON.stringify({
          product_id: product.id,
          title: product.title,
          price: product.price,
          merchant: product.merchant,
          thumbnail: product.thumbnail || "",
          product_url: product.product_url || "",
          user_id: user?.user_id,
          ...(budgetExcess != null ? { budget_excess: budgetExcess } : {}),
        }),
      });
      const body = await response.json();
      if (response.status === 409) {
        let detail = body.detail;
        if (typeof detail === "string") {
          try { detail = JSON.parse(detail); } catch { throw new Error(detail); }
        }
        if (detail && typeof detail === "object") {
          setExcess({
            excess: Number(detail.excess || 0),
            limit: Number(detail.limit || 0),
            product,
          });
          return;
        }
      }
      if (!response.ok || body.error || !body.session_id) {
        throw new Error(body.error || body.detail || "Payment session could not be created");
      }
      setExcess(null);
      window.sessionStorage.setItem("priva_pending", JSON.stringify({
        user_id: user?.user_id,
        session_id: body.session_id,
        transaction_id: body.transaction_id,
        session_token: body.session_token,
        iframe_url: body.iframe_url,
        order_id: body.order_id,
        expires_at: body.expires_at,
        title: product.title,
        price: product.price,
        merchant: product.merchant,
        thumbnail: product.thumbnail || "",
        payment_url: body.payment_url || "",
        budget_excess: budgetExcess,
      }));
      navigating = true;
      router.push("/checkout");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Payment session could not be created");
    } finally {
      if (!navigating) {
        payingRef.current = false;
        setPayingId("");
      }
    }
  };

  const syncPayments = async () => {
    setActionId("sync");
    setOrderNotice("");
    try {
      const response = await apiFetch("/api/transactions/refresh", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || "Payment status was not synced");
      await loadTransactions();
      setOrderNotice("Payment status synced");
    } catch (reason) {
      setOrderNotice(reason instanceof Error ? reason.message : "Payment status was not synced");
    } finally {
      setActionId("");
    }
  };

  const checkStatus = async (transaction: Transaction) => {
    if (!transaction.prava_session_id) return;
    setActionId(`status-${transaction.id}`);
    setOrderNotice("");
    try {
      const response = await apiFetch(`/api/pay/status?session_id=${encodeURIComponent(transaction.prava_session_id)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || "Status is unavailable");
      setOrderNotice(`${transaction.product_title || "Purchase"}: ${body.status || body.prava_status || "status checked"}`);
      await loadTransactions();
    } catch (reason) {
      setOrderNotice(reason instanceof Error ? reason.message : "Status is unavailable");
    } finally {
      setActionId("");
    }
  };

  const advanceShipping = async (transaction: Transaction) => {
    setActionId(`shipping-${transaction.id}`);
    setOrderNotice("");
    try {
      const response = await apiFetch(`/api/transactions/${encodeURIComponent(transaction.id)}/shipping/advance`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || "Shipping status was not advanced");
      setTransactions((current) => current.map((item) =>
        item.id === transaction.id ? { ...item, shipping_status: body.shipping_status } : item
      ));
      setOrderNotice(`Shipping updated to ${(body.shipping_status || "next stage").replaceAll("_", " ")}`);
    } catch (reason) {
      setOrderNotice(reason instanceof Error ? reason.message : "Shipping status was not advanced");
    } finally {
      setActionId("");
    }
  };

  if (loading || !user) return <main className="loading-page"><Spinner /></main>;

  const limit = Number(budget?.limit || 0);
  const spent = Number(budget?.spent_this_month || 0);
  const spendPercent = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
  const insightLines = analysisLines(spendAnalysis);

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <p className="page-kicker">Quality first</p>
          <h1>Shop</h1>
          <p className="page-description">Find strong options, keep the budget visible, choose deliberately.</p>
        </div>
      </header>

      <section className="card order-history" aria-labelledby="history-heading">
        <header className="order-history-head">
          <h2 id="history-heading">Order History</h2>
          <button className="btn btn-ghost btn-sm" type="button" onClick={syncPayments} disabled={Boolean(actionId)}>
            <RefreshCw size={13} aria-hidden="true" />
            {actionId === "sync" ? "Syncing..." : "Sync payment status"}
          </button>
        </header>

        <div className="budget-grid">
          <div>
            <div className="budget-numbers">
              <div>
                <p className="budget-title">Spent this month</p>
                <PriceTag value={spent} />
              </div>
              <div className="budget-limit-row">
                <Wallet size={14} className="muted" aria-hidden="true" />
                <input
                  className="budget-limit-input"
                  type="number"
                  min="0"
                  step="1"
                  value={budgetLimit}
                  onChange={(event) => setBudgetLimit(event.target.value)}
                  aria-label="Monthly budget limit"
                />
                <button className="btn btn-sm btn-ghost" type="button" onClick={updateBudget} disabled={actionId === "budget"}>
                  {actionId === "budget" ? "Saving..." : "Update"}
                </button>
              </div>
            </div>
            <div
              className="spend-bar"
              role="progressbar"
              aria-label="Monthly budget used"
              aria-valuemin={0}
              aria-valuemax={Math.max(limit, spent, 1)}
              aria-valuenow={Math.min(spent, Math.max(limit, spent, 1))}
              aria-valuetext={`${spendPercent.toFixed(0)} percent of budget spent`}
            >
              <div className="spend-bar-fill" style={{ width: `${spendPercent}%` }} />
            </div>
            <p className="muted tiny" style={{ margin: "8px 0 0" }}>
              {budget ? `${usd.format(Number(budget.remaining || 0))} remaining${budget.month ? ` · ${budget.month}` : ""}` : "Budget data is reconnecting"}
            </p>
          </div>
          <div className="spend-analysis">
            <strong>Spend analysis</strong>
            {insightLines.length ? insightLines.slice(0, 3).map((line, index) => <p key={index}>{line}</p>) : <p>Insights will sharpen after your first purchases.</p>}
          </div>
        </div>

        <div className="transaction-list">
          {transactions.length === 0 ? (
            <div className="empty-state">Completed and active purchases will appear here.</div>
          ) : transactions.map((transaction) => {
            const open = expandedId === transaction.id;
            return (
              <div className="transaction-row" key={transaction.id}>
                <button className="transaction-summary" type="button" aria-expanded={open} onClick={() => setExpandedId(open ? "" : transaction.id)}>
                  <span className="transaction-product">
                    <span className="transaction-title">{transaction.product_title || "Purchase"}</span>
                    <span className="transaction-merchant">{transaction.merchant || "Merchant"}</span>
                  </span>
                  <PriceTag value={Number(transaction.amount || 0)} />
                  <span className={`badge tag-${transaction.status || "pending"}`}>{(transaction.status || "pending").replaceAll("_", " ")}</span>
                  <span className={`badge tag-${transaction.shipping_status || "confirmed"}`}>{(transaction.shipping_status || "confirmed").replaceAll("_", " ")}</span>
                  <ChevronDown className={`transaction-chevron${open ? " on" : ""}`} size={14} aria-hidden="true" />
                </button>
                {open && (
                  <div className="transaction-details">
                    <button className="btn btn-sm btn-ghost" type="button" onClick={syncPayments} disabled={Boolean(actionId)}>
                      <RefreshCw size={12} aria-hidden="true" /> Sync payment status
                    </button>
                    <button className="btn btn-sm btn-ghost" type="button" onClick={() => checkStatus(transaction)} disabled={!transaction.prava_session_id || Boolean(actionId)}>
                      {actionId === `status-${transaction.id}` ? "Checking..." : "Check status"}
                    </button>
                    <button className="btn btn-sm btn-ghost" type="button" onClick={() => advanceShipping(transaction)} disabled={Boolean(actionId) || transaction.shipping_status === "delivered"}>
                      <Truck size={12} aria-hidden="true" />
                      {actionId === `shipping-${transaction.id}` ? "Advancing..." : "Advance shipping"}
                    </button>
                    {safeExternalUrl(transaction.product_url) && (
                      <a className="btn btn-sm btn-ghost" href={safeExternalUrl(transaction.product_url)} target="_blank" rel="noreferrer">
                        View product <ExternalLink size={12} aria-hidden="true" />
                      </a>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {orderNotice && <p className="order-notice" role="status">{orderNotice}</p>}
      </section>

      <form
        className="card shop-search"
        onSubmit={(event) => { event.preventDefault(); searchProducts(); }}
      >
        <input className="field" placeholder="What are you looking for?" aria-label="Product search" value={query} onChange={(event) => setQuery(event.target.value)} disabled={searching} />
        <input className="field mono" type="number" min="0" placeholder="Max $" aria-label="Maximum price" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} disabled={searching} />
        <button className="btn btn-primary" type="submit" disabled={searching || !query.trim()}>
          <Search size={14} aria-hidden="true" />
          {searching ? "Searching..." : "Search"}
        </button>
      </form>

      {excess && (
        <section className="card warning-card">
          <p>
            This purchase exceeds your monthly limit by <PriceTag value={excess.excess} />.
            Borrowing from next month requires your approval.
          </p>
          <div className="btn-row">
            <button className="btn btn-primary" type="button" onClick={() => pay(excess.product, excess.excess)} disabled={Boolean(payingId)}>
              {payingId ? "Starting..." : "Borrow from next month"}
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setExcess(null)} disabled={Boolean(payingId)}>Keep looking</button>
          </div>
        </section>
      )}

      {error && <p className="err small" role="alert">{error}</p>}
      {searched && !products.length && !error && <div className="empty-state">No strong matches yet. Try a broader description.</div>}

      <div className="product-grid">
        {products.map((product) => (
          <article className="card product" key={product.id}>
            <div className="product-image-wrap"><ProductImage product={product} /></div>
            <div className="product-body">
              <h2 className="product-title">{product.title}</h2>
              <div className="product-meta">
                <span>{product.merchant}</span>
                {product.rating != null && <span className="badge"><Star size={10} fill="currentColor" aria-hidden="true" /> {product.rating}</span>}
                {product.trust && <span className="badge">{product.trust}</span>}
                {product.over_budget && <span className="badge status-danger">over budget</span>}
              </div>
              <div className="product-footer">
                <PriceTag value={Number(product.price || 0)} />
                <button className="btn btn-primary btn-sm" type="button" onClick={() => pay(product)} disabled={Boolean(payingId)}>
                  {payingId === product.id ? "Starting..." : "Pay"}
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </AppShell>
  );
}

export default function ShopPage() {
  return <Suspense fallback={<main className="loading-page"><Spinner /></main>}><ShopInner /></Suspense>;
}
