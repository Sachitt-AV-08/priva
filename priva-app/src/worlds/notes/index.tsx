import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  StickyNote, Plus, Trash2, ChevronDown, ChevronRight,
  Type, List, Minus, ToggleLeft, Search, ShoppingBag, CheckCircle,
  Circle, Bell, Clock, Sparkles, CheckSquare, Pen,
} from "lucide-react";
import type { NoteBlock } from "../../engine/types";
import { api, type NoteResult, type NoteAnalysis, type ReminderResult, type ActivityEvent } from "../../engine/apiClient";
import { DrawingCanvas } from "../../components/DrawingCanvas";

const LEGACY_STORAGE_KEY = "priva_notes";
const AUTHORS = { NOTE: "NOTE ANALYZER", LINQ: "LINQ", SERP: "SERPAPI", RANK: "RANKER", PRAVA: "PRAVA", PAID: "PAID" };

interface StoredNote extends NoteResult {
  blocks: NoteBlock[];
  analysis?: NoteAnalysis;
  reminders?: ReminderResult[];
}

function storageKey() {
  return `${LEGACY_STORAGE_KEY}_${api.getCurrentUser()?.user_id || "local"}`;
}

function normalizedTime(value: number) {
  return value < 1e12 ? value * 1000 : value;
}

function loadNotes(): StoredNote[] {
  try {
    const key = storageKey();
    const scoped = localStorage.getItem(key);
    const raw = scoped ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw && !scoped) localStorage.setItem(key, raw);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveNotes(notes: StoredNote[]) {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(notes));
  } catch {
    // Keep the in-memory editor usable when storage is unavailable.
  }
}

function NoteBlockEditor({ block, onChange, onDelete }: {
  block: NoteBlock;
  onChange: (id: string, content: string) => void;
  onDelete: (id: string) => void;
}) {
  if (block.type === "divider") {
    return <div className="border-t border-border my-2" />;
  }

  if (block.type === "drawing") {
    return (
      <div className="group flex items-start gap-2">
        <div className="mt-1.5 text-text-muted text-[10px] w-4 flex justify-end opacity-0 group-hover:opacity-100 transition-opacity"><Pen size={10} /></div>
        <div className="flex-1 min-w-0">
          <DrawingCanvas value={block.content} onChange={(content) => onChange(block.id, content)} />
        </div>
        <button
          onClick={() => onDelete(block.id)}
          className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-900/30 rounded text-red-400 transition-all"
        >
          <Trash2 size={11} />
        </button>
      </div>
    );
  }

  return (
    <div className="group flex items-start gap-2">
      <div className="mt-1.5 text-text-muted text-[10px] w-4 text-right font-mono opacity-0 group-hover:opacity-100 transition-opacity">
        {block.type === "heading" ? "H" : block.type === "list" ? "•" : block.type === "toggle" ? "▸" : "—"}
      </div>
      {block.type === "heading" ? (
        <input
          value={block.content}
          onChange={(e) => onChange(block.id, e.target.value)}
          className="flex-1 bg-transparent text-base font-semibold text-text-primary outline-none placeholder-text-muted/50"
          placeholder="Heading..."
        />
      ) : (
        <textarea
          value={block.content}
          onChange={(e) => onChange(block.id, e.target.value)}
          className="flex-1 bg-transparent text-sm text-text-primary outline-none resize-none placeholder-text-muted/50"
          placeholder={block.type === "list" ? "List item..." : block.type === "toggle" ? "Toggle item..." : "Type something..."}
          rows={1}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement;
            target.style.height = "auto";
            target.style.height = target.scrollHeight + "px";
          }}
        />
      )}
      <button
        onClick={() => onDelete(block.id)}
        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-900/30 rounded text-red-400 transition-all"
      >
        <Trash2 size={11} />
      </button>
    </div>
  );
}

function TodoRow({ text, done, onToggle }: { text: string; done: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-2/60 transition-colors rounded-lg group/todo">
      {done
        ? <CheckCircle size={13} className="shrink-0 text-accent-green" />
        : <Circle size={13} className="shrink-0 text-text-muted group-hover/todo:text-accent" />}
      <span className={`text-[11px] truncate ${done ? "line-through text-text-muted" : "text-text-secondary"}`}>{text}</span>
    </button>
  );
}

function ReminderChips({ note, onSet, onAdd }: {
  note: StoredNote;
  onSet: (mins: number, label: string) => void;
  onAdd: (text: string, mins: number) => void;
}) {
  const chips = [
    { label: "in 1h", mins: 60 },
    { label: "tonight 9pm", mins: -1 },
    { label: "tomorrow 9am", mins: -2 },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Bell size={11} className="text-text-muted" />
      {chips.map((c) => (
        <button
          key={c.label}
          onClick={() => onSet(c.mins, c.label)}
          className="px-2 py-0.5 text-[10px] rounded-full bg-surface-3 text-text-secondary hover:bg-accent/20 hover:text-accent transition-colors border border-border/60"
        >
          {c.label}
        </button>
      ))}
      <input
        placeholder="custom reminder..."
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.target as HTMLInputElement).value.trim()) {
            onAdd((e.target as HTMLInputElement).value.trim(), 30);
            (e.target as HTMLInputElement).value = "";
          }
        }}
        className="w-36 px-2 py-0.5 text-[10px] bg-surface-2 border border-border rounded-full text-text-primary outline-none placeholder-text-muted/50 focus:border-accent/40"
      />
    </div>
  );
}

function NoteEditor({ note, onUpdate, onSetReminder, onAddReminder, onDelete }: {
  note: StoredNote;
  onUpdate: (n: StoredNote) => void;
  onSetReminder: (mins: number, label: string) => void;
  onAddReminder: (text: string, mins: number) => void;
  onDelete: () => void;
}) {
  const addBlock = (type: NoteBlock["type"]) => {
    const block: NoteBlock = {
      id: crypto.randomUUID(),
      type,
      content: type === "drawing" ? '{"strokes":[],"shapes":[]}' : "",
    };
    onUpdate({ ...note, blocks: [...note.blocks, block], updated_at: Date.now() });
  };

  const updateBlock = (blockId: string, content: string) => {
    onUpdate({
      ...note,
      blocks: note.blocks.map((b) => b.id === blockId ? { ...b, content } : b),
      updated_at: Date.now(),
    });
  };

  const deleteBlock = (blockId: string) => {
    onUpdate({ ...note, blocks: note.blocks.filter((b) => b.id !== blockId), updated_at: Date.now() });
  };

  const analysis = note.analysis;
  const buyIntents = analysis?.buy_intents ?? [];
  const offerState = analysis?.offer_state;

  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      <div className="max-w-2xl mx-auto px-8 py-6">
        <div className="flex items-center gap-2 mb-1">
          {buyIntents.length > 0 && offerState && offerState !== "not_shopping" && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 border border-accent/30 text-[10px] text-accent">
              <ShoppingBag size={10} /> shopping — {offerState === "already_purchased"
                ? "already purchased"
                : offerState === "already_offered"
                  ? "already offered"
                  : offerState === "cooldown"
                    ? "offer paused"
                    : "texted you on iMessage"}
            </span>
          )}
          {analysis?.category && analysis.category !== "general" && (
            <span className="px-2 py-0.5 rounded-full bg-surface-3 border border-border text-[10px] text-text-muted capitalize">
              {analysis.category}
            </span>
          )}
          <button
            onClick={onDelete}
            title="Delete this note"
            className="ml-auto flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md border border-border text-text-muted hover:text-red-400 hover:border-red-400/40 transition-all"
          >
            <Trash2 size={10} /> Delete note
          </button>
        </div>
        <input
          value={note.title}
          onChange={(e) => onUpdate({ ...note, title: e.target.value, updated_at: Date.now() })}
          className="w-full bg-transparent text-2xl font-bold text-text-primary outline-none placeholder-text-muted/50 mb-1"
          placeholder="Untitled Note"
        />
        {analysis?.summary && (
          <div className="flex items-start gap-1.5 mb-3 text-[11px] text-text-muted">
            <Sparkles size={11} className="mt-0.5 shrink-0 text-accent/70" />
            <span>{analysis.summary}</span>
          </div>
        )}
        <div className="mb-3">
          <ReminderChips note={note} onSet={onSetReminder} onAdd={onAddReminder} />
        </div>
        <div className="space-y-1">
          {note.blocks.map((block) => (
            <NoteBlockEditor key={block.id} block={block} onChange={updateBlock} onDelete={deleteBlock} />
          ))}
        </div>
        <div className="flex items-center gap-1 mt-3 opacity-0 hover:opacity-100 transition-opacity">
          <button onClick={() => addBlock("text")} className="p-1.5 rounded hover:bg-surface-3 text-text-muted hover:text-text-secondary" title="Text"><Type size={13} /></button>
          <button onClick={() => addBlock("heading")} className="p-1.5 rounded hover:bg-surface-3 text-text-muted hover:text-text-secondary" title="Heading"><span className="text-xs font-bold px-1">H</span></button>
          <button onClick={() => addBlock("list")} className="p-1.5 rounded hover:bg-surface-3 text-text-muted hover:text-text-secondary" title="List"><List size={13} /></button>
          <button onClick={() => addBlock("toggle")} className="p-1.5 rounded hover:bg-surface-3 text-text-muted hover:text-text-secondary" title="Toggle"><ToggleLeft size={13} /></button>
          <button onClick={() => addBlock("divider")} className="p-1.5 rounded hover:bg-surface-3 text-text-muted hover:text-text-secondary" title="Divider"><Minus size={13} /></button>
          <button onClick={() => addBlock("drawing")} className="p-1.5 rounded hover:bg-surface-3 text-text-muted hover:text-text-secondary" title="Drawing / annotation"><Pen size={13} /></button>
        </div>
      </div>
    </div>
  );
}

function noteSnippet(note: StoredNote): string {
  const textBlock = note.blocks.find(b => b.type === "text" || b.type === "list" || b.type === "toggle");
  return (textBlock?.content || "").replace(/\s+/g, " ").trim();
}

const AGENT_COLORS: Record<string, string> = {
  "NOTE ANALYZER": "text-accent",
  LINQ: "text-accent-bright",
  SERPAPI: "text-accent-bright",
  RANKER: "text-accent",
  PRAVA: "text-accent-bright",
  PAID: "text-accent-green",
  REMINDER: "text-accent",
  DELIVERY: "text-accent-green",
  "PRICE WATCH": "text-accent-bright",
};

const AGENT_ACTIONS: Record<string, string> = {
  LINQ: "Messaging You",
  SERPAPI: "Searching Products",
  RANKER: "Ranking Results",
  PRAVA: "Processing Payment",
  BUDGET: "Budget Guard",
  PAID: "Checkout Complete",
  REMINDER: "Reminder Set",
  DELIVERY: "Order Shipped",
  "PRICE WATCH": "Price Drop Alert",
  NOTES: "Note Saved",
};

// NOTE ANALYZER events carry different meanings; label by message so we never
// claim "Shopping Intent Detected" before an intent is actually confirmed.
function noteAnalyzerLabel(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("saw buy intent")) return "Shopping Intent Detected";
  if (m.includes("already purchased")) return "Already Purchased";
  if (m.includes("cooldown") || m.includes("already offered")) return "Offer Paused";
  if (m.includes("scheduled") || m.includes("urgent")) return "Analyzing Note";
  return "Analyzing Note";
}

function agentAction(agent: string, message: string): string {
  if (agent === "NOTE ANALYZER") return noteAnalyzerLabel(message);
  return AGENT_ACTIONS[agent] ?? agent;
}

const TRACE_STAGES = [
  { label: "Intent", agents: ["NOTE ANALYZER", "LINQ", "NOTES"] },
  { label: "Search", agents: ["SERPAPI"] },
  { label: "Rank", agents: ["RANKER"] },
  { label: "Pay", agents: ["PRAVA", "BUDGET"] },
  { label: "Checkout", agents: ["PAID"] },
  { label: "Deliver", agents: ["DELIVERY", "PRICE WATCH"] },
];

function NoteTracePanel({ noteId }: { noteId: string | null }) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  useEffect(() => {
    setEvents([]);
    if (!noteId) return;
    let alive = true;
    const poll = async () => {
      try {
        const res = await api.getActivity(noteId);
        if (alive) setEvents(res.events);
      } catch { /* backend down */ }
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => { alive = false; clearInterval(id); };
  }, [noteId]);
  const agents = new Set(events.map((e) => e.agent));
  return (
    <div className="w-72 shrink-0 border-l border-border bg-surface-1/60 flex flex-col overflow-hidden">
      <div className="px-3 py-2.5 border-b border-border flex items-center gap-1.5">
        <Sparkles size={10} className={events.length ? "text-accent" : "text-text-muted/40"} />
        <span className="text-[9px] font-semibold tracking-widest text-text-muted uppercase">Agent trace</span>
        {noteId && events.length > 0 && (
          <span className="ml-auto text-[9px] bg-accent/10 text-accent px-1.5 py-0.5 rounded-full">{events.length} events</span>
        )}
      </div>
      <div className="px-3 py-2 border-b border-border/50 flex flex-wrap gap-1">
        {TRACE_STAGES.map((s) => {
          const done = s.agents.some((a) => agents.has(a));
          return (
            <span
              key={s.label}
              className={`px-1.5 py-0.5 rounded text-[9px] font-medium border transition-colors ${
                done ? "bg-accent/10 border-accent/30 text-accent" : "border-border text-text-muted/60"
              }`}
            >
              {done && <CheckCircle size={8} className="inline mr-1" />}{s.label}
            </span>
          );
        })}
      </div>
      <div className="flex-1 overflow-y-auto min-h-0 px-3 py-2 space-y-1.5">
        {!noteId && (
          <p className="text-[10px] text-text-muted text-center py-6 px-2">
            Select a note to see its agent trace.
          </p>
        )}
        {noteId && events.length === 0 && (
          <p className="text-[10px] text-text-muted text-center py-6 px-2">
            No agent activity for this note yet.<br />The agent will work on it after you stop typing.
          </p>
        )}
        {events.map((e, i) => {
          const action = agentAction(e.agent, e.message || "");
          return (
            <div key={i} className="flex items-start gap-2">
              <div className="flex flex-col items-center mt-1">
                <span className={`w-1.5 h-1.5 rounded-full ${i === 0 ? "bg-accent animate-pulse" : "bg-text-muted/40"}`} />
                {i < events.length - 1 && <span className="w-px flex-1 bg-border min-h-3" />}
              </div>
              <div className="flex-1 min-w-0 pb-1">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-text-primary">
                  <span className="truncate">{action}</span>
                  <span className="ml-auto shrink-0 text-[9px] text-text-muted/60 font-normal">
                    {new Date(e.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                </div>
                <div className="pl-0 text-[10px] text-text-muted truncate">
                  <span className={AGENT_COLORS[e.agent] ?? "text-text-secondary"}>{e.agent}</span>
                  <span className="text-text-muted/70"> — {e.message}</span>
                  {e.detail && <span className="text-text-muted/50"> · {e.detail}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function NotesWorld() {
  const [notes, setNotes] = useState<StoredNote[]>(loadNotes);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [todoView, setTodoView] = useState(false);
  const [doneTodos, setDoneTodos] = useState<Set<string>>(new Set());
  const [reminders, setReminders] = useState<ReminderResult[]>([]);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notesRef = useRef<StoredNote[]>(notes);
  notesRef.current = notes;

  // Debounced localStorage persist: typing only updates React state; the
  // (potentially large) JSON stringify + write happens once, after a pause.
  const persistNotes = useCallback((next: StoredNote[]) => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => saveNotes(next), 800);
  }, []);

  const pushToBackend = useCallback((next: StoredNote[], changed?: StoredNote) => {
    persistNotes(next);
    if (syncTimer.current) clearTimeout(syncTimer.current);
    if (!changed) return;
    const originUser = api.getCurrentUser()?.user_id || "local";
    const originToken = localStorage.getItem("priva_token");
    syncTimer.current = setTimeout(() => {
      if ((api.getCurrentUser()?.user_id || "local") !== originUser) return;
      if (localStorage.getItem("priva_token") !== originToken) return;
      const payload: NoteResult = {
        id: changed.id,
        title: changed.title,
        blocks: changed.blocks.filter((block) => block.type !== "drawing"),
        tags: changed.tags,
        created_at: changed.created_at,
        updated_at: changed.updated_at,
      };
      api.saveNote(payload)
        .then(() => api.analyzeNotes(changed.id))
        .then((nextAnalysis) => {
          if ((api.getCurrentUser()?.user_id || "local") !== originUser) return;
          setNotes((current) => {
            const updated = current.map((note) => note.id === changed.id
              ? { ...note, analysis: nextAnalysis as unknown as NoteAnalysis }
              : note);
            saveNotes(updated);
            return updated;
          });
        })
        .catch(() => {});
    }, 2000);
  }, [persistNotes]);

  useEffect(() => () => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    if (persistTimer.current) clearTimeout(persistTimer.current);
    saveNotes(notesRef.current);
  }, []);

  useEffect(() => {
    api.getNotes().then(({ notes }) => {
      setNotes((prev) => {
        const merged = new Map<string, StoredNote>();
        for (const remote of notes as StoredNote[]) merged.set(remote.id, remote);
        for (const local of prev) {
          const remote = merged.get(local.id);
          if (!remote || normalizedTime(local.updated_at) >= normalizedTime(remote.updated_at)) {
            merged.set(local.id, local);
          }
        }
        const next = Array.from(merged.values()).sort((a, b) => normalizedTime(b.updated_at) - normalizedTime(a.updated_at));
        saveNotes(next);
        return next;
      });
      if (notes.length > 0 && notes[0].id) setActiveNoteId((cur) => cur ?? notes[0].id);
    }).catch(() => {});
    api.getReminders().then(({ reminders: r }) => setReminders(r)).catch(() => {});
    const id = setInterval(() => {
      api.getReminders().then(({ reminders: r }) => setReminders(r)).catch(() => {});
    }, 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    api.analyzeNotes().then((res) => {
      const list = (res as { notes?: { id: string; buy_intents?: unknown[]; todos?: string[]; summary?: string; category?: string }[] }).notes;
      if (!list) return;
      setNotes((prev) => prev.map((n) => {
        const a = list.find((x) => x.id === n.id);
        if (!a) return n;
        const aAnalysis = a as unknown as NoteAnalysis;
        return { ...n, analysis: { buy_intents: aAnalysis.buy_intents ?? [], todos: aAnalysis.todos ?? [], reminders: aAnalysis.reminders ?? [], category: aAnalysis.category ?? "general", summary: aAnalysis.summary ?? "", offer_state: aAnalysis.offer_state ?? n.analysis?.offer_state } };
      }));
    }).catch(() => {});
  }, [notes.length]);

  const activeNote = notes.find((n) => n.id === activeNoteId) || null;

  const createNote = useCallback(() => {
    const note: StoredNote = {
      id: crypto.randomUUID(),
      title: "",
      blocks: [],
      tags: [],
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    setNotes((prev) => [note, ...prev]);
    pushToBackend([note, ...notes], note);
    setActiveNoteId(note.id);
  }, [notes, pushToBackend]);

  const updateNote = (updated: StoredNote) => {
    const next = notes.map((n) => n.id === updated.id ? updated : n);
    setNotes(next);
    pushToBackend(next, updated);
  };

  const deleteNote = (id: string) => {
    const next = notes.filter((n) => n.id !== id);
    setNotes(next);
    pushToBackend(next);
    if (activeNoteId === id) setActiveNoteId(null);
    api.deleteNote(id).catch(() => {});
  };

  const setReminder = (mins: number, label: string, customText?: string) => {
    if (!activeNote) return;
    const now = Date.now();
    let due = now + mins * 60 * 1000;
    if (mins === -1) {
      const tonight = new Date(now);
      tonight.setHours(21, 0, 0, 0);
      if (tonight.getTime() <= now) tonight.setDate(tonight.getDate() + 1);
      due = tonight.getTime();
    }
    if (mins === -2) due = new Date(now + 86400000).setHours(9, 0, 0, 0);
    const text = customText || (activeNote.title || "Note") + ` (${label})`;
    api.addReminder(text, Math.floor(due / 1000), activeNote.id).then(({ reminder }) => {
      setReminders((prev) => [...prev, reminder]);
    }).catch(() => {});
  };

  const q = searchQuery.trim().toLowerCase();
  const filteredNotes = q
    ? notes.filter(n =>
        n.title.toLowerCase().includes(q) ||
        n.blocks.some(b => b.content.toLowerCase().includes(q))
      )
    : notes;

  const allTodos = notes.flatMap((n) =>
    (n.analysis?.todos ?? []).map((t) => ({ text: t, note: n, key: `${n.id}:${t}` }))
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-canvas">
      <div className="flex-1 flex overflow-hidden">
        <div className="w-56 bg-surface-1 border-r border-border flex flex-col">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
            <span className="text-xs font-semibold text-text-secondary flex items-center gap-1.5">
              <StickyNote size={12} className="text-accent" /> Notes
              <span className="text-[9px] font-normal text-text-muted bg-surface-3 px-1.5 py-0.5 rounded-full">{notes.length}</span>
            </span>
            <button onClick={createNote} className="p-1 rounded hover:bg-surface-3 text-text-muted hover:text-accent transition-colors">
              <Plus size={14} />
            </button>
          </div>
          <div className="px-3 py-2 border-b border-border/50">
            <div className="relative">
              <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search notes..."
                className="w-full pl-7 pr-2 py-1.5 text-[11px] bg-surface-2 border border-border rounded-lg text-text-primary outline-none placeholder-text-muted/50 focus:border-accent/40 transition-all"
              />
            </div>
          </div>
          <div className="flex border-b border-border/50">
            <button
              onClick={() => setTodoView(false)}
              className={`flex-1 py-1.5 text-[10px] font-medium transition-colors ${!todoView ? "text-accent border-b-2 border-accent" : "text-text-muted hover:text-text-secondary"}`}
            >
              Notes
            </button>
            <button
              onClick={() => setTodoView(true)}
              className={`flex-1 py-1.5 text-[10px] font-medium transition-colors flex items-center justify-center gap-1 ${todoView ? "text-accent border-b-2 border-accent" : "text-text-muted hover:text-text-secondary"}`}
            >
              <CheckSquare size={10} /> Todos
              <span className="text-[8px] bg-surface-3 px-1 rounded-full text-text-muted">{allTodos.length}</span>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            {todoView ? (
              <div className="p-2">
                {allTodos.length === 0 && (
                  <p className="text-[10px] text-text-muted text-center py-4">No todos detected. Write one like "call dentist".</p>
                )}
                {allTodos.map((t) => (
                  <TodoRow
                    key={t.key}
                    text={t.text}
                    done={doneTodos.has(t.key)}
                    onToggle={() => {
                      setDoneTodos((prev) => {
                        const nextSet = new Set(prev);
                        if (nextSet.has(t.key)) nextSet.delete(t.key); else nextSet.add(t.key);
                        return nextSet;
                      });
                    }}
                  />
                ))}
              </div>
            ) : (
              <>
                {filteredNotes.length === 0 && (
                  <div className="px-4 py-8 text-center">
                    <StickyNote size={24} className="mx-auto mb-2 text-text-muted/30" />
                    <p className="text-[11px] text-text-muted">{q ? "No notes match" : "No notes yet"}</p>
                    {!q && <button onClick={createNote} className="mt-2 text-xs text-accent hover:text-accent-bright transition-colors">Create one</button>}
                  </div>
                )}
                {filteredNotes.map((note) => {
                  const snippet = noteSnippet(note);
                  const buys = note.analysis?.buy_intents?.length ?? 0;
                  return (
                    <div
                      key={note.id}
                      className={`group relative w-full text-left px-3 py-2 text-xs border-b border-border/50 transition-colors cursor-pointer
                        ${activeNoteId === note.id ? "bg-accent/10" : "hover:bg-surface-2"}`}
                    >
                      <button onClick={() => setActiveNoteId(note.id)} className="w-full text-left">
                        <div className={`truncate font-medium flex items-center gap-1.5 ${activeNoteId === note.id ? "text-accent" : "text-text-secondary group-hover:text-text-primary"}`}>
                          {note.title || "Untitled"}
                          {buys > 0 && <ShoppingBag size={10} className="shrink-0 text-accent" />}
                        </div>
                        {snippet && <div className="truncate text-[10px] text-text-muted mt-0.5">{snippet}</div>}
                        <div className="text-[9px] text-text-muted/70 mt-0.5">
                          {note.blocks.length} blocks{note.updated_at > 1e9 && ` · ${new Date(note.updated_at >= 1e11 ? note.updated_at : note.updated_at * 1000).toLocaleDateString()}`}
                          {note.analysis?.category && note.analysis.category !== "general" && ` · ${note.analysis.category}`}
                        </div>
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm(`Delete note "${note.title || "Untitled"}"?`)) deleteNote(note.id);
                        }}
                        title="Delete note"
                        className="absolute top-1.5 right-1.5 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-900/40 text-red-400 transition-all"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>

        {activeNote ? (
          <NoteEditor
            note={activeNote}
            onUpdate={updateNote}
            onSetReminder={(mins, label) => setReminder(mins, label)}
            onAddReminder={(text, mins) => setReminder(mins, "custom", text)}
            onDelete={() => {
              if (window.confirm(`Delete note "${activeNote.title || "Untitled"}"?`)) deleteNote(activeNote.id);
            }}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <button onClick={createNote} className="text-center group">
              <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-surface-3 group-hover:bg-surface-4 group-hover:border-accent/30 border border-border flex items-center justify-center transition-all">
                <StickyNote size={32} className="text-text-muted/30 group-hover:text-accent/50 transition-colors" />
              </div>
              <p className="text-sm text-text-muted group-hover:text-text-secondary transition-colors">Select a note or create a new one</p>
              <p className="text-[10px] text-text-muted/50 mt-1">Click anywhere here to start writing</p>
            </button>
          </div>
        )}
        <NoteTracePanel noteId={activeNoteId} />
      </div>
    </div>
  );
}
