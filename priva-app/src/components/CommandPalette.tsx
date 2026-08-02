import React, { useState, useEffect, useRef, useCallback } from "react";
import { Search, ShoppingCart, Star, Command, Mic, MicOff } from "lucide-react";
import { useStore } from "../store";
import { api } from "../engine/apiClient";
import { useSpeech } from "../hooks/useSpeech";

export function CommandPalette() {
  const { commandPaletteOpen, setCommandPaletteOpen } = useStore();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const speech = useSpeech((text) => {
    setQuery(text.trim());
    void search(text.trim());
  });

  useEffect(() => {
    if (commandPaletteOpen) {
      setQuery("");
      setResults([]);
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [commandPaletteOpen]);

  useEffect(() => {
    if (!commandPaletteOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCommandPaletteOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [commandPaletteOpen, setCommandPaletteOpen]);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await api.searchProducts(q);
      setResults(res.products);
      setSelectedIdx(0);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => search(query), 200);
    return () => clearTimeout(timer);
  }, [query, search]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, results.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
    if (e.key === "Enter" && results[selectedIdx]) {
      window.open(results[selectedIdx].product_url || results[selectedIdx].merchant_url, "_blank");
      setCommandPaletteOpen(false);
    }
  };

  if (!commandPaletteOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={() => setCommandPaletteOpen(false)}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-xl glass-strong rounded-2xl overflow-hidden animate-scale-in shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search size={16} className="text-text-muted shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search products, notes, tasks..."
            className="flex-1 bg-transparent text-sm text-text-primary outline-none placeholder-text-muted/50"
          />
          <button
            onClick={() => void speech.toggle()}
            title={speech.listening ? "Stop & transcribe" : "Speak a product search"}
            className={`shrink-0 w-8 h-8 rounded-full border flex items-center justify-center transition-all ${
              speech.listening
                ? "bg-red-500/20 border-red-500/60 text-red-400 animate-pulse"
                : "border-border text-text-muted hover:text-accent hover:border-accent/50"
            }`}
          >
            {speech.listening ? <MicOff size={13} /> : <Mic size={13} />}
          </button>
          <kbd className="text-[9px] text-text-muted bg-surface-4 px-1.5 py-0.5 rounded">ESC</kbd>
        </div>

        <div className="max-h-80 overflow-y-auto">
          {loading ? (
            <div className="px-4 py-8 text-center">
              <div className="text-sm text-text-muted animate-pulse-soft">Searching...</div>
            </div>
          ) : results.length > 0 ? (
            results.map((product, i) => (
              <button
                key={product.id}
                onClick={() => { window.open(product.product_url || product.merchant_url, "_blank"); setCommandPaletteOpen(false); }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  i === selectedIdx ? "bg-accent/10 text-text-primary" : "text-text-secondary hover:bg-surface-3"
                }`}
              >
                <div className="w-8 h-8 bg-surface-3 rounded-lg flex items-center justify-center shrink-0">
                  {product.thumbnail ? (
                    <img src={product.thumbnail} alt="" className="w-full h-full object-cover rounded-lg" />
                  ) : (
                    <ShoppingCart size={14} className="text-text-muted" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{product.title}</div>
                  <div className="text-[10px] text-text-muted flex items-center gap-2">
                    <span>{product.merchant}</span>
                    {product.rating && (
                      <span className="flex items-center gap-0.5">
                        <Star size={9} className="text-accent-orange" fill="currentColor" />
                        {product.rating}
                      </span>
                    )}
                  </div>
                </div>
                <span className="text-sm font-semibold text-text-primary shrink-0">${product.price.toFixed(2)}</span>
              </button>
            ))
          ) : query.trim() ? (
            <div className="px-4 py-8 text-center">
              <Search size={24} className="mx-auto mb-2 text-text-muted/20" />
              <p className="text-sm text-text-muted">No results for "{query}"</p>
            </div>
          ) : (
            <div className="px-4 py-8 text-center">
              <Command size={24} className="mx-auto mb-2 text-text-muted/20" />
              <p className="text-sm text-text-muted">Search products across the web</p>
              <p className="text-[10px] text-text-muted/50 mt-1">Type a product name to search via SerpApi</p>
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-border flex items-center gap-4 text-[10px] text-text-muted">
          <span><kbd className="text-[9px] bg-surface-4 px-1 rounded">↑↓</kbd> Navigate</span>
          <span><kbd className="text-[9px] bg-surface-4 px-1 rounded">↵</kbd> Open</span>
          <span><kbd className="text-[9px] bg-surface-4 px-1 rounded">Esc</kbd> Close</span>
        </div>
      </div>
    </div>
  );
}
