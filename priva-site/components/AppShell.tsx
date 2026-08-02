"use client";

import {
  ArrowLeft,
  ListTodo,
  LogOut,
  MessageSquare,
  NotebookPen,
  Share2,
  Shield,
  ShoppingBag,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "../lib/auth";
import Logo from "./Logo";
import ReconnectPill from "./ReconnectPill";

const NAV = [
  { href: "/dashboard", label: "Chat", icon: MessageSquare },
  { href: "/notes", label: "Notes", icon: NotebookPen },
  { href: "/tasks", label: "Tasks", icon: ListTodo },
  { href: "/shop", label: "Shop", icon: ShoppingBag },
  { href: "/purchase-graph", label: "Purchase Graph", icon: Share2 },
];

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Chat",
  "/notes": "Notes",
  "/tasks": "Tasks",
  "/shop": "Shop",
  "/checkout": "Checkout",
  "/purchase-graph": "Purchase Graph",
  "/admin": "Admin",
};

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const title = Object.entries(PAGE_TITLES).find(([path]) => pathname.startsWith(path))?.[1] || "PRIVA";

  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === href : pathname.startsWith(href);

  const logOut = () => {
    window.sessionStorage.removeItem("priva_pending");
    logout();
    router.replace("/login");
  };

  return (
    <main className="app-shell">
      <aside className="app-side" aria-label="Primary navigation">
        <div className="side-logo"><Logo /></div>
        <nav className="side-nav">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`side-item${isActive(item.href) ? " on" : ""}`}
                data-tooltip={item.label}
                aria-label={item.label}
                aria-current={isActive(item.href) ? "page" : undefined}
              >
                <span className="side-icon"><Icon size={17} strokeWidth={1.8} aria-hidden="true" /></span>
                <span className="side-label">{item.label}</span>
              </Link>
            );
          })}
          {user?.is_admin && (
            <Link
              href="/admin"
              className={`side-item${pathname.startsWith("/admin") ? " on" : ""}`}
              data-tooltip="Admin"
              aria-label="Admin"
              aria-current={pathname.startsWith("/admin") ? "page" : undefined}
            >
              <span className="side-icon"><Shield size={17} strokeWidth={1.8} aria-hidden="true" /></span>
              <span className="side-label">Admin</span>
            </Link>
          )}
        </nav>
        <div className="side-user">
          {user && (
            <div className="side-user-info">
              <span className="side-user-name">{user.name || "You"}</span>
              <span className="side-user-phone">{user.phone}</span>
            </div>
          )}
          <button className="btn btn-ghost btn-sm side-logout" type="button" onClick={logOut} title="Log out" aria-label="Log out">
            <LogOut size={14} aria-hidden="true" />
            <span className="logout-label">Log out</span>
          </button>
        </div>
      </aside>

      <div className="app-main">
        <header className="app-topbar">
          <div className="app-topbar-left">
            <h1 className="app-page-title">{title}</h1>
            <ReconnectPill />
          </div>
          <div className="app-topbar-right">
            <Link href="/" className="back-to-site" aria-label="Back to site">
              <ArrowLeft size={13} aria-hidden="true" />
              <span className="back-to-site-label">back to site</span>
            </Link>
          </div>
        </header>
        <div className="app-content">{children}</div>
      </div>
    </main>
  );
}
