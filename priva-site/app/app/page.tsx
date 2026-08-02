"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../lib/auth";

function AppInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, demoLogin } = useAuth();

  useEffect(() => {
    if (user) {
      router.replace("/dashboard");
      return;
    }
    const uid = params.get("u");
    if (uid) {
      demoLogin(uid)
        .then(() => router.replace("/dashboard"))
        .catch(() => router.replace("/login"));
    }
  }, [user, params, demoLogin, router]);

  return (
    <main className="site">
      <nav className="nav">
        <a className="logo" href="/">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/priva.png" alt="PRIVA" />
          <span>PRIVA</span>
        </a>
        <div className="nav-links">
          <Link href="/">Home</Link>
          <Link href="/login">Log in</Link>
        </div>
      </nav>
      <section className="login-wrap">
        <div className="card login-card center">
          <h2>Scan → you're in</h2>
          <p className="dim">
            This page is what your phone lands on after scanning the QR code in the PRIVA
            desktop app — it logs you in instantly and opens your dashboard.
          </p>
          <Link className="btn primary" href="/login">Go to login</Link>
        </div>
      </section>
    </main>
  );
}

export default function AppPage() {
  return (
    <Suspense>
      <AppInner />
    </Suspense>
  );
}
