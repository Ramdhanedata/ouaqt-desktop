import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

/*
 * The app for a web page: the builder's preview (see web/main.ts).
 *
 * The same renderer, the same database modules and the same handlers as the
 * desktop build. Electron, better-sqlite3 and the few Node modules the main
 * process imports are swapped for their web stand-ins in web/, and nothing
 * else changes. The output goes into the website, which serves it.
 */
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: here("./web"),
  base: "./",
  publicDir: false,
  define: {
    /* The main-process modules read a few switches from the environment; a web page has none set. */
    "process.env": "{}",
    "process.platform": JSON.stringify("web"),
  },
  resolve: {
    alias: [
      { find: /^@\/app-ui\//, replacement: `${here("./vendor/ouaqt-website/app-ui")}/` },
      { find: "@app-ui", replacement: here("./vendor/ouaqt-website/app-ui") },
      { find: "@", replacement: here("./src") },
      { find: /^electron$/, replacement: here("./web/electron.ts") },
      { find: /^better-sqlite3$/, replacement: here("./web/sqlite.ts") },
      { find: /^node:(fs|path|crypto)$/, replacement: here("./web/node.ts") },
    ],
  },
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
  build: {
    /* Never under dist/: that folder is packaged into the installers, and this build has no place there. */
    outDir: process.env.OUAQT_WEB_OUT ?? here("./dist-web"),
    emptyOutDir: true,
    target: "es2022",
    chunkSizeWarningLimit: 2000,
  },
  server: { port: 5184, strictPort: true },
});
