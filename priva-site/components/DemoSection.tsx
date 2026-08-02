"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { analyzeNote, CATEGORY_LABEL, type Analysis } from "../lib/fallbackAnalyzer";
import { apiFetch } from "../lib/constants";

const SAMPLE_NOTES = [
  "need a usb-c hub for travel, under 300",
  "out of coffee beans, get me a bag of medium roast",
  "call the dentist\npick up prescription at pharmacy\ngym tomorrow at 7am",
  "want to buy a 4k monitor for the home office, budget 2000",
  "book flight to goa for the weekend, need it before friday",
];

type DemoState = {
  note: string;
  analysis: Analysis | null;
  source: "backend" | "local" | "error";
  error: string;
  busy: boolean;
};

type PhoneState = {
  phone: string;
  status: "idle" | "sending" | "ok" | "error";
  detail: string;
};

const BLOCK = (n: string) => ({
  id: "demo-block",
  type: "text",
  content: n.split("\n")[1] || "",
});

function toAnalysis(json: any): Analysis {
  return {
    buy_intents: (json.buy_intents || []).map((it: any) => ({
      item: it.item,
      price_hint: it.price_hint,
      raw: it.raw,
    })),
    todos: json.todos || [],
    reminders: (json.reminders || []).map((r: any) => ({
      text: r.text,
      due: new Date(r.due_at * 1000).toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      }),
    })),
    category: json.category || "general",
    summary: json.summary || "",
  };
}

export default function DemoSection() {
  const [state, setState] = useState<DemoState>({ note: SAMPLE_NOTES[0], analysis: null, source: "local", error: "", busy: false });
  const [phone, setPhone] = useState<PhoneState>({ phone: "", status: "idle", detail: "" });
  const ranRef = useRef(false);

  const runAnalysis = useCallback(async (note: string) => {
    setState((s) => ({ ...s, busy: true, error: "" }));
    try {
      const res = await apiFetch("/api/notes/analyze-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "web-demo",
          title: note.split("\n")[0].slice(0, 40),
          blocks: [BLOCK(note)],
          tags: [],
          created_at: 0,
          updated_at: 0,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        setState({ note, analysis: toAnalysis(json), source: "backend", error: "", busy: false });
        return;
      }
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      setState({
        note,
        analysis: analyzeNote(note),
        source: "local",
        error: err instanceof Error ? err.message : "unreachable",
        busy: false,
      });
    }
  }, []);

  useEffect(() => {
    if (!ranRef.current) {
      ranRef.current = true;
      runAnalysis(SAMPLE_NOTES[0]);
    }
  }, [runAnalysis]);

  const registerPhone = async () => {
    const digits = phone.phone.replace(/\D/g, "");
    if (digits.length < 8) {
      setPhone((p) => ({ ...p, status: "error", detail: "Enter a valid phone number with country code (e.g. 1 917 555 0132)." }));
      return;
    }
    setPhone((p) => ({ ...p, status: "sending", detail: "" }));
    try {
      const res = await apiFetch("/api/demo/register-phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: digits, send_test: true }),
      });
      const json = await res.json();
      if (!res.ok) {
        setPhone({ ...phone, status: "error", detail: json.detail || "Registration failed." });
        return;
      }
      setPhone({
        phone: phone.phone,
        status: "ok",
        detail: `Registered ${json.effective}. PRIVA just texted you — reply anything to start shopping.`,
      });
    } catch {
      setPhone({ ...phone, status: "error", detail: "Demo backend unreachable — it runs on the demo machine. Try again in a moment." });
    }
  };

  const a = state.analysis;

  return (
    <div className="demo-wrap">
      <div className="demo-col">
        <label className="field-label">1 · Paste a note, then hit analyze</label>
        <textarea
          className="note-input"
          value={state.note}
          rows={4}
          onChange={(e) => setState((s) => ({ ...s, note: e.target.value }))}
          placeholder="e.g. need a usb-c hub for travel, under 300"
        />
        <div className="chips">
          {SAMPLE_NOTES.map((n) => (
            <button key={n} className="chip" onClick={() => runAnalysis(n)}>{n.split(",")[0]}</button>
          ))}
        </div>
        <button className="btn primary big" disabled={state.busy} onClick={() => runAnalysis(state.note)}>
          {state.busy ? "Analyzing…" : "Analyze note"}
        </button>
        <p className="dim small">
          {state.source === "backend"
            ? "✓ analyzed by the live PRIVA agent"
            : state.source === "error"
              ? `Demo backend offline (${state.error}) — showing built-in analyzer.`
              : "Showing built-in analyzer."}
        </p>

        <div className="phone-box">
          <label className="field-label">2 · Get the SMS experience — enter your phone</label>
          <div className="phone-row">
            <input
              className="phone-input"
              placeholder="+1 917 555 0132"
              value={phone.phone}
              onChange={(e) => setPhone((p) => ({ ...p, phone: e.target.value }))}
            />
            <button className="btn" disabled={phone.status === "sending"} onClick={registerPhone}>
              {phone.status === "sending" ? "Registering…" : "Text me"}
            </button>
          </div>
          {phone.status === "ok" && <p className="ok">✓ {phone.detail}</p>}
          {phone.status === "error" && <p className="err">{phone.detail}</p>}
          <p className="dim small">
            PRIVA will text you offers and reminders to this number via Linq SMS (sandbox). No data stored.
          </p>
        </div>
      </div>

      <div className="demo-col result">
        {!a ? (
          <p className="dim">Analyze a note to see what PRIVA extracts…</p>
        ) : (
          <>
            <div className="result-head">
              <span className={`cat cat-${a.category}`}>{CATEGORY_LABEL[a.category] || a.category}</span>
              <span className="dim small">{a.summary}</span>
            </div>

            <h4>🛒 Buy intents</h4>
            {a.buy_intents.length === 0 ? (
              <p className="dim small">None detected.</p>
            ) : (
              <ul className="list">
                {a.buy_intents.map((it, i) => (
                  <li key={i} className="item">
                    <b>{it.item}</b>
                    {it.price_hint != null && <span className="tag">under ${it.price_hint}</span>}
                    <span className="dim small">→ PRIVA will text you to confirm</span>
                  </li>
                ))}
              </ul>
            )}

            <h4>✅ Todos</h4>
            {a.todos.length === 0 ? (
              <p className="dim small">None detected.</p>
            ) : (
              <ul className="list">
                {a.todos.map((t, i) => (
                  <li key={i} className="item dim">☐ {t}</li>
                ))}
              </ul>
            )}

            <h4>⏰ Reminders</h4>
            {a.reminders.length === 0 ? (
              <p className="dim small">None detected.</p>
            ) : (
              <ul className="list">
                {a.reminders.map((r, i) => (
                  <li key={i} className="item dim">🔔 {r.text} <span className="tag">{r.due}</span></li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
