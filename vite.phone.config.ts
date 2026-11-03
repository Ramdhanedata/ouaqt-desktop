import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

/*
 * The app for a phone (see web/phone/main.ts): installed from the website
 * into the phone's browser, with its own icon, and working with no internet.
 *
 * The same renderer, database modules, handlers and licence code as the
 * desktop build. Electron and better-sqlite3 get the same stand-ins as the
 * builder's preview (web/electron.ts, web/sqlite.ts); the Node file
 * functions get the phone's own disk, which keeps the shop in the phone's
 * storage; and the fingerprint is the phone's own.
 *
 * Built into the website's public/app (scripts/build-phone.mjs), which also
 * writes the service worker that lets it open with no network.
 */
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const pkg = JSON.parse(readFileSync(here("./package.json"), "utf8")) as { version: string };

export default defineConfig({
  plugins: [react()],
  root: here("./web/phone"),
  base: "./",
  publicDir: here("./web/phone/public"),
  define: {
    /* Set by web/phone/env.ts, the first module the page runs. */
    "process.env": "globalThis.__OUAQT_ENV__",
    "process.platform": JSON.stringify("web"),
    /* Which licence key to trust is decided where the page is served: see web/phone/env.ts. */
    __OUAQT_TEST_BUILD__: "globalThis.__OUAQT_TEST_BUILD__",
    __OUAQT_PHONE_VERSION__: JSON.stringify(`${pkg.version}-phone`),
  },
  resolve: {
    alias: [
      { find: /^@\/app-ui\//, replacement: `${here("./vendor/ouaqt-website/app-ui")}/` },
      { find: "@app-ui", replacement: here("./vendor/ouaqt-website/app-ui") },
      { find: "@", replacement: here("./src") },
      { find: /^electron$/, replacement: here("./web/electron.ts") },
      { find: /^better-sqlite3$/, replacement: here("./web/sqlite.ts") },
      { find: /^node:(fs|path|crypto)$/, replacement: here("./web/phone/disk.ts") },
      /* electron/licence/state.ts reads the machine; on a phone that is the phone's own id. */
      { find: /^\.\/fingerprint$/, replacement: here("./web/phone/fingerprint.ts") },
    ],
  },
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
  build: {
    outDir: process.env.OUAQT_PHONE_OUT ?? here("./dist-phone"),
    emptyOutDir: true,
    /* Safari 16.4 and Chrome 111: the oldest phones still common in the shops this is for. */
    target: ["es2022", "safari16.4", "chrome111"],
    chunkSizeWarningLimit: 2000,
  },
  server: { port: 5185, strictPort: true },
});
