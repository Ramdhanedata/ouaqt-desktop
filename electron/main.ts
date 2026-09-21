import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { loadConfiguration } from "./config/load";
import { integrityIsGood, migrate, openDatabase, readMigrations } from "./db/open";

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

function start() {
  const file = join(dataFolder(), "ouaqt.db");
  database = openDatabase(file);

  const ran = migrate(database, readMigrations(migrationsFolder()));
  if (ran.length > 0) console.log("migrations applied:", ran.join(", "));
  if (!integrityIsGood(database)) {
    console.error("the database did not pass its integrity check");
  }
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
