/*
 * Walk the till in both languages and leave the pictures behind.
 *
 *   npm run walk:till [output-folder]
 *
 * Demo mode, invented products, a data folder of its own. It presses two of
 * one product and one of another, reads the ticket back off the screen, and
 * only charges if the ticket is exactly that. The window ignores real mouse
 * clicks while it runs, because the first time this ran on a working desktop,
 * a click meant for something else became a line on the ticket.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const out = process.argv[2] ?? join(tmpdir(), "ouaqt-walk");
const demoData =
  process.platform === "darwin"
    ? join(homedir(), "Library", "Application Support", "OUAQT Demo")
    : process.platform === "win32"
      ? join(process.env.APPDATA ?? "", "OUAQT Demo")
      : join(homedir(), ".config", "OUAQT Demo");

const electron = join("node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");
let failures = 0;

for (const language of ["fr", "ar"]) {
  const folder = join(out, language);
  rmSync(folder, { recursive: true, force: true });
  rmSync(demoData, { recursive: true, force: true });

  const fixture = language === "ar" ? "configuration.pharmacy.ar.json" : "configuration.pharmacy.json";
  spawnSync(electron, ["."], {
    stdio: "ignore",
    env: {
      ...process.env,
      OUAQT_DEMO: "1",
      OUAQT_DEMO_LANG: language,
      OUAQT_DEMO_CONFIG: join(process.cwd(), "fixtures", fixture),
      OUAQT_WALK: folder,
    },
  });

  const report = join(folder, "walk.json");
  if (!existsSync(report)) {
    failures += 1;
    console.log(`  FAIL  ${language}: the walk did not finish`);
    continue;
  }

  const walk = JSON.parse(readFileSync(report, "utf8"));
  const ok = walk.ticketIsRight && walk.charged && walk.sales.length === 1 && walk.sales[0].total === 70000;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "pass" : "FAIL"}  ${language}: ticket ${JSON.stringify(walk.ticket)}, sale ${walk.sales[0]?.total ?? "none"}`);
}

console.log(failures === 0 ? `\nThe till sells in both languages. Pictures in ${out}\n` : `\n${failures} walks failed.\n`);
process.exit(failures === 0 ? 0 : 1);
