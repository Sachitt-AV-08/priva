"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../lib/auth";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, demoLogin, requestOtp, verifyOtp } = useAuth();

  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState("");
  const [inlineOtp, setInlineOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (user) {
      router.replace(user.is_admin ? "/admin" : "/dashboard");
      return;
    }
    const uid = params.get("u");
    if (uid) {
      demoLogin(uid)
        .then(() => router.replace("/dashboard"))
        .catch((e) => setError(e.message || "Deep link login failed"));
    }
  }, [user, params, demoLogin, router]);

  const askCode = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const body = await requestOtp(phone, name);
      setInlineOtp(body.otp || "");
      setStep("otp");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send code");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await verifyOtp(phone, otp);
      router.replace("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid code");
    } finally {
      setBusy(false);
    }
  };

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
          <Link href="/login" className="on">Log in</Link>
        </div>
      </nav>

      <section className="login-wrap">
        <div className="card login-card">
          <h2>Where Notes becomes Purchase</h2>
          <p className="dim small">
            Sign up with your phone — PRIVA texts you on real SMS via Linq, and this same
            conversation shows up in the desktop app.
          </p>

          {step === "phone" ? (
            <>
              <label className="field-label">Phone (country code first)</label>
              <input
                className="phone-input"
                placeholder="+1 917 555 0132"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <label className="field-label">Name</label>
              <input
                className="phone-input"
                placeholder="Alex"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <button className="btn primary big" disabled={busy} onClick={askCode}>
                {busy ? "Sending…" : "Send me a code"}
              </button>
            </>
          ) : (
            <>
              <label className="field-label">Code sent to {phone}</label>
              {inlineOtp && (
                <p className="ok">
                  Demo mode: your code is <b>{inlineOtp}</b>
                </p>
              )}
              <input
                className="phone-input"
                placeholder="6-digit code"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
              />
              <div className="btn-row">
                <button className="btn primary big" disabled={busy} onClick={submit}>
                  {busy ? "Checking…" : "Log in"}
                </button>
                <button className="btn ghost" onClick={() => setStep("phone")}>Back</button>
              </div>
            </>
          )}

          {error && <p className="err">{error}</p>}
        </div>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
