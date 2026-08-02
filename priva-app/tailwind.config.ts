import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        canvas: "#090909",
        surface: {
          1: "#101010",
          2: "#171717",
          3: "#1d1d1d",
          4: "#242424",
          5: "#303030",
        },
        accent: {
          DEFAULT: "#d4af37",
          hover: "#efcf6a",
          dim: "#a67c00",
          bright: "#b76e79",
          green: "#4caf50",
          orange: "#d4af37",
          red: "#e5484d",
          pink: "#b76e79",
          cyan: "#efcf6a",
        },
        text: {
          primary: "#f4f4f4",
          secondary: "#a0a0a0",
          muted: "#858585",
        },
        border: {
          DEFAULT: "rgba(212,175,55,0.15)",
          active: "rgba(212,175,55,0.34)",
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
        xl: "12px",
        "2xl": "12px",
      },
      boxShadow: {
        subtle: "0 1px 3px rgba(0,0,0,0.4), 0 0 0 1px rgba(212,175,55,0.05)",
        card: "0 2px 8px rgba(0,0,0,0.5), 0 0 0 1px rgba(212,175,55,0.08)",
        elevated: "0 8px 24px rgba(0,0,0,0.6), 0 0 0 1px rgba(212,175,55,0.10)",
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
