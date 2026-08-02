import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

let electronPlugin: any[] = [];
try {
  const electron = require("vite-plugin-electron").default;
  electronPlugin = electron([
    {
      entry: "electron/main.ts",
      vite: {
        build: {
          outDir: "dist-electron",
          format: "cjs",
          rollupOptions: { external: ["sql.js"] },
        },
      },
    },
    {
      entry: "electron/preload.ts",
      onstart(args) { args.reload(); },
      vite: {
        build: {
          outDir: "dist-electron",
          format: "cjs",
        },
      },
    },
  ]);
  console.log("[vite] Electron plugin loaded");
} catch (e: any) {
  console.log("[vite] Electron plugin unavailable, web-only mode:", e?.message);
}

export default defineConfig({
  plugins: [react(), ...electronPlugin],
  base: "./",
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom"],
          ui: ["zustand", "framer-motion", "lucide-react"],
          flow: ["@xyflow/react"],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
