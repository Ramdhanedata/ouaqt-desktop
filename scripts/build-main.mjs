/*
 * Builds the main process and the preload script, and copies the migrations
 * beside them so the packaged app can find its own sql.
 */
import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

/*
 * Which website a build activates against, when nothing says otherwise.
 *
 * The licence API only exists on the builder branch until it is merged, so a
 * test build asks the branch's stable address. A production build asks the
 * live site. Either can be overridden with OUAQT_API_ORIGIN.
 */
const production = process.env.OUAQT_RELEASE === "production";
const LIVE = "https://ouaqtcom.vercel.app";
const BUILDER_BRANCH = "https://ouaqtcom-git-builder-b0-ouaqt.vercel.app";

const shared = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: true,
  /* Electron and the native module are resolved at runtime, not bundled. */
  external: ["electron", "better-sqlite3", "electron-updater"],
  /*
   * Fixed at build time. A test build says so in its window and trusts the
   * test project; OUAQT_API_ORIGIN says which website it activates against.
   */
  define: {
    __OUAQT_TEST_BUILD__: JSON.stringify(!production),
    __OUAQT_API_ORIGIN__: JSON.stringify(process.env.OUAQT_API_ORIGIN ?? (production ? LIVE : BUILDER_BRANCH)),
  },
};

await build({ ...shared, entryPoints: ["electron/main.ts"], outfile: "dist/main/main.js" });
await build({ ...shared, entryPoints: ["electron/preload.ts"], outfile: "dist/main/preload.js" });

/* The database on its own, so the checks can drive the real modules. */
await build({ ...shared, entryPoints: ["electron/db/index.ts"], outfile: "dist/main/db.js" });

mkdirSync("dist/main/migrations", { recursive: true });
cpSync("electron/db/migrations", "dist/main/migrations", { recursive: true });

console.log("main, preload and migrations built");
