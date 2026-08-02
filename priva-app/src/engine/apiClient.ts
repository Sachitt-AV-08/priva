const API_BASES = [
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, ""),
  "http://localhost:8766",
  "https://priva-backend.onrender.com",
  "https://mollusk-anytime-handcraft.ngrok-free.dev",
].filter((x): x is string => Boolean(x));

let apiBase: string | null = null;
const USER_KEY = "priva_user";

export interface AuthUser {
  user_id: string;
  name: string;
  phone: string;
  is_admin: boolean;
}

function baseHeaders(base: string, initial?: HeadersInit) {
  const headers = new Headers(initial);
  if (base.includes("ngrok")) headers.set("ngrok-skip-browser-warning", "true");
  return headers;
}

function storeUser(user: AuthUser | null) {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_KEY);
}

function currentUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function currentThread() {
  const user = currentUser();
  return user?.user_id && user.user_id !== "local"
    ? `priva_mirror_${user.user_id}`
    : "priva_mirror";
}

async function resolveApi(): Promise<string> {
  if (apiBase) return apiBase;
  for (const base of API_BASES) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(`${base}/health`, {
        signal: ctrl.signal,
        headers: baseHeaders(base),
      });
      clearTimeout(timer);
      if (res.ok) {
        apiBase = base;
        return base;
      }
    } catch {
      /* try next candidate */
    }
  }
  throw new Error("PRIVA backend is unreachable");
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method || "GET").toUpperCase();
  const tokenAtStart = localStorage.getItem("priva_token") || "";
  const request = async (base: string) => {
    const headers = baseHeaders(base, init?.headers);
    const token = localStorage.getItem("priva_token") || "";
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (init?.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    return fetch(`${base}${path}`, { ...init, headers });
  };

  let response: Response;
  const base = await resolveApi();
  try {
    response = await request(base);
  } catch (error) {
    if (tokenAtStart || !["GET", "HEAD", "OPTIONS"].includes(method)) throw error;
    apiBase = null;
    response = await request(await resolveApi());
  }

  if (response.status === 401) {
    localStorage.removeItem("priva_token");
    storeUser(null);
    window.dispatchEvent(new Event("priva:unauthorized"));
  }
  return response;
}

export interface ProductResult {
  id: string;
  title: string;
  price: number;
  currency: string;
  merchant: string;
  merchant_url: string;
  rating: number | null;
  reviews: number | null;
  thumbnail: string;
  product_url: string;
}

export interface SearchResponse {
  products: ProductResult[];
}

export interface PayResponse {
  session_id: string;
  session_token?: string;
  iframe_url?: string;
  order_id?: string;
  expires_at?: string;
  payment_url?: string;
  transaction_id?: string;
  error?: string;
}

export interface TransactionResult {
  id: string;
  product_title: string;
  amount: number;
  currency: string;
  merchant: string;
  status: string;
  prava_session_id: string;
  prava_status: string;
  thumbnail: string;
  product_url: string;
  shipping_status: string;
  shipping_eta: string;
  created_at: number;
}

export interface NoteBlockInput {
  id: string;
  type: string;
  content: string;
}

export interface NoteResult {
  id: string;
  title: string;
  blocks: NoteBlockInput[];
  tags: string[];
  created_at: number;
  updated_at: number;
}

export interface BuyIntent {
  item: string;
  price_hint: number | null;
  raw: string;
}

export interface NoteAnalysis {
  buy_intents: BuyIntent[];
  todos: string[];
  reminders: { text: string; due_at: number; parsed_from: string }[];
  category: string;
  summary: string;
}

export interface ReminderResult {
  id: string;
  note_id: string;
  text: string;
  due_at: number;
  channel: string;
  fired: boolean;
  created_at: number;
}

export interface ActivityEvent {
  agent: string;
  message: string;
  detail: string;
  note_id?: string;
  ts: number;
}

export interface WatchResult {
  id: string;
  item: string;
  price: number;
  added_at: number;
  alerted: boolean;
}

export interface TransactionsResponse {
  transactions: TransactionResult[];
}

export interface ConfigResponse {
  prava_publishable_key: string;
  prava_configured: boolean;
  prava_healthy: boolean;
  linq_configured: boolean;
  linq_sandbox_number: string;
  serpapi_configured: boolean;
}

export interface BudgetState {
  limit: number | null;
  spent_this_month: number;
  remaining: number | null;
  month: string;
}

export interface SpendAnalysis {
  month: string;
  monthly_limit: number | null;
  effective_limit: number | null;
  borrowed_into_next: number;
  spent_this_month: number;
  remaining: number | null;
  purchase_count: number;
  avg_purchase: number;
  by_merchant: { merchant: string; total: number }[];
  by_day: { day: string; total: number }[];
}

export const api = {
  getCurrentUser: currentUser,
  getThreadId: currentThread,
  requestOtp: async (phone: string, name: string): Promise<{ otp?: string; delivery: string; user_id: string }> => {
    const res = await apiFetch("/api/auth/otp", {
      method: "POST",
      body: JSON.stringify({ phone, name }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.detail || "Could not send code");
    return body;
  },

  verifyOtp: async (phone: string, otp: string): Promise<{
    user_id: string; name: string; phone: string; is_admin: boolean; token: string;
  }> => {
    const res = await apiFetch("/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({ phone, otp }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.detail || "Invalid code");
    localStorage.setItem("priva_token", body.token);
    storeUser({ user_id: body.user_id, name: body.name, phone: body.phone, is_admin: body.is_admin });
    return body;
  },

  demoLogin: async (userId: string): Promise<{ user_id: string; name: string; is_admin: boolean; token: string }> => {
    const res = await apiFetch("/api/auth/demo-login", {
      method: "POST",
      body: JSON.stringify({ user_id: userId }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.detail || "Login failed");
    localStorage.setItem("priva_token", body.token);
    storeUser({ user_id: body.user_id, name: body.name, phone: body.phone || "", is_admin: body.is_admin });
    return body;
  },

  getMe: async (): Promise<{ user: AuthUser | null; authenticated: boolean }> => {
    const res = await apiFetch("/api/auth/me");
    if (!res.ok) {
      storeUser(null);
      return { user: null, authenticated: false };
    }
    const body = await res.json();
    storeUser(body.authenticated ? body.user : null);
    if (!body.authenticated) localStorage.removeItem("priva_token");
    return body;
  },

  sendSms: async (text: string): Promise<{ ok: boolean; sent: boolean; error?: string }> => {
    const res = await apiFetch("/api/linq/send", {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.detail || "Send failed");
    return body;
  },

  searchProducts: async (query: string, maxPrice?: number): Promise<SearchResponse> => {
    const res = await apiFetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, max_price: maxPrice }),
    });
    if (!res.ok) throw new Error(`Search failed: ${res.status}`);
    return res.json();
  },

  createPayment: async (product: {
    product_id: string;
    title: string;
    price: number;
    merchant: string;
    thumbnail?: string;
    product_url?: string;
    budget_excess?: number;
  }): Promise<PayResponse> => {
    const res = await apiFetch("/api/pay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...product, user_id: currentUser()?.user_id }),
    });
    if (!res.ok) {
      let detail = "";
      try {
        const body = await res.json();
        detail = body.detail ?? "";
      } catch { /* not json */ }
      if (res.status === 409 && detail) {
        const err = new Error("budget_cap") as Error & { budgetDetail?: string };
        err.budgetDetail = detail;
        throw err;
      }
      throw new Error(`Payment failed: ${res.status}`);
    }
    return res.json();
  },

  getTransactions: async (): Promise<TransactionsResponse> => {
    const res = await apiFetch("/api/transactions");
    if (!res.ok) throw new Error(`Transactions failed: ${res.status}`);
    return res.json();
  },

  getPaymentStatus: async (sessionId: string): Promise<Record<string, unknown>> => {
    const res = await apiFetch(`/api/pay/status?session_id=${sessionId}`);
    if (!res.ok) throw new Error(`Status check failed: ${res.status}`);
    return res.json();
  },

  getConfig: async (): Promise<ConfigResponse> => {
    const res = await apiFetch("/api/config");
    if (!res.ok) throw new Error(`Config failed: ${res.status}`);
    return res.json();
  },

  payComplete: async (sessionId: string, transactionId: string, amount?: number, budgetExcess?: number): Promise<Record<string, unknown>> => {
    const res = await apiFetch("/api/pay/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, transaction_id: transactionId, amount, budget_excess: budgetExcess }),
    });
    const body = await res.json();
    if (!res.ok || body.error) throw new Error(body.error || `Complete failed: ${res.status}`);
    return body;
  },

  refreshTransactions: async (): Promise<TransactionsResponse> => {
    const res = await apiFetch("/api/transactions/refresh", { method: "POST" });
    if (!res.ok) throw new Error(`Refresh failed: ${res.status}`);
    return res.json();
  },

  getNotes: async (): Promise<{ notes: NoteResult[] }> => {
    const res = await apiFetch("/api/notes");
    if (!res.ok) throw new Error(`Notes failed: ${res.status}`);
    return res.json();
  },

  saveNote: async (note: NoteResult): Promise<{ note: NoteResult }> => {
    const res = await apiFetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(note),
    });
    if (!res.ok) throw new Error(`Save note failed: ${res.status}`);
    return res.json();
  },

  deleteNote: async (id: string): Promise<{ ok: boolean }> => {
    const res = await apiFetch(`/api/notes/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`Delete note failed: ${res.status}`);
    return res.json();
  },

  analyzeNotes: async (noteId?: string): Promise<Record<string, unknown>> => {
    const qs = noteId ? `?note_id=${encodeURIComponent(noteId)}` : "";
    const res = await apiFetch(`/api/notes/analyze${qs}`);
    if (!res.ok) throw new Error(`Analyze failed: ${res.status}`);
    return res.json();
  },

  getReminders: async (): Promise<{ reminders: ReminderResult[] }> => {
    const res = await apiFetch("/api/reminders");
    if (!res.ok) throw new Error(`Reminders failed: ${res.status}`);
    return res.json();
  },

  addReminder: async (text: string, dueAt: number, noteId: string = ""): Promise<{ reminder: ReminderResult }> => {
    const res = await apiFetch("/api/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, due_at: dueAt, note_id: noteId }),
    });
    if (!res.ok) throw new Error(`Add reminder failed: ${res.status}`);
    return res.json();
  },

  getActivity: async (noteId: string = ""): Promise<{ events: ActivityEvent[] }> => {
    const qs = noteId ? `?note_id=${encodeURIComponent(noteId)}` : "";
    const res = await apiFetch(`/api/agent/activity${qs}`);
    if (!res.ok) throw new Error(`Activity failed: ${res.status}`);
    return res.json();
  },

  getTranscript: async (threadId: string = currentThread()): Promise<{
    messages: { to: string; text: string; thread_id: string; ts: number }[];
    inbound: { from: string; text: string; thread_id: string; ts: number }[];
  }> => {
    const qs = threadId ? `?thread_id=${encodeURIComponent(threadId)}` : "";
    const res = await apiFetch(`/api/linq/transcript${qs}`);
    if (!res.ok) throw new Error(`Transcript failed: ${res.status}`);
    return res.json();
  },

  simulateReply: async (text: string, threadId: string = currentThread()): Promise<{ result: string }> => {
    const res = await apiFetch("/api/linq/simulate-reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, thread_id: threadId }),
    });
    if (!res.ok) throw new Error(`Simulate reply failed: ${res.status}`);
    return res.json();
  },

  advanceShipping: async (txnId: string): Promise<{ shipping_status: string }> => {
    const res = await apiFetch(`/api/transactions/${txnId}/shipping/advance`, { method: "POST" });
    if (!res.ok) throw new Error(`Shipping advance failed: ${res.status}`);
    return res.json();
  },

  getWatchlist: async (): Promise<{ watches: WatchResult[] }> => {
    const res = await apiFetch("/api/watchlist");
    if (!res.ok) throw new Error(`Watchlist failed: ${res.status}`);
    return res.json();
  },

  demoPriceDrop: async (item: string, dropPct: number = 12): Promise<Record<string, unknown>> => {
    const res = await apiFetch("/api/demo/price-drop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item, drop_pct: dropPct }),
    });
    if (!res.ok) throw new Error(`Demo price drop failed: ${res.status}`);
    return res.json();
  },

  getBudget: async (): Promise<BudgetState> => {
    const res = await apiFetch("/api/budget");
    if (!res.ok) throw new Error(`Budget fetch failed: ${res.status}`);
    return res.json();
  },

  setBudget: async (limit: number): Promise<BudgetState> => {
    const res = await apiFetch("/api/budget", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit }),
    });
    if (!res.ok) throw new Error(`Budget set failed: ${res.status}`);
    return res.json();
  },

  getSpendAnalysis: async (): Promise<{ analysis: SpendAnalysis }> => {
    const res = await apiFetch("/api/spending/analysis");
    if (!res.ok) throw new Error(`Spend analysis failed: ${res.status}`);
    return res.json();
  },

  speechToText: async (pcm16: ArrayBuffer, signal?: AbortSignal): Promise<{ text: string }> => {
    const res = await apiFetch("/api/voice/stt", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: pcm16,
      signal,
    });
    if (!res.ok) throw new Error(`STT failed: ${res.status}`);
    return res.json();
  },

  textToSpeech: async (text: string): Promise<Blob> => {
    const res = await apiFetch(`/api/voice/tts?text=${encodeURIComponent(text)}`);
    if (!res.ok) throw new Error(`TTS failed: ${res.status}`);
    return res.blob();
  },

  clearTranscript: async (threadId: string = currentThread()): Promise<{ ok: boolean; removed: number }> => {
    const qs = threadId ? `?thread_id=${encodeURIComponent(threadId)}` : "";
    const res = await apiFetch(`/api/linq/transcript${qs}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`Clear failed: ${res.status}`);
    return res.json();
  },
};
