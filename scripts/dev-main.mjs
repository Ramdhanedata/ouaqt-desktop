/*
 * Rebuilds the main process on change and starts Electron.
 *
 * It waits for the renderer first: a window that opens before Vite is
 * listening shows an error page and stays on it.
 */
import { spawn } from "node:child_process";
import { context } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

const RENDERER = "http://localhost:5183";

async function waitForRenderer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(RENDERER)).ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

const shared = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: true,
  external: ["electron", "better-sqlite3"],
};

const main = await context({ ...shared, entryPoints: ["electron/main.ts"], outfile: "dist/main/main.js" });
const preload = await context({ ...shared, entryPoints: ["electron/preload.ts"], outfile: "dist/main/preload.js" });
await main.rebuild();
await preload.rebuild();

mkdirSync("dist/main/migrations", { recursive: true });
cpSync("electron/db/migrations", "dist/main/migrations", { recursive: true });

if (!(await waitForRenderer())) {
  console.error(`The renderer never answered on ${RENDERER}`);
  process.exit(1);
}

spawn("npx", ["electron", "."], {
  stdio: "inherit",
  env: { ...process.env, OUAQT_DEV_URL: RENDERER },
}).on("exit", () => process.exit(0));
