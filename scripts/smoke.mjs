/*
 * Does the built app start? The one question none of the other checks ask.
 *
 *   npm run smoke               the build, run by the development Electron
 *   npm run smoke -- --packaged the app electron-builder packaged, as installed
 *
 * Launches the app in demo mode, in its own data folder, and waits for it to
 * say its window has loaded. A crash at start, like the updater import that
 * killed every installed copy of 0.1.5 before its window appeared, fails here
 * instead of on an owner's counter.
 *
 * The packaged run is the one that matters. 0.1.6 passed the first kind and
 * still could not start on an Intel Mac, because what was packaged differed
 * from what was tested: a database module for the wrong processor. The
 * pipeline runs each installer's own app on its own kind of machine.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/* The packaged app for this machine's processor, where electron-builder leaves it. */
function packagedApp() {
  if (process.platform === "win32") return join("release", "win-unpacked", "OUAQT.exe");
  const folder = process.arch === "arm64" ? "mac-arm64" : "mac";
  return join("release", folder, "OUAQT.app", "Contents", "MacOS", "OUAQT");
}

const packaged = process.argv.includes("--packaged");
const env = { ...process.env, OUAQT_DEMO: "1", OUAQT_SMOKE: "1" };
let child;
if (packaged) {
  const app = packagedApp();
  if (!existsSync(app)) {
    console.error(`No packaged app at ${app}. Run electron-builder first.`);
    process.exit(1);
  }
  console.log(`Launching ${app}`);
  child = spawn(app, [], { env });
} else {
  const electron = join("node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");
  child = spawn(electron, ["."], { env, shell: process.platform === "win32" });
}

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
