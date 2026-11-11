import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/*
 * This repo's own tests, and no others.
 *
 * The website is vendored here so its shared screens can be imported, and it
 * brings its own test suite with it. Those tests belong to that repo and run
 * in its CI; running them here would fail on aliases and dependencies this
 * project has no reason to have.
 *
 * app-ui's tests are the exception worth making later: they cover the code
 * this app depends on most.
 */
export default defineConfig({
  resolve: {
    /* The website's own code, used here as it is, writes its shared pieces as "@/app-ui". */
    alias: [
      { find: /^@\/app-ui\//, replacement: `${fileURLToPath(new URL("./vendor/ouaqt-website/app-ui", import.meta.url))}/` },
      { find: "@app-ui", replacement: fileURLToPath(new URL("./vendor/ouaqt-website/app-ui", import.meta.url)) },
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
    ],
  },
  test: {
    include: ["src/**/*.test.ts", "electron/**/*.test.ts"],
    exclude: ["node_modules", "dist", "vendor"],
  },
});
