import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        canvas: "#08090a",
        surface: {
          1: "#0f1113",
          2: "#181a1e",
          3: "#1f2126",
          4: "#282a30",
          5: "#32343c",
        },
        accent: {
          DEFAULT: "#8b5cf6",
          hover: "#7c3aed",
          dim: "#6d28d9",
          bright: "#a78bfa",
          purple: "#8b5cf6",
          green: "#22c55e",
          orange: "#f59e0b",
          red: "#ef4444",
          pink: "#ec4899",
          cyan: "#06b6d4",
        },
        text: {
          primary: "#f0f0f0",
          secondary: "#8b8d97",
          muted: "#55575f",
        },
        border: {
          DEFAULT: "rgba(255,255,255,0.06)",
          active: "rgba(255,255,255,0.12)",
        },
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      borderRadius: {
        sm: "6px",
        DEFAULT: "8px",
        md: "10px",
        lg: "12px",
        xl: "16px",
        "2xl": "20px",
      },
      boxShadow: {
        subtle: "0 1px 3px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04)",
        card: "0 2px 8px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)",
        elevated: "0 8px 24px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06)",
      },
      animation: {
        "fade-in": "fadeIn 0.15s ease-out",
        "slide-up": "slideUp 0.2s ease-out",
        "slide-in-right": "slideInRight 0.2s ease-out",
        "slide-down": "slideDown 0.2s ease-out",
        "scale-in": "scaleIn 0.15s ease-out",
        "pulse-soft": "pulseSoft 2s ease-in-out infinite",
        shimmer: "shimmer 2s infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideDown: {
          "0%": { opacity: "0", transform: "translateY(-8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideInRight: {
          "0%": { opacity: "0", transform: "translateX(-8px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        scaleIn: {
          "0%": { opacity: "0", transform: "scale(0.96)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.6" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
