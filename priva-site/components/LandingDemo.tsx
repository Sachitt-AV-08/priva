"use client";

import { useEffect, useState } from "react";
import { ArrowRight, ImageOff, NotebookPen, Star } from "lucide-react";
import Link from "next/link";
import { apiFetch } from "../lib/backend";
import PriceTag from "./PriceTag";
import ReconnectPill from "./ReconnectPill";

type DemoProduct = {
  id: string;
  title: string;
  price: number;
  merchant: string;
  rating?: number;
  thumbnail?: string;
};

const SAMPLE_PRODUCTS: DemoProduct[] = [
  {
    id: "sample-nike-air-force",
    title: "Air Force 1 '07 White Leather",
    price: 115,
    merchant: "Nike",
    rating: 4.8,
    thumbnail: "https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=320&q=80",
  },
  {
    id: "sample-stan-smith",
    title: "Stan Smith Lux Shoes",
    price: 145,
    merchant: "Adidas",
    rating: 4.7,
    thumbnail: "https://images.unsplash.com/photo-1543508282-6319a3e2621f?auto=format&fit=crop&w=320&q=80",
  },
  {
    id: "sample-club-c",
    title: "Club C 85 Vintage",
    price: 90,
    merchant: "Reebok",
    rating: 4.6,
    thumbnail: "https://images.unsplash.com/photo-1600269452121-4f2416e55c28?auto=format&fit=crop&w=320&q=80",
  },
  {
    id: "sample-roger",
    title: "The Roger Advantage",
    price: 149.99,
    merchant: "On",
    rating: 4.7,
    thumbnail: "https://images.unsplash.com/photo-1539185441755-769473a23570?auto=format&fit=crop&w=320&q=80",
  },
];

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function parseNote(text: string) {
  const itemMatch = text.match(/\b(shoes?|sneakers?|trainers?|boots?|sandals?)\b/i);
  const colorMatch = text.match(/\b(white|black|brown|cream|beige|navy|blue|red|green)\b/i);
  const priceMatch = text.match(/(?:under|below|max|budget(?:\s+of)?)\s*\$?\s*([\d,]+(?:\.\d+)?)/i);
  const item = itemMatch?.[1] || "product";
  const normalizedItem = /shoe/i.test(item) ? "shoes" : item.toLowerCase();
  const color = colorMatch?.[1]?.toLowerCase();
  const maxPrice = priceMatch ? Number(priceMatch[1].replaceAll(",", "")) : undefined;
  const chips = [
    normalizedItem.charAt(0).toUpperCase() + normalizedItem.slice(1),
    color ? color.charAt(0).toUpperCase() + color.slice(1) : "",
    maxPrice != null ? `under $${maxPrice}` : "",
  ].filter(Boolean);
  return {
    chips,
    query: [color, normalizedItem].filter(Boolean).join(" ") || text.trim(),
    maxPrice,
  };
}

function DemoImage({ product }: { product: DemoProduct }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [product.thumbnail]);
  if (!product.thumbnail || failed) {
    return <div className="demo-product-placeholder"><ImageOff size={17} strokeWidth={1.4} aria-hidden="true" /></div>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="demo-product-image"
      src={product.thumbnail}
      alt=""
      onError={() => setFailed(true)}
    />
  );
}

export default function LandingDemo() {
  const [note, setNote] = useState("need white shoes under 5000");
  const [intents, setIntents] = useState<string[]>([]);
  const [products, setProducts] = useState<DemoProduct[]>([]);
  const [picked, setPicked] = useState<DemoProduct | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (busy || !note.trim()) return;
    setBusy(true);
    setIntents([]);
    setProducts([]);
    setPicked(null);
    const parsed = parseNote(note);

    for (const intent of parsed.chips) {
      await delay(200);
      setIntents((current) => [...current, intent]);
    }

    let nextProducts = SAMPLE_PRODUCTS;
    try {
      const response = await apiFetch("/api/demo/search", {
        method: "POST",
        body: JSON.stringify({
          query: parsed.query,
          ...(parsed.maxPrice != null ? { max_price: parsed.maxPrice } : {}),
          limit: 4,
        }),
      });
      if (response.ok) {
        const body = await response.json();
        if (Array.isArray(body.products) && body.products.length) nextProducts = body.products;
      }
    } catch {
      // The public demo intentionally remains complete when search is unavailable.
    }

    const four = nextProducts.slice(0, 4);
    setProducts(four);
    await delay(400);
    setPicked(four[0] || null);
    setBusy(false);
  };

  return (
    <div className="demo-card" aria-busy={busy}>
      <div className="demo-top">
        <span className="demo-label">Try it</span>
        <div className="demo-live"><ReconnectPill /> live intent</div>
      </div>
      <div className="demo-note">
        <label className="demo-note-label" htmlFor="landing-note">
          <NotebookPen size={13} strokeWidth={1.7} aria-hidden="true" /> Notes
        </label>
        <textarea
          id="landing-note"
          className="demo-textarea"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
        />
        <div className="demo-run-row">
          <div className="demo-intents" aria-live="polite">
            {intents.map((intent, index) => (
              <span className="badge demo-intent" style={{ animationDelay: `${index * 40}ms` }} key={intent}>{intent}</span>
            ))}
          </div>
          <button className="btn btn-primary btn-sm" type="button" onClick={run} disabled={busy || !note.trim()}>
            {busy ? "Working..." : "Run"} <ArrowRight size={13} aria-hidden="true" />
          </button>
        </div>
      </div>

      {products.length > 0 && (
        <div className="demo-results" aria-live="polite">
          {products.map((product, index) => (
            <article className="demo-product" style={{ animationDelay: `${index * 90}ms` }} key={product.id}>
              <DemoImage product={product} />
              <div className="demo-product-info">
                <p className="demo-product-title">{product.title}</p>
                <p className="demo-product-meta">
                  <span>{product.merchant}</span>
                  {product.rating != null && <span><Star size={8} fill="currentColor" aria-hidden="true" /> {product.rating}</span>}
                </p>
                <PriceTag className="demo-product-price" value={Number(product.price || 0)} />
              </div>
            </article>
          ))}
        </div>
      )}

      {picked && (
        <div className="demo-checkout">
          <div>
            <p className="demo-pick-label">PRIVA picked</p>
            <p className="demo-pick-copy">{picked.title} — <PriceTag value={picked.price} /></p>
          </div>
          <Link className="btn btn-primary btn-sm" href="/login">
            Continue in the app <ArrowRight size={12} aria-hidden="true" />
          </Link>
        </div>
      )}
    </div>
  );
}
