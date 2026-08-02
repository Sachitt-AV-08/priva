"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiFetch } from "./constants";

export type AuthUser = {
  user_id: string;
  name: string;
  phone: string;
  is_admin: boolean;
};

type AuthCtx = {
  user: AuthUser | null;
  token: string;
  loading: boolean;
  requestOtp: (phone: string, name: string) => Promise<{ otp?: string; delivery: string }>;
  verifyOtp: (phone: string, otp: string) => Promise<void>;
  demoLogin: (userId: string) => Promise<void>;
  logout: () => void;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);

  const applyToken = useCallback((t: string) => {
    window.localStorage.setItem("priva_token", t);
    setToken(t);
  }, []);

  useEffect(() => {
    const t = window.localStorage.getItem("priva_token") || "";
    if (!t) {
      setLoading(false);
      return;
    }
    apiFetch("/api/auth/me")
      .then(async (res) => {
        if (!res.ok) throw new Error("bad token");
        const body = await res.json();
        if (!body.authenticated) throw new Error("bad token");
        setToken(t);
        setUser(body.user);
      })
      .catch(() => {
        window.localStorage.removeItem("priva_token");
      })
      .finally(() => setLoading(false));
  }, []);

  const requestOtp = useCallback(async (phone: string, name: string) => {
    const res = await apiFetch("/api/auth/otp", {
      method: "POST",
      body: JSON.stringify({ phone, name }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.detail || "Could not send code");
    return body;
  }, []);

  const verifyOtp = useCallback(
    async (phone: string, otp: string) => {
      const res = await apiFetch("/api/auth/verify", {
        method: "POST",
        body: JSON.stringify({ phone, otp }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || "Invalid code");
      applyToken(body.token);
      setUser({
        user_id: body.user_id,
        name: body.name,
        phone: body.phone,
        is_admin: body.is_admin,
      });
    },
    [applyToken]
  );

  const demoLogin = useCallback(
    async (userId: string) => {
      const res = await apiFetch("/api/auth/demo-login", {
        method: "POST",
        body: JSON.stringify({ user_id: userId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || "Login failed");
      applyToken(body.token);
      setUser({
        user_id: body.user_id,
        name: body.name,
        phone: body.phone,
        is_admin: body.is_admin,
      });
    },
    [applyToken]
  );

  const logout = useCallback(() => {
    window.localStorage.removeItem("priva_token");
    setToken("");
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, token, loading, requestOtp, verifyOtp, demoLogin, logout }),
    [user, token, loading, requestOtp, verifyOtp, demoLogin, logout]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
