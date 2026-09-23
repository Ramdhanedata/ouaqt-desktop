/*
 * Builds the main process and the preload script, and copies the migrations
 * beside them so the packaged app can find its own sql.
 */
import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

const shared = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: true,
  /* Electron and the native module are resolved at runtime, not bundled. */
  external: ["electron", "better-sqlite3"],
  /*
   * Fixed at build time. A test build says so in its window and trusts the
   * test project; OUAQT_API_ORIGIN says which website it activates against.
   */
  define: {
    __OUAQT_TEST_BUILD__: JSON.stringify(process.env.OUAQT_RELEASE !== "production"),
    __OUAQT_API_ORIGIN__: JSON.stringify(process.env.OUAQT_API_ORIGIN ?? "https://ouaqtcom.vercel.app"),
  },
};

await build({ ...shared, entryPoints: ["electron/main.ts"], outfile: "dist/main/main.js" });
await build({ ...shared, entryPoints: ["electron/preload.ts"], outfile: "dist/main/preload.js" });

/* The database on its own, so the checks can drive the real modules. */
await build({ ...shared, entryPoints: ["electron/db/index.ts"], outfile: "dist/main/db.js" });

mkdirSync("dist/main/migrations", { recursive: true });
cpSync("electron/db/migrations", "dist/main/migrations", { recursive: true });

console.log("main, preload and migrations built");
