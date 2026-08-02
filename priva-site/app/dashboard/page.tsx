"use client";

import { useCallback, useEffect, useState } from "react";
import { NotebookPen, PackageOpen, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "../../components/AppShell";
import Chat from "../../components/Chat";
import PriceTag from "../../components/PriceTag";
import Spinner from "../../components/Spinner";
import { useAuth } from "../../lib/auth";
import { apiFetch } from "../../lib/backend";

type NoteBlock = { type: string; content?: string };
type Note = {
  id: string;
  title?: string;
  blocks?: NoteBlock[];
  created_at?: number;
};
type Transaction = {
  id: string;
  product_title?: string;
  merchant?: string;
  amount?: number;
  status?: string;
  created_at?: number | string;
};

function notePreview(note: Note) {
  return (note.blocks || [])
    .filter((block) => block.type !== "divider" && block.content)
    .map((block) => block.content)
    .join(" ")
    .trim();
}

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [notes, setNotes] = useState<Note[]>([]);
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const loadNotes = useCallback(async () => {
    try {
      const [notesResponse, analysisResponse] = await Promise.all([
        apiFetch("/api/notes"),
        apiFetch("/api/notes/analyze"),
      ]);
      if (notesResponse.ok) {
        const body = await notesResponse.json();
        setNotes(body.notes || []);
      }
      if (analysisResponse.ok) {
        const body = await analysisResponse.json();
        const next: Record<string, string> = {};
        for (const entry of body.notes || []) {
          if (entry.id) next[entry.id] = entry.category || "general";
        }
        setCategories(next);
      }
    } catch {
      // ReconnectPill reports transient failures.
    }
  }, []);

  const loadTransactions = useCallback(async () => {
    try {
      const response = await apiFetch("/api/transactions");
      if (!response.ok) return;
      const body = await response.json();
      setTransactions(body.transactions || []);
    } catch {
      // ReconnectPill reports transient failures.
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    loadNotes();
    loadTransactions();
    const timer = window.setInterval(loadTransactions, 5000);
    return () => window.clearInterval(timer);
  }, [loadNotes, loadTransactions, user]);

  if (loading || !user) {
    return <main className="loading-page"><Spinner /></main>;
  }

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <p className="page-kicker">Your assistant</p>
          <h1>Conversation</h1>
          <p className="page-description">One thread across web, desktop, and your phone.</p>
        </div>
        <Link className="btn btn-primary" href="/notes?new=1">
          <Plus size={15} aria-hidden="true" />
          New note
        </Link>
      </header>

      <Chat />

      <div className="dashboard-grid">
        <section className="card summary-panel">
          <header className="summary-heading">
            <h2><NotebookPen size={16} strokeWidth={1.8} aria-hidden="true" /> Your notes</h2>
            <span className="muted tiny mono">{notes.length}</span>
          </header>
          {notes.length === 0 ? (
            <div className="empty-state">Start with a thought. PRIVA will find the intent inside it.</div>
          ) : (
            <div className="summary-list">
              {notes.slice(0, 5).map((note) => (
                <Link href={`/notes?id=${encodeURIComponent(note.id)}`} className="summary-row" key={note.id}>
                  <div className="summary-row-title">
                    <span>{note.title || "Untitled"}</span>
                    <span className="badge">{categories[note.id] || "general"}</span>
                  </div>
                  <div className="summary-preview">{notePreview(note) || "No content yet"}</div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="card summary-panel">
          <header className="summary-heading">
            <h2><PackageOpen size={16} strokeWidth={1.8} aria-hidden="true" /> Recent orders</h2>
            <span className="muted tiny">updates every 5s</span>
          </header>
          {transactions.length === 0 ? (
            <div className="empty-state">No purchases yet. Your considered picks will appear here.</div>
          ) : (
            <div className="summary-list">
              {[...transactions].sort((a, b) => {
                const time = (value: Transaction["created_at"]) => {
                  if (typeof value === "number") return value;
                  return value ? new Date(value).getTime() : 0;
                };
                return time(b.created_at) - time(a.created_at);
              }).slice(0, 5).map((transaction) => (
                <div className="summary-row" key={transaction.id}>
                  <div className="summary-row-title">
                    <span>{transaction.product_title || "Purchase"}</span>
                    <PriceTag value={Number(transaction.amount || 0)} />
                  </div>
                  <div className="summary-row-meta">
                    <span>{transaction.merchant || "Merchant"}</span>
                    <span className={`badge tag-${transaction.status || "pending"}`}>
                      {(transaction.status || "pending").replaceAll("_", " ")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
