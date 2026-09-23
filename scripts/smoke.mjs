/*
 * Does the built app start? The one question none of the other checks ask.
 *
 *   npm run smoke
 *
 * Launches the built main process in demo mode, in its own data folder, and
 * waits for it to say its window has loaded. A crash at start, like the
 * updater import that killed every installed copy of 0.1.5 before its window
 * appeared, fails here instead of on an owner's counter.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";

const electron = join("node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");
const child = spawn(electron, ["."], {
  env: { ...process.env, OUAQT_DEMO: "1", OUAQT_SMOKE: "1" },
  shell: process.platform === "win32",
});

let output = "";
const finish = (ok, why) => {
  clearTimeout(timer);
  if (!ok) {
    console.error(`The app did not start: ${why}`);
    console.error(output.split("\n").filter((line) => /OUAQT_SMOKE|Error|error/.test(line)).slice(0, 10).join("\n"));
  } else {
    console.log("The app starts, opens its database and loads its window.");
  }
  child.kill();
  process.exit(ok ? 0 : 1);
};

const listen = (chunk) => {
  output += chunk.toString();
  if (output.includes("OUAQT_SMOKE_OK")) finish(true);
  if (output.includes("OUAQT_SMOKE_FAIL")) finish(false, "it reported a failure");
};
child.stdout.on("data", listen);
child.stderr.on("data", listen);
child.on("exit", (code) => {
  if (!output.includes("OUAQT_SMOKE_OK")) finish(false, `it exited with code ${code}`);
});

const timer = setTimeout(() => finish(false, "no window after 90 seconds"), 90_000);
