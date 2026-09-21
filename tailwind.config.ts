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
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "./vendor/ouaqt-website/app-ui/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        surface: "var(--surface)",
        border: "var(--border)",
        /* The same values the website's tailwind.config.ts holds. */
        accent: { DEFAULT: "#C9A961", foreground: "#0A0A0A" },
        muted: "var(--muted)",
        "muted-foreground": "var(--muted-foreground)",
        destructive: "#B4443C",
      },
      fontFamily: {
        serif: ["var(--font-serif)", "Georgia", "Times New Roman", "serif"],
        arabic: ["var(--font-arabic)", "var(--font-serif)", "serif"],
      },
      letterSpacing: { tight: "-0.011em" },
    },
  },
  plugins: [],
} satisfies Config;
