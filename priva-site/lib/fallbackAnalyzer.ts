/**
 * Pure-client fallback of the PRIVA note analyzer (mirrors priva/note_analyzer.py
 * rule engine) so the website demo works even when the live backend is offline.
 */

export interface BuyIntent {
  item: string;
  price_hint: number | null;
  raw: string;
}

export interface Analysis {
  buy_intents: BuyIntent[];
  todos: string[];
  reminders: { text: string; due: string }[];
  category: string;
  summary: string;
}

const BUY_RE =
  /(?<![a-z])(?:need to (?:buy|get|order|pick up)|want(?:s)? to (?:buy|get|order|pick up)|want(?:s)?\s+(?!to\b)(?:a|an|the|new)?\s*|get me|gonna buy|going to buy|buy(?: a| an| the| new)?|order(?: a| an| the| new)?|pick up(?: a| an| the| new)?|look(?:ing)? for(?: a| an| the| new)?|out of|low on|need (?:a|an|the|new)?|restock)(.+)$/i;

const PRICE_RE = /(?:under|less than|max|budget(?: of)?|below|around)\s*\$?\s*(\d+(?:\.\d+)?)/i;

const TODO_VERBS =
  /^(?:call|email|text|message|submit|finish|complete|pay|renew|cancel|book|schedule|take|fix|clean|prepare|write|download|install|register|file|return|meet|send|check|review|follow up|confirm|reserve|collect|drop off|apply)/i;

const TIME_RE =
  /(?:at\s+)?(\d{1,2}):(\d{2})\s*(am|pm)?\b|(?:at\s+)?(\d{1,2})\s*(am|pm)\b|(tomorrow|tonight|now|in\s+(\d+)\s*(?:h|hr|hrs|hour|hours|min|mins|minute|minutes))\b|\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

function parsePrice(line: string): number | null {
  const m = PRICE_RE.exec(line);
  return m ? parseFloat(m[1]) : null;
}

function cleanItem(item: string): string {
  let s = item.replace(/\s+(?:under|less than|before|by|for\s+\$\d|since)\b/i, "").trim();
  s = s.replace(/^(?:a|an|the)\s+/i, "").replace(/\s+/g, " ");
  return s.replace(/^[\s.:;\-–]+|[\s.:;\-–]+$/g, "");
}

export function analyzeNote(text: string): Analysis {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const buyLines = new Set<string>();
  const buy_intents: BuyIntent[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    if (/^(?:don'?t|do not|won'?t|not|never|no)\s+buy/i.test(line)) continue;
    if (/^[-*]?\s*\[[ xX]\]|^todo:|^to do:/i.test(line)) continue;
    const m = BUY_RE.exec(line);
    if (!m) continue;
    let item = cleanItem(m[1]);
    if (!item || item.length > 60 || !/[a-z0-9]/i.test(item)) continue;
    if (/prescription|medicine|medication|meds|dry clean|laundry/i.test(item)) continue;
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      buy_intents.push({ item, price_hint: parsePrice(line), raw: line });
      buyLines.add(line.toLowerCase());
    }
  }

  const todos: string[] = [];
  for (const line of lines) {
    if (buyLines.has(line.toLowerCase())) continue;
    if (/^[-*]?\s*\[ \]/.test(line)) todos.push(line.replace(/^[-*]?\s*\[ \]\s*/, ""));
    else if (/^todo:|^to do:/i.test(line)) todos.push(line.replace(/^(?:todo|to do):\s*/i, ""));
    else if (TODO_VERBS.test(line)) todos.push(line);
    if (todos.length >= 8) break;
  }

  const reminders: { text: string; due: string }[] = [];
  for (const line of lines) {
    const m = TIME_RE.exec(line);
    if (!m) continue;
    if (m[1]) {
      let h = parseInt(m[1], 10);
      const mm = parseInt(m[2], 10);
      const tz = (m[3] || "").toLowerCase();
      if (tz === "pm" && h < 12) h += 12;
      if (tz === "am" && h === 12) h = 0;
      reminders.push({ text: line, due: `${h.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}` });
    } else if (m[4]) {
      let h = parseInt(m[4], 10);
      const tz = (m[5] || "").toLowerCase();
      if (tz === "pm" && h < 12) h += 12;
      if (tz === "am" && h === 12) h = 0;
      reminders.push({ text: line, due: `${h.toString().padStart(2, "0")}:00` });
    } else if (m[6]) {
      reminders.push({ text: line, due: m[6] === "tomorrow" ? "tomorrow 9:00" : m[6] });
    } else if (m[8]) {
      reminders.push({ text: line, due: `next ${m[8]} 9:00` });
    }
    if (reminders.length >= 5) break;
  }

  const low = text.toLowerCase();
  let category = "general";
  if (buy_intents.length) category = "shopping";
  else if (/(doctor|dentist|gym|medicine|appointment|workout|health)/.test(low)) category = "health";
  else if (/(meeting|deadline|project|assignment|report|client|email|interview)/.test(low)) category = "work";
  else if (todos.length) category = "personal";

  const firstLine = lines[0] || "";
  const summary = firstLine.length > 80 ? firstLine.slice(0, 80) + "…" : firstLine || "Untitled note";

  return { buy_intents, todos, reminders, category, summary };
}

export const CATEGORY_LABEL: Record<string, string> = {
  shopping: "Shopping",
  health: "Health",
  work: "Work",
  personal: "Personal",
  general: "General",
};
