import type { Config } from "tailwindcss";

/*
 * The same tokens the website uses, because app-ui's screens are written
 * against them and this app renders those screens unchanged. If a colour
 * drifts here, the shop sees something the builder's preview never showed.
 *
 * The content globs reach into the vendored website on purpose: that is
 * where the shared screens live.
 */
export default {
  /* The dark theme is a data attribute on <html>, set from Settings. */
  darkMode: ["selector", '[data-theme="dark"]'],
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "./vendor/ouaqt-website/app-ui/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      /*
       * Every colour is a token from src/tokens.css. A screen says "ink/60"
       * or "surface", never a hex value, so light, dark and the design pass
       * are all one file.
       */
      colors: {
        background: "var(--background)",
        foreground: "rgb(var(--ink) / <alpha-value>)",
        surface: "var(--surface)",
        raised: "var(--raised)",
        hover: "var(--hover)",
        selected: "var(--selected)",
        scrim: "var(--scrim)",
        line: { DEFAULT: "var(--line)", strong: "var(--line-strong)" },
        border: "var(--line)",
        ink: { DEFAULT: "rgb(var(--ink) / <alpha-value>)", 2: "var(--ink-2)", 3: "var(--ink-3)" },
        "on-ink": "rgb(var(--on-ink) / <alpha-value>)",
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-ink)",
          strong: "var(--accent-strong)",
          soft: "var(--accent-soft)",
          chosen: "var(--accent-chosen)",
          line: "var(--accent-line)",
          "on-soft": "var(--accent-on-soft)",
        },
        /* The near-black of the first apps: the main button and the chosen category. */
        main: { DEFAULT: "var(--main)", foreground: "var(--main-ink)" },
        /* The two tints at the top of a till: the day's total and End of day, the sales and History. */
        "tint-green": { DEFAULT: "var(--tint-green)", ink: "var(--tint-green-ink)", muted: "var(--tint-green-muted)", line: "var(--tint-green-line)" },
        "tint-sand": { DEFAULT: "var(--tint-sand)", ink: "var(--tint-sand-ink)", muted: "var(--tint-sand-muted)", line: "var(--tint-sand-line)" },
        /* A price on a product card, in the gold of the first apps. */
        price: "var(--price)",
        warning: { DEFAULT: "var(--warning)", soft: "var(--warning-soft)" },
        danger: { DEFAULT: "var(--danger)", soft: "var(--danger-soft)" },
        success: { DEFAULT: "var(--success)", soft: "var(--success-soft)" },
        destructive: "var(--danger)",
        muted: "var(--hover)",
        "muted-foreground": "var(--ink-3)",
        "logo-chip": "var(--logo-chip)",
        "logo-tile": "var(--logo-tile)",
        attention: "var(--attention)",
        whatsapp: { DEFAULT: "var(--whatsapp)", foreground: "var(--whatsapp-ink)" },
      },
      fontFamily: {
        serif: ["var(--font-ui)", "sans-serif"],
        arabic: ["var(--font-arabic)", "var(--font-ui)", "sans-serif"],
        numbers: ["var(--font-numbers)", "monospace"],
        display: ["var(--font-display)", "sans-serif"],
      },
      /* Rounder than the stock scale: cards at 16, controls at 12, as the design draws them. */
      borderRadius: { md: "10px", lg: "12px", xl: "16px", "2xl": "20px" },
      boxShadow: { card: "var(--shadow-card)", main: "var(--shadow-main)" },
      letterSpacing: { tight: "-0.011em" },
    },
  },
  plugins: [],
} satisfies Config;
