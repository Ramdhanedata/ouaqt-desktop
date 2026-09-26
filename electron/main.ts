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
import { activateAndWalk, DEMO, demoFolder, fixtureFor, prepareDemoFolder, seedDemo, walkLicence, walkTill, walkTrade } from "./demo";
import { applyActivation, applyRefresh } from "./licence/apply";
import { fingerprint } from "./licence/fingerprint";
import { activate, apiOrigin, refresh, type Proof } from "./licence/network";
import { claimLinks, onToken } from "./licence/protocol";
import { licenceState, maySell } from "./licence/state";
import { readDeviceToken } from "./licence/store";
import { watchForUpdates } from "./updates";
import { markInstalledIcon, wearTradeIcon } from "./icon";
import { getSetting, setSetting } from "./db/rows";

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
    if (configuration.ok) seedDemo(database, deviceId, configuration.configuration.pack, { empty: process.env.OUAQT_DEMO_EMPTY === "1" });
    /* A demo can open in dark, for pictures of every screen that way. */
    setSetting(database, "ui_theme", process.env.OUAQT_DEMO_THEME === "dark" ? "dark" : "light");
    /* A demo has its language already, unless the walk is to show the first launch. */
    if (process.env.OUAQT_DEMO_FIRST_LAUNCH !== "1") {
      setSetting(database, "ui_language", process.env.OUAQT_DEMO_LANG === "ar" ? "ar" : configuration.ok ? configuration.configuration.language.app : "fr");
    }
  }
}

/*
 * The two things chosen on this computer rather than for the shop: the
 * language the screens speak, picked once on the first launch and changed in
 * Settings, and light or dark. Kept in the shop's own database, so an update
 * never resets them and a backup carries them. Allowed even when the
 * licence has run out: choosing a language is never a sale.
 */
const LANGUAGES = ["fr", "ar", "en"] as const;
type UiLanguage = (typeof LANGUAGES)[number];

function readPreferences() {
  const db = open();
  const language = getSetting(db, "ui_language");
  return {
    language: (LANGUAGES as readonly string[]).includes(language ?? "") ? (language as UiLanguage) : null,
    theme: getSetting(db, "ui_theme") === "dark" ? ("dark" as const) : ("light" as const),
  };
}

ipcMain.handle("prefs:read", () => readPreferences());

/*
 * "trial:3", "expired_trial", "active:3" (a paid licence ending in three
 * days), "renewal_due" or "expired", for pictures of each of those screens.
 */
function demoLicence(pretend: string | undefined) {
  if (!pretend) return { kind: "demo" as const };
  const [status, days] = pretend.split(":");
  const ended = status === "expired_trial" || status === "expired";
  const paid = status === "active" || status === "renewal_due" || status === "expired";
  /* OUAQT_DEMO_SERIAL puts a real test shop's serial in the picture, so its QR code can be scanned and paid. */
  if (ended && !getSetting(open(), "serial")) setSetting(open(), "serial", process.env.OUAQT_DEMO_SERIAL || "DEMO-2026");
  if (ended && !getSetting(open(), "support_whatsapp")) setSetting(open(), "support_whatsapp", "22200000000");
  const day = 86_400_000; // not-a-rule: a day, for invented dates
  const left = Number(days ?? 3);
  const endsAt = new Date(Date.now() + (status === "renewal_due" ? -2 : ended ? -1 : left) * day);
  const known = ["trial", "expired_trial", "active", "renewal_due", "expired"] as const;
  return {
    kind: "ok" as const,
    businessName: "Demo",
    plan: paid ? "annual" : "trial",
    status: known.find((one) => one === status) ?? ("trial" as const),
    clockWrong: false,
    canSell: !ended,
    daysLeft: ended || status === "renewal_due" ? 0 : left,
    startsAt: new Date(endsAt.getTime() - (paid ? 365 : 30) * day).toISOString(), // not-a-rule: invented dates for a picture
    endsAt: endsAt.toISOString(),
    graceUntil: paid ? new Date(endsAt.getTime() + 30 * day).toISOString() : null, // not-a-rule: the grace setting's usual value
    trialSummaryDays: 5,
  };
}

/* The shop's numéro de série, as this computer last heard it, to show and copy when the trial ends. */
ipcMain.handle("licence:serial", () => getSetting(open(), "serial"));

/*
 * The website's payment page, in the language the screens speak. Built here
 * from the site this build activates against: the screens cannot hand over
 * an address, only a language.
 */
function payAddress(language: unknown): string {
  const lang = language === "ar" || language === "en" ? language : "fr";
  return `${apiOrigin()}/${lang}/${lang === "fr" ? "payer" : "pay"}`;
}

/*
 * With his serial after the #, the page finds his shop by itself: he picks
 * his app and sends the screenshot, nothing to type. The # part never
 * reaches the website's server, and the page takes it off the address.
 */
ipcMain.handle("open:pay", (_event, language: unknown, withSerial: unknown) => {
  const serial = withSerial === true ? getSetting(open(), "serial") : null;
  void shell.openExternal(payAddress(language) + (serial ? `#${encodeURIComponent(serial)}` : ""));
});

/*
 * What the end-of-trial window shows him: the address to open on his phone,
 * written the short way, and OUAQT's WhatsApp as the last check sent it.
 */
ipcMain.handle("licence:payHelp", (_event, language: unknown) => {
  const serial = getSetting(open(), "serial");
  return {
    payAddress: payAddress(language).replace(/^https?:\/\//, ""),
    /* For the QR code his phone scans: the page opens on his shop, nothing to type. */
    payLink: serial ? `${payAddress(language)}#${encodeURIComponent(serial)}` : null,
    supportWhatsapp: getSetting(open(), "support_whatsapp"),
  };
});

ipcMain.handle("prefs:write", (_event, next: { language?: unknown; theme?: unknown }) => {
  const db = open();
  if (typeof next?.language === "string" && (LANGUAGES as readonly string[]).includes(next.language)) {
    setSetting(db, "ui_language", next.language);
  }
  if (next?.theme === "light" || next?.theme === "dark") setSetting(db, "ui_theme", next.theme);
  return readPreferences();
});

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

/*
 * The trade's icon, once the shop is known: on the window every time, on the
 * shortcuts or in Applications once per trade (electron/icon.ts). Never in a
 * demo, a walk or a smoke test, which run on somebody's own machine.
 */
function applyTradeIcon() {
  if (DEMO || SMOKE || !database) return;
  const loaded = loadConfiguration(join(dataFolder(), "configuration.json"));
  if (!loaded.ok) return;
  const pack = loaded.configuration.pack;
  wearTradeIcon(mainWindow, pack);
  if (getSetting(open(), "icon_pack") === pack) return;
  void markInstalledIcon(pack).then((changed) => {
    if (changed) setSetting(open(), "icon_pack", pack);
  });
}

function createWindow() {
  const window = new BrowserWindow({
    title: TEST_BUILD ? "OUAQT, version de test" : "OUAQT",
    /* The screens' own ivory, so the window never flashes white while it loads. */
    backgroundColor: "#f0eee6",
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
    applyTradeIcon();
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
      const language = process.env.OUAQT_DEMO_LANG === "ar" ? "ar" : "fr";
      const run = process.env.OUAQT_DEMO_LICENCE
        ? walkLicence(window, walk, language)
        : pack === "pharmacy"
          ? walkTill(window, open, walk, charge)
          : walkTrade(window, open, walk, pack, language);
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

function viaOf(proof: Proof) {
  return "serial" in proof ? ("serial" as const) : "nearby" in proof ? ("nearby" as const) : ("link" as const);
}

/*
 * Activation, from any proof. The serial the owner typed and the token the
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
      via: viaOf(proof),
    };
  }

  const applied = await applyActivation(db, dataFolder(), deviceId, answer);
  /* A website too old to send the serial back: the one he typed is the same number. */
  if (applied.ok && "serial" in proof && !getSetting(db, "serial")) setSetting(db, "serial", proof.serial.trim().toUpperCase());
  if (!applied.ok) {
    return { ok: false as const, error: applied.reason, via: viaOf(proof) };
  }
  applyTradeIcon();
  return { ok: true as const, products: applied.products, staff: applied.staff };
}

/*
 * Asking the website whether anything changed: a renewal the owner paid for,
 * a suspension, or the software he described again on the site. True when
 * something the screens show is now different. Without a network, or before
 * activation, it quietly does nothing: the licence file already says what
 * holds, and for how long.
 */
async function runRefresh(): Promise<{ reached: boolean; changed: boolean }> {
  if (DEMO) return { reached: false, changed: false };
  const db = open();
  const businessId = getSetting(db, "business_id");
  const deviceToken = readDeviceToken(dataFolder());
  if (!businessId || !deviceToken) return { reached: false, changed: false };
  const version = Number(getSetting(db, "configuration_version"));
  const answer = await refresh({
    businessId,
    deviceId,
    deviceToken,
    ...(Number.isInteger(version) && version >= 0 ? { configurationVersion: version } : {}),
  });
  if (!answer.ok) return { reached: false, changed: false };
  const applied = await applyRefresh(db, dataFolder(), deviceId, answer);
  if (applied.ok && applied.changed) applyTradeIcon();
  return { reached: true, changed: applied.ok && applied.changed };
}

/*
 * Asked by the end-of-trial window while it is open: has a payment been
 * confirmed? The same refresh as at start, then the licence read again, so
 * a confirmed payment opens the software within the minute.
 */
ipcMain.handle("licence:check", async () => {
  if (DEMO) return { reached: true, state: demoLicence(process.env.OUAQT_DEMO_LICENCE) };
  const reached = await runRefresh()
    .then((result) => result.reached)
    .catch(() => false);
  return { reached, state: await licenceState(dataFolder(), deviceId) };
});

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
  /* A demo can pretend to be near or past the end of its trial, for pictures of those screens. */
  if (DEMO) return demoLicence(process.env.OUAQT_DEMO_LICENCE);
  return licenceState(dataFolder(), deviceId);
});

ipcMain.handle("licence:activate", async (_event, serial: string) => {
  if (typeof serial !== "string" || !serial.trim()) {
    return { ok: false as const, error: "unknown_serial", via: "serial" as const };
  }
  return runActivation({ serial: serial.trim() });
});

/*
 * The first start: was this software downloaded from where it stands? When
 * the website says one shop was, it opens straight on that shop and the
 * trial starts, with nothing to type. The screens then speak the language
 * the shop was built in, unless one was already chosen on this computer.
 * Anything else, and the owner is asked for his serial as before.
 */
ipcMain.handle("licence:nearby", async () => {
  if (DEMO) return { ok: false as const, error: "no_nearby", via: "nearby" as const };
  const current = await licenceState(dataFolder(), deviceId);
  if (current.kind !== "none") return { ok: false as const, error: "already_active", via: "nearby" as const };
  const result = await runActivation({ nearby: true });
  if (result.ok && !getSetting(open(), "ui_language")) {
    const loaded = loadConfiguration(join(dataFolder(), "configuration.json"));
    if (loaded.ok) setSetting(open(), "ui_language", loaded.configuration.language.app);
  }
  return result;
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
      .then(({ changed }) => {
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
