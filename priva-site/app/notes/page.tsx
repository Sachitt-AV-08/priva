"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Circle,
  Heading2,
  List,
  Minus,
  Plus,
  Save,
  Search,
  SquareCheckBig,
  Trash2,
  Type,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "../../components/AppShell";
import Spinner from "../../components/Spinner";
import { useAuth } from "../../lib/auth";
import { apiFetch } from "../../lib/backend";

type BlockType = "text" | "heading" | "list" | "toggle" | "divider";
type NoteBlock = { type: BlockType; content?: string };
type Note = {
  id: string;
  title?: string;
  blocks: NoteBlock[];
  tags?: string[];
  created_at?: number;
  updated_at?: number;
};
type BuyIntent = { item: string; price_hint?: number; prefs?: Record<string, unknown> };
type Analysis = {
  id?: string;
  buy_intents?: BuyIntent[];
  todos?: string[];
  reminders?: { text: string; due_at: number; parsed_from?: string }[];
  category?: string;
  summary?: string;
};
type AgentEvent = {
  agent?: string;
  text?: string;
  message?: string;
  detail?: string;
  note_id?: string;
  ts?: number;
};

const BLOCK_OPTIONS: { type: BlockType; label: string; icon: typeof Type }[] = [
  { type: "text", label: "Text", icon: Type },
  { type: "heading", label: "Heading", icon: Heading2 },
  { type: "list", label: "List", icon: List },
  { type: "toggle", label: "Toggle", icon: SquareCheckBig },
  { type: "divider", label: "Divider", icon: Minus },
];

function emptyDraft(): Note {
  return { id: "", title: "", blocks: [{ type: "text", content: "" }], tags: [] };
}

function copyNote(note: Note): Note {
  return { ...note, blocks: (note.blocks || []).map((block) => ({ ...block })) };
}

function noteText(note: Note) {
  return (note.blocks || [])
    .filter((block) => block.type !== "divider")
    .map((block) => block.content || "")
    .join("\n")
    .trim();
}

function fallbackTodos(note: Note) {
  return noteText(note)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*\[\s]*\[\s*]/i.test(line))
    .map((line) => line.replace(/^[-*\s]*\[\s*\]\s*/i, "").trim())
    .filter(Boolean);
}

function stageFor(event: AgentEvent) {
  const text = `${event.text || event.message || ""} ${event.detail || ""}`.toLowerCase();
  if (/deliver|shipping|shipped|arrival/.test(text)) return "Deliver";
  if (/checkout|order/.test(text)) return "Checkout";
  if (/\bpay|payment|prava|session/.test(text)) return "Pay";
  if (/rank|score|best pick|recommend/.test(text)) return "Rank";
  if (/search|product|merchant|result/.test(text)) return "Search";
  if (/intent|analy|understand|note/.test(text)) return "Intent";
  return "Event";
}

function reminderTime(kind: "hour" | "tonight" | "tomorrow") {
  const now = new Date();
  if (kind === "hour") return Math.floor(now.getTime() / 1000) + 3600;
  const due = new Date(now);
  if (kind === "tonight") {
    due.setHours(21, 0, 0, 0);
    if (due.getTime() <= now.getTime()) due.setDate(due.getDate() + 1);
  } else {
    due.setDate(due.getDate() + 1);
    due.setHours(9, 0, 0, 0);
  }
  return Math.floor(due.getTime() / 1000);
}

export default function NotesPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState<Note>(emptyDraft);
  const [selectedId, setSelectedId] = useState("");
  const [analyses, setAnalyses] = useState<Record<string, Analysis>>({});
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [tab, setTab] = useState<"notes" | "todos">("notes");
  const [search, setSearch] = useState("");
  const [customTime, setCustomTime] = useState("");
  const [busy, setBusy] = useState<"save" | "delete" | "reminder" | "">("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [loaded, setLoaded] = useState(false);
  const selectedIdRef = useRef("");

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }, []);

  const fetchAnalysis = useCallback(async (noteId: string) => {
    if (!noteId) {
      setAnalysis(null);
      return;
    }
    try {
      const response = await apiFetch(`/api/notes/analyze?note_id=${encodeURIComponent(noteId)}`);
      if (!response.ok) return;
      const body: Analysis = await response.json();
      setAnalyses((current) => ({ ...current, [noteId]: body }));
      if (selectedIdRef.current === noteId) setAnalysis(body);
    } catch {
      // Existing analysis remains visible while reconnecting.
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    Promise.all([apiFetch("/api/notes"), apiFetch("/api/notes/analyze")])
      .then(async ([notesResponse, analysisResponse]) => {
        const loadedNotes: Note[] = notesResponse.ok ? (await notesResponse.json()).notes || [] : [];
        const allAnalysis = analysisResponse.ok ? (await analysisResponse.json()).notes || [] : [];
        if (!alive) return;
        setNotes(loadedNotes);
        const route = new URLSearchParams(window.location.search);
        const requestedId = route.get("id");
        const wantsNew = route.get("new") === "1";
        const initialNote = !wantsNew
          ? loadedNotes.find((note) => note.id === requestedId) || loadedNotes[0]
          : undefined;
        if (initialNote) {
          selectedIdRef.current = initialNote.id;
          setSelectedId(initialNote.id);
          setDraft(copyNote(initialNote));
        } else {
          selectedIdRef.current = "";
          setSelectedId("");
          setDraft(emptyDraft());
        }
        const byId: Record<string, Analysis> = {};
        for (const entry of allAnalysis) {
          if (entry.id) byId[entry.id] = entry;
        }
        setAnalyses(byId);
        if (initialNote && byId[initialNote.id]) setAnalysis(byId[initialNote.id]);
      })
      .catch(() => {})
      .finally(() => alive && setLoaded(true));
    return () => { alive = false; };
  }, [user]);

  useEffect(() => {
    if (!selectedId) {
      setEvents([]);
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const response = await apiFetch(`/api/agent/activity?note_id=${encodeURIComponent(selectedId)}`);
        if (!response.ok || !alive) return;
        const body = await response.json();
        setEvents(body.events || []);
      } catch {
        // Keep the last trace visible during reconnects.
      }
    };
    load();
    const timer = window.setInterval(load, 3000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [selectedId]);

  const todos = useMemo(() => notes.flatMap((note) => {
    const items = analyses[note.id]?.todos?.length
      ? analyses[note.id].todos || []
      : fallbackTodos(note);
    return items.map((text) => ({ noteId: note.id, noteTitle: note.title || "Untitled", text }));
  }), [analyses, notes]);

  const normalizedSearch = search.trim().toLowerCase();
  const visibleNotes = notes.filter((note) =>
    !normalizedSearch || `${note.title || ""} ${noteText(note)}`.toLowerCase().includes(normalizedSearch)
  );
  const visibleTodos = todos.filter((todo) =>
    !normalizedSearch || `${todo.noteTitle} ${todo.text}`.toLowerCase().includes(normalizedSearch)
  );

  const selectNote = (note: Note) => {
    selectedIdRef.current = note.id;
    setSelectedId(note.id);
    setDraft(copyNote(note));
    setAnalysis(analyses[note.id] || null);
    setError("");
    router.replace(`/notes?id=${encodeURIComponent(note.id)}`, { scroll: false });
    fetchAnalysis(note.id);
  };

  const startNote = () => {
    selectedIdRef.current = "";
    setSelectedId("");
    setDraft(emptyDraft());
    setAnalysis(null);
    setEvents([]);
    setError("");
    setTab("notes");
    router.replace("/notes?new=1", { scroll: false });
  };

  const updateBlock = (index: number, content: string) => {
    setDraft((current) => ({
      ...current,
      blocks: current.blocks.map((block, blockIndex) =>
        blockIndex === index ? { ...block, content } : block
      ),
    }));
  };

  const addBlock = (type: BlockType) => {
    setDraft((current) => ({
      ...current,
      blocks: [...current.blocks, { type, ...(type === "divider" ? {} : { content: "" }) }],
    }));
  };

  const removeBlock = (index: number) => {
    setDraft((current) => {
      const next = current.blocks.filter((_, blockIndex) => blockIndex !== index);
      return { ...current, blocks: next.length ? next : [{ type: "text", content: "" }] };
    });
  };

  const saveNote = async () => {
    if (busy) return;
    setBusy("save");
    setError("");
    const now = Math.floor(Date.now() / 1000);
    const id = draft.id || `web-${Date.now()}`;
    const payload: Note = {
      ...draft,
      id,
      title: draft.title?.trim() || "Untitled",
      blocks: draft.blocks,
      tags: draft.tags || [],
      created_at: draft.created_at || now,
      updated_at: now,
    };
    try {
      const response = await apiFetch(draft.id ? `/api/notes/${encodeURIComponent(draft.id)}` : "/api/notes", {
        method: draft.id ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || "Note was not saved");
      const saved: Note = { ...payload, ...(body.note || {}) };
      setNotes((current) => {
        const exists = current.some((note) => note.id === saved.id);
        return exists
          ? current.map((note) => note.id === saved.id ? saved : note)
          : [saved, ...current];
      });
      setDraft(copyNote(saved));
      selectedIdRef.current = saved.id;
      setSelectedId(saved.id);
      router.replace(`/notes?id=${encodeURIComponent(saved.id)}`, { scroll: false });
      showToast("Saved");
      await fetchAnalysis(saved.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Note was not saved");
    } finally {
      setBusy("");
    }
  };

  const deleteNote = async (note: Note) => {
    if (busy || !window.confirm(`Delete “${note.title || "Untitled"}”?`)) return;
    setBusy("delete");
    setError("");
    try {
      const response = await apiFetch(`/api/notes/${encodeURIComponent(note.id)}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.detail || "Note was not deleted");
      }
      const remaining = notes.filter((item) => item.id !== note.id);
      setNotes(remaining);
      setAnalyses((current) => {
        const next = { ...current };
        delete next[note.id];
        return next;
      });
      if (selectedId === note.id) {
        if (remaining[0]) selectNote(remaining[0]);
        else startNote();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Note was not deleted");
    } finally {
      setBusy("");
    }
  };

  const createReminder = async (dueAt: number) => {
    if (!dueAt || busy) return;
    const text = draft.title?.trim() || noteText(draft).split("\n")[0] || "PRIVA reminder";
    setBusy("reminder");
    setError("");
    try {
      const response = await apiFetch("/api/reminders", {
        method: "POST",
        body: JSON.stringify({ text, due_at: dueAt, ...(selectedId ? { note_id: selectedId } : {}) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || "Reminder was not set");
      showToast("Reminder set");
      setCustomTime("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Reminder was not set");
    } finally {
      setBusy("");
    }
  };

  if (loading || !user || !loaded) {
    return <main className="loading-page"><Spinner /></main>;
  }

  return (
    <AppShell>
      <div className="notes-workspace">
        <aside className="notes-pane notes-list-pane">
          <div className="notes-pane-head">
            <div className="notes-pane-title">
              <h2>Notes</h2>
              <button className="btn btn-icon btn-sm" type="button" onClick={startNote} title="New note" disabled={Boolean(busy)}>
                <Plus size={14} aria-hidden="true" />
              </button>
            </div>
            <div className="search-wrap">
              <Search size={14} aria-hidden="true" />
              <input
                className="field note-search"
                placeholder="Search notes"
                aria-label="Search notes"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="segmented" role="tablist" aria-label="Note views">
              <button
                id="notes-tab"
                className={`segment${tab === "notes" ? " on" : ""}`}
                type="button"
                role="tab"
                aria-selected={tab === "notes"}
                aria-controls="notes-list-panel"
                tabIndex={tab === "notes" ? 0 : -1}
                onClick={() => setTab("notes")}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowRight") return;
                  event.preventDefault();
                  setTab("todos");
                  window.requestAnimationFrame(() => document.getElementById("todos-tab")?.focus());
                }}
              >
                Notes <span className="mono">{notes.length}</span>
              </button>
              <button
                id="todos-tab"
                className={`segment${tab === "todos" ? " on" : ""}`}
                type="button"
                role="tab"
                aria-selected={tab === "todos"}
                aria-controls="notes-list-panel"
                tabIndex={tab === "todos" ? 0 : -1}
                onClick={() => setTab("todos")}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft") return;
                  event.preventDefault();
                  setTab("notes");
                  window.requestAnimationFrame(() => document.getElementById("notes-tab")?.focus());
                }}
              >
                Todos <span className="mono">{todos.length}</span>
              </button>
            </div>
          </div>

          <div className="notes-rows" id="notes-list-panel" role="tabpanel" aria-labelledby={tab === "notes" ? "notes-tab" : "todos-tab"}>
            {tab === "notes" && visibleNotes.map((note) => (
              <div className={`note-list-row${selectedId === note.id ? " on" : ""}`} key={note.id}>
                <button className="note-select" type="button" onClick={() => selectNote(note)} disabled={Boolean(busy)}>
                  <span className="note-list-title">{note.title || "Untitled"}</span>
                  <span className="note-list-preview">{noteText(note) || "No content yet"}</span>
                </button>
                <button
                  className="note-row-delete"
                  type="button"
                  title="Delete note"
                  onClick={() => deleteNote(note)}
                  disabled={Boolean(busy)}
                >
                  <Trash2 size={12} aria-hidden="true" />
                </button>
              </div>
            ))}
            {tab === "notes" && visibleNotes.length === 0 && (
              <div className="empty-state">No notes match this search.</div>
            )}
            {tab === "todos" && visibleTodos.map((todo, index) => (
              <button
                className="todo-row"
                type="button"
                key={`${todo.noteId}-${index}`}
                disabled={Boolean(busy)}
                onClick={() => {
                  const note = notes.find((item) => item.id === todo.noteId);
                  if (note) selectNote(note);
                }}
              >
                <Circle size={12} aria-hidden="true" />
                <span>{todo.text}<small>{todo.noteTitle}</small></span>
              </button>
            ))}
            {tab === "todos" && visibleTodos.length === 0 && (
              <div className="empty-state">No open todos were found in your notes.</div>
            )}
          </div>
        </aside>

        <section className="notes-pane editor-pane">
          <div className="editor-toolbar">
            <div className="block-adders" aria-label="Add block">
              <Plus size={13} className="muted" aria-hidden="true" />
              {BLOCK_OPTIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    className="block-adder"
                    type="button"
                    key={option.type}
                    title={`Add ${option.label.toLowerCase()}`}
                    onClick={() => addBlock(option.type)}
                    disabled={Boolean(busy)}
                  >
                    <Icon size={14} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
            <button className="btn btn-primary btn-sm" type="button" onClick={saveNote} disabled={Boolean(busy)}>
              <Save size={13} aria-hidden="true" />
              {busy === "save" ? "Saving..." : "Save"}
            </button>
          </div>

          <div className="editor-scroll">
            <input
              className="note-title-input"
              placeholder="Untitled note"
              aria-label="Note title"
              disabled={Boolean(busy)}
              value={draft.title || ""}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
            />

            {analysis && (
              <div className="note-analysis">
                <div className="analysis-line">
                  <span className="badge">{analysis.category || "general"}</span>
                  {(analysis.buy_intents || []).map((intent) => (
                    <Link className="chip" href={`/shop?q=${encodeURIComponent(intent.item)}${intent.price_hint != null ? `&max=${encodeURIComponent(String(intent.price_hint))}` : ""}`} key={intent.item}>
                      {intent.item}
                    </Link>
                  ))}
                  {(analysis.buy_intents || []).length > 0 && (
                    <span className="muted tiny">shopping · texted you</span>
                  )}
                </div>
                {analysis.summary && <p className="analysis-summary">{analysis.summary}</p>}
              </div>
            )}

            <div className="blocks-list">
              {draft.blocks.map((block, index) => (
                <div className={`block-row block-${block.type}`} key={`${block.type}-${index}`}>
                  <span className="block-kind" aria-hidden="true">
                    {block.type === "heading" ? "H" : block.type === "list" ? "•" : block.type === "toggle" ? "□" : block.type === "divider" ? "−" : "T"}
                  </span>
                  {block.type === "divider" ? (
                    <div className="block-divider" aria-label="Divider" />
                  ) : (
                    <textarea
                      className="block-input"
                      rows={block.type === "heading" ? 1 : 2}
                      placeholder={
                        block.type === "heading" ? "Heading" :
                        block.type === "list" ? "List item" :
                        block.type === "toggle" ? "Toggle item" : "Write naturally..."
                      }
                      value={block.content || ""}
                      onChange={(event) => updateBlock(index, event.target.value)}
                      aria-label={`${block.type} block`}
                      disabled={Boolean(busy)}
                    />
                  )}
                  <button className="block-delete" type="button" title="Delete block" onClick={() => removeBlock(index)} disabled={Boolean(busy)}>
                    <Trash2 size={12} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>

            <div className="reminder-bar">
              <span className="muted tiny">Remind me</span>
              <button className="chip" type="button" disabled={Boolean(busy)} onClick={() => createReminder(reminderTime("hour"))}>in 1h</button>
              <button className="chip" type="button" disabled={Boolean(busy)} onClick={() => createReminder(reminderTime("tonight"))}>tonight 9pm</button>
              <button className="chip" type="button" disabled={Boolean(busy)} onClick={() => createReminder(reminderTime("tomorrow"))}>tomorrow 9am</button>
              <input
                className="custom-reminder"
                type="datetime-local"
                value={customTime}
                onChange={(event) => setCustomTime(event.target.value)}
                aria-label="Custom reminder date and time"
              />
              <button
                className="chip"
                type="button"
                disabled={!customTime || Boolean(busy)}
                onClick={() => createReminder(Math.floor(new Date(customTime).getTime() / 1000))}
              >
                custom
              </button>
            </div>
            {error && <p className="err small" role="alert">{error}</p>}
          </div>
        </section>

        <aside className="notes-pane trace-pane">
          <div className="trace-head">
            <h2>Agent Trace</h2>
            <p className="muted tiny">Intent → Search → Rank → Pay → Checkout → Deliver</p>
          </div>
          <div className="trace-list">
            {events.length === 0 ? (
              <div className="empty-state">Waiting for PRIVA&apos;s agent to pick up this note...</div>
            ) : events.map((event, index) => {
              const stage = stageFor(event);
              const text = event.text || event.message || "Agent update";
              return (
                <div className="trace-row" key={`${event.ts || 0}-${index}`}>
                  <span className={`badge trace-stage trace-stage-${stage.toLowerCase()}`}>{stage}</span>
                  <div className="trace-copy">
                    <p className="trace-text">{text}</p>
                    {event.detail && <p className="trace-detail">{event.detail}</p>}
                    <span className="trace-time">
                      {event.ts ? new Date(event.ts * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "now"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>
      </div>
      {toast && <div className="toast" role="status"><Check size={14} aria-hidden="true" /> {toast}</div>}
    </AppShell>
  );
}
