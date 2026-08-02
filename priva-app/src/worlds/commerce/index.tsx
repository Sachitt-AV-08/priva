import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PravaSDK, type CollectPANResult } from "@prava-sdk/core";
import {
  ShoppingCart, Search, Star,
  Clock, CheckCircle, CreditCard, ArrowRight, Sparkles, ShieldCheck, ExternalLink, AlertTriangle,
  MessageSquare, Copy, ChevronDown, RefreshCw, Send, Truck, BellRing, Wallet, Pencil, Check,
  Mic, MicOff, Trash2, Volume2,
} from "lucide-react";
import type { Product } from "../../engine/types";
import { api, type PayResponse, type ProductResult, type TransactionResult, type ActivityEvent, type BudgetState, type SpendAnalysis } from "../../engine/apiClient";
import { SkeletonGrid } from "../../components/LoadingSkeleton";
import { useSpeech } from "../../hooks/useSpeech";
import { openExternal } from "../../engine/openExternal";

const PRAVA_PUBKEY_KEY = "priva_prava_publishable_key";
const TEST_CARD = { number: "4622 9431 2323 2341", cvv: "450", expiry: "12/30", otp: "456789" };

const cardVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { duration: 0.2, delay: i * 0.04, ease: "easeOut" },
  }),
};

function ProductCard({ product, onBuy, disabled }: { product: Product; onBuy: (p: Product) => void; disabled: boolean }) {
  return (
    <motion.div
      variants={cardVariants}
      custom={parseInt(product.id) || 0}
      initial="hidden"
      animate="visible"
      className="card p-0 overflow-hidden hover:border-accent/30 hover:shadow-[0_0_20px_rgba(212,175,55,0.08)] transition-all duration-200 group"
    >
      <div className="w-full h-36 bg-surface-3 flex items-center justify-center overflow-hidden">
        {product.image_url ? (
          <img src={product.image_url} alt={product.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
        ) : (
          <ShoppingCart size={32} className="text-text-muted/30" />
        )}
      </div>
      <div className="p-3">
        <div className="flex items-start justify-between gap-2 mb-1">
          <h3 className="text-sm font-medium text-text-primary truncate flex-1">{product.title}</h3>
        </div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-text-muted">{product.source}</span>
          {product.rating ? (
            <span className="flex items-center gap-0.5 text-xs text-accent-orange">
              <Star size={10} fill="currentColor" /> {product.rating}
            </span>
          ) : null}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-base font-bold text-text-primary">${product.price.toFixed(2)}</span>
          <button
            onClick={() => onBuy(product)}
            disabled={disabled}
            className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:bg-accent-hover active:bg-accent-dim transition-all opacity-0 group-hover:opacity-100 disabled:opacity-50 flex items-center gap-1"
          >
            {disabled ? "..." : <>
              Buy <ArrowRight size={12} />
            </>}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

type CheckoutPhase = "confirm" | "creating" | "card" | "completing" | "done" | "error";

function CheckoutModal({ product, onClose, onPaid, publishableKey }: {
  product: Product; onClose: () => void; onPaid: () => void; publishableKey: string;
}) {
  const [phase, setPhase] = useState<CheckoutPhase>("confirm");
  const [error, setError] = useState("");
  const [session, setSession] = useState<PayResponse | null>(null);
  const [card, setCard] = useState<CollectPANResult | null>(null);
  const [formReady, setFormReady] = useState(false);
  const [nearLimit, setNearLimit] = useState<{ left: number; limit: number } | null>(null);
  const [overspend, setOverspend] = useState<{ excess: number; limit: number } | null>(null);
  const [approved, setApproved] = useState(false);
  const formRef = useRef<HTMLDivElement | null>(null);
  const hasStarted = useRef(false);
  const approvedRef = useRef(approved);
  approvedRef.current = approved;
  const overspendRef = useRef(overspend);
  overspendRef.current = overspend;

  useEffect(() => {
    api.getBudget().then((b) => {
      if (b.limit === null) return;
      const after = (b.spent_this_month ?? 0) + product.price;
      if (after > b.limit) {
        setOverspend({ excess: Math.round((after - b.limit) * 100) / 100, limit: b.limit });
      } else if (after >= b.limit * 0.9) {
        setNearLimit({ left: Math.round((b.limit - after) * 100) / 100, limit: b.limit });
      }
    }).catch(() => {});
  }, [product.price]);

  const completeOrder = useCallback(async (sid: string, txnId: string, amount: number) => {
    setPhase("completing");
    try {
      await api.payComplete(sid, txnId, amount, overspendRef.current?.excess);
      setPhase("done");
      onPaid();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment completion could not be confirmed.");
      setPhase("error");
    }
  }, [onPaid]);

  const startPayment = useCallback(async () => {
    setPhase("creating");
    setError("");
    try {
      const res = await api.createPayment({
        product_id: product.id,
        title: product.title,
        price: product.price,
        merchant: product.source,
        thumbnail: product.image_url,
        product_url: product.product_url,
        budget_excess: approvedRef.current ? overspendRef.current?.excess : undefined,
      });
      if (res.error) {
        setError(res.error);
        setPhase("error");
        return;
      }
      setSession(res);
      if (res.session_token && res.iframe_url) {
        setPhase("card");
      } else if (res.payment_url) {
        openExternal(res.payment_url);
        setPhase("done");
        onPaid();
      } else {
        setError("Payment session could not be created.");
        setPhase("error");
      }
    } catch (err) {
      const budgetErr = err as Error & { budgetDetail?: string };
      if (err instanceof Error && err.message === "budget_cap" && budgetErr.budgetDetail) {
        try {
          const d = JSON.parse(budgetErr.budgetDetail);
          if (d?.tier === "exceeds") {
            setOverspend({ excess: d.excess, limit: d.limit });
            setPhase("confirm");
            return;
          }
        } catch { /* not our payload */ }
      }
      setError("Could not reach the payment server. Make sure the backend is running.");
      setPhase("error");
    }
  }, [product, onPaid]);

  useEffect(() => {
    if (phase !== "card" || !session?.session_token || !session.iframe_url) return;
    const formEl = formRef.current;
    if (!formEl) return;

    const key = publishableKey || localStorage.getItem(PRAVA_PUBKEY_KEY) || "";
    if (!key) {
      openExternal(session.iframe_url);
      setPhase("done");
      onPaid();
      return;
    }

    if (hasStarted.current) return;
    hasStarted.current = true;
    let disposed = false;
    const sdk = new PravaSDK({ publishableKey: key });
    sdk.collectPAN({
      sessionToken: session.session_token,
      iframeUrl: session.iframe_url,
      container: formEl,
      onSuccess: (result) => {
        if (disposed) return;
        setCard(result);
        void completeOrder(session.session_id, session.transaction_id || "", product.price);
      },
      onError: (err) => {
        if (disposed) return;
        setError(err?.message || "Card form failed to load.");
        setPhase("error");
      },
      onReady: () => { if (!disposed) setFormReady(true); },
      onChange: () => {},
      onDismiss: () => { if (!disposed) setPhase("confirm"); },
    });
    return () => {
      disposed = true;
      hasStarted.current = false;
      sdk.destroy();
    };
  }, [phase, session, publishableKey, onPaid, completeOrder, product.price]);

  useEffect(() => {
    if (phase !== "card") return;
    const formEl = formRef.current;
    if (!formEl) return;
    const observer = new MutationObserver(() => {
      if (formEl.querySelector("iframe")) setFormReady(true);
    });
    observer.observe(formEl, { childList: true, subtree: true });
    const timeout = setTimeout(() => setFormReady(true), 5000);
    return () => { observer.disconnect(); clearTimeout(timeout); };
  }, [phase, formReady]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="glass-strong rounded-xl p-6 w-80"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-accent/10">
            <CreditCard size={18} className="text-accent" />
          </div>
          <h3 className="text-sm font-semibold text-text-primary">
            {phase === "done" ? "Payment Complete" : phase === "card" ? "Enter Card Details"
              : phase === "completing" ? "Securing Payment" : "Confirm Purchase"}
          </h3>
        </div>

        {phase === "confirm" && (
          <>
            <div className="bg-surface-3 rounded-lg p-3 mb-4 border border-border">
              <div className="text-sm text-text-primary font-medium mb-1">{product.title}</div>
              <div className="text-xs text-text-muted">{product.source}</div>
              <div className="text-lg font-bold text-accent mt-2">${product.price.toFixed(2)}</div>
            </div>
            {nearLimit && !overspend && (
              <div className="mb-4 rounded-lg border border-accent-orange/30 bg-accent-orange/10 p-2.5 text-[11px] text-accent-orange flex items-start gap-2">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                <span>
                  Budget check: this puts you at 90%+ of your ${nearLimit.limit.toFixed(2)} monthly limit —{" "}
                  <span className="font-semibold">${nearLimit.left.toFixed(2)} left</span>.
                </span>
              </div>
            )}
            {overspend && (
              <div className="mb-4 rounded-lg border border-accent-red/40 bg-accent-red/10 p-2.5 text-[11px] text-accent-red flex items-start gap-2">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                <span>
                  Budget cap: this exceeds your ${overspend.limit.toFixed(2)} monthly limit by{" "}
                  <span className="font-semibold">${overspend.excess.toFixed(2)}</span>.{" "}
                  {approved
                    ? "Overspend approved — the excess is borrowed from next month."
                    : "Approve below to borrow the excess from next month."}
                </span>
              </div>
            )}
            <p className="text-xs text-text-muted mb-4 leading-relaxed">
              This will open a secure payment session via <span className="text-accent">Prava</span>. Complete with card + passkey authentication.
            </p>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 py-2 rounded-lg text-xs font-medium border border-border text-text-secondary hover:bg-surface-3 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => (overspend && !approved ? setApproved(true) : startPayment())}
                className="flex-1 py-2 rounded-lg text-xs font-medium bg-accent text-white hover:bg-accent-hover active:bg-accent-dim transition-all flex items-center justify-center gap-1"
              >
                {overspend && !approved ? (
                  <>Approve overspend <ArrowRight size={12} /></>
                ) : (
                  <>Pay <ArrowRight size={12} /></>
                )}
              </button>
            </div>
          </>
        )}

        {phase === "creating" && (
          <div className="py-10 flex flex-col items-center gap-3">
            <div className="w-7 h-7 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
            <p className="text-xs text-text-muted">Creating secure payment session...</p>
          </div>
        )}

        {phase === "card" && (
          <>
            <div className="bg-surface-3 rounded-lg p-3 mb-3 border border-border">
              <div className="text-xs text-text-primary font-medium">{product.title}</div>
              <div className="text-sm font-bold text-accent">${product.price.toFixed(2)}</div>
            </div>
            {!formReady && (
              <div className="flex items-center gap-2 text-[11px] text-text-muted mb-2">
                <div className="w-3.5 h-3.5 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
                Loading secure card form...
              </div>
            )}
            <div ref={formRef} className="mb-3 min-h-[180px]" />
            <p className="text-[10px] text-text-muted flex items-center gap-1">
              <ShieldCheck size={11} className="text-accent-green" />
              Card details are handled securely by Prava. Passkey completes the checkout.
            </p>
            <details className="mt-3 text-[10px] text-text-muted">
              <summary className="cursor-pointer hover:text-text-secondary transition-colors">Sandbox test card</summary>
              <div className="mt-2 bg-surface-3 border border-border rounded-lg p-2.5 space-y-0.5 font-mono">
                <div>Card: {TEST_CARD.number}</div>
                <div>CVV: {TEST_CARD.cvv} · Expiry: {TEST_CARD.expiry}</div>
                <div>OTP (first use): {TEST_CARD.otp}</div>
              </div>
            </details>
          </>
        )}

        {phase === "completing" && (
          <div className="py-10 flex flex-col items-center gap-3">
            <div className="w-7 h-7 rounded-full border-2 border-accent-green/30 border-t-accent-green animate-spin" />
            <p className="text-xs text-text-muted">Confirming payment with Prava...</p>
            <p className="text-[10px] text-text-muted/60">Sending approval to the card network</p>
          </div>
        )}

        {phase === "done" && (
          <>
            <div className="flex flex-col items-center py-6">
              <div className="w-12 h-12 rounded-full bg-accent-green/10 flex items-center justify-center mb-3">
                <CheckCircle size={22} className="text-accent-green" />
              </div>
              {card ? (
                <>
                  <p className="text-sm text-text-primary font-medium mb-1">
                    {card.brand} •••• {card.last4}
                  </p>
                  <p className="text-xs text-text-muted mb-4">Secured with passkey authentication</p>
                </>
              ) : (
                <p className="text-xs text-text-muted mb-4">
                  Payment initiated in the Prava payment window.
                </p>
              )}
              <button
                onClick={onClose}
                className="px-5 py-2 rounded-lg text-xs font-medium bg-accent text-white hover:bg-accent-hover transition-all"
              >
                Done
              </button>
            </div>
          </>
        )}

        {phase === "error" && (
          <>
            <div className="bg-surface-3 rounded-lg p-3 mb-4 border border-accent-red/20 flex items-start gap-2">
              <AlertTriangle size={14} className="text-accent-red shrink-0 mt-0.5" />
              <p className="text-xs text-text-secondary leading-relaxed">{error}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 py-2 rounded-lg text-xs font-medium border border-border text-text-secondary hover:bg-surface-3 transition-all"
              >
                Close
              </button>
              <button
                onClick={startPayment}
                className="flex-1 py-2 rounded-lg text-xs font-medium bg-accent text-white hover:bg-accent-hover transition-all"
              >
                Retry
              </button>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

function mapProduct(r: ProductResult): Product {
  return {
    id: r.id,
    title: r.title,
    price: r.price,
    currency: r.currency || "USD",
    source: r.merchant || "",
    image_url: r.thumbnail || "",
    product_url: r.product_url || "",
    rating: r.rating || 0,
    description: "",
  };
}

function mapTransaction(t: TransactionResult) {
  return {
    id: t.id,
    product_title: t.product_title,
    price: t.amount,
    currency: t.currency || "USD",
    source: t.merchant,
    order_date: t.created_at ? new Date(t.created_at * 1000).toLocaleString() : "",
    status: t.status as "pending" | "completed" | "cancelled",
    prava_status: t.prava_status || "",
    prava_session_id: t.prava_session_id || "",
    image_url: t.thumbnail || "",
    product_url: t.product_url || "",
    shipping_status: t.shipping_status || "",
    shipping_eta: t.shipping_eta || "",
    created_at: t.created_at || 0,
  };
}

type OrderType = ReturnType<typeof mapTransaction>;

const SHIP_STEPS = [
  { key: "confirmed", label: "Confirmed" },
  { key: "shipped", label: "Shipped" },
  { key: "out_for_delivery", label: "Out for delivery" },
  { key: "delivered", label: "Delivered" },
];

function ShippingTimeline({ order, onAdvance }: { order: OrderType; onAdvance: (id: string) => void }) {
  const idx = SHIP_STEPS.findIndex((s) => s.key === order.shipping_status);
  const current = idx === -1 ? 0 : idx;
  return (
    <div className="pt-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-semibold tracking-widest text-text-muted uppercase flex items-center gap-1">
          <Truck size={10} /> Delivery {order.shipping_eta ? `· ETA ${order.shipping_eta}` : ""}
        </span>
        {current < SHIP_STEPS.length - 1 && (
          <button
            onClick={() => onAdvance(order.id)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-surface-3 border border-border text-[10px] text-text-secondary hover:text-accent hover:border-accent/30 transition-all"
          >
            <RefreshCw size={9} /> Advance
          </button>
        )}
      </div>
      <div className="flex items-center gap-1">
        {SHIP_STEPS.map((s, i) => (
          <React.Fragment key={s.key}>
            {i > 0 && <div className={`h-0.5 flex-1 rounded ${i <= current ? "bg-accent-green/60" : "bg-surface-3"}`} />}
            <div className={`w-2 h-2 rounded-full shrink-0 ${i < current ? "bg-accent-green" : i === current ? "bg-accent-green ring-2 ring-accent-green/20" : "bg-surface-4"}`} />
          </React.Fragment>
        ))}
      </div>
      <div className="flex justify-between mt-1">
        {SHIP_STEPS.map((s, i) => (
          <span key={s.key} className={`text-[8px] ${i <= current ? "text-accent-green" : "text-text-muted/60"}`}>{s.label}</span>
        ))}
      </div>
    </div>
  );
}

function BudgetCard() {
  const [budget, setBudget] = useState<BudgetState | null>(null);
  const [analysis, setAnalysis] = useState<SpendAnalysis | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  useEffect(() => {
    api.getBudget().then(setBudget).catch(() => {});
    api.getSpendAnalysis().then((r) => setAnalysis(r.analysis)).catch(() => {});
  }, []);
  const saveBudget = async () => {
    const v = parseFloat(draft);
    if (!Number.isFinite(v) || v <= 0) return;
    try {
      const b = await api.setBudget(v);
      setBudget(b);
      setEditing(false);
    } catch { /* backend down */ }
  };
  const pct = budget?.limit ? Math.min(100, (budget.spent_this_month / budget.limit) * 100) : 0;
  return (
    <div className="px-6 pt-3">
      <div className="card p-3.5">
        <div className="flex items-center gap-2 mb-2.5">
          <Wallet size={13} className="text-accent" />
          <span className="text-[10px] font-semibold tracking-widest text-text-muted uppercase">Monthly budget</span>
          {budget?.month && <span className="text-[10px] text-text-muted">{budget.month}</span>}
          {budget?.limit !== null && !editing && (
            <button
              onClick={() => { setDraft(String(budget?.limit ?? "")); setEditing(true); }}
              className="ml-auto text-text-muted hover:text-accent transition-colors"
              title="Edit budget"
            >
              <Pencil size={11} />
            </button>
          )}
        </div>
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveBudget()}
              placeholder="e.g. 100"
              className="w-28 px-2 py-1.5 text-xs bg-surface-3 border border-border rounded-lg text-text-primary outline-none focus:border-accent/50"
            />
            <button
              onClick={saveBudget}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] bg-accent text-white rounded-lg font-medium hover:bg-accent-hover"
            >
              <Check size={11} /> Set
            </button>
            <button onClick={() => setEditing(false)} className="text-[10px] text-text-muted hover:text-text-secondary">Cancel</button>
          </div>
        ) : budget?.limit === null ? (
          <p className="text-[11px] text-text-muted">
            No limit set —{" "}
            <button className="text-accent underline" onClick={() => { setDraft(""); setEditing(true); }}>
              set a monthly budget
            </button>{" "}
            and PRIVA will warn you before an overspend.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] text-text-secondary">${(budget?.spent_this_month ?? 0).toFixed(2)} spent</span>
              <span className={`text-[11px] font-medium ${pct >= 100 ? "text-accent-red" : "text-text-muted"}`}>
                ${(budget?.remaining ?? 0).toFixed(2)} left of ${budget?.limit?.toFixed(2)}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden mb-2.5">
              <div
                className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-accent-red" : "bg-accent"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            {analysis && analysis.borrowed_into_next > 0 && (
              <div className="mb-2 rounded-md border border-accent-orange/30 bg-accent-orange/10 px-2 py-1 text-[10px] text-accent-orange flex items-center gap-1">
                <AlertTriangle size={10} />
                Overspend approved — ${analysis.borrowed_into_next.toFixed(2)} borrowed from next month's budget.
              </div>
            )}
            {analysis && analysis.by_merchant.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {analysis.by_merchant.slice(0, 3).map((m) => (
                  <span key={m.merchant} className="px-1.5 py-0.5 rounded bg-surface-3 border border-border text-[9px] text-text-muted">
                    {m.merchant} <span className="text-text-secondary">${m.total.toFixed(2)}</span>
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function LinqMirrorChat() {
  const [messages, setMessages] = useState<{ text: string; from: "user" | "agent"; ts: number }[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [ttsOn, setTtsOn] = useState(() => localStorage.getItem("priva_tts") === "1");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const ttsOnRef = useRef(ttsOn);
  ttsOnRef.current = ttsOn;
  const lastSpokenRef = useRef("");
  const busyRef = useRef(false);
  const transcriptVersionRef = useRef(0);

  const speech = useSpeech((text) => {
    setInput(text);
    void sendText(text);
  });

  const speak = useCallback(async (text: string) => {
    if (!ttsOnRef.current || !text.trim() || text === lastSpokenRef.current) return;
    lastSpokenRef.current = text;
    try {
      const blob = await api.textToSpeech(text);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      void audio.play();
    } catch { /* TTS optional */ }
  }, []);

  const poll = useCallback(async () => {
    const version = transcriptVersionRef.current;
    try {
      const res = await api.getTranscript();
      if (version !== transcriptVersionRef.current) return;
      const seen = new Set<string>();
      const next: { text: string; from: "user" | "agent"; ts: number }[] = [];
      const add = (m: { text: string; ts: number }, from: "user" | "agent") => {
        const key = `${from}:${m.ts}:${m.text}`;
        if (seen.has(key)) return;
        seen.add(key);
        next.push({ text: m.text, from, ts: m.ts * 1000 });
      };
      for (const m of res.messages ?? []) add(m, "agent");
      for (const m of res.inbound ?? []) add(m, "user");
      next.sort((a, b) => a.ts - b.ts || (a.from === b.from ? 0 : a.from === "user" ? -1 : 1));
      setMessages(next);
      const lastAgent = [...next].reverse().find((m) => m.from === "agent");
      if (lastAgent && lastAgent.text !== lastSpokenRef.current) void speak(lastAgent.text);
    } catch { /* backend down */ }
  }, [speak]);

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const run = async () => {
      await poll();
      if (!stopped) timer = window.setTimeout(run, 2000);
    };
    void run();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [poll]);

  const nearBottom = () => {
    const el = scrollRef.current;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  useEffect(() => {
    if (nearBottom()) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length]);

  const sendText = async (text: string) => {
    if (!text || busyRef.current) return;
    setInput("");
    busyRef.current = true;
    transcriptVersionRef.current += 1;
    setBusy(true);
    try {
      await api.simulateReply(text);
    } catch { /* backend down */ }
    await new Promise((r) => setTimeout(r, 400));
    await poll();
    busyRef.current = false;
    setBusy(false);
  };

  const send = () => void sendText(input.trim());

  const clearChat = async () => {
    if (!window.confirm("Clear the entire Linq mirror conversation?")) return;
    transcriptVersionRef.current += 1;
    try {
      await api.clearTranscript();
      setMessages([]);
    } catch { /* backend down */ }
  };

  const fmtTime = (ts: number) =>
    new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-6 pt-3 pb-2 border-b border-border/50 flex items-center gap-2">
        <BellRing size={11} className="text-accent" />
        <span className="text-[11px] text-text-muted">
          Linq mirror — identical conversation machine as iMessage ({`+1 213-476-8016`}). Drives the same agent.
        </span>
        <button
          onClick={() => { const v = !ttsOn; setTtsOn(v); localStorage.setItem("priva_tts", v ? "1" : "0"); }}
          title={ttsOn ? "Voice replies ON — click to mute" : "Voice replies OFF — click to enable"}
          className={`ml-auto flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border transition-all ${ttsOn ? "bg-accent/15 border-accent/40 text-accent" : "border-border text-text-muted hover:text-text-secondary"}`}
        >
          <Volume2 size={11} /> Voice {ttsOn ? "ON" : "OFF"}
        </button>
        <button
          onClick={clearChat}
          title="Clear conversation"
          className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border border-border text-text-muted hover:text-red-400 hover:border-red-400/40 transition-all"
        >
          <Trash2 size={11} /> Clear
        </button>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 p-4 space-y-2">
        {messages.length === 0 && (
          <div className="text-center py-10 text-xs text-text-muted">
            No messages yet. Try: <span className="text-text-secondary">YES</span>,{" "}
            <span className="text-text-secondary">BUY NOW</span>, or a product search.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex flex-col ${m.from === "user" ? "items-end" : "items-start"}`}>
            <div
              className={`max-w-[75%] px-3 py-2 rounded-2xl text-xs leading-relaxed whitespace-pre-wrap ${
                m.from === "user"
                  ? "bg-accent text-white rounded-br-sm"
                  : "bg-surface-3 border border-border text-text-primary rounded-bl-sm"
              }`}
            >
              {m.text}
            </div>
            <span className="text-[9px] text-text-muted/60 mt-0.5 px-1">
              {m.from === "user" ? "you" : "PRIVA"} · {fmtTime(m.ts)}
            </span>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="px-3 py-2 rounded-2xl bg-surface-3 border border-border text-[11px] text-text-muted flex items-center gap-2">
              <div className="w-3 h-3 rounded-full border-2 border-accent/30 border-t-accent animate-spin" /> PRIVA is typing...
            </div>
          </div>
        )}
      </div>
      {speech.error && (
        <div className="px-4 py-1 text-[10px] text-red-400">{speech.error}</div>
      )}
      <div className="px-4 py-3 border-t border-border/50 flex gap-2 items-center">
        <button
          onClick={() => void speech.toggle()}
          disabled={speech.busy}
          title={speech.listening ? "Stop & transcribe" : "Speak to PRIVA (voice shopping)"}
          className={`relative shrink-0 w-9 h-9 rounded-full border flex items-center justify-center transition-all ${
            speech.listening
              ? "bg-red-500/20 border-red-500/60 text-red-400 animate-pulse"
              : "border-border text-text-muted hover:text-accent hover:border-accent/50"
          }`}
        >
          {speech.listening ? <MicOff size={14} /> : <Mic size={14} />}
          {speech.listening && <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500" />}
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={speech.busy ? "Listening & transcribing..." : "Reply as if texting PRIVA... or tap the mic"}
          className="flex-1 px-3 py-2 text-xs bg-surface-2 border border-border rounded-lg text-text-primary outline-none placeholder-text-muted/50 focus:border-accent/50 transition-all"
        />
        <button
          onClick={send}
          disabled={busy || !input.trim()}
          className="px-3 py-2 bg-accent text-white rounded-lg text-xs hover:bg-accent-hover transition-all disabled:opacity-40 flex items-center gap-1"
        >
          <Send size={12} /> Send
        </button>
      </div>
    </div>
  );
}

type OrderFilter = "all" | "pending" | "completed" | "cancelled";

const FILTERS: { key: OrderFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
];

export function CommerceWorld() {
  const [searchQuery, setSearchQuery] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [purchases, setPurchases] = useState<ReturnType<typeof mapTransaction>[]>([]);
  const [checkoutProduct, setCheckoutProduct] = useState<Product | null>(null);
  const [activeTab, setActiveTab] = useState<"search" | "orders" | "chat">("search");
  const [isSearching, setIsSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [orderFilter, setOrderFilter] = useState<OrderFilter>("all");
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [publishableKey, setPublishableKey] = useState("");
  const [linqNumber, setLinqNumber] = useState("");
  const [copiedTxn, setCopiedTxn] = useState("");
  const searchRequestRef = useRef(0);

  const handleSearch = useCallback(async (queryOverride?: string) => {
    const query = (queryOverride ?? searchQuery).trim();
    if (!query) return;
    const requestId = ++searchRequestRef.current;
    setIsSearching(true);
    try {
      const res = await api.searchProducts(query);
      if (requestId !== searchRequestRef.current) return;
      setProducts(res.products.map(mapProduct));
      setSearched(true);
    } catch {
      if (requestId === searchRequestRef.current) {
        setProducts([]);
        setSearched(true);
      }
    } finally {
      if (requestId === searchRequestRef.current) setIsSearching(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    api.getConfig()
      .then(cfg => {
        setPublishableKey(cfg.prava_publishable_key || localStorage.getItem(PRAVA_PUBKEY_KEY) || "");
        setLinqNumber(cfg.linq_sandbox_number || "");
      })
      .catch(() => {
        setPublishableKey(localStorage.getItem(PRAVA_PUBKEY_KEY) || "");
      });
  }, []);

  const loadTransactions = useCallback(() => {
    api.getTransactions()
      .then(res => setPurchases(res.transactions.map(mapTransaction)))
      .catch(() => {});
  }, []);

  useEffect(() => { loadTransactions(); }, [loadTransactions]);

  const handleBuy = useCallback((product: Product) => {
    setCheckoutProduct(product);
  }, []);

  const refreshTransactions = useCallback(() => {
    loadTransactions();
  }, [loadTransactions]);

  const handleStatusRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await api.refreshTransactions();
      const scoped = await api.getTransactions();
      setPurchases(scoped.transactions.map(mapTransaction));
    } catch {
      loadTransactions();
    } finally {
      setIsRefreshing(false);
    }
  }, [loadTransactions]);

  const checkOrderStatus = useCallback(async (order: ReturnType<typeof mapTransaction>) => {
    if (!order.prava_session_id) return;
    const prava = await api.getPaymentStatus(order.prava_session_id);
    const pravaStatus = String(prava.status || prava.session_status || "unknown");
    setPurchases(prev => prev.map(p => p.id === order.id ? { ...p, prava_status: pravaStatus } : p));
  }, []);

  const copyTxnId = useCallback((id: string) => {
    navigator.clipboard?.writeText(id).catch(() => {});
    setCopiedTxn(id);
    setTimeout(() => setCopiedTxn(""), 1500);
  }, []);

  const advanceShipping = useCallback(async (id: string) => {
    try {
      const res = await api.advanceShipping(id);
      setPurchases(prev => prev.map(p => p.id === id ? { ...p, shipping_status: res.shipping_status } : p));
    } catch { /* backend down */ }
  }, []);

  const statusPill = (status: string) => {
    const styles: Record<string, string> = {
      completed: "bg-accent-green/10 text-accent-green border-accent-green/20",
      pending: "bg-accent-orange/10 text-accent-orange border-accent-orange/20",
      cancelled: "bg-accent-red/10 text-accent-red border-accent-red/20",
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${styles[status] || "bg-surface-3 text-text-muted border-border"}`}>
        {status}
      </span>
    );
  };

  const filtered = purchases
    .filter(p => orderFilter === "all" || p.status === orderFilter)
    .sort((a, b) => b.created_at - a.created_at);
  const counts = {
    all: purchases.length,
    pending: purchases.filter(p => p.status === "pending").length,
    completed: purchases.filter(p => p.status === "completed").length,
    cancelled: purchases.filter(p => p.status === "cancelled").length,
  };
  const totalSpent = purchases.filter(p => p.status === "completed").reduce((s, p) => s + p.price, 0);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-canvas">
      <div className="px-6 py-4 border-b border-border">
        <div className="flex items-center gap-2 mb-3">
          <div className="p-1.5 rounded-lg bg-accent/10">
            <ShoppingCart size={16} className="text-accent" />
          </div>
          <h1 className="text-lg font-semibold text-text-primary">Commerce</h1>
          <span className="text-[10px] text-text-muted bg-surface-3 px-1.5 py-0.5 rounded-full border border-border/50">AI-Powered</span>
        </div>
        <div className="flex gap-0 border-b border-border -mx-6 px-6">
          <button onClick={() => setActiveTab("search")}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-all ${activeTab === "search" ? "text-accent border-accent" : "text-text-muted border-transparent hover:text-text-secondary"}`}>
            <Search size={12} className="inline mr-1" /> Search Products
          </button>
          <button onClick={() => setActiveTab("orders")}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-all ${activeTab === "orders" ? "text-accent border-accent" : "text-text-muted border-transparent hover:text-text-secondary"}`}>
            <Clock size={12} className="inline mr-1" /> Order History
          </button>
          <button onClick={() => setActiveTab("chat")}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-all ${activeTab === "chat" ? "text-accent border-accent" : "text-text-muted border-transparent hover:text-text-secondary"}`}>
            <MessageSquare size={12} className="inline mr-1" /> Linq Chat
          </button>
        </div>
      </div>

      {activeTab === "chat" && <LinqMirrorChat />}

      {activeTab === "search" && (
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="px-6 py-3 border-b border-border/50">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  placeholder="Search products... (e.g. 'noise cancelling headphones')"
                  className="w-full pl-9 pr-3 py-2 text-sm bg-surface-2 border border-border rounded-lg text-text-primary outline-none placeholder-text-muted/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
                />
              </div>
              <button
                onClick={() => void handleSearch()}
                disabled={isSearching || !searchQuery.trim()}
                className="px-3 py-2 bg-accent text-white rounded-lg text-xs font-medium hover:bg-accent-hover active:bg-accent-dim transition-all disabled:opacity-40 flex items-center gap-1"
              >
                {isSearching ? "..." : <><Search size={13} /> Search</>}
              </button>
            </div>
          </div>

          <AnimatePresence mode="wait">
            {isSearching ? (
              <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="px-4 pt-3 pb-1">
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <Sparkles size={12} className="text-accent animate-pulse-soft" />
                    Searching the web for "{searchQuery}"...
                  </div>
                </div>
                <SkeletonGrid count={6} />
              </motion.div>
            ) : products.length > 0 ? (
              <motion.div key="results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="px-4 pt-3 pb-1">
                  <div className="text-xs text-text-muted">Found {products.length} products</div>
                </div>
                <div className="grid grid-cols-3 gap-3 p-4">
                  {products.map((product) => (
                    <ProductCard key={product.id} product={product} onBuy={handleBuy} disabled={isSearching} />
                  ))}
                </div>
              </motion.div>
            ) : searched ? (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex items-center justify-center py-24">
                <div className="text-center max-w-xs">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-surface-3 flex items-center justify-center">
                    <Search size={28} className="text-text-muted/30" />
                  </div>
                  <p className="text-sm text-text-secondary font-medium mb-1">No results found</p>
                  <p className="text-xs text-text-muted leading-relaxed">Try a different search term or browse categories like "headphones", "shoes", or "speakers"</p>
                </div>
              </motion.div>
            ) : (
              <motion.div key="initial" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex items-center justify-center py-24">
                <div className="text-center max-w-xs">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-accent/20 to-accent/5 flex items-center justify-center border border-accent/10">
                    <ShoppingCart size={28} className="text-accent/50" />
                  </div>
                  <p className="text-sm text-text-secondary font-medium mb-2">Search with natural language</p>
                  <p className="text-xs text-text-muted leading-relaxed mb-4">
                    Type any product you want and PRIVA will search across stores, compare prices, and help you buy — all in one place.
                  </p>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {["wireless headphones", "running shoes", "mechanical keyboard", "usb hub"].map((suggestion) => (
                      <button
                        key={suggestion}
                        onClick={() => { setSearchQuery(suggestion); void handleSearch(suggestion); }}
                        className="px-2.5 py-1.5 text-[10px] bg-surface-3 border border-border rounded-lg text-text-muted hover:text-text-secondary hover:border-border-active transition-all"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {activeTab === "orders" && (
        <div className="flex-1 overflow-y-auto min-h-0">
          <BudgetCard />
          <div className="px-6 pt-3 pb-2 border-b border-border/50 flex items-center gap-4">
            <div className="text-[11px] text-text-muted">
              <span className="text-text-primary font-semibold text-sm">{purchases.length}</span> orders
              <span className="mx-2 text-border-active">·</span>
              <span className="text-text-primary font-semibold text-sm">${totalSpent.toFixed(2)}</span> spent
            </div>
            <button
              onClick={handleStatusRefresh}
              disabled={isRefreshing}
              className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-surface-3 border border-border text-text-secondary hover:text-text-primary hover:border-border-active transition-all disabled:opacity-50"
            >
              <RefreshCw size={11} className={isRefreshing ? "animate-spin" : ""} />
              {isRefreshing ? "Syncing..." : "Sync payment status"}
            </button>
          </div>
          <div className="flex gap-1 px-6 py-2.5 border-b border-border/50">
            {FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setOrderFilter(f.key)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                  orderFilter === f.key
                    ? "bg-accent/15 text-accent border border-accent/30"
                    : "text-text-muted hover:text-text-secondary border border-transparent"
                }`}
              >
                {f.label} <span className="opacity-60">{counts[f.key]}</span>
              </button>
            ))}
          </div>
          {filtered.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-center">
                <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-surface-3 flex items-center justify-center">
                  <ShoppingCart size={24} className="text-text-muted/30" />
                </div>
                <p className="text-sm text-text-secondary font-medium mb-1">
                  {purchases.length === 0 ? "No orders yet" : `No ${orderFilter} orders`}
                </p>
                <p className="text-xs text-text-muted">Your purchase history will appear here</p>
              </div>
            </div>
          ) : (
            <div className="p-4 space-y-2">
              {filtered.map((p) => (
                <div key={p.id} className="card overflow-hidden">
                  <button
                    onClick={() => setExpandedOrder(expandedOrder === p.id ? null : p.id)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-surface-2/60 transition-all text-left"
                  >
                    <div className="w-11 h-11 bg-surface-3 rounded-lg overflow-hidden flex items-center justify-center shrink-0">
                      {p.image_url ? (
                        <img src={p.image_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <ShoppingCart size={16} className="text-text-muted/50" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-text-primary truncate">{p.product_title}</div>
                      <div className="text-[11px] text-text-muted">{p.source} · {p.order_date}</div>
                    </div>
                    <div className="text-right flex flex-col items-end gap-1">
                      <div className="text-sm font-medium text-text-primary">${p.price.toFixed(2)}</div>
                      {statusPill(p.status)}
                    </div>
                    <ChevronDown size={13} className={`text-text-muted transition-transform ${expandedOrder === p.id ? "rotate-180" : ""}`} />
                  </button>
                  <AnimatePresence>
                    {expandedOrder === p.id && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="border-t border-border/50 bg-surface-2/50"
                      >
                        <div className="px-3 py-3 space-y-2 text-[11px]">
                          <div className="flex items-center justify-between">
                            <span className="text-text-muted">Order ID</span>
                            <span className="flex items-center gap-1.5 font-mono text-text-secondary">
                              {p.id}
                              <button onClick={() => copyTxnId(p.id)} className="hover:text-accent transition-colors">
                                {copiedTxn === p.id ? <CheckCircle size={11} className="text-accent-green" /> : <Copy size={11} />}
                              </button>
                            </span>
                          </div>
                          <div className="rounded-lg border border-accent-green/20 bg-accent-green/5 p-2.5">
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <ShieldCheck size={11} className="text-accent-green" />
                              <span className="text-[10px] font-semibold tracking-widest text-accent-green uppercase">Payment proof</span>
                              <span className="ml-auto text-text-primary font-mono text-xs">${p.price.toFixed(2)} USD</span>
                            </div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-text-muted">Prava session</span>
                              <span className="font-mono text-text-secondary">
                                {p.prava_session_id ? (
                                  <>
                                    {p.prava_session_id.slice(0, 18)}...
                                    <button onClick={() => copyTxnId(p.prava_session_id)} className="ml-1 hover:text-accent transition-colors">
                                      {copiedTxn === p.prava_session_id ? <CheckCircle size={10} className="text-accent-green" /> : <Copy size={10} />}
                                    </button>
                                  </>
                                ) : "—"}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-text-muted">Prava status</span>
                              <span className="text-text-secondary">{p.prava_status || "not checked"}</span>
                            </div>
                          </div>
                          {p.shipping_status && <ShippingTimeline order={p} onAdvance={advanceShipping} />}
                          <div className="flex gap-2 pt-1">
                            {p.prava_session_id && (
                              <button
                                onClick={() => checkOrderStatus(p)}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-surface-3 border border-border text-text-secondary hover:text-text-primary hover:border-border-active transition-all"
                              >
                                <RefreshCw size={10} /> Check status
                              </button>
                            )}
                            {p.product_url && (
                              <a
                                href={p.product_url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-surface-3 border border-border text-text-secondary hover:text-text-primary hover:border-border-active transition-all"
                              >
                                <ExternalLink size={10} /> View product
                              </a>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "search" && linqNumber && (
        <div className="px-6 py-3 border-t border-border/50 flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-accent/10">
            <MessageSquare size={13} className="text-accent" />
          </div>
          <p className="text-[11px] text-text-muted">
            Shop by text — message <span className="text-text-secondary font-medium">{linqNumber}</span>{" "}
            something like "buy noise cancelling headphones under $100" and PRIVA handles the rest.
          </p>
        </div>
      )}

      <AnimatePresence>
        {checkoutProduct && (
          <CheckoutModal
            key="checkout"
            product={checkoutProduct}
            publishableKey={publishableKey}
            onClose={() => setCheckoutProduct(null)}
            onPaid={refreshTransactions}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
