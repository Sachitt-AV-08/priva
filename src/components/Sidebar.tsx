import React from "react";
import {
  StickyNote, CheckSquare, ShoppingCart, Share2, MessageSquareText,
  PanelLeftClose, Zap, Search,
} from "lucide-react";
import { useStore } from "../store";

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { id: "chat", label: "Chat", icon: <MessageSquareText size={16} /> },
  { id: "notes", label: "Notes", icon: <StickyNote size={16} /> },
  { id: "tasks", label: "Tasks", icon: <CheckSquare size={16} /> },
  { id: "commerce", label: "Commerce", icon: <ShoppingCart size={16} /> },
  { id: "purchase-graph", label: "Purchase Graph", icon: <Share2 size={16} /> },
];

export function Sidebar() {
  const { activeWorld, sidebarOpen, setActiveWorld, setSidebarOpen, setCommandPaletteOpen } = useStore();

  if (!sidebarOpen) {
    return (
      <div className="w-11 bg-canvas border-r border-border flex flex-col items-center pt-3 gap-3">
        <button
          onClick={() => setSidebarOpen(true)}
          className="p-1.5 rounded-lg hover:bg-surface-3 text-text-secondary transition-all hover:text-text-primary"
          title="Expand sidebar"
        >
          <PanelLeftClose size={16} className="rotate-180" />
        </button>
        <div className="w-4 h-px bg-border/50" />
        <button
          onClick={() => setCommandPaletteOpen(true)}
          className="p-1.5 rounded-lg hover:bg-surface-3 text-text-secondary transition-all hover:text-text-primary"
          title="Command Palette (⌘K)"
        >
          <Search size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="bg-canvas border-r border-border flex flex-col h-full overflow-hidden select-none" style={{ width: 220 }}>
      <div className="h-10 flex items-center justify-between px-3 border-b border-border">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Navigation</span>
        <button
          onClick={() => setSidebarOpen(false)}
          className="p-1 rounded-lg hover:bg-surface-3 text-text-muted hover:text-text-secondary transition-all"
          title="Collapse sidebar"
        >
          <PanelLeftClose size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-2 py-3 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const isActive = activeWorld === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveWorld(item.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-all duration-150 group
                ${isActive
                  ? "bg-accent/10 text-accent font-medium"
                  : "text-text-secondary hover:bg-surface-3 hover:text-text-primary"
                }`}
            >
              <span className={`transition-colors ${isActive ? "text-accent" : "text-text-muted group-hover:text-text-secondary"}`}>
                {item.icon}
              </span>
              <span>{item.label}</span>
              {isActive && (
                <span className="ml-auto w-1 h-4 rounded-full bg-gradient-to-b from-accent to-accent-bright shadow-[0_0_6px_rgba(139,92,246,0.5)]" />
              )}
            </button>
          );
        })}
      </div>

      <div className="p-2 border-t border-border">
        <button
          onClick={() => setCommandPaletteOpen(true)}
          className="w-full flex items-center gap-2 px-2.5 py-2 text-xs rounded-lg bg-surface-2 hover:bg-surface-3 text-text-secondary hover:text-text-primary transition-all border border-border/50 hover:border-border"
        >
          <Zap size={12} className="text-accent" />
          <span>Quick Search</span>
          <kbd className="ml-auto text-[9px] text-text-muted bg-surface-4 px-1 py-0.5 rounded font-mono">⌘K</kbd>
        </button>
      </div>
    </div>
  );
}
