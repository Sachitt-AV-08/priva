export type AIProvider = "openai" | "gemini" | "local";

export interface AISettings {
  provider: AIProvider;
  openaiKey: string;
  geminiKey: string;
  openaiModel: string;
  geminiModel: string;
}

export interface AIRequest {
  prompt: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AIResponse {
  text: string;
  provider: AIProvider;
  tokens?: number;
  latency?: number;
}

const SETTINGS_KEY = "priva_ai_settings";

const DEFAULTS: AISettings = {
  provider: "openai",
  openaiKey: "",
  geminiKey: "",
  openaiModel: "gpt-4o-mini",
  geminiModel: "gemini-2.0-flash",
};

function loadSettings(): AISettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULTS };
}

function saveSettings(s: AISettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export { loadSettings, saveSettings };

function getSettings(): AISettings {
  return loadSettings();
}

async function callOpenAI(req: AIRequest, settings: AISettings): Promise<AIResponse> {
  if (!settings.openaiKey) throw new Error("No OpenAI API key configured");
  const t0 = Date.now();
  const messages: { role: string; content: string }[] = [];
  if (req.system) messages.push({ role: "system", content: req.system });
  messages.push({ role: "user", content: req.prompt });
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.openaiKey}`,
    },
    body: JSON.stringify({
      model: settings.openaiModel,
      messages,
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.7,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${err}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  return { text, provider: "openai", tokens: data.usage?.total_tokens, latency: Date.now() - t0 };
}

async function callGemini(req: AIRequest, settings: AISettings): Promise<AIResponse> {
  if (!settings.geminiKey) throw new Error("No Gemini API key configured");
  const t0 = Date.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${settings.geminiModel}:generateContent?key=${settings.geminiKey}`;
  const parts: { text: string }[] = [];
  if (req.system) parts.push({ text: `[System] ${req.system}\n\n${req.prompt}` });
  else parts.push({ text: req.prompt });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        maxOutputTokens: req.maxTokens ?? 1024,
        temperature: req.temperature ?? 0.7,
      },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini error ${res.status}: ${err}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return { text, provider: "gemini", latency: Date.now() - t0 };
}

function callLocal(req: AIRequest): AIResponse {
  const t0 = Date.now();
  const p = req.prompt.toLowerCase();
  if (p.includes("sentiment") || p.includes("emotion")) {
    const positive = ["amazing", "great", "love", "awesome", "excellent", "happy", "good", "nice"];
    const negative = ["bad", "terrible", "hate", "error", "fail", "broken", "bug", "crash", "issue", "problem"];
    const posCount = positive.filter(w => p.includes(w)).length;
    const negCount = negative.filter(w => p.includes(w)).length;
    const total = posCount + negCount || 1;
    const score = (posCount - negCount) / total;
    const emotions = [];
    if (score > 0.3) emotions.push({ name: "joy", score: Math.min(0.9, 0.5 + score * 0.4) });
    if (score < -0.3) emotions.push({ name: "frustration", score: Math.min(0.9, 0.5 + Math.abs(score) * 0.4) });
    if (emotions.length === 0) emotions.push({ name: "neutral", score: 0.5 });
    return {
      text: JSON.stringify({ sentiment: score, sentimentLabel: score > 20 ? "Positive" : score < -20 ? "Negative" : "Neutral", emotions: emotions.slice(0, 3) }),
      provider: "local", latency: Date.now() - t0,
    };
  }
  if (p.includes("shopping") || p.includes("product") || p.includes("buy") || p.includes("price")) {
    return {
      text: JSON.stringify({ summary: "Shopping assistant active. Connect to SerpApi and Prava to enable real product search and purchasing.", products: [] }),
      provider: "local", latency: Date.now() - t0,
    };
  }
  return {
    text: `PRIVA is running locally. To get full AI responses, go to Settings and add an OpenAI or Gemini API key.\n\nYour message: "${req.prompt.slice(0, 80)}${req.prompt.length > 80 ? "..." : ""}"`,
    provider: "local", latency: Date.now() - t0,
  };
}

export async function aiComplete(req: AIRequest): Promise<AIResponse> {
  const settings = getSettings();
  try {
    if (settings.provider === "openai" && settings.openaiKey) return await callOpenAI(req, settings);
    if (settings.provider === "gemini" && settings.geminiKey) return await callGemini(req, settings);
  } catch (e) {
    console.warn("[AI] Primary provider failed:", e);
  }
  try {
    if (settings.provider !== "openai" && settings.openaiKey) return await callOpenAI(req, settings);
    if (settings.provider !== "gemini" && settings.geminiKey) return await callGemini(req, settings);
  } catch (e) {
    console.warn("[AI] Fallback provider failed:", e);
  }
  return callLocal(req);
}

export async function aiChat(messages: { role: "user" | "assistant"; content: string }[], system?: string): Promise<AIResponse> {
  const settings = getSettings();
  const req: AIRequest = {
    prompt: messages[messages.length - 1].content,
    system, maxTokens: 1024, temperature: 0.7,
  };
  if (settings.provider === "openai" && settings.openaiKey) {
    try {
      const t0 = Date.now();
      const fullMessages: { role: string; content: string }[] = [];
      if (system) fullMessages.push({ role: "system", content: system });
      fullMessages.push(...messages);
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.openaiKey}` },
        body: JSON.stringify({ model: settings.openaiModel, messages: fullMessages, max_tokens: 1024, temperature: 0.7 }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      return { text: data.choices?.[0]?.message?.content ?? "", provider: "openai", latency: Date.now() - t0 };
    } catch { /* fall through */ }
  }
  return aiComplete(req);
}

export function aiAvailable(): boolean {
  const s = getSettings();
  return !!(s.openaiKey || s.geminiKey);
}

export function getActiveProvider(): AIProvider {
  const s = getSettings();
  if (s.provider === "openai" && s.openaiKey) return "openai";
  if (s.provider === "gemini" && s.geminiKey) return "gemini";
  if (s.openaiKey) return "openai";
  if (s.geminiKey) return "gemini";
  return "local";
}
