import React, { useState } from "react";
import { MessageSquareText, Phone, User, KeyRound, LogIn } from "lucide-react";
import { api } from "../engine/apiClient";
import { Logo } from "./Logo";

export function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState("");
  const [inlineOtp, setInlineOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const askCode = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const body = await api.requestOtp(phone, name);
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
      await api.verifyOtp(phone, otp);
      onLogin();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid code");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 w-full flex flex-col items-center justify-center bg-canvas relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none opacity-60"
        style={{
          background:
            "radial-gradient(600px 300px at 50% 0%, rgba(212,175,55,0.12), transparent), radial-gradient(500px 260px at 80% 100%, rgba(183,110,121,0.08), transparent)",
        }}
      />

      <div className="relative w-[380px] max-w-[92vw]">
        <div className="flex flex-col items-center gap-3 mb-8 justify-center">
          <Logo size="large" />
          <div className="text-[10px] text-text-muted uppercase tracking-widest">Personal Retail Intelligence</div>
        </div>

        <div className="bg-surface-2 border border-border rounded-2xl p-6 space-y-4">
          {step === "phone" ? (
            <>
              <label className="flex items-center gap-2 text-xs font-medium text-text-secondary uppercase tracking-wide">
                <Phone size={13} className="text-accent" /> Phone (country code first)
              </label>
              <input
                className="w-full bg-surface-1 border border-border rounded-lg px-3.5 py-2.5 text-sm text-text-primary outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/30 placeholder-text-muted"
                placeholder="+1 917 555 0132"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <label className="flex items-center gap-2 text-xs font-medium text-text-secondary uppercase tracking-wide">
                <User size={13} className="text-accent" /> Name
              </label>
              <input
                className="w-full bg-surface-1 border border-border rounded-lg px-3.5 py-2.5 text-sm text-text-primary outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/30 placeholder-text-muted"
                placeholder="Alex"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <button
                onClick={askCode}
                disabled={busy}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-accent to-accent-bright text-white font-medium text-sm py-2.5 hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-50"
              >
                <MessageSquareText size={15} /> {busy ? "Sending…" : "Send me a code (SMS via Linq)"}
              </button>
            </>
          ) : (
            <>
              <label className="flex items-center gap-2 text-xs font-medium text-text-secondary uppercase tracking-wide">
                <KeyRound size={13} className="text-accent" /> Code sent to {phone}
              </label>
              {inlineOtp && (
                <p className="text-[13px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 rounded-lg px-3 py-2">
                  Demo mode — your code is <b className="font-mono">{inlineOtp}</b>
                </p>
              )}
              <input
                className="w-full bg-surface-1 border border-border rounded-lg px-3.5 py-2.5 text-sm text-text-primary outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/30 placeholder-text-muted font-mono tracking-widest"
                placeholder="6-digit code"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  onClick={submit}
                  disabled={busy}
                  className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-accent to-accent-bright text-white font-medium text-sm py-2.5 hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-50"
                >
                  <LogIn size={15} /> {busy ? "Checking…" : "Log in"}
                </button>
                <button
                  onClick={() => setStep("phone")}
                  className="rounded-lg bg-surface-1 border border-border text-text-secondary text-sm px-4 hover:bg-surface-3 transition-all"
                >
                  Back
                </button>
              </div>
            </>
          )}

          {error && <p className="text-[13px] text-red-400">{error}</p>}
        </div>

        <p className="text-center text-[11px] text-text-muted mt-5 leading-relaxed">
          Same phone, same SMS thread — this conversation mirrors your real iMessage chat
          <br /> and the PRIVA web app at the same time.
        </p>
      </div>
    </div>
  );
}
