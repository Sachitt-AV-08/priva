import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { CommandPalette } from "./components/CommandPalette";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LoginScreen } from "./components/LoginScreen";
import { NotesWorld } from "./worlds/notes";
import { TasksWorld } from "./worlds/tasks";
import { CommerceWorld } from "./worlds/commerce";
import { PurchaseGraphWorld } from "./worlds/purchase-graph";
import { ChatWorld } from "./worlds/chat";
import { useStore } from "./store";
import { api } from "./engine/apiClient";

const worldVariants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.15, ease: "easeOut" } },
  exit: { opacity: 0, y: -4, transition: { duration: 0.1, ease: "easeIn" } },
};

const worlds: Record<string, React.ReactNode> = {
  chat: (
    <ErrorBoundary label="Chat world">
      <ChatWorld.Content />
    </ErrorBoundary>
  ),
  notes: <NotesWorld />,
  tasks: <TasksWorld />,
  commerce: (
    <ErrorBoundary label="Commerce world">
      <CommerceWorld />
    </ErrorBoundary>
  ),
  "purchase-graph": (
    <ErrorBoundary label="Purchase graph world">
      <PurchaseGraphWorld />
    </ErrorBoundary>
  ),
};

export function App() {
  const { activeWorld, sidebarOpen, commandPaletteOpen, setCommandPaletteOpen } = useStore();
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    const t = localStorage.getItem("priva_token");
    if (!t) {
      setAuthed(false);
      return;
    }
    api
      .getMe()
      .then((me) => setAuthed(me.authenticated))
      .catch(() => setAuthed(false));
  }, []);

  useEffect(() => {
    if (authed === false) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [authed, commandPaletteOpen, setCommandPaletteOpen]);

  if (authed === null) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-canvas">
        <span className="text-text-muted text-sm animate-pulse">Connecting to PRIVA…</span>
      </div>
    );
  }

  if (!authed) {
    return <LoginScreen onLogin={() => setAuthed(true)} />;
  }

  return (
    <ErrorBoundary label="App">
      <div className="h-screen w-screen flex flex-col overflow-hidden bg-canvas">
        <TitleBar />
        <div className="flex-1 flex overflow-hidden">
          <Sidebar />
          <div className="flex-1 flex flex-col overflow-hidden relative">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeWorld}
                variants={worldVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="absolute inset-0 flex flex-col overflow-hidden"
              >
                {worlds[activeWorld] || <NotesWorld />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
        <CommandPalette />
      </div>
    </ErrorBoundary>
  );
}
