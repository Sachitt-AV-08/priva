import React, { useState, useEffect, useCallback } from "react";
import {
  CheckSquare, Plus, Trash2, Circle, CheckCircle,
  Flag, Calendar, Search,
} from "lucide-react";
import type { Task } from "../../engine/types";

const STORAGE_KEY = "priva_tasks";

function loadTasks(): Task[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveTasks(tasks: Task[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

const PRIORITY_COLORS: Record<string, string> = {
  p1: "#ef4444",
  p2: "#f59e0b",
  p3: "#3b82f6",
  p4: "#6b7280",
};

const PRIORITY_LABELS: Record<string, string> = {
  p1: "P1 - Urgent",
  p2: "P2 - High",
  p3: "P3 - Medium",
  p4: "P4 - Low",
};

function TaskRow({ task, onToggle, onDelete, onUpdate }: {
  task: Task;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, changes: Partial<Task>) => void;
}) {
  return (
    <div className={`group flex items-center gap-3 px-4 py-2.5 border-b border-border/50 transition-colors hover:bg-surface-2/50
      ${task.completed ? "opacity-50" : ""}`}>
      <button onClick={() => onToggle(task.id)} className="shrink-0 transition-colors">
        {task.completed
          ? <CheckCircle size={16} className="text-accent-green" />
          : <Circle size={16} className="text-text-muted hover:text-accent" />}
      </button>
      <div className="flex-1 min-w-0">
        <input
          value={task.title}
          onChange={(e) => onUpdate(task.id, { title: e.target.value })}
          className={`w-full bg-transparent text-sm outline-none
            ${task.completed ? "line-through text-text-muted" : "text-text-primary"}`}
          placeholder="New task..."
        />
        {task.description && (
          <div className="text-[11px] text-text-muted mt-0.5 truncate">{task.description}</div>
        )}
      </div>
      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <select
          value={task.priority}
          onChange={(e) => onUpdate(task.id, { priority: e.target.value as any })}
          className="text-[10px] bg-surface-3 border border-border rounded px-1 py-0.5 text-text-secondary outline-none cursor-pointer"
          style={{ color: PRIORITY_COLORS[task.priority] }}
        >
          <option value="p1">P1</option>
          <option value="p2">P2</option>
          <option value="p3">P3</option>
          <option value="p4">P4</option>
        </select>
        <button onClick={() => onDelete(task.id)} className="p-1 hover:bg-red-900/30 rounded text-red-400 transition-colors">
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  );
}

export function TasksWorld() {
  const [tasks, setTasks] = useState<Task[]>(loadTasks);
  const [filter, setFilter] = useState<"all" | "active" | "done">("all");
  const [newTitle, setNewTitle] = useState("");

  useEffect(() => { saveTasks(tasks); }, [tasks]);

  const filteredTasks = tasks.filter((t) => {
    if (filter === "active") return !t.completed;
    if (filter === "done") return t.completed;
    return true;
  });

  const addTask = () => {
    if (!newTitle.trim()) return;
    const task: Task = {
      id: crypto.randomUUID(),
      title: newTitle.trim(),
      description: "",
      priority: "p3",
      completed: false,
      due_date: null,
      tags: [],
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    setTasks((prev) => [task, ...prev]);
    setNewTitle("");
  };

  const toggleTask = useCallback((id: string) => {
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, completed: !t.completed, updated_at: Date.now() } : t));
  }, []);

  const deleteTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const updateTask = useCallback((id: string, changes: Partial<Task>) => {
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, ...changes, updated_at: Date.now() } : t));
  }, []);

  const activeCount = tasks.filter((t) => !t.completed).length;
  const doneCount = tasks.filter((t) => t.completed).length;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-canvas">
      <div className="px-6 py-4 border-b border-border">
        <div className="flex items-center gap-2 mb-3">
          <CheckSquare size={18} className="text-accent" />
          <h1 className="text-lg font-semibold text-text-primary">Tasks</h1>
          <span className="text-xs text-text-muted ml-1">{activeCount} active</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTask()}
            placeholder="Add a new task..."
            className="flex-1 px-3 py-2 text-sm bg-surface-2 border border-border rounded-lg text-text-primary outline-none placeholder-text-muted/50 focus:border-accent/50 transition-colors"
          />
          <button onClick={addTask} disabled={!newTitle.trim()}
            className="px-3 py-2 bg-accent text-white rounded-lg text-xs font-medium hover:bg-accent-hover transition-colors disabled:opacity-30">
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className="flex border-b border-border">
        {(["all", "active", "done"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-4 py-2 text-xs font-medium transition-colors border-b-2
              ${filter === f ? "text-accent border-accent" : "text-text-muted border-transparent hover:text-text-secondary"}`}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
            <span className="ml-1.5 text-[10px] text-text-muted">
              {f === "all" ? tasks.length : f === "active" ? activeCount : doneCount}
            </span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {filteredTasks.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <CheckSquare size={36} className="mx-auto mb-2 text-text-muted/20" />
              <p className="text-sm text-text-muted">
                {filter === "all" ? "No tasks yet" : `No ${filter} tasks`}
              </p>
            </div>
          </div>
        )}
        {filteredTasks.map((task) => (
          <TaskRow key={task.id} task={task} onToggle={toggleTask} onDelete={deleteTask} onUpdate={updateTask} />
        ))}
      </div>
    </div>
  );
}
