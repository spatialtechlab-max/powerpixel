import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Refined neutral-warm palette inspired by Linear / Stripe Atlas / Mirror.
        // Single accent (indigo) keeps the design serious and trustworthy.
        bg: "#0a0b0f",
        surface: "#101218",
        "surface-2": "#171a22",
        "surface-3": "#1d2029",
        border: "#22262f",
        "border-strong": "#2c313c",
        "text-primary": "#ECEEF2",
        "text-secondary": "#9ca0aa",
        "text-tertiary": "#5d626c",
        accent: "#6366f1",
        "accent-hover": "#4f46e5",
        "accent-soft": "#6366f1",
        success: "#10b981",
        warning: "#f59e0b",
        danger: "#ef4444",
        // shadcn semantic tokens for components/ui/*. Don't collide with
        // existing literal tokens above (no `border` / `accent` overrides).
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        ring: "hsl(var(--ring))",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui"],
        serif: ["'Newsreader'", "Georgia", "serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      letterSpacing: {
        tightest: "-0.04em",
      },
    },
  },
  plugins: [],
};

export default config;
