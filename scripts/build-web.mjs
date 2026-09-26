/*
 * Builds this app for a web page, the builder's preview, and puts it where
 * the website serves it.
 *
 *   npm run build:web [folder]
 *
 * The folder defaults to the website checkout beside this one, at
 * public/app-preview. Run it after any change to the screens, so what an
 * owner tries on the website stays the software he downloads. See web/main.ts.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const out = resolve(process.argv[2] ?? "../Website OUQT/public/app-preview");
if (!existsSync(resolve(out, "..")) ) {
  console.error(`No folder to build into: ${resolve(out, "..")}`);
  process.exit(1);
}
const vite = process.platform === "win32" ? "npx.cmd" : "npx";
const built = spawnSync(vite, ["vite", "build", "--config", "vite.web.config.ts"], {
  stdio: "inherit",
  env: { ...process.env, OUAQT_WEB_OUT: out },
});
if (built.status !== 0) process.exit(built.status ?? 1);
console.log(`\nThe preview app is in ${out}\n`);
