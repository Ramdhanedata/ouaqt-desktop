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
    /* Electron 36 is Chromium 136 or later. Nothing needs to be older. */
    target: "chrome136",
  },
  server: { port: 5183, strictPort: true },
});
