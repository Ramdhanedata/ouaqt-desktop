import { configurationSchema, type Configuration } from "@app-ui/config";
import type { Pack } from "@app-ui/packs";
import Database, { startEngine } from "./sqlite";
import { ipcMain } from "./electron";
import { showPrinted } from "./print-slip";
import { migrate, type Migration } from "../electron/db/open";
import { deviceIdOf, getSetting, setSetting } from "../electron/db/rows";
import { listProducts, searchProducts } from "../electron/db/products";
import { recentSales } from "../electron/db/sales";
import { registerScreens, type Context } from "../electron/ipc";
import { registerTrades } from "../electron/ipc-trades";
import { seedDemo } from "../electron/demo-seed";

/*
 * This app, running in a web page: the builder's preview.
 *
 * The screens are the app's own, unchanged, and so are the database modules,
 * the migrations and every handler in ipc.ts and ipc-trades.ts. What differs
 * is underneath: SQLite in WebAssembly and in memory instead of a file, and
 * Electron replaced by web/electron.ts. So what an owner tries in the
 * builder is the software he downloads, screen for screen and button for
 * button, not a drawing of it.
 *
 * The page that embeds this one sends the configuration the owner is
 * building, each time an answer changes it:
 *
 *   { type: "ouaqt:configuration", configuration, section? }
 *
 * and this page says "ouaqt:ready" once it can take one. A new trade starts
 * a new invented shop; any other change is applied to the open one, which
 * keeps what the owner already did in it.
 */

const migrations: Migration[] = Object.entries(
  import.meta.glob("../electron/db/migrations/*.sql", { query: "?raw", import: "default", eager: true }) as Record<string, string>
)
  .map(([path, sql]) => ({ name: path.split("/").pop() ?? path, sql }))
  .sort((a, b) => a.name.localeCompare(b.name));

let database: Database | null = null;
let deviceId = "";
let configuration: Configuration | null = null;

const PLACEHOLDER_NAME: Record<string, string> = { fr: "Votre commerce", ar: "متجرك", en: "Your business" };

function open(): Database {
  if (!database) throw new Error("the preview has no shop yet");
  return database;
}

/* A fresh invented shop for this trade, in memory, with the app's own migrations and demo stock. */
function newShop(pack: Pack) {
  database?.close();
  database = new Database();
  database.pragma("foreign_keys = ON");
  migrate(database as never, migrations);
  deviceId = deviceIdOf(database as never);
  seedDemo(database as never, deviceId, pack, { week: true });
}

/*
 * The builder sends what the owner has answered so far. A name not typed
 * yet still has to be a name, so the window says "Votre commerce" until it
 * is; everything else is the owner's own configuration, checked with the
 * same schema the app checks a downloaded one with.
 */
function accept(sent: unknown): Configuration | null {
  const draft = sent as Configuration;
  const language = draft?.language?.app ?? "fr";
  const named = {
    ...draft,
    business: { ...draft?.business, nameLatin: draft?.business?.nameLatin?.trim() || PLACEHOLDER_NAME[language] || PLACEHOLDER_NAME.fr },
  };
  const checked = configurationSchema.safeParse(named);
  return checked.success ? checked.data : null;
}

function apply(next: Configuration, section: unknown) {
  const newTrade = !configuration || configuration.pack !== next.pack;
  configuration = next;
  if (newTrade) newShop(next.pack);
  const db = open();
  /* The language the owner chose for his staff is the one the screens speak. */
  setSetting(db as never, "ui_language", next.language.app);
  /* A shop with a receipt printer prints each sale; one without never does. */
  setSetting(db as never, "print_auto", next.common.printedReceipt ? "1" : "0");
  window.dispatchEvent(new CustomEvent("ouaqt:reload", { detail: { fresh: newTrade } }));
  /* After the window has read the new configuration, so a section the answer just created exists. */
  if (typeof section === "string") setTimeout(() => window.dispatchEvent(new CustomEvent("ouaqt:section", { detail: section })), 200); // not-a-rule: ms for the window to read it

}

function registerMain() {
  const LANGUAGES = ["fr", "ar", "en"];
  const readPreferences = () => {
    const language = getSetting(open() as never, "ui_language");
    return {
      language: LANGUAGES.includes(language ?? "") ? language : null,
      theme: getSetting(open() as never, "ui_theme") === "dark" ? "dark" : "light",
    };
  };

  ipcMain.handle("prefs:read", () => readPreferences());
  ipcMain.handle("prefs:write", (_event, next) => {
    const wanted = next as { language?: unknown; theme?: unknown };
    if (typeof wanted?.language === "string" && LANGUAGES.includes(wanted.language)) setSetting(open() as never, "ui_language", wanted.language);
    if (wanted?.theme === "light" || wanted?.theme === "dark") setSetting(open() as never, "ui_theme", wanted.theme);
    return readPreferences();
  });
  ipcMain.handle("configuration:read", () =>
    configuration ? { ok: true, configuration } : { ok: false, reason: "missing" }
  );
  ipcMain.handle("database:state", () => ({ ready: Boolean(database), tables: 0 }));
  ipcMain.handle("products:list", (_event, term) =>
    typeof term === "string" && term.trim() ? searchProducts(open() as never, term) : listProducts(open() as never)
  );
  ipcMain.handle("sales:recent", (_event, limit) => recentSales(open() as never, typeof limit === "number" ? limit : undefined));
  ipcMain.handle("app:info", () => ({ testBuild: false, version: "preview", server: null }));

  /* The preview is never on a licence: it is the demo, with nothing to activate and nothing ending. */
  ipcMain.handle("licence:state", () => ({ kind: "demo" }));
  ipcMain.handle("licence:check", () => ({ reached: true, state: { kind: "demo" } }));
  ipcMain.handle("licence:serial", () => null);
  ipcMain.handle("licence:activate", () => ({ ok: false, error: "unknown_serial", via: "serial" }));
  ipcMain.handle("licence:payHelp", () => ({ payAddress: "", payLink: null, supportWhatsapp: null }));
  ipcMain.handle("open:pay", () => undefined);
  ipcMain.handle("open:whatsapp", () => undefined);
}

async function start() {
  await startEngine();
  registerMain();

  const context: Context = {
    database: () => open() as never,
    deviceId: () => deviceId,
    dataFolder: () => "/preview",
    databaseFile: () => "/preview/ouaqt.db",
    configuration: () => configuration,
    window: () => null,
    writable: async () => true,
    closeDatabase: () => undefined,
  };
  registerScreens(context);
  registerTrades(context);
  window.addEventListener("ouaqt:printed", (event) => showPrinted((event as CustomEvent<{ html: string; sheet: boolean }>).detail));

  /* The bridge the screens use, exactly as the desktop app's preload writes it. */
  await import("../electron/preload");

  /* The first configuration decides the trade; the screens wait for it. */
  const first = await new Promise<{ configuration: Configuration; section: unknown }>((resolve) => {
    let started = false;
    window.addEventListener("message", (event) => {
      /* Only the page this one is part of may reshape it. */
      if (event.origin !== window.location.origin && !import.meta.env.DEV) return;
      const message = event.data as { type?: string; configuration?: unknown; section?: unknown };
      if (message?.type !== "ouaqt:configuration") return;
      const next = accept(message.configuration);
      if (!next) return;
      if (!started) {
        started = true;
        resolve({ configuration: next, section: message.section });
      } else {
        apply(next, message.section);
      }
    });
    window.parent.postMessage({ type: "ouaqt:ready" }, "*");
  });
  apply(first.configuration, first.section);

  await import("../src/main");
  /* The window is drawn: the page around it can take its loading state away. */
  window.parent.postMessage({ type: "ouaqt:started" }, "*");
}

void start();
