"use client";

export const PRIVA_API =
  process.env.NEXT_PUBLIC_PRIVA_API || "https://mollusk-anytime-handcraft.ngrok-free.dev";

export const DOWNLOAD_URL =
  "https://github.com/Sachitt-AV-08/priva/releases/download/v1.1.1/PRIVA-Setup-1.1.1.exe";

export const WEB_APP_URL = "https://sachitt-av-08.github.io/priva/";

export const GITHUB_URL = "https://github.com/Sachitt-AV-08/priva";

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const token =
    typeof window !== "undefined" ? window.localStorage.getItem("priva_token") || "" : "";
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${PRIVA_API}${path}`, { ...init, headers });
}
