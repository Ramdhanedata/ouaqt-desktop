import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { join } from "node:path";
import { loadConfiguration } from "./config/load";
import { integrityIsGood, migrate, openDatabase, readMigrations } from "./db/open";
import { deviceIdOf } from "./db/rows";
import { adoptImportedBatches, listProducts, searchProducts } from "./db/products";
import { recentSales } from "./db/sales";
import { automaticBackup } from "./backup";
import { registerScreens, type Context } from "./ipc";
import { registerTrades } from "./ipc-trades";
import { activateAndWalk, DEMO, demoFolder, fixtureFor, prepareDemoFolder, seedDemo, walkTill, walkTrade } from "./demo";
import { applyActivation, applyRefresh } from "./licence/apply";
import { fingerprint } from "./licence/fingerprint";
import { activate, apiOrigin, refresh, type Proof } from "./licence/network";
import { claimLinks, onToken } from "./licence/protocol";
import { licenceState, maySell } from "./licence/state";
import { readDeviceToken } from "./licence/store";
import { watchForUpdates } from "./updates";
import { getSetting } from "./db/rows";

/*
 * The main process: the database, the configuration, and one window.
 *
 * Nothing here reaches the network. Activation and refresh arrive in D2, and
 * when they do they will live in one file that can be read on its own, so
 * that "no code path sends business data anywhere" stays something anybody
 * can check rather than something we assert.
 */

const isDev = Boolean(process.env.OUAQT_DEV_URL);

/*
 * A test run can point the app at a folder of its own. Nothing an owner
 * installs sets this.
 */
if (process.env.OUAQT_DATA_FOLDER) app.setPath("userData", process.env.OUAQT_DATA_FOLDER);

/* A test build says so in its own window. Set at build time. */
declare const __OUAQT_TEST_BUILD__: boolean;
const TEST_BUILD = typeof __OUAQT_TEST_BUILD__ === "boolean" ? __OUAQT_TEST_BUILD__ : true;

/*
 * One copy of the app, and the ouaqt:// link handed to it. Claimed before
 * anything else, because a second copy must pass its link on and leave.
 */
const primary = DEMO ? true : claimLinks();

/*
 * Demo mode moves the whole data folder aside before anything opens it, so
 * nothing it writes can reach a real shop's database. See demo.ts.
 */
if (DEMO) {
  const folder = demoFolder(app.getPath("userData"));
  app.setPath("userData", folder);
  prepareDemoFolder(folder, fixtureFor(process.cwd()));
}

/* Everything the app owns lives here: the database, the configuration, logs. */
function dataFolder(): string {
  return app.getPath("userData");
}

function migrationsFolder(): string {
  /* Packaged, the sql files sit beside the compiled main process. */
  return isDev
    ? join(process.cwd(), "electron", "db", "migrations")
    : join(__dirname, "migrations");
}

let database: ReturnType<typeof openDatabase> | null = null;
let deviceId = "";
let mainWindow: BrowserWindow | null = null;

function databaseFile(): string {
  return join(dataFolder(), "ouaqt.db");
}

function start() {
  database = openDatabase(databaseFile());

  const ran = migrate(database, readMigrations(migrationsFolder()));
  if (ran.length > 0) console.log("migrations applied:", ran.join(", "));
  if (!integrityIsGood(database)) {
    console.error("the database did not pass its integrity check");
  }
  deviceId = deviceIdOf(database);

  /* A database from 0.1 gets real batches for what it imported. */
  const adopted = adoptImportedBatches(database, deviceId);
  if (adopted > 0) console.log("batches adopted from the import:", adopted);

  if (DEMO) {
    const configuration = loadConfiguration(join(dataFolder(), "configuration.json"));
    if (configuration.ok) seedDemo(database, deviceId, configuration.configuration.pack);
  }
}

/*
 * Everything the screens may ask the machine to do.
 *
 * Each handler is a few lines that hand straight to a database module. No
 * handler here reaches the network, and there is no handler that sends a
 * sale, a movement or a debt anywhere: the list being this short is what
 * makes that something anybody can check.
 */
function open() {
  if (!database) throw new Error("the database is not open");
  return database;
}

function createWindow() {
  const window = new BrowserWindow({
    title: TEST_BUILD ? "OUAQT — version de test" : "OUAQT",
    width: 1366,
    height: 768,
    /* The size of the shop laptops this runs on, so nothing is designed
       for a screen the client does not have. */
    minWidth: 1024,
    minHeight: 640,
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      /* A walk runs in a window without focus; it must still paint. */
      backgroundThrottling: !process.env.OUAQT_WALK,
    },
  });

  /* OUAQT_WALK=folder walks the till in demo mode and leaves pictures there. */
  const walk = process.env.OUAQT_WALK;

  /*
   * A walk runs on somebody's desktop while they are working. It must not
   * take their focus, and a real click landing on it must not become a line
   * on the ticket: only the walk's own presses may touch the till.
   */
  mainWindow = window;
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  window.once("ready-to-show", () => {
    if (walk && (DEMO || process.env.OUAQT_DATA_FOLDER)) {
      window.setIgnoreMouseEvents(true);
      window.showInactive();
    } else {
      window.show();
    }
  });

  const charge = process.env.OUAQT_DEMO_LANG === "ar" ? "تحصيل" : "Encaisser";
  if (DEMO && walk && database) {
    const open = database;
    const loaded = loadConfiguration(join(dataFolder(), "configuration.json"));
    const pack = loaded.ok ? loaded.configuration.pack : "pharmacy";
    window.webContents.once("did-finish-load", () => {
      const run =
        pack === "pharmacy"
          ? walkTill(window, open, walk, charge)
          : walkTrade(window, open, walk, pack, process.env.OUAQT_DEMO_LANG === "ar" ? "ar" : "fr");
      void run.finally(() => app.quit());
    });
  } else if (walk && process.env.OUAQT_DATA_FOLDER && database) {
    /*
     * An activation walk, only ever in a data folder named for it, so it can
     * never run against a real shop's profile.
     */
    const open = database;
    window.webContents.once("did-finish-load", () => {
      void activateAndWalk(window, open, walk, process.env.OUAQT_WALK_SERIAL ?? null, charge).finally(() =>
        app.quit()
      );
    });
  }

  if (process.env.OUAQT_DEV_URL) {
    void window.loadURL(process.env.OUAQT_DEV_URL);
  } else {
    void window.loadFile(join(__dirname, "..", "renderer", "index.html"));
  }
}

ipcMain.handle("configuration:read", () => {
  return loadConfiguration(join(dataFolder(), "configuration.json"));
});

ipcMain.handle("database:state", () => {
  if (!database) return { ready: false, tables: 0 };
  const tables = database
    .prepare("select count(*) as n from sqlite_master where type = 'table'")
    .get() as { n: number };
  return { ready: true, tables: tables.n, file: join(dataFolder(), "ouaqt.db") };
});

ipcMain.handle("products:list", (_event, term?: string) =>
  typeof term === "string" && term.trim()
    ? searchProducts(open(), term)
    : listProducts(open())
);

/*
 * Activation, from either proof. The serial the owner typed and the token the
 * link carried go down exactly the same path, so there is one activation to
 * get right and not two.
 */
async function runActivation(proof: Proof) {
  const db = open();
  const answer = await activate({
    proof,
    deviceId,
    platform: process.platform === "win32" ? "windows" : "mac",
    fingerprint: await fingerprint(),
    /* The shop this database already belongs to, if any. See LICENCE_API.md. */
    expectBusinessId: getSetting(db, "business_id") ?? undefined,
  });

  if (!answer.ok) {
    return {
      ok: false as const,
      error: answer.error,
      because: answer.because,
      supportWhatsapp: answer.supportWhatsapp,
      via: "serial" in proof ? ("serial" as const) : ("link" as const),
    };
  }

  const applied = await applyActivation(db, dataFolder(), deviceId, answer);
  if (!applied.ok) {
    return { ok: false as const, error: applied.reason, via: "serial" in proof ? ("serial" as const) : ("link" as const) };
  }
  return { ok: true as const, products: applied.products, staff: applied.staff };
}

/*
 * Asking the website whether anything changed: a renewal the owner paid for,
 * a suspension, or the software he described again on the site. True when
 * something the screens show is now different. Without a network, or before
 * activation, it quietly does nothing: the licence file already says what
 * holds, and for how long.
 */
async function runRefresh(): Promise<boolean> {
  if (DEMO) return false;
  const db = open();
  const businessId = getSetting(db, "business_id");
  const deviceToken = readDeviceToken(dataFolder());
  if (!businessId || !deviceToken) return false;
  const version = Number(getSetting(db, "configuration_version"));
  const answer = await refresh({
    businessId,
    deviceId,
    deviceToken,
    ...(Number.isInteger(version) && version >= 0 ? { configurationVersion: version } : {}),
  });
  if (!answer.ok) return false;
  const applied = await applyRefresh(db, dataFolder(), deviceId, answer);
  return applied.ok && applied.changed;
}

/*
 * WhatsApp, and nothing else. The screens can ask to open one kind of link,
 * to one place, built here from digits: they cannot hand over a URL.
 */
ipcMain.handle("open:whatsapp", (_event, number: string) => {
  const digits = String(number ?? "").replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return;
  void shell.openExternal(`https://wa.me/${digits}`);
});

ipcMain.handle("app:info", () => ({
  testBuild: TEST_BUILD,
  version: app.getVersion(),
  /* Which website this build activates against, so a test run can see it. */
  server: TEST_BUILD ? apiOrigin() : null,
}));

ipcMain.handle("licence:state", async () => {
  if (DEMO) return { kind: "demo" as const };
  return licenceState(dataFolder(), deviceId);
});

ipcMain.handle("licence:activate", async (_event, serial: string) => {
  if (typeof serial !== "string" || !serial.trim()) {
    return { ok: false as const, error: "unknown_serial", via: "serial" as const };
  }
  return runActivation({ serial: serial.trim() });
});

ipcMain.handle("sales:recent", (_event, limit?: number) => recentSales(open(), limit));

/*
 * The screens after the till: stock, customers, the drawer, reports,
 * printing and backups. Registered once, in their own file, with the few
 * things they need from here.
 */
const screens: Context = {
  database: open,
  deviceId: () => deviceId,
  dataFolder,
  databaseFile,
  configuration: () => {
    const loaded = loadConfiguration(join(dataFolder(), "configuration.json"));
    return loaded.ok ? loaded.configuration : null;
  },
  window: () => mainWindow,
  /*
   * Read-only means read-only here, not only on the screen. Everything
   * already recorded stays visible; nothing new is written until the
   * licence says otherwise.
   */
  writable: async () => DEMO || (await maySell(dataFolder(), deviceId)),
  closeDatabase: () => {
    database?.close();
    database = null;
  },
};
registerScreens(screens);
registerTrades(screens);

/*
 * If the app cannot start, it says so. Otherwise an owner double-clicks the
 * icon and nothing happens, which is the one failure with no way forward. The
 * message is in both languages because no configuration has been read yet,
 * and it ends with the reason, for whoever he sends a photo of it to.
 */
function cannotStart(error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  if (SMOKE) {
    console.error("OUAQT_SMOKE_FAIL", reason);
    app.exit(1);
    return;
  }
  dialog.showErrorBox(
    "OUAQT",
    [
      "Le logiciel n'a pas pu démarrer. Écrivez-nous sur WhatsApp avec une photo de ce message.",
      "",
      "تعذر تشغيل البرنامج. راسلنا على واتساب مع صورة لهذه الرسالة.",
      "",
      `Pour l'assistance : ${reason}`,
    ].join("\n")
  );
  app.quit();
}

/*
 * The launch check the pipeline runs on every build: demo mode, its own data
 * folder, and a line on stdout once the window has loaded. A build that
 * cannot open its window never becomes a release.
 */
const SMOKE = DEMO && process.env.OUAQT_SMOKE === "1";
if (SMOKE) {
  process.on("uncaughtException", cannotStart);
  process.on("unhandledRejection", cannotStart);
}

app.whenReady().then(() => {
  if (!primary) return;
  try {
    start();
  } catch (error) {
    cannotStart(error);
    return;
  }
  createWindow();

  /*
   * The daily copy of the database, now and every few hours while the app
   * stays open. Not in the launch check, which must leave nothing behind.
   */
  if (!SMOKE) {
    const copy = () => {
      if (database) void automaticBackup(database, dataFolder()).catch((error) => console.error("backup failed", error));
    };
    copy();
    setInterval(copy, 3 * 3_600_000); // not-a-rule: how often to look whether today's copy exists
  }

  if (SMOKE) {
    mainWindow?.webContents.once("did-finish-load", () => {
      console.log("OUAQT_SMOKE_OK");
      app.quit();
    });
  }
  watchForUpdates(() => mainWindow, DEMO);

  /*
   * What changed on the website, at start and every few hours. A change
   * found at start shows at once, before anyone has begun a ticket; one
   * found later waits for the next start rather than reloading the screen
   * under a cashier's hands.
   */
  if (!SMOKE && !DEMO) {
    const startedAt = Date.now();
    void runRefresh()
      .then((changed) => {
        if (changed && Date.now() - startedAt < 60_000) mainWindow?.webContents.reload(); // not-a-rule: the first minute after opening
      })
      .catch((error) => console.error("refresh failed", error));
    setInterval(() => void runRefresh().catch((error) => console.error("refresh failed", error)), 3 * 3_600_000); // not-a-rule: how often to ask
  }

  /*
   * A link from step 4. If this computer already has a working licence the
   * token is simply not needed, and is not spent. Otherwise it goes down the
   * same path as a typed serial, and the screen is told how it went.
   */
  onToken((token) => {
    void (async () => {
      const current = await licenceState(dataFolder(), deviceId);
      const result =
        current.kind === "ok"
          ? { ok: false as const, error: "already_active", via: "link" as const }
          : await runActivation({ token });
      mainWindow?.webContents.send("licence:activated", result);
    })();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  database?.close();
  if (process.platform !== "darwin") app.quit();
});
