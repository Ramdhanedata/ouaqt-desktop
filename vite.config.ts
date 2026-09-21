import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

/*
 * The renderer, and only the renderer.
 *
 * `base: "./"` because the packaged app loads these files off the disk rather
 * than from a server, and an absolute path would send it looking at the root
 * of the drive.
 */
export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@app-ui": fileURLToPath(new URL("./vendor/ouaqt-website/app-ui", import.meta.url)),
    },
  },
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true,
    /* Electron 36 is Chromium 136 or later. Nothing needs to be older. */
    target: "chrome136",
  },
  server: { port: 5183, strictPort: true },
});
