import React from "react";

export interface WorldContext {
  openDocument: (id: string) => void;
  openCollection: (id: string) => void;
  openWorld: (worldId: string) => void;
  goHome: () => void;
}

export interface WorldPersonality {
  /** Emotion word — "thinking", "exploration", "creation", etc. */
  emotion: string;
  /** CSS animation name for the background layer */
  bgAnimation?: string;
  /** CSS gradient or color for the background */
  bgGradient: string;
  /** Accent glow CSS for selected/active elements */
  accentGlow: string;
  /** Subtle ambient animation class */
  ambientClass?: string;
}

export interface World {
  id: string;
  label: string;
  icon: string;
  category: "development" | "visualization" | "ai" | "utilities";
  accentColor: string;
  description: string;
  personality?: WorldPersonality;

  Sidebar?: React.FC<{ ctx: WorldContext }>;
  Toolbar?: React.FC<{ ctx: WorldContext }>;
  Content: React.FC<{ ctx?: WorldContext }>;
  StatusBar?: React.FC;
  commands?: WorldCommand[];
}

export interface WorldCommand {
  id: string;
  label: string;
  icon: string;
  shortcut?: string;
  action: (ctx: WorldContext) => void;
}

export interface WorldDef {
  id: string;
  label: string;
  icon: string;
  category: "development" | "visualization" | "ai" | "utilities";
  description: string;
  accentColor: string;
}
