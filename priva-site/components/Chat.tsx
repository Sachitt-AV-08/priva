"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, MessageSquare, Send, Smartphone, Trash2 } from "lucide-react";
import Link from "next/link";
import { apiFetch } from "../lib/backend";

type Message = {
  text: string;
  ts: number;
  thread_id: string;
};

type Row = Message & { direction: "in" | "out"; lastInbound?: boolean };

function sameMessages(current: Message[], next: Message[]) {
  return current.length === next.length && current.every((message, index) =>
    message.text === next[index]?.text &&
    message.ts === next[index]?.ts &&
    message.thread_id === next[index]?.thread_id
  );
}

function formatTime(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getBuyLink(text: string): string | null {
  if (!/^PRIVA\b/i.test(text.trim()) || !/\$\s*\d/.test(text)) return null;
  const match = text.match(
    /mentions buying\s+(.+?)(?=\s+(?:for|under|at|around|within)\s+\$|[.!?](?:\s|$)|$)/i
  );
  const item = match?.[1]?.trim().replace(/["'“”]+/g, "");
  if (!item || item.length < 2 || item.length > 100) return null;
  return `/shop?q=${encodeURIComponent(item)}`;
}

export default function Chat() {
  const [outbound, setOutbound] = useState<Message[]>([]);
  const [inbound, setInbound] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [simulatedText, setSimulatedText] = useState("");
  const [busy, setBusy] = useState<"send" | "reply" | "clear" | "">("");
  const [error, setError] = useState("");
  const transcriptRef = useRef<HTMLDivElement>(null);
  const transcriptVersion = useRef(0);

  const loadTranscript = useCallback(async () => {
    const version = transcriptVersion.current;
    try {
      const response = await apiFetch("/api/linq/transcript");
      if (!response.ok) return;
      const body = await response.json();
      if (version !== transcriptVersion.current) return;
      const nextOutbound = body.messages || [];
      const nextInbound = body.inbound || [];
      setOutbound((current) => sameMessages(current, nextOutbound) ? current : nextOutbound);
      setInbound((current) => sameMessages(current, nextInbound) ? current : nextInbound);
    } catch {
      // ReconnectPill owns transient network feedback.
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const poll = async () => {
      await loadTranscript();
      if (!stopped) timer = window.setTimeout(poll, 3000);
    };
    poll();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [loadTranscript]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [inbound, outbound]);

  const activeThread = [...inbound, ...outbound]
    .sort((a, b) => b.ts - a.ts)[0]?.thread_id;

  const sendMessage = async (event?: FormEvent) => {
    event?.preventDefault();
    const message = text.trim();
    if (!message || busy) return;
    setBusy("send");
    setError("");
    transcriptVersion.current += 1;
    try {
      const response = await apiFetch("/api/linq/send", {
        method: "POST",
        body: JSON.stringify({ text: message, ...(activeThread ? { thread_id: activeThread } : {}) }),
      });
      const body = await response.json();
      if (!response.ok || body.error) throw new Error(body.error || body.detail || "Message was not sent");
      setText("");
      await loadTranscript();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Message was not sent");
    } finally {
      setBusy("");
    }
  };

  const simulateReply = async (event?: FormEvent) => {
    event?.preventDefault();
    const message = simulatedText.trim();
    if (!message || busy) return;
    setBusy("reply");
    setError("");
    transcriptVersion.current += 1;
    try {
      const response = await apiFetch("/api/linq/simulate-reply", {
        method: "POST",
        body: JSON.stringify({ text: message, ...(activeThread ? { thread_id: activeThread } : {}) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || "Reply was not received");
      setSimulatedText("");
      await loadTranscript();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Reply was not received");
    } finally {
      setBusy("");
    }
  };

  const clearTranscript = async () => {
    if (busy || !window.confirm("Clear this SMS conversation?")) return;
    setBusy("clear");
    setError("");
    transcriptVersion.current += 1;
    try {
      const query = activeThread ? `?thread_id=${encodeURIComponent(activeThread)}` : "";
      const response = await apiFetch(`/api/linq/transcript${query}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.detail || "Conversation was not cleared");
      }
      setInbound([]);
      setOutbound([]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Conversation was not cleared");
    } finally {
      setBusy("");
    }
  };

  const lastInbound = [...inbound].sort((a, b) => b.ts - a.ts)[0];
  const rows: Row[] = [
    ...inbound.map((message) => ({
      ...message,
      direction: "in" as const,
      lastInbound: message === lastInbound,
    })),
    ...outbound.map((message) => ({ ...message, direction: "out" as const })),
  ].sort((a, b) => a.ts - b.ts);

  return (
    <section className="card chat-card" aria-label="SMS conversation">
      <header className="chat-head">
        <div className="chat-title">
          <MessageSquare size={16} strokeWidth={1.8} aria-hidden="true" />
          <span>SMS conversation — same thread as your phone</span>
        </div>
        <div className="btn-row">
          <span className="muted tiny">polls every 3s</span>
          <button className="btn btn-ghost btn-sm" type="button" onClick={clearTranscript} disabled={Boolean(busy) || !activeThread}>
            <Trash2 size={13} aria-hidden="true" />
            {busy === "clear" ? "Clearing..." : "Clear"}
          </button>
        </div>
      </header>

      <div className="chat-box" ref={transcriptRef} role="log" aria-live="polite" aria-label="SMS messages">
        {rows.length === 0 && (
          <div className="empty-state">
            No messages yet. Save a note and PRIVA will text you here.
          </div>
        )}
        {rows.map((message, index) => {
          const buyLink = message.direction === "in" && message.lastInbound
            ? getBuyLink(message.text)
            : null;
          return (
            <div
              className={`bubble-wrap ${message.direction}`}
              key={`${message.direction}-${message.thread_id}-${message.ts}-${index}`}
            >
              <div className={`bubble ${message.direction}`}>{message.text}</div>
              <span className="bubble-time">{formatTime(message.ts)}</span>
              {buyLink && (
                <Link className="chip buy-chip" href={buyLink}>
                  Buy now <ArrowRight size={12} aria-hidden="true" />
                </Link>
              )}
            </div>
          );
        })}
      </div>

      <div className="chat-composer">
        <form className="chat-actions" onSubmit={sendMessage}>
          <input
            className="chat-input"
            placeholder="Message PRIVA"
            aria-label="Message PRIVA"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <button className="btn btn-primary" type="submit" disabled={Boolean(busy) || !text.trim()}>
            <Send size={14} aria-hidden="true" />
            {busy === "send" ? "Sending..." : "Send"}
          </button>
        </form>
        <form className="chat-actions" onSubmit={simulateReply}>
          <input
            className="chat-input"
            placeholder="Simulate your phone replying (demo): e.g. black, 8-in-1"
            aria-label="Simulate your phone replying"
            value={simulatedText}
            onChange={(event) => setSimulatedText(event.target.value)}
          />
          <button className="btn btn-ghost" type="submit" disabled={Boolean(busy) || !simulatedText.trim()}>
            <Smartphone size={14} aria-hidden="true" />
            {busy === "reply" ? "Replying..." : "Reply as phone"}
          </button>
        </form>
        {error && <p className="err chat-error" role="alert">{error}</p>}
      </div>
    </section>
  );
}
