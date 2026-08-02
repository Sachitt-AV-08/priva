"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../lib/auth";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const path = usePathname();

  return (
    <main className="site app-area">
      <nav className="nav">
        <div className="logo">
          <span className="logo-mark">P</span>
          <span>PRIVA</span>
        </div>
        <div className="nav-links">
          <Link className={path === "/dashboard" ? "on" : ""} href="/dashboard">Dashboard</Link>
          <Link className={path === "/notes/new" ? "on" : ""} href="/notes/new">New note</Link>
          <Link className={path === "/shop" ? "on" : ""} href="/shop">Shop</Link>
          {user?.is_admin && <Link className={path === "/admin" ? "on" : ""} href="/admin">Admin</Link>}
        </div>
        <div className="nav-user">
          {user && (
            <>
              <span className="dim small">
                {user.name || "You"} · {user.phone}
                {user.is_admin && <b className="tag">owner</b>}
              </span>
              <button className="btn ghost small-btn" onClick={logout}>Log out</button>
            </>
          )}
        </div>
      </nav>
      {children}
    </main>
  );
}
