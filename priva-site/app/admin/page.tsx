"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "../../components/AppShell";
import { useAuth } from "../../lib/auth";
import { apiFetch } from "../../lib/constants";

type AdminUser = {
  user_id: string;
  name: string;
  phone: string;
  is_admin: boolean;
  last_active: number;
  created_at: number;
  notes: number;
  transactions: number;
  messages: number;
};

type Activity = { agent: string; message: string; detail: string; ts: number };

export default function AdminPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [thread, setThread] = useState<{ messages: any[]; inbound: any[] } | null>(null);
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
    const load = () =>
      Promise.all([
        apiFetch("/api/admin/users").then(async (r) => (r.ok ? r.json() : null)),
        apiFetch("/api/admin/activity").then(async (r) => (r.ok ? r.json() : null)),
      ])
        .then(([u, a]) => {
          if (!alive) return;
          if (u) setUsers(u.users || []);
          if (a) setActivity(a.events || []);
        })
        .catch((e) => setError(e instanceof Error ? e.message : "Backend unreachable"));
    load();
    const t = window.setInterval(load, 3000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [user?.is_admin]);

  useEffect(() => {
    if (!selected) return;
    let alive = true;
    const load = () =>
      apiFetch(`/api/admin/users/${selected.user_id}/transcript`)
        .then(async (r) => {
          if (r.ok && alive) setThread(await r.json());
        })
        .catch(() => {});
    load();
    const t = window.setInterval(load, 3000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [selected]);

  if (loading || !user || !user.is_admin) return <p className="dim">Loading…</p>;

  const rows = [
    ...(thread?.inbound || []).map((m) => ({ dir: "in", text: m.text, ts: m.ts })),
    ...(thread?.messages || []).map((m) => ({ dir: "out", text: m.text, ts: m.ts })),
  ].sort((a, b) => a.ts - b.ts);

  return (
    <AppShell>
      <section className="section">
        <h2>🔐 Owner console</h2>
        <p className="dim small">
          Every user has a real phone number, a real SMS thread, and a mirror chat that shows on
          their website + desktop app. This console sees all of them.
        </p>

        <div className="grid two">
          <div className="card">
            <h3>Users ({users.length})</h3>
            {error && <p className="err">{error}</p>}
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Notes</th>
                  <th>Orders</th>
                  <th>Msgs</th>
                  <th>Active</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr
                    key={u.user_id}
                    className={selected?.user_id === u.user_id ? "sel" : ""}
                    onClick={() => setSelected(u)}
                  >
                    <td>
                      {u.name || "—"} {u.is_admin && <b className="tag">owner</b>}
                    </td>
                    <td className="dim">{u.phone}</td>
                    <td>{u.notes}</td>
                    <td>{u.transactions}</td>
                    <td>{u.messages}</td>
                    <td className="dim tiny">
                      {u.last_active ? new Date(u.last_active * 1000).toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h3>📡 Agent activity</h3>
            <div className="feed">
              {activity.length === 0 && <p className="dim small">No events yet.</p>}
              {activity.map((e, i) => (
                <div key={i} className="feed-row">
                  <span className="tag">{e.agent}</span>
                  <span>{e.message}</span>
                  <span className="dim small">{e.detail}</span>
                  <span className="dim tiny">
                    {new Date(e.ts * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {selected && (
          <div className="card">
            <h3>💬 {selected.name || selected.phone} — SMS thread</h3>
            <div className="chat-box">
              {rows.length === 0 && <p className="dim small">No messages.</p>}
              {rows.map((m, i) => (
                <div key={i} className={`bubble ${m.dir}`}>
                  <span className="bubble-text">{m.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </AppShell>
  );
}
