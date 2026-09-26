import { app } from "electron";

/*
 * What an installed copy refuses, decided before anything else runs.
 *
 * The app obeys a handful of switches for development and for tests: a
 * demo shop, a data folder of its own, another website, a page to load
 * instead of its own, the walks that take pictures. In an installed
 * production build they would be ways round the licence (a demo shop is a
 * till that never asks to be paid) or ways to put a page that is not ours
 * behind the app's own bridge. So a production build forgets them all the
 * moment it starts, except the pipeline's own launch check, which opens
 * the window once and quits.
 *
 * Any installed build, test builds included, refuses to start with a
 * debugger's flags: nothing an owner does needs one.
 *
 * Imported first by main.ts, so no other module has read a switch yet.
 */

declare const __OUAQT_TEST_BUILD__: boolean;
const TEST_BUILD = typeof __OUAQT_TEST_BUILD__ === "boolean" ? __OUAQT_TEST_BUILD__ : true;

const DEBUGGER = /^--(inspect|inspect-brk|inspect-port|remote-debugging-port|remote-debugging-pipe|remote-allow-origins|js-flags)(=|$)/;

if (app.isPackaged) {
  if (process.argv.some((arg) => DEBUGGER.test(arg))) {
    console.error("OUAQT does not start with debugging flags.");
    process.exit(1);
  }
  if (!TEST_BUILD) {
    const launchCheck = process.env.OUAQT_DEMO === "1" && process.env.OUAQT_SMOKE === "1";
    for (const name of Object.keys(process.env)) {
      if (!name.startsWith("OUAQT_")) continue;
      if (launchCheck && (name === "OUAQT_DEMO" || name === "OUAQT_SMOKE")) continue;
      delete process.env[name];
    }
  }
}

export {};
