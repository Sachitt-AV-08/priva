"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AppShell from "../../components/AppShell";
import Chat from "../../components/Chat";
import { useAuth } from "../../lib/auth";
import { apiFetch } from "../../lib/constants";

type Note = {
  id: string;
  title: string;
  blocks: { type: string; content: string }[];
  created_at: number;
};

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    apiFetch("/api/notes")
      .then(async (res) => {
        if (res.ok) setNotes((await res.json()).notes || []);
      })
      .catch(() => {});
  }, [user]);

  if (loading || !user) return <p className="dim">Loading…</p>;

  const text = (n: Note) =>
    (n.blocks || []).filter((b) => b.type === "text").map((b) => b.content).join("\n");

  return (
    <AppShell>
      <section className="section">
        <div className="page-head">
          <h2>Dashboard</h2>
          <Link className="btn primary" href="/notes/new">+ New note</Link>
        </div>

        <div className="grid two">
          <div className="card">
            <h3>📝 Your notes</h3>
            {notes.length === 0 && <p className="dim small">No notes yet — PRIVA turns them into offers texted to your phone.</p>}
            {notes.map((n) => (
              <div className="note-row" key={n.id}>
                <b>{n.title || "Untitled"}</b>
                <p className="dim small">{text(n).slice(0, 140) || "—"}</p>
                <span className="dim tiny">
                  {new Date((n.created_at || 0) * 1000).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
          <div className="card">
            <h3>📦 Recent orders</h3>
            <Orders />
          </div>
        </div>

        <div className="card">
          <Chat />
        </div>
      </section>
    </AppShell>
  );
}

function Orders() {
  const [txns, setTxns] = useState<any[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      apiFetch("/api/transactions")
        .then(async (res) => {
          if (res.ok) {
            const body = await res.json();
            if (alive) setTxns(body.transactions || []);
          }
        })
        .catch(() => {});
    load();
    const t = window.setInterval(load, 5000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);
  if (txns.length === 0) return <p className="dim small">Nothing purchased yet — try the Shop tab.</p>;
  return (
    <ul className="list">
      {txns.map((t) => (
        <li key={t.id} className="item">
          <b>{t.product_title}</b>
          <span className="tag">${t.amount}</span>
          <span className={`tag tag-${t.status || "pending"}`}>{t.status || "pending"}</span>
          <span className="dim tiny">{t.shipping_status || ""}</span>
        </li>
      ))}
    </ul>
  );
}
