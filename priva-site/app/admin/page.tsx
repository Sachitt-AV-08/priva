"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity as ActivityIcon, MessageSquare, ShieldCheck, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import AppShell from "../../components/AppShell";
import Spinner from "../../components/Spinner";
import { useAuth } from "../../lib/auth";
import { apiFetch } from "../../lib/backend";

type AdminUser = {
  user_id: string;
  name?: string;
  phone?: string;
  is_admin?: boolean;
  created_at?: number;
  last_active?: number;
  notes?: number;
  transactions?: number;
  messages?: number;
};
type ActivityEvent = {
  agent?: string;
  text?: string;
  message?: string;
  detail?: string;
  note_id?: string;
  ts?: number;
};
type Message = { text: string; ts: number; thread_id?: string };
type Thread = { messages?: Message[]; inbound?: Message[] };

function formatTime(timestamp?: number) {
  if (!timestamp) return "—";
  return new Date(timestamp * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading) {
      if (!user) router.replace("/login");
      else if (!user.is_admin) router.replace("/dashboard");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!user?.is_admin) return;
    let alive = true;
    const load = async () => {
      try {
        const [usersResponse, activityResponse] = await Promise.all([
          apiFetch("/api/admin/users"),
          apiFetch("/api/admin/activity"),
        ]);
        if (!alive) return;
        if (usersResponse.ok) setUsers((await usersResponse.json()).users || []);
        if (activityResponse.ok) setActivity((await activityResponse.json()).events || []);
        setError("");
      } catch (reason) {
        if (alive) setError(reason instanceof Error ? reason.message : "Admin data is reconnecting");
      }
    };
    load();
    const timer = window.setInterval(load, 3000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [user?.is_admin]);

  useEffect(() => {
    if (!selected) {
      setThread(null);
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const response = await apiFetch(`/api/admin/users/${encodeURIComponent(selected.user_id)}/transcript`);
        if (response.ok && alive) setThread(await response.json());
      } catch {
        // Retain the last transcript during reconnects.
      }
    };
    load();
    const timer = window.setInterval(load, 3000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [selected]);

  const messages = useMemo(() => [
    ...(thread?.inbound || []).map((message) => ({ ...message, direction: "in" as const })),
    ...(thread?.messages || []).map((message) => ({ ...message, direction: "out" as const })),
  ].sort((a, b) => a.ts - b.ts), [thread]);

  if (loading || !user || !user.is_admin) {
    return <main className="loading-page"><Spinner /></main>;
  }

  const noteCount = users.reduce((sum, item) => sum + Number(item.notes || 0), 0);
  const orderCount = users.reduce((sum, item) => sum + Number(item.transactions || 0), 0);

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <p className="page-kicker">Private operations</p>
          <h1>Owner Console</h1>
          <p className="page-description">Users, agent activity, and mirrored SMS threads in one considered view.</p>
        </div>
        <span className="badge"><ShieldCheck size={13} aria-hidden="true" /> Admin access</span>
      </header>

      <div className="admin-stats">
        <section className="card stat">
          <p className="stat-label"><Users size={12} aria-hidden="true" /> Users</p>
          <p className="stat-value">{users.length}</p>
        </section>
        <section className="card stat">
          <p className="stat-label">Notes</p>
          <p className="stat-value">{noteCount}</p>
        </section>
        <section className="card stat">
          <p className="stat-label">Orders</p>
          <p className="stat-value">{orderCount}</p>
        </section>
      </div>

      <div className="admin-grid">
        <section className="card admin-panel">
          <h2>People</h2>
          {error && <p className="err small" role="alert">{error}</p>}
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Notes</th>
                  <th>Orders</th>
                  <th>Messages</th>
                  <th>Last active</th>
                </tr>
              </thead>
              <tbody>
                {users.map((item) => (
                  <tr
                    className={selected?.user_id === item.user_id ? "sel" : ""}
                    key={item.user_id}
                    tabIndex={0}
                    aria-selected={selected?.user_id === item.user_id}
                    onClick={() => {
                      setThread(null);
                      setSelected(item);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setThread(null);
                        setSelected(item);
                      }
                    }}
                  >
                    <td>
                      {item.name || "Unnamed"}
                      {item.is_admin && <span className="badge admin-owner">owner</span>}
                    </td>
                    <td className="mono muted">{item.phone || "—"}</td>
                    <td className="admin-number">{item.notes || 0}</td>
                    <td className="admin-number">{item.transactions || 0}</td>
                    <td className="admin-number">{item.messages || 0}</td>
                    <td className="muted tiny">{formatTime(item.last_active)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {users.length === 0 && <div className="empty-state">No users are available yet.</div>}
        </section>

        <section className="card admin-panel">
          <h2><ActivityIcon size={15} aria-hidden="true" /> Agent activity</h2>
          <div className="feed">
            {activity.length === 0 ? (
              <div className="empty-state">Agent events will appear as notes move through the workflow.</div>
            ) : activity.map((event, index) => (
              <article className="feed-row" key={`${event.ts || 0}-${index}`}>
                <div className="feed-agent">
                  <span className="badge">{event.agent || "PRIVA"}</span>
                  <span className="trace-time">{event.ts ? new Date(event.ts * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "now"}</span>
                </div>
                <p className="feed-message">{event.text || event.message || "Agent update"}</p>
                {event.detail && <p className="feed-detail">{event.detail}</p>}
              </article>
            ))}
          </div>
        </section>
      </div>

      {selected && (
        <section className="card admin-thread">
          <header className="summary-heading">
            <h2><MessageSquare size={15} aria-hidden="true" /> {selected.name || selected.phone || "User"}</h2>
            <span className="mono muted tiny">{selected.phone}</span>
          </header>
          <div className="chat-box">
            {messages.length === 0 ? (
              <div className="empty-state">No messages in this thread.</div>
            ) : messages.map((message, index) => (
              <div className={`bubble-wrap ${message.direction}`} key={`${message.direction}-${message.ts}-${index}`}>
                <div className={`bubble ${message.direction}`}>{message.text}</div>
                <span className="bubble-time">{new Date(message.ts * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </AppShell>
  );
}
