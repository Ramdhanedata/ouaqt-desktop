/*
 * Walk every trade's app in demo mode, in French and in Arabic, and leave
 * the pictures behind.
 *
 *   npm run walk:trades [output-folder] [trade ...]
 *
 * Each trade opens on its own invented shop: every section down the side is
 * opened and photographed, then the trade's main action is done through the
 * screen and checked in the database. The pharmacy has its own walk,
 * walk:till.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const out = process.argv[2] ?? join(tmpdir(), "ouaqt-trades");
const only = process.argv.slice(3);
const trades = (only.length ? only : ["shop", "restaurant", "bakery", "warehouse", "hotel", "transport", "general"]);
const demoData =
  process.platform === "darwin"
    ? join(homedir(), "Library", "Application Support", "OUAQT Demo")
    : process.platform === "win32"
      ? join(process.env.APPDATA ?? "", "OUAQT Demo")
      : join(homedir(), ".config", "OUAQT Demo");
const electron = join("node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");

let failures = 0;
for (const trade of trades) {
  for (const language of ["fr", "ar"]) {
    const folder = join(out, trade, language);
    rmSync(folder, { recursive: true, force: true });
    rmSync(demoData, { recursive: true, force: true });
    const fixture = join(process.cwd(), "fixtures", `configuration.${trade}${language === "ar" ? ".ar" : ""}.json`);
    spawnSync(electron, ["."], {
      stdio: "ignore",
      env: { ...process.env, OUAQT_DEMO: "1", OUAQT_DEMO_LANG: language, OUAQT_DEMO_CONFIG: fixture, OUAQT_WALK: folder },
    });
    const report = join(folder, "walk.json");
    if (!existsSync(report)) {
      failures += 1;
      console.log(`  FAIL  ${trade} ${language}: the walk did not finish`);
      continue;
    }
    const walk = JSON.parse(readFileSync(report, "utf8"));
    const ok = walk.action && walk.pictures.length === walk.sections.length && walk.sections.length >= 4 && (walk.audit ?? []).length === 0;
    for (const small of walk.audit ?? []) console.log(`        too small: ${small}`);
    if (!ok) failures += 1;
    console.log(`  ${ok ? "pass" : "FAIL"}  ${trade} ${language}: ${walk.sections.join(" · ")} | ${walk.detail}`);
  }
}
console.log(failures === 0 ? `\nEvery trade opens, shows its screens and does its main job. Pictures in ${out}\n` : `\n${failures} walks failed.\n`);
process.exit(failures === 0 ? 0 : 1);
