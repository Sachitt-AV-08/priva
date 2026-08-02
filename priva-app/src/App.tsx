import React, { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { CommandPalette } from "./components/CommandPalette";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { NotesWorld } from "./worlds/notes";
import { TasksWorld } from "./worlds/tasks";
import { CommerceWorld } from "./worlds/commerce";
import { PurchaseGraphWorld } from "./worlds/purchase-graph";
import { useStore } from "./store";

const worldVariants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.15, ease: "easeOut" } },
  exit: { opacity: 0, y: -4, transition: { duration: 0.1, ease: "easeIn" } },
};

const worlds: Record<string, React.ReactNode> = {
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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [commandPaletteOpen, setCommandPaletteOpen]);

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
