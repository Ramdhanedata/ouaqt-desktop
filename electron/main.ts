import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { loadConfiguration } from "./config/load";
import { integrityIsGood, migrate, openDatabase, readMigrations } from "./db/open";
import { deviceIdOf } from "./db/rows";
import { listProducts, searchProducts } from "./db/products";
import { cashTakenSince, recentSales, recordSale, voidSale, type NewSale } from "./db/sales";

/*
 * The main process: the database, the configuration, and one window.
 *
 * Nothing here reaches the network. Activation and refresh arrive in D2, and
 * when they do they will live in one file that can be read on its own, so
 * that "no code path sends business data anywhere" stays something anybody
 * can check rather than something we assert.
 */

const isDev = Boolean(process.env.OUAQT_DEV_URL);

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

function start() {
  const file = join(dataFolder(), "ouaqt.db");
  database = openDatabase(file);

  const ran = migrate(database, readMigrations(migrationsFolder()));
  if (ran.length > 0) console.log("migrations applied:", ran.join(", "));
  if (!integrityIsGood(database)) {
    console.error("the database did not pass its integrity check");
  }
  deviceId = deviceIdOf(database);
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
    },
  });

  window.once("ready-to-show", () => window.show());

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

ipcMain.handle("sales:record", (_event, sale: NewSale) => {
  try {
    return { ok: true as const, sale: recordSale(open(), deviceId, sale) };
  } catch (error) {
    /*
     * The screen keeps the ticket when this comes back false, so the reason
     * matters less than the fact that it did not happen.
     */
    return { ok: false as const, reason: (error as Error).message };
  }
});

ipcMain.handle("sales:recent", (_event, limit?: number) => recentSales(open(), limit));

ipcMain.handle(
  "sales:void",
  (_event, saleId: string, reason: string, staffId: string | null) => {
    try {
      return { ok: true as const, id: voidSale(open(), deviceId, saleId, reason, staffId) };
    } catch (error) {
      return { ok: false as const, reason: (error as Error).message };
    }
  }
);

ipcMain.handle("cash:expected", (_event, since: string) => cashTakenSince(open(), since));

app.whenReady().then(() => {
  start();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  database?.close();
  if (process.platform !== "darwin") app.quit();
});
