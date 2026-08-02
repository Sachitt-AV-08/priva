"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "../../components/AppShell";
import { useAuth } from "../../lib/auth";
import { apiFetch } from "../../lib/constants";

type Product = {
  id: string;
  title: string;
  price: number;
  merchant: string;
  rating?: number;
  reviews?: number;
  thumbnail?: string;
  product_url?: string;
  over_budget?: boolean;
};

export default function ShopPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [query, setQuery] = useState("usb-c hub for travel");
  const [maxPrice, setMaxPrice] = useState("300");
  const [products, setProducts] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [excess, setExcess] = useState<{ excess: number; limit: number } | null>(null);
  const [payingId, setPayingId] = useState("");
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const search = async () => {
    setSearching(true);
    setError("");
    setExcess(null);
    try {
      const res = await apiFetch("/api/search", {
        method: "POST",
        body: JSON.stringify({
          query,
          max_price: maxPrice ? parseFloat(maxPrice) : null,
          limit: 10,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || "Search failed");
      setProducts(body.products || []);
      setSearched(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backend unreachable");
    } finally {
      setSearching(false);
    }
  };

  const pay = async (p: Product, withExcess: boolean) => {
    setPayingId(p.id);
    setError("");
    try {
      const res = await apiFetch("/api/pay", {
        method: "POST",
        body: JSON.stringify({
          product_id: p.id,
          title: p.title,
          price: p.price,
          merchant: p.merchant,
          thumbnail: p.thumbnail || "",
          product_url: p.product_url || "",
          user_id: user?.user_id || "web-user",
          budget_excess: withExcess ? excess?.excess ?? null : null,
        }),
      });
      const body = await res.json();
      if (res.status === 409) {
        setExcess(body.detail);
        return;
      }
      if (!res.ok) throw new Error(body.detail || "Pay failed");
      window.sessionStorage.setItem(
        "priva_pending",
        JSON.stringify({
          session_id: body.session_id,
          transaction_id: body.transaction_id,
          title: p.title,
          price: p.price,
          payment_url: body.payment_url || "",
        })
      );
      router.push("/checkout");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backend unreachable");
    } finally {
      setPayingId("");
    }
  };

  return (
    <AppShell>
      <section className="section">
        <h2>Shop — quality-first, budget-capped</h2>
        <div className="card">
          <div className="btn-row">
            <input
              className="phone-input grow"
              placeholder="what do you want?"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
            />
            <input
              className="phone-input short"
              placeholder="max $"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
            />
            <button className="btn primary" disabled={searching} onClick={search}>
              {searching ? "Searching…" : "Deep search"}
            </button>
          </div>
        </div>

        {excess && (
          <div className="card warn">
            <p>
              ⚠️ <b>{excess.limit >= 0 ? `$${excess.limit.toFixed(2)}` : "your"} monthly budget</b> would be
              exceeded by <b>${excess.excess.toFixed(2)}</b>.
            </p>
            <button
              className="btn"
              onClick={() => {
                const p = products.find((x) => x.id === payingId);
                if (p) pay(p, true);
              }}
            >
              Borrow from next month & pay anyway
            </button>
            <button className="btn ghost" onClick={() => setExcess(null)}>Keep looking</button>
          </div>
        )}

        {error && <p className="err">{error}</p>}

        {searched && products.length === 0 && !error && (
          <p className="dim">No products found — try a different query.</p>
        )}

        <div className="product-grid">
          {products.map((p) => (
            <div className="card product" key={p.id}>
              {p.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="product-img" src={p.thumbnail} alt={p.title} loading="lazy" />
              ) : (
                <div className="product-img placeholder">🛍️</div>
              )}
              <h3>{p.title}</h3>
              <p className="dim small">
                {p.merchant}
                {p.rating != null && <span className="tag">★ {p.rating}</span>}
                {p.over_budget && <span className="tag warn-tag">over budget</span>}
              </p>
              <div className="btn-row">
                <b className="price">${p.price.toFixed(2)}</b>
                <button className="btn primary" disabled={payingId === p.id} onClick={() => pay(p, false)}>
                  {payingId === p.id ? "…" : "Pay"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
