"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "../../../components/AppShell";
import { useAuth } from "../../../lib/auth";
import { apiFetch } from "../../../lib/constants";

const SAMPLE_NOTES = [
  "need a usb-c hub for travel, under 300",
  "out of coffee beans, get me a bag of medium roast",
  "want a 4k monitor for the home office, budget 2000",
  "winter jacket for seattle, waterproof, under 400",
];

type Analysis = {
  buy_intents: { item: string; price_hint?: number; raw?: string }[];
  todos: string[];
  reminders: { text: string; due_at: number }[];
  category: string;
  summary: string;
};

export default function NewNotePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [note, setNote] = useState(SAMPLE_NOTES[0]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const analyze = async () => {
    if (!note.trim()) return;
    setAnalyzing(true);
    setError("");
    try {
      const res = await apiFetch("/api/notes/analyze-text", {
        method: "POST",
        body: JSON.stringify({
          id: "preview",
          title: note.split("\n")[0].slice(0, 40),
          blocks: [{ type: "text", content: note }],
          tags: [],
          created_at: 0,
          updated_at: 0,
        }),
      });
      if (!res.ok) throw new Error("analyze failed");
      setAnalysis(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backend unreachable");
    } finally {
      setAnalyzing(false);
    }
  };

  const save = async () => {
    if (!note.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch("/api/notes", {
        method: "POST",
        body: JSON.stringify({
          id: `web-${Date.now()}`,
          title: note.split("\n")[0].slice(0, 60),
          blocks: [{ type: "text", content: note }],
          tags: [],
          created_at: Math.floor(Date.now() / 1000),
          updated_at: Math.floor(Date.now() / 1000),
        }),
      });
      if (!res.ok) throw new Error("save failed");
      router.push("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backend unreachable");
      setSaving(false);
    }
  };

  return (
    <AppShell>
      <section className="section">
        <h2>New note</h2>
        <p className="dim">Type it like you would in Notes. PRIVA texts you a preference question, then ships you the best buy.</p>
        <div className="grid two">
          <div className="card">
            <textarea
              className="note-input"
              rows={6}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="chips">
              {SAMPLE_NOTES.map((n) => (
                <button key={n} className="chip" onClick={() => setNote(n)}>
                  {n.split(",")[0]}
                </button>
              ))}
            </div>
            <div className="btn-row">
              <button className="btn" disabled={analyzing} onClick={analyze}>
                {analyzing ? "Analyzing…" : "Analyze preview"}
              </button>
              <button className="btn primary" disabled={saving} onClick={save}>
                {saving ? "Saving…" : "Save note & text me"}
              </button>
            </div>
            {error && <p className="err">{error}</p>}
          </div>
          <div className="card">
            <h3>What PRIVA sees</h3>
            {!analysis ? (
              <p className="dim small">Hit “Analyze preview”…</p>
            ) : (
              <>
                <p className="dim small">{analysis.summary}</p>
                <h4>🛒 Buy intents</h4>
                <ul className="list">
                  {(analysis.buy_intents || []).map((it, i) => (
                    <li key={i} className="item">
                      <b>{it.item}</b>
                      {it.price_hint != null && <span className="tag">under ${it.price_hint}</span>}
                    </li>
                  ))}
                </ul>
                {(analysis.todos || []).length > 0 && (
                  <>
                    <h4>✅ Todos</h4>
                    <ul className="list">
                      {analysis.todos.map((t, i) => (
                        <li key={i} className="item dim">☐ {t}</li>
                      ))}
                    </ul>
                  </>
                )}
                {(analysis.reminders || []).length > 0 && (
                  <>
                    <h4>⏰ Reminders</h4>
                    <ul className="list">
                      {analysis.reminders.map((r, i) => (
                        <li key={i} className="item dim">
                          🔔 {r.text}{" "}
                          <span className="tag">
                            {new Date(r.due_at * 1000).toLocaleString(undefined, {
                              month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                            })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </section>
    </AppShell>
  );
}
