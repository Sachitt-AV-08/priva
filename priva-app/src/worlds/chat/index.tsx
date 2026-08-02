import React, { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquareText, Send, Smartphone, Eraser } from "lucide-react";
import type { World } from "../types";
import { api } from "../../engine/apiClient";

type Msg = { text: string; ts: number };

function fmt(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function ChatContent() {
  const [rows, setRows] = useState<{ dir: "in" | "out"; text: string; ts: number }[]>([]);
  const [text, setText] = useState("");
  const [sim, setSim] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const transcriptVersion = useRef(0);

  const load = useCallback(async () => {
    const version = transcriptVersion.current;
    try {
      const body = await api.getTranscript();
      if (version !== transcriptVersion.current) return;
      const merged = [
        ...(body.inbound || []).map((m) => ({ dir: "in" as const, text: m.text, ts: m.ts })),
        ...(body.messages || []).map((m) => ({ dir: "out" as const, text: m.text, ts: m.ts })),
      ].sort((a, b) => a.ts - b.ts);
      setRows(merged);
    } catch {
      /* offline */
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const poll = async () => {
      await load();
      if (!stopped) timer = window.setTimeout(poll, 3000);
    };
    void poll();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [load]);

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight });
  }, [rows]);

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setError("");
    transcriptVersion.current += 1;
    try {
      const res = await api.sendSms(t);
      if (!res.sent) setError(res.error || "Send failed — backend off?");
      else setText("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backend unreachable");
    } finally {
      setBusy(false);
    }
  };

  const simulate = async () => {
    const t = sim.trim();
    if (!t || busy) return;
    setBusy(true);
    setError("");
    transcriptVersion.current += 1;
    try {
      await api.simulateReply(t);
      setSim("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backend unreachable");
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!rows.length || !window.confirm("Clear this Linq conversation?")) return;
    transcriptVersion.current += 1;
    try {
      await api.clearTranscript();
      setRows([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Conversation could not be cleared");
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <MessageSquareText size={15} className="text-accent" />
          SMS conversation — same thread as your phone and the web app
          <span className="text-[10px] text-text-muted">(polls every 3s)</span>
        </div>
        <button
          onClick={clear}
          disabled={!rows.length || busy}
          className="flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text-secondary px-2 py-1 rounded-lg hover:bg-surface-3 transition-all"
        >
          <Eraser size={12} /> Clear
        </button>
      </div>

      <div ref={boxRef} className="flex-1 min-h-0 overflow-y-auto space-y-2 p-3 rounded-xl bg-surface-1/70 border border-border/60">
        {rows.length === 0 && (
          <p className="text-center text-xs text-text-muted pt-10">
            No messages yet — save a note and PRIVA will text you here.
          </p>
        )}
        {rows.map((m, i) => (
          <div key={i} className={`flex ${m.dir === "out" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[75%] px-3.5 py-2 rounded-2xl text-[13px] leading-relaxed ${
                m.dir === "out"
                  ? "bg-gradient-to-r from-accent to-accent-bright text-white rounded-br-md shadow-[0_2px_12px_rgba(212,175,55,0.20)]"
                  : "bg-surface-3 text-text-primary rounded-bl-md"
              }`}
            >
              <div className="break-words whitespace-pre-wrap">{m.text}</div>
              <div className={`text-[9px] mt-1 ${m.dir === "out" ? "text-[#14120b]/65" : "text-text-muted"}`}>
                {m.dir === "out" ? "PRIVA → your phone" : "you → PRIVA"} · {fmt(m.ts)}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 space-y-2">
        <div className="flex gap-2">
          <input
            className="flex-1 bg-surface-2 border border-border rounded-lg px-3.5 py-2.5 text-sm text-text-primary outline-none focus:border-accent/60 placeholder-text-muted"
            placeholder="Text PRIVA… (delivered to your real phone via Linq)"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <button
            onClick={send}
            disabled={busy}
            className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-accent to-accent-bright text-white text-sm px-4 hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50"
          >
            <Send size={14} /> Send
          </button>
        </div>
        <div className="flex gap-2">
          <input
            className="flex-1 bg-surface-2 border border-border/60 rounded-lg px-3.5 py-2 text-sm text-text-primary outline-none focus:border-accent/40 placeholder-text-muted"
            placeholder="Simulate your phone replying (demo): e.g. black, 8-in-1"
            value={sim}
            onChange={(e) => setSim(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && simulate()}
          />
          <button
            onClick={simulate}
            disabled={busy}
            className="flex items-center gap-2 rounded-lg bg-surface-3 border border-border text-text-secondary text-sm px-4 hover:bg-surface-2 transition-all disabled:opacity-50"
          >
            <Smartphone size={14} /> Reply as phone
          </button>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}

export const ChatWorld: World = {
  id: "chat",
  label: "Chat",
  icon: "chat",
  category: "utilities",
  accentColor: "#d4af37",
  description: "The live SMS conversation — mirrored with your phone and the web app.",
  Content: ChatContent,
};
