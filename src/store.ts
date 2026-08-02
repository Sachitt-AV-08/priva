import { create } from "zustand";
import type { Node } from "./engine/types";

export interface Tab {
  id: string;
  nodeId: string | null;
  toolId: string | null;
  title: string;
  icon: string;
}

interface PrivaState {
  activeWorld: string;
  activeTabId: string | null;
  tabs: Tab[];
  sidebarOpen: boolean;
  sidebarWidth: number;
  commandPaletteOpen: boolean;

  setActiveWorld: (world: string) => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setCommandPaletteOpen: (open: boolean) => void;

  addTab: (tab: Omit<Tab, "id">) => string;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
}

export const useStore = create<PrivaState>((set, get) => ({
  activeWorld: "notes",
  activeTabId: null,
  tabs: [],
  sidebarOpen: true,
  sidebarWidth: 220,
  commandPaletteOpen: false,

  setActiveWorld: (world) => set({ activeWorld: world }),

  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

  addTab: (tab) => {
    const id = crypto.randomUUID();
    const newTab = { ...tab, id };
    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: id,
    }));
    return id;
  },

  closeTab: (id) => {
    const state = get();
    const idx = state.tabs.findIndex((t) => t.id === id);
    const newTabs = state.tabs.filter((t) => t.id !== id);
    let newActiveId = state.activeTabId;
    if (state.activeTabId === id) {
      if (newTabs.length === 0) newActiveId = null;
      else if (idx >= newTabs.length) newActiveId = newTabs[newTabs.length - 1].id;
      else newActiveId = newTabs[idx].id;
    }
    set({ tabs: newTabs, activeTabId: newActiveId });
  },

  setActiveTab: (id) => set({ activeTabId: id }),
}));
