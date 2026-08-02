"use client";

import { FormEvent, Suspense, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, LockKeyhole } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import Logo from "../../components/Logo";
import Spinner from "../../components/Spinner";
import { useAuth } from "../../lib/auth";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading, demoLogin, requestOtp, verifyOtp } = useAuth();
  const attemptedDeepLink = useRef(false);
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState("");
  const [inlineOtp, setInlineOtp] = useState("");
  const [delivery, setDelivery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (user) router.replace(user.is_admin ? "/admin" : "/dashboard");
  }, [user, router]);

  useEffect(() => {
    const userId = params.get("u");
    if (loading || !userId || user || attemptedDeepLink.current) return;
    attemptedDeepLink.current = true;
    setBusy(true);
    demoLogin(userId)
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : "Deep link login failed");
        setBusy(false);
      });
  }, [demoLogin, loading, params, user]);

  const askCode = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await requestOtp(phone.trim(), name.trim());
      setInlineOtp(response.otp || "");
      setDelivery(response.delivery || "sms");
      setStep("otp");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not send code");
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || otp.length !== 6) return;
    setBusy(true);
    setError("");
    try {
      await verifyOtp(phone.trim(), otp);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Invalid or expired code");
      setBusy(false);
    }
  };

  if (loading || (busy && params.get("u"))) {
    return <main className="loading-page"><Spinner label="Signing you in" /></main>;
  }

  return (
    <main className="auth-page">
      <section className="card login-card" aria-labelledby="login-heading">
        <div className="login-brand">
          <Logo size="large" />
        </div>
        <h1 id="login-heading">Where Notes Become Purchases.</h1>
        <p className="login-intro">
          One quiet place for notes, conversations, and considered purchases.
        </p>

        {step === "phone" ? (
          <form className="login-fields" onSubmit={askCode}>
            <div>
              <label className="field-label" htmlFor="phone">Phone number</label>
              <input
                id="phone"
                className="field"
                type="tel"
                autoComplete="tel"
                placeholder="+1 917 555 0132"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                required
              />
            </div>
            <div>
              <label className="field-label" htmlFor="name">Name</label>
              <input
                id="name"
                className="field"
                type="text"
                autoComplete="name"
                placeholder="Alex"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <button className="btn btn-primary btn-lg" type="submit" disabled={busy}>
              {busy ? "Sending..." : "Continue"}
            </button>
          </form>
        ) : (
          <form className="login-fields" onSubmit={submitCode}>
            {inlineOtp ? (
              <div className="otp-callout">
                <span>Demo OTP</span>
                <code>{inlineOtp}</code>
              </div>
            ) : (
              <div className="otp-callout">
                <span>Code sent to {phone} via {delivery === "sms" ? "SMS" : delivery}</span>
                <Check size={15} aria-hidden="true" />
              </div>
            )}
            <div>
              <label className="field-label" htmlFor="otp">Six-digit code</label>
              <input
                id="otp"
                className="field otp-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                value={otp}
                onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
                autoFocus
                required
              />
            </div>
            <div className="login-actions">
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => {
                  setStep("phone");
                  setOtp("");
                  setError("");
                }}
              >
                <ArrowLeft size={15} aria-hidden="true" />
                Back
              </button>
              <button className="btn btn-primary btn-lg" type="submit" disabled={busy || otp.length !== 6}>
                <LockKeyhole size={15} aria-hidden="true" />
                {busy ? "Checking..." : "Log in"}
              </button>
            </div>
          </form>
        )}

        {error && <p className="err login-error" role="alert">{error}</p>}
      </section>
    </main>
  );
}

export default function LoginPage() {
  return <Suspense fallback={<main className="loading-page"><Spinner /></main>}><LoginInner /></Suspense>;
}
