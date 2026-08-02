"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/constants";

type Msg = { text: string; ts: number; thread_id: string };

function fmt(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export default function Chat() {
  const [outbound, setOutbound] = useState<Msg[]>([]);
  const [inbound, setInbound] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [simText, setSimText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/linq/transcript");
      if (!res.ok) return;
      const body = await res.json();
      setOutbound(body.messages || []);
      setInbound(body.inbound || []);
    } catch {
      /* backend offline */
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 3000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight });
  }, [outbound, inbound]);

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch("/api/linq/send", { method: "POST", body: JSON.stringify({ text: t }) });
      const body = await res.json();
      if (!res.ok || body.error) {
        setError(body.error || body.detail || "Send failed — is the backend on?");
      } else {
        setText("");
      }
      await load();
    } catch {
      setError("Backend unreachable");
    } finally {
      setBusy(false);
    }
  };

  const simulate = async () => {
    const t = simText.trim();
    if (!t || busy) return;
    setBusy(true);
    setError("");
    try {
      await apiFetch("/api/linq/simulate-reply", { method: "POST", body: JSON.stringify({ text: t }) });
      setSimText("");
      await load();
    } catch {
      setError("Backend unreachable");
    } finally {
      setBusy(false);
    }
  };

  const rows: { dir: "in" | "out"; text: string; ts: number }[] = [
    ...inbound.map((m) => ({ dir: "in" as const, text: m.text, ts: m.ts })),
    ...outbound.map((m) => ({ dir: "out" as const, text: m.text, ts: m.ts })),
  ].sort((a, b) => a.ts - b.ts);

  return (
    <div className="chat">
      <div className="chat-head">
        <span>💬 SMS conversation — same thread as your phone</span>
        <span className="dim small">polls every 3s</span>
      </div>
      <div className="chat-box" ref={boxRef}>
        {rows.length === 0 && <p className="dim small">No messages yet. Save a note and PRIVA will text you here.</p>}
        {rows.map((m, i) => (
          <div key={i} className={`bubble ${m.dir}`}>
            <span className="bubble-text">{m.text}</span>
            <span className="bubble-time">{fmt(m.ts)}</span>
          </div>
        ))}
      </div>
      <div className="chat-actions">
        <input
          className="chat-input"
          placeholder="Text PRIVA… (goes to your real phone via Linq)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button className="btn" disabled={busy} onClick={send}>Send</button>
      </div>
      <div className="chat-actions">
        <input
          className="chat-input"
          placeholder="Simulate your phone replying (demo): e.g. black, 8-in-1"
          value={simText}
          onChange={(e) => setSimText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && simulate()}
        />
        <button className="btn ghost" disabled={busy} onClick={simulate}>Reply as phone</button>
      </div>
      {error && <p className="err small">{error}</p>}
    </div>
  );
}
