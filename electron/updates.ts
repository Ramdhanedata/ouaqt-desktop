import { app, type BrowserWindow } from "electron";
/*
 * A named import, not the default. electron-updater marks itself as an ES
 * module with no default export, so "import electronUpdater from" bundled to
 * undefined and every installed copy crashed on start, before its window.
 */
import { autoUpdater } from "electron-updater";

/*
 * New versions, from the public releases repository.
 *
 * The one other thing in this app that touches the network, beside
 * licence/network.ts. It reads a small file listing the latest version and
 * downloads the installer if there is a newer one. It sends nothing about the
 * shop: no sale, no stock, no customer, not even the shop's name.
 *
 * It never interrupts work. The update downloads in the background and is
 * installed when the app is next closed, so a cashier halfway through a sale
 * is never met by a restart.
 *
 * Only an installed app checks. A development run has nothing to update, and
 * demo mode must never go looking.
 *
 * On macOS this only works once the app is signed: Apple's updater refuses
 * an unsigned one. Until notarisation is in place, a Mac gets new versions by
 * downloading them again from step 4.
 */
export function watchForUpdates(window: () => BrowserWindow | null, demo: boolean): void {
  if (!app.isPackaged || demo) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  /* Never let a failed check reach the owner as an error. */
  autoUpdater.logger = null;

  autoUpdater.on("update-downloaded", (info) => {
    window()?.webContents.send("update:ready", { version: info.version });
  });
  autoUpdater.on("error", () => {
    /* No network, a rate limit, a repository not ready yet: try again next start. */
  });

  void autoUpdater.checkForUpdates().catch(() => undefined);
}
