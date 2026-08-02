import React, { useEffect, useState } from "react";
import { Command, Minus, Square, X, Copy } from "lucide-react";
import { useStore } from "../store";
import { Logo } from "./Logo";

export function TitleBar({ showSearch = true }: { showSearch?: boolean }) {
  const setCommandPaletteOpen = useStore((s) => s.setCommandPaletteOpen);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    window.priva?.window?.isMaximized?.().then(setMaximized).catch(() => {});
  }, []);

  const toggleMaximize = () => {
    window.priva?.window?.maximize?.();
    setMaximized((m) => !m);
  };

  const win = window.priva?.window ?? {};

  return (
    <div
      className="h-10 bg-canvas/80 backdrop-blur-xl flex items-center justify-between border-b border-border select-none"
      style={{ WebkitAppRegion: "drag" } as any}
      onDoubleClick={toggleMaximize}
    >
      <div className="flex items-center gap-3 px-4" style={{ WebkitAppRegion: "no-drag" } as any}>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-500 hover:brightness-125 transition-all" />
          <div className="w-3 h-3 rounded-full bg-yellow-500 hover:brightness-125 transition-all" />
          <div className="w-3 h-3 rounded-full bg-green-500 hover:brightness-125 transition-all" />
        </div>
        <div className="w-px h-4 bg-border mx-1" />
        <Logo size="small" />
      </div>

      <div className="flex items-center gap-2" style={{ WebkitAppRegion: "no-drag" } as any}>
        {showSearch && (
          <button
            onClick={() => setCommandPaletteOpen(true)}
            className="flex items-center gap-1.5 text-[10px] text-text-muted bg-surface-2 hover:bg-surface-3 hover:text-text-secondary px-2 py-1 rounded-md border border-border transition-colors"
          >
            <Command size={10} />
            <span>Quick Search</span>
            <kbd className="text-[9px] text-text-muted bg-surface-4 px-1 rounded ml-1">⌘K</kbd>
          </button>
        )}
      </div>

      <div className="flex items-center h-full" style={{ WebkitAppRegion: "no-drag" } as any}>
        <button
          onClick={() => win.minimize?.()}
          title="Minimize"
          className="w-11 h-full flex items-center justify-center text-text-muted hover:bg-surface-2 hover:text-text-secondary transition-colors"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={toggleMaximize}
          title={maximized ? "Restore" : "Maximize"}
          className="w-11 h-full flex items-center justify-center text-text-muted hover:bg-surface-2 hover:text-text-secondary transition-colors"
        >
          {maximized ? <Copy size={12} /> : <Square size={11} />}
        </button>
        <button
          onClick={() => win.close?.()}
          title="Close"
          className="w-11 h-full flex items-center justify-center text-text-muted hover:bg-red-600 hover:text-white transition-colors"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
