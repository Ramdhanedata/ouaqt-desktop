import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { fileURLToPath } from "node:url";

/*
 * The renderer, and only the renderer.
 *
 * `base: "./"` because the packaged app loads these files off the disk rather
 * than from a server, and an absolute path would send it looking at the root
 * of the drive.
 */
/*
 * What the till's own window may load: its own files, the pictures it holds
 * as data (logos, payment apps), and nothing from the network. The window
 * never navigates away (main.ts), and with this a line of text that somehow
 * reached the page as markup still could not run or call out. Styles may be
 * inline because React writes widths and colours on the elements themselves.
 *
 * Built pages only: the development server injects a script of its own and
 * talks to the page over a websocket.
 */
const policy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

function contentPolicy(): Plugin {
  return {
    name: "ouaqt-content-policy",
    apply: "build",
    transformIndexHtml: () => [
      { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: policy }, injectTo: "head-prepend" },
    ],
  };
}

export default defineConfig({
  plugins: [react(), contentPolicy()],
  base: "./",
  resolve: {
    /* The website's own code, used here as it is, writes its shared pieces as "@/app-ui". */
    alias: [
      { find: /^@\/app-ui\//, replacement: `${fileURLToPath(new URL("./vendor/ouaqt-website/app-ui", import.meta.url))}/` },
      { find: "@app-ui", replacement: fileURLToPath(new URL("./vendor/ouaqt-website/app-ui", import.meta.url)) },
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
    ],
  },
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true,
    /* Electron 44 runs a newer Chromium than 136, so nothing needs to be older. */
    target: "chrome136",
  },
  server: { port: 5183, strictPort: true },
});
