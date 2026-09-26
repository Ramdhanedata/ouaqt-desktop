import { app, nativeImage, shell, type BrowserWindow } from "electron";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/*
 * The app wears its trade's icon: a croissant for a bakery, a bus for a
 * transport company. There is one installer for every trade, so it installs
 * with the OUAQT tile and changes once it knows which shop it serves, the
 * first time it opens. An update brings the OUAQT tile back with it, and the
 * next opening puts the trade's icon on again.
 *
 * The icons are drawn by scripts/make-icons.cjs and travel in the app's
 * resources. Nothing here reaches the network, and nothing here is needed
 * for the shop to work: a system that refuses a change keeps the OUAQT tile.
 */

function iconsFolder(): string {
  return app.isPackaged ? join(process.resourcesPath, "icons") : join(process.cwd(), "build", "trade-icons");
}

function iconFile(pack: string, kind: "png" | "ico"): string | null {
  if (!/^[a-z]+$/.test(pack)) return null;
  const file = join(iconsFolder(), `${pack}.${kind}`);
  return existsSync(file) ? file : null;
}

/* Every opening: the window and the taskbar on Windows, the Dock on the Mac. */
export function wearTradeIcon(window: BrowserWindow | null, pack: string): void {
  const png = iconFile(pack, "png");
  if (!png) return;
  if (process.platform === "darwin") {
    app.dock?.setIcon(nativeImage.createFromPath(png));
    return;
  }
  const ico = process.platform === "win32" ? iconFile(pack, "ico") : null;
  window?.setIcon(nativeImage.createFromPath(ico ?? png));
}

/*
 * Once per trade: the icon he sees before the app is open. On Windows, the
 * shortcuts the installer made, on the desktop and in the Start menu, and
 * only those that open this app. On the Mac, the app in Applications, set the
 * way Finder's own "Get Info" sets one. True when the icon was changed.
 */
export async function markInstalledIcon(pack: string): Promise<boolean> {
  if (!app.isPackaged) return false;

  if (process.platform === "win32") {
    const ico = iconFile(pack, "ico");
    if (!ico) return false;
    const exe = app.getPath("exe").toLowerCase();
    const shortcuts = [
      join(app.getPath("desktop"), "OUAQT.lnk"),
      join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", "OUAQT.lnk"),
    ];
    let changed = false;
    for (const shortcut of shortcuts) {
      if (!existsSync(shortcut)) continue;
      try {
        const link = shell.readShortcutLink(shortcut);
        if (link.target.toLowerCase() !== exe) continue;
        changed = shell.writeShortcutLink(shortcut, "update", { ...link, icon: ico, iconIndex: 0 }) || changed;
      } catch {
        // A shortcut we cannot read or write keeps its icon.
      }
    }
    return changed;
  }

  if (process.platform === "darwin") {
    const png = iconFile(pack, "png");
    /* .../OUAQT.app/Contents/MacOS/OUAQT */
    const bundle = dirname(dirname(dirname(app.getPath("exe"))));
    if (!png || !bundle.endsWith(".app")) return false;
    const script = `ObjC.import("AppKit");
      const image = $.NSImage.alloc.initWithContentsOfFile(${JSON.stringify(png)});
      $.NSWorkspace.sharedWorkspace.setIconForFileOptions(image, ${JSON.stringify(bundle)}, 0) ? "set" : "refused";`;
    return new Promise((resolve) => {
      execFile("/usr/bin/osascript", ["-l", "JavaScript", "-e", script], { timeout: 10_000 }, (error, stdout) => {
        resolve(!error && stdout.trim() === "set");
      });
    });
  }

  return false;
}
