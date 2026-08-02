"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../lib/auth";

const NAV = [
  { href: "/dashboard", label: "Chat", icon: "💬" },
  { href: "/notes/new", label: "Notes", icon: "📝" },
  { href: "/shop", label: "Shop", icon: "🛍️" },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const path = usePathname();

  return (
    <main className="app-shell">
      <aside className="app-side">
        <div className="side-logo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/priva.png" alt="PRIVA" />
          <span>PRIVA</span>
        </div>
        <nav className="side-nav">
          {NAV.map((n) => {
            const on = path.startsWith(n.href) && (n.href === "/dashboard" ? path === "/dashboard" : true);
            return (
              <Link key={n.href} href={n.href} className={`side-item${on ? " on" : ""}`}>
                <span className="side-icon">{n.icon}</span>
                <span>{n.label}</span>
                {on && <span className="side-dot" />}
              </Link>
            );
          })}
          {user?.is_admin && (
            <Link href="/admin" className={`side-item${path === "/admin" ? " on" : ""}`}>
              <span className="side-icon">👑</span>
              <span>Admin</span>
              {path === "/admin" && <span className="side-dot" />}
            </Link>
          )}
        </nav>
        <div className="side-user">
          {user && (
            <>
              <div className="side-user-info">
                <b>{user.name || "You"}</b>
                <span className="dim small">{user.phone}</span>
              </div>
              <button className="btn ghost small-btn" onClick={logout}>Log out</button>
            </>
          )}
        </div>
      </aside>
      <div className="app-content">
        <div className="app-topbar">
          <span className="dim small">connected to the live demo backend</span>
          <Link href="/" className="dim small">← back to site</Link>
        </div>
        {children}
      </div>
    </main>
  );
}
