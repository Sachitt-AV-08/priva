"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import AppShell from "../../components/AppShell";
import Spinner from "../../components/Spinner";
import { useAuth } from "../../lib/auth";

type Priority = "P1" | "P2" | "P3" | "P4";
type Task = { id: string; text: string; done: boolean; priority: Priority };
type Filter = "all" | "active" | "done";

const STORAGE_KEY = "priva_tasks";

export default function TasksPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [text, setText] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editingId, setEditingId] = useState("");
  const [editingText, setEditingText] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const priorities: Priority[] = ["P1", "P2", "P3", "P4"];
          const seen = new Set<string>();
          const restored = parsed
            .filter((task) => task && typeof task.text === "string" && task.text.trim())
            .map((task, index) => {
              const candidate = typeof task.id === "string" && task.id.trim() ? task.id : `restored-${index}`;
              const id = seen.has(candidate) ? `${candidate}-${index}` : candidate;
              seen.add(id);
              return {
                id,
                text: task.text.trim(),
                done: Boolean(task.done),
                priority: priorities.includes(task.priority) ? task.priority : "P3" as Priority,
              };
            });
          setTasks(restored);
        }
      }
    } catch {
      // A malformed local value should not block the task list.
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch {
      // The in-memory task list remains usable when storage is unavailable.
    }
  }, [hydrated, tasks]);

  const counts = useMemo(() => ({
    all: tasks.length,
    active: tasks.filter((task) => !task.done).length,
    done: tasks.filter((task) => task.done).length,
  }), [tasks]);

  const visibleTasks = tasks.filter((task) =>
    filter === "all" || (filter === "active" ? !task.done : task.done)
  );

  const addTask = (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    setTasks((current) => [
      ...current,
      { id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text: value, done: false, priority: "P3" },
    ]);
    setText("");
  };

  const updateTask = (id: string, patch: Partial<Task>) => {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, ...patch } : task));
  };

  const commitRename = () => {
    const value = editingText.trim();
    if (editingId && value) updateTask(editingId, { text: value });
    setEditingId("");
    setEditingText("");
  };

  const deleteTask = (task: Task) => {
    if (!window.confirm(`Delete “${task.text}”?`)) return;
    setTasks((current) => current.filter((item) => item.id !== task.id));
  };

  if (loading || !user || !hydrated) {
    return <main className="loading-page"><Spinner /></main>;
  }

  return (
    <AppShell>
      <div className="tasks-layout">
        <header className="page-head">
          <div>
            <p className="page-kicker">Private to this device</p>
            <h1>Tasks</h1>
            <p className="page-description">A clear list for the work that should stay simple.</p>
          </div>
        </header>

        <form className="card task-composer" onSubmit={addTask}>
          <input
            className="field"
            placeholder="Add a task"
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-label="New task"
          />
          <button className="btn btn-primary" type="submit" disabled={!text.trim()}>
            <Plus size={15} aria-hidden="true" />
            Add
          </button>
        </form>

        <div className="task-tabs">
          <div className="filter-tabs" role="tablist" aria-label="Task filters">
            {(["all", "active", "done"] as Filter[]).map((item) => (
              <button
                id={`tasks-${item}-tab`}
                className={`filter-tab${filter === item ? " on" : ""}`}
                type="button"
                role="tab"
                aria-selected={filter === item}
                aria-controls="tasks-filter-panel"
                tabIndex={filter === item ? 0 : -1}
                key={item}
                onClick={() => setFilter(item)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                  event.preventDefault();
                  const tabs: Filter[] = ["all", "active", "done"];
                  const direction = event.key === "ArrowRight" ? 1 : -1;
                  const next = tabs[(tabs.indexOf(item) + direction + tabs.length) % tabs.length];
                  setFilter(next);
                  window.requestAnimationFrame(() => document.getElementById(`tasks-${next}-tab`)?.focus());
                }}
              >
                {item[0].toUpperCase() + item.slice(1)} <span className="mono">{counts[item]}</span>
              </button>
            ))}
          </div>
          <span className="muted tiny">Select a task to rename</span>
        </div>

        <section className="card task-list" id="tasks-filter-panel" role="tabpanel" aria-labelledby={`tasks-${filter}-tab`} aria-label={`${filter} tasks`}>
          {visibleTasks.length === 0 ? (
            <div className="empty-state">
              {filter === "done" ? "Completed tasks will collect here." : "Nothing waiting. Add the next clear action."}
            </div>
          ) : visibleTasks.map((task) => (
            <div className="task-row" key={task.id}>
              <button
                className={`task-checkbox${task.done ? " on" : ""}`}
                type="button"
                aria-label={task.done ? `Mark ${task.text} active` : `Complete ${task.text}`}
                onClick={() => updateTask(task.id, { done: !task.done })}
              >
                {task.done && <Check size={13} strokeWidth={2.5} aria-hidden="true" />}
              </button>

              {editingId === task.id ? (
                <input
                  className="task-edit"
                  value={editingText}
                  aria-label={`Rename ${task.text}`}
                  onChange={(event) => setEditingText(event.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitRename();
                    if (event.key === "Escape") {
                      setEditingId("");
                      setEditingText("");
                    }
                  }}
                  autoFocus
                />
              ) : (
                <button
                  type="button"
                  className={`task-text${task.done ? " done" : ""}`}
                  onClick={() => {
                    setEditingId(task.id);
                    setEditingText(task.text);
                  }}
                  aria-label={`Rename ${task.text}`}
                >
                  {task.text}
                </button>
              )}

              <select
                className={`priority-select priority-${task.priority.toLowerCase()}`}
                value={task.priority}
                onChange={(event) => updateTask(task.id, { priority: event.target.value as Priority })}
                aria-label={`Priority for ${task.text}`}
              >
                <option value="P1">P1</option>
                <option value="P2">P2</option>
                <option value="P3">P3</option>
                <option value="P4">P4</option>
              </select>

              <button className="btn btn-icon btn-ghost btn-danger" type="button" title="Delete task" onClick={() => deleteTask(task)}>
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </div>
          ))}
        </section>
      </div>
    </AppShell>
  );
}
