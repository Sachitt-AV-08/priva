"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Logo from "../../components/Logo";
import Spinner from "../../components/Spinner";
import { useAuth } from "../../lib/auth";

function AppInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading, demoLogin } = useAuth();
  const attempted = useRef(false);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (user) router.replace(user.is_admin ? "/admin" : "/dashboard");
  }, [router, user]);

  useEffect(() => {
    if (loading || user || attempted.current) return;
    const userId = params.get("u");
    if (!userId) return;
    attempted.current = true;
    setLinking(true);
    demoLogin(userId)
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : "This sign-in link could not be verified");
        setLinking(false);
      });
  }, [demoLogin, loading, params, user]);

  if (loading || linking || user) {
    return <main className="loading-page"><Spinner label="Opening PRIVA" /></main>;
  }

  return (
    <main className="center-page">
      <section className="center-card">
        <Logo size="large" />
        <h1>Open PRIVA</h1>
        <p>{error || "Use your secure desktop link, or sign in with your phone to continue."}</p>
        <Link className="btn btn-primary" href="/login">
          Continue to login <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </section>
    </main>
  );
}

export default function AppPage() {
  return <Suspense fallback={<main className="loading-page"><Spinner /></main>}><AppInner /></Suspense>;
}
