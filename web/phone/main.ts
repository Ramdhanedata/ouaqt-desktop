/* First, before any of the app's own modules: process.env and Buffer. */
import "./env";
import { loadDisk, flushDisk, readFileSync, existsSync, writeFileSync, join, SHOP_FOLDER, downloadPath, pickFile } from "./disk";
import Database, { saveNow, startEngine, useFileStore } from "../sqlite";
import { configureHost, ipcMain, sendToWindow } from "../electron";
import { showPaper } from "./paper";
import { integrityIsGood, migrate, type Migration } from "../../electron/db/open";
import { deviceIdOf, getSetting, setSetting } from "../../electron/db/rows";
import { adoptImportedBatches, listProducts, searchProducts } from "../../electron/db/products";
import { recentSales, saleDetail } from "../../electron/db/sales";
import { receiptContext } from "../../electron/db/receipts";
import { isPrintedTable, receiptHtml, tableHtml } from "../../electron/print";
import { registerScreens, type Context } from "../../electron/ipc";
import { registerTrades } from "../../electron/ipc-trades";
import { loadConfiguration } from "../../electron/config/load";
import { applyActivation, applyRefresh } from "../../electron/licence/apply";
import { thisMachine } from "./fingerprint";
import { activate, apiOrigin, payInfoFrom, refresh, type Proof } from "../../electron/licence/network";
import { licenceState, maySell } from "../../electron/licence/state";
import { readDeviceToken } from "../../electron/licence/store";

/*
 * The shop's software on a phone: the same app, installed from the website
 * into the phone's browser, with its own icon and no internet needed once it
 * is in.
 *
 * Everything the owner touches is the desktop app's own code. The screens in
 * src/, the database modules and migrations in electron/db, the handlers in
 * electron/ipc.ts and ipc-trades.ts, and the licence code in
 * electron/licence all run here unchanged. What is different sits
 * underneath, the way it does for the builder's preview (web/main.ts):
 *
 * - SQLite in WebAssembly, kept in the phone's storage (web/sqlite.ts with
 *   the store from web/phone/disk.ts) instead of a file on a disk;
 * - a small disk of its own under /shop for the licence, the device token
 *   and the configuration, so electron/licence reads and writes them as on
 *   a PC;
 * - the phone's file picker and downloads instead of open and save dialogs;
 * - the phone's print sheet instead of a receipt printer.
 *
 * The phone is one more device of the shop, activated with the shop's
 * serial like a second PC, and it keeps its own data. Nothing of the shop's
 * trade is ever sent anywhere: the licence calls are the ones the desktop
 * makes, in electron/licence/network.ts, and nothing else here reaches the
 * network.
 */

declare const __OUAQT_TEST_BUILD__: boolean;
const TEST_BUILD = typeof __OUAQT_TEST_BUILD__ === "boolean" ? __OUAQT_TEST_BUILD__ : true;
declare const __OUAQT_PHONE_VERSION__: string;
const VERSION = typeof __OUAQT_PHONE_VERSION__ === "string" ? __OUAQT_PHONE_VERSION__ : "phone";

const migrations: Migration[] = Object.entries(
  import.meta.glob("../../electron/db/migrations/*.sql", { query: "?raw", import: "default", eager: true }) as Record<string, string>
)
  .map(([path, sql]) => ({ name: path.split("/").pop() ?? path, sql }))
  .sort((a, b) => a.name.localeCompare(b.name));

const DATABASE_FILE = join(SHOP_FOLDER, "ouaqt.db");
const CONFIGURATION_FILE = join(SHOP_FOLDER, "configuration.json");
const LANGUAGES = ["fr", "ar", "en"] as const;

let database: Database | null = null;
let deviceId = "";

function open(): Database {
  if (!database) throw new Error("the database is not open");
  return database;
}

/* The same database calls as the desktop, typed for better-sqlite3; the stand-in answers them. */
const db = () => open() as never;

function openShopDatabase() {
  database = new Database(DATABASE_FILE);
  database.pragma("foreign_keys = ON");
  migrate(db(), migrations);
  if (!integrityIsGood(db())) console.error("the database did not pass its integrity check");
  deviceId = deviceIdOf(db());
  adoptImportedBatches(db(), deviceId);
  /* A phone has no receipt printer: a receipt is opened when asked for, never after every sale. */
  if (getSetting(db(), "print_auto") !== "0") setSetting(db(), "print_auto", "0");
}

function configuration() {
  const loaded = loadConfiguration(CONFIGURATION_FILE);
  return loaded.ok ? loaded.configuration : null;
}

function screenLanguage(): string {
  return getSetting(db(), "ui_language") ?? configuration()?.language.app ?? "fr";
}

const narrow = () => window.matchMedia("(max-width: 767px)").matches;

/* ── What the desktop's main.ts answers, answered for a phone ─────── */

function readPreferences() {
  const language = getSetting(db(), "ui_language");
  return {
    language: (LANGUAGES as readonly string[]).includes(language ?? "") ? language : null,
    theme: getSetting(db(), "ui_theme") === "dark" ? "dark" : "light",
  };
}

function shownSerial(): string | null {
  const serial = getSetting(db(), "serial");
  return serial ? serial.replace(/[\s-]/g, "") : null;
}

function payAddress(language: unknown): string {
  const lang = language === "ar" || language === "en" ? language : "fr";
  return `${apiOrigin()}/${lang}/${lang === "fr" ? "payer" : "pay"}`;
}

function storedPayInfo() {
  try {
    return payInfoFrom(JSON.parse(getSetting(db(), "pay_info") ?? "null"));
  } catch {
    return null;
  }
}

function viaOf(proof: Proof) {
  return "serial" in proof ? ("serial" as const) : "nearby" in proof ? ("nearby" as const) : ("link" as const);
}

async function runActivation(proof: Proof) {
  const answer = await activate({
    proof,
    deviceId,
    deviceName: phoneName(),
    platform: "phone",
    fingerprint: await thisMachine(),
    expectBusinessId: getSetting(db(), "business_id") ?? undefined,
  });
  if (!answer.ok) {
    return { ok: false as const, error: answer.error, because: answer.because, supportWhatsapp: answer.supportWhatsapp, via: viaOf(proof), shop: answer.shop };
  }
  const applied = await applyActivation(db(), SHOP_FOLDER, deviceId, answer);
  if (applied.ok && "serial" in proof && !getSetting(db(), "serial")) setSetting(db(), "serial", proof.serial.replace(/[\s-]/g, "").toUpperCase());
  saveNow();
  if (!applied.ok) return { ok: false as const, error: applied.reason, via: viaOf(proof) };
  /* The screens speak the language the shop was built in, unless one was already chosen on this phone. */
  const built = configuration();
  if (built && !getSetting(db(), "ui_language")) setSetting(db(), "ui_language", built.language.app);
  dressForShop();
  return { ok: true as const, products: applied.products, staff: applied.staff };
}

/* What the owner sees in his list of devices on the website: which phone this is, roughly. */
function phoneName(): string {
  const agent = navigator.userAgent;
  if (/iPhone/i.test(agent)) return "iPhone";
  if (/iPad/i.test(agent)) return "iPad";
  if (/Android/i.test(agent)) return "Android";
  return "Téléphone";
}

async function runRefresh(): Promise<{ reached: boolean; changed: boolean; tradeChanged: boolean }> {
  const businessId = getSetting(db(), "business_id");
  const deviceToken = readDeviceToken(SHOP_FOLDER);
  if (!businessId || !deviceToken || !navigator.onLine) return { reached: false, changed: false, tradeChanged: false };
  const packBefore = configuration()?.pack ?? null;
  const version = Number(getSetting(db(), "configuration_version"));
  const answer = await refresh({
    businessId,
    deviceId,
    deviceToken,
    ...(Number.isInteger(version) && version >= 0 ? { configurationVersion: version } : {}),
  });
  if (!answer.ok) return { reached: false, changed: false, tradeChanged: false };
  const applied = await applyRefresh(db(), SHOP_FOLDER, deviceId, answer);
  saveNow();
  const changed = applied.ok && applied.changed;
  return { reached: true, changed, tradeChanged: changed && (configuration()?.pack ?? null) !== packBefore };
}

/*
 * A serial carried in the address, after the #: the website's "open on my
 * phone" code puts it there, so the owner scans and his shop opens with
 * nothing to type. The part after # never reaches any server, and it is
 * taken off the address as soon as it is read.
 */
function serialFromAddress(): string | null {
  const match = /(?:^|[#&])serial=([A-Za-z0-9-]{6,20})/.exec(window.location.hash);
  if (!match) return null;
  history.replaceState(null, "", window.location.pathname + window.location.search);
  return match[1];
}

function registerMain() {
  ipcMain.handle("prefs:read", () => readPreferences());
  ipcMain.handle("prefs:write", (_event, next) => {
    const wanted = next as { language?: unknown; theme?: unknown };
    if (typeof wanted?.language === "string" && (LANGUAGES as readonly string[]).includes(wanted.language)) setSetting(db(), "ui_language", wanted.language);
    if (wanted?.theme === "light" || wanted?.theme === "dark") setSetting(db(), "ui_theme", wanted.theme);
    return readPreferences();
  });
  ipcMain.handle("licence:serial", () => shownSerial());
  ipcMain.handle("open:pay", (_event, language, withSerial) => {
    const serial = withSerial === true ? shownSerial() : null;
    window.open(payAddress(language) + (serial ? `#${encodeURIComponent(serial)}` : ""), "_blank", "noopener");
  });
  ipcMain.handle("licence:payHelp", (_event, language) => {
    const serial = shownSerial();
    const pay = storedPayInfo();
    return {
      payAddress: payAddress(language).replace(/^https?:\/\//, ""),
      payLink: serial ? `${payAddress(language)}#${encodeURIComponent(serial)}` : null,
      supportWhatsapp: getSetting(db(), "support_whatsapp"),
      payTo: pay?.payTo ?? [],
      prices: pay?.prices ?? [],
    };
  });
  ipcMain.handle("configuration:read", () => loadConfiguration(CONFIGURATION_FILE));
  ipcMain.handle("database:state", () => {
    const tables = open().prepare("select count(*) as n from sqlite_master where type = 'table'").get() as { n: number };
    return { ready: true, tables: tables.n, file: DATABASE_FILE };
  });
  ipcMain.handle("products:list", (_event, term) =>
    typeof term === "string" && term.trim() ? searchProducts(db(), term) : listProducts(db())
  );
  ipcMain.handle("sales:recent", (_event, limit) => recentSales(db(), typeof limit === "number" ? limit : undefined));
  ipcMain.handle("licence:check", async () => {
    const reached = await runRefresh().then((result) => result.reached).catch(() => false);
    return { reached, state: await licenceState(SHOP_FOLDER, deviceId) };
  });
  ipcMain.handle("open:whatsapp", (_event, number) => {
    const digits = String(number ?? "").replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) return;
    window.open(`https://wa.me/${digits}`, "_blank", "noopener");
  });
  ipcMain.handle("app:info", () => ({ testBuild: TEST_BUILD, version: VERSION, server: TEST_BUILD ? apiOrigin() : null }));
  ipcMain.handle("licence:state", () => licenceState(SHOP_FOLDER, deviceId));
  ipcMain.handle("licence:activate", async (_event, serial) => {
    if (typeof serial !== "string" || !serial.trim()) return { ok: false as const, error: "unknown_serial", via: "serial" as const };
    return runActivation({ serial: serial.trim() });
  });
  /*
   * The desktop asks the website here whether it was downloaded from this
   * connection. A phone is opened from a link instead, so it only looks at
   * its own address for a serial; with none, the serial screen shows.
   */
  ipcMain.handle("licence:nearby", async () => {
    const serial = serialFromAddress();
    if (!serial) return { ok: false as const, error: "no_nearby", via: "nearby" as const };
    const current = await licenceState(SHOP_FOLDER, deviceId);
    if (current.kind !== "none") return { ok: false as const, error: "already_active", via: "serial" as const };
    return runActivation({ serial });
  });

  /* One shop per phone for now: opening another one is done from a PC. */
  ipcMain.handle("shop:pending", () => null);
  ipcMain.handle("shop:open", () => ({ ok: false, error: "not_available", via: "serial" }));
  ipcMain.handle("shop:stay", () => undefined);
  ipcMain.handle("shops:list", () => []);
  ipcMain.handle("shops:switch", () => false);
  ipcMain.handle("shops:serial", () => ({ ok: false, error: "not_available", via: "serial" }));
}

/*
 * The two places the desktop makes a PDF with Chromium's printToPDF, which a
 * web page does not have: the page opens over the screen instead, and the
 * phone's print sheet saves it as a PDF or shares it.
 */
function registerPhonePrinting() {
  ipcMain.handle("lists:print", (_event, table) => {
    const shop = configuration();
    if (!shop) return { ok: false, reason: "no_configuration" };
    if (!isPrintedTable(table)) return { ok: false, reason: "not a list" };
    showPaper(tableHtml(shop, table), screenLanguage(), false);
    return { ok: true, value: "" };
  });
  ipcMain.handle("print:receiptPdf", (_event, saleId) => {
    const shop = configuration();
    const sale = saleDetail(db(), String(saleId));
    if (!shop || !sale) return { ok: false, reason: "no_sale" };
    showPaper(receiptHtml(shop, sale, "80", receiptContext(db(), sale.id)), screenLanguage(), true);
    return { ok: true, value: null };
  });
  /* Anything sent to "the printer" (a receipt asked for, a ticket, a delivery note) opens the same way. */
  window.addEventListener("ouaqt:printed", (event) => {
    const { html, sheet } = (event as CustomEvent<{ html: string; sheet: boolean }>).detail;
    showPaper(html, screenLanguage(), !sheet || narrow());
  });
}

/*
 * The phone's icon and name for this shop. An iPhone reads the title and the
 * apple-touch-icon at the moment "Add to Home Screen" is pressed, and Android
 * reads the manifest when it installs, so once the shop is known the page
 * wears the trade's icon and the shop's own name.
 */
const PACK_ICONS = ["pharmacy", "bakery", "restaurant", "warehouse", "shop", "hotel", "transport", "general"];
function dressForShop() {
  const shop = configuration();
  if (!shop) return;
  const name = (screenLanguage() === "ar" && shop.business.nameArabic) || shop.business.nameLatin;
  document.title = name;
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", name.slice(0, 30));
  if (!PACK_ICONS.includes(shop.pack)) return;
  document.querySelector('link[rel="apple-touch-icon"]')?.setAttribute("href", `./icons/${shop.pack}-180.png`);
  document.querySelector('link[rel="icon"]')?.setAttribute("href", `./icons/${shop.pack}-192.png`);
  document.querySelector('link[rel="manifest"]')?.setAttribute("href", `./manifest-${shop.pack}.webmanifest`);
}

/* The service worker that keeps the app's files on the phone, written by scripts/build-phone.mjs. */
function keepFilesOnPhone() {
  if (!("serviceWorker" in navigator) || import.meta.env.DEV) return;
  void navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch((error) => console.error("the app cannot be kept on this phone", error));
}

/* ── Starting ──────────────────────────────────────────────────────── */

function failed(error: unknown) {
  const reason = error instanceof Error ? error.message : String(error);
  const root = document.getElementById("root");
  if (!root) return;
  root.innerHTML = "";
  const box = document.createElement("div");
  box.style.cssText = "padding:24px;font:17px/1.5 system-ui,sans-serif;max-width:32rem;margin:auto";
  box.innerText = [
    "Le logiciel n'a pas pu démarrer. Écrivez-nous sur WhatsApp avec une capture de cet écran.",
    "",
    "تعذر تشغيل البرنامج. راسلنا على واتساب مع صورة لهذه الشاشة.",
    "",
    `Pour l'assistance : ${reason}`,
  ].join("\n");
  root.appendChild(box);
}

async function start() {
  await loadDisk();
  await startEngine();
  useFileStore({
    read: (file) => (existsSync(file) ? (readFileSync(file) as Uint8Array) : null),
    write: (file, bytes) => writeFileSync(file, bytes),
  });

  configureHost({
    getPath: (name) => (name === "userData" ? SHOP_FOLDER : name === "temp" ? "/tmp" : "/downloads"),
    version: VERSION,
    showSaveDialog: async (options) => ({ canceled: false, filePath: downloadPath(options.defaultPath, "ouaqt.csv") }),
    showOpenDialog: async (options) => {
      const path = await pickFile(options.filters?.flatMap((filter) => filter.extensions) ?? []);
      return path ? { canceled: false, filePaths: [path] } : { canceled: true, filePaths: [] };
    },
    /* A restored copy is in place: save it, then start again on it. */
    relaunch: () => {
      void flushDisk().then(() => window.location.reload());
    },
  });

  openShopDatabase();
  registerMain();

  const context: Context = {
    database: db,
    deviceId: () => deviceId,
    dataFolder: () => SHOP_FOLDER,
    databaseFile: () => DATABASE_FILE,
    configuration,
    window: () => null,
    writable: async () => {
      const may = await maySell(SHOP_FOLDER, deviceId);
      if (!may) sendToWindow("licence:refused");
      return may;
    },
    closeDatabase: () => {
      database?.close();
      database = null;
    },
  };
  registerScreens(context);
  registerTrades(context);
  registerPhonePrinting();

  /*
   * Saved before the phone puts the page away. A phone closes a hidden page
   * whenever it needs the memory, often without another word, so this is
   * the last moment that is sure to come.
   */
  const keep = () => {
    saveNow();
    void flushDisk();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") keep();
  });
  window.addEventListener("pagehide", keep);

  /* The bridge the screens use, exactly as the desktop app's preload writes it. */
  await import("../../electron/preload");
  await import("../../src/main");
  dressForShop();
  keepFilesOnPhone();

  /*
   * What changed on the website, when there is a network: a renewal paid
   * for, a suspension, the software described again. Never in the way of a
   * sale: without a network nothing happens and the licence file decides.
   */
  const startedAt = Date.now();
  const ask = (reloadOnAnyChange: boolean) =>
    void runRefresh()
      .then(({ changed, tradeChanged }) => {
        if (tradeChanged || (reloadOnAnyChange && changed && Date.now() - startedAt < 60_000)) window.location.reload(); // not-a-rule: the first minute after opening
      })
      .catch((error) => console.error("refresh failed", error));
  ask(true);
  setInterval(() => ask(false), 3 * 3_600_000); // not-a-rule: how often to ask
  window.addEventListener("online", () => ask(false));
}

start().catch(failed);
