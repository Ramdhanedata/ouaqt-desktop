import { app, dialog, ipcMain, shell, type BrowserWindow } from "electron";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import type { Configuration } from "@app-ui/config";
import { formatAmount, formatDateTime } from "@app-ui/format";
import {
  backupInfo,
  checkRestore,
  defaultBackupName,
  manualBackup,
  replaceDatabase,
} from "./backup";
import { auditBetween, recentAudit } from "./db/audit";
import { closeSession, openSession, pastSessions, startSession } from "./db/cash";
import {
  addCustomer,
  getCustomer,
  ledgerOf,
  listCustomers,
  recordPayment,
  updateCustomer,
  type NewCustomer,
} from "./db/customers";
import {
  addProduct,
  adjustStock,
  archiveProduct,
  batchesOf,
  expiredProductIds,
  pastExpiryOf,
  expiringProductIds,
  getProduct,
  importProducts,
  monthsFromToday,
  movementsOf,
  receiveStock,
  stockOverview,
  today,
  updateProduct,
  type Adjustment,
  type ImportRow,
  type NewProduct,
  type Reception,
} from "./db/products";
import { dailyTotals, pastExpirySales, summary, topProducts, trialSummary, type Period } from "./db/reports";
import { getSetting, setSetting } from "./db/rows";
import { recordSale, saleDetail, salesBetween, SaleRefused, voidSale, type NewSale } from "./db/sales";
import { addPaymentApp, listPaymentApps, movePaymentApp, removePaymentApp, renamePaymentApp, setPaymentAppLogo } from "./db/payment-apps";
import {
  addColumn,
  columnValues,
  CUSTOM_LIMIT,
  deleteColumn,
  listColumns,
  moveColumn,
  renameColumn,
  setColumnChoices,
  setColumnHidden,
  setColumnValue,
  type ColumnType,
  type ListName,
} from "./db/columns";
import { isPrintedTable, printHtml, receiptHtml, tableCsv, tableHtml, tablePdf, testHtml, type PrintSettings } from "./print";

/*
 * Everything the screens after the till may ask of the machine.
 *
 * Each handler hands straight to a database module and answers with either
 * the result or a short reason the screen turns into a sentence. None of
 * them reaches the network: backups go to this computer or to a folder the
 * owner picks, and printing goes to a printer.
 *
 * Every write goes through `write`, which refuses when the licence says
 * read-only. What is recorded stays readable; nothing new is recorded.
 */

export type Context = {
  database: () => Database.Database;
  deviceId: () => string;
  dataFolder: () => string;
  databaseFile: () => string;
  configuration: () => Configuration | null;
  window: () => BrowserWindow | null;
  writable: () => Promise<boolean>;
  closeDatabase: () => void;
};

type Answer<T> = { ok: true; value: T } | { ok: false; reason: string };

function reasonOf(error: unknown): string {
  if (error instanceof SaleRefused) return error.code;
  const message = error instanceof Error ? error.message : String(error);
  return message;
}

export function registerScreens(context: Context): void {
  const db = context.database;

  const read = <A extends unknown[], T>(channel: string, run: (...args: A) => T) => {
    ipcMain.handle(channel, (_event, ...args: unknown[]): Answer<T> => {
      try {
        return { ok: true, value: run(...(args as A)) };
      } catch (error) {
        return { ok: false, reason: reasonOf(error) };
      }
    });
  };

  const write = <A extends unknown[], T>(channel: string, run: (...args: A) => T | Promise<T>) => {
    ipcMain.handle(channel, async (_event, ...args: unknown[]): Promise<Answer<T>> => {
      if (!(await context.writable())) return { ok: false, reason: "read_only" };
      try {
        return { ok: true, value: await run(...(args as A)) };
      } catch (error) {
        return { ok: false, reason: reasonOf(error) };
      }
    });
  };

  const expiryMonths = () => context.configuration()?.features.pharmacy?.expiryAlertMonths ?? 3; // not-a-rule: the question's own default

  /* ── Payment applications, as the owner keeps them ─────────────────── */

  read("payapps:list", () => listPaymentApps(db()));
  read("payapps:add", (name: string) => addPaymentApp(db(), context.deviceId(), String(name ?? "")));
  read("payapps:rename", (id: string, name: string) => renamePaymentApp(db(), context.deviceId(), String(id), String(name ?? "")));
  read("payapps:logo", (id: string, logo: string | null) => setPaymentAppLogo(db(), String(id), typeof logo === "string" ? logo : null));
  read("payapps:remove", (id: string) => removePaymentApp(db(), context.deviceId(), String(id)));
  read("payapps:move", (id: string, direction: "up" | "down") => movePaymentApp(db(), String(id), direction === "up" ? "up" : "down"));

  /* ── The owner's columns ─────────────────────────────────────────────── */

  const listOf = (list: unknown): ListName => {
    if (list !== "products" && list !== "customers") throw new Error("no such list");
    return list;
  };
  /* Arranging a list is allowed after the trial too: it changes how data is shown, not the data. */
  read("columns:list", (list: string) => ({
    columns: listColumns(db(), context.deviceId(), listOf(list)),
    values: columnValues(db(), listOf(list)),
    limit: CUSTOM_LIMIT,
  }));
  read("columns:add", (list: string, input: { label: string; type: ColumnType; choices?: string[] }) =>
    addColumn(db(), context.deviceId(), listOf(list), {
      label: String(input?.label ?? ""),
      type: input?.type,
      choices: Array.isArray(input?.choices) ? input.choices.map(String) : [],
    })
  );
  read("columns:rename", (id: string, label: string | null) => renameColumn(db(), String(id), typeof label === "string" ? label : null));
  read("columns:hide", (id: string, hidden: boolean) => setColumnHidden(db(), String(id), hidden === true));
  read("columns:choices", (id: string, choices: string[]) => setColumnChoices(db(), String(id), Array.isArray(choices) ? choices.map(String) : []));
  read("columns:move", (id: string, direction: "up" | "down", among?: string[]) =>
    moveColumn(db(), context.deviceId(), String(id), direction === "up" ? "up" : "down", Array.isArray(among) ? among.map(String) : undefined)
  );
  /* Deleting one, or writing in it, is recording, and follows the licence like any other entry. */
  write("columns:delete", (id: string) => deleteColumn(db(), context.deviceId(), String(id)));
  write("columns:value", (list: string, rowId: string, columnId: string, value: string | null) =>
    setColumnValue(db(), listOf(list), String(rowId), String(columnId), typeof value === "string" ? value : null)
  );

  /* A list as it is on screen, to a spreadsheet or to paper. Both work after the trial. */
  const fileNameOf = (name: string, extension: string) =>
    join(app.getPath("documents"), `${String(name).replace(/[^\p{L}\p{N}.-]+/gu, "-").slice(0, 80) || "liste"}.${extension}`);

  ipcMain.handle("lists:export", async (_event, table: unknown, fileName: string): Promise<Answer<string | null>> => {
    try {
      if (!isPrintedTable(table)) throw new Error("not a list");
      const target = await dialog.showSaveDialog(context.window() ?? undefined!, {
        defaultPath: fileNameOf(fileName, "csv"),
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (target.canceled || !target.filePath) return { ok: true, value: null };
      writeFileSync(target.filePath, tableCsv(table), "utf8");
      return { ok: true, value: target.filePath };
    } catch (error) {
      return { ok: false, reason: reasonOf(error) };
    }
  });

  ipcMain.handle("lists:print", async (_event, table: unknown, fileName: string): Promise<Answer<string>> => {
    try {
      const configuration = context.configuration();
      if (!configuration) throw new Error("no_configuration");
      if (!isPrintedTable(table)) throw new Error("not a list");
      const file = join(app.getPath("temp"), `${String(fileName).replace(/[^\p{L}\p{N}.-]+/gu, "-").slice(0, 80) || "liste"}.pdf`);
      writeFileSync(file, await tablePdf(tableHtml(configuration, table)));
      /* A walk records the screens; it does not open a viewer on top of them. */
      if (!process.env.OUAQT_WALK) {
        const failed = await shell.openPath(file);
        if (failed) throw new Error(failed);
      }
      return { ok: true, value: file };
    } catch (error) {
      return { ok: false, reason: reasonOf(error) };
    }
  });

  /* ── Stock ──────────────────────────────────────────────────────────── */

  read("stock:overview", () => stockOverview(db(), expiryMonths()));
  /* What a ticket would sell past expiry, asked before the sale is recorded. */
  read("sales:pastExpiry", (lines: { productId?: string | null; quantity: number }[]) => pastExpiryOf(db(), lines));
  read("stock:flags", () => ({
    expired: expiredProductIds(db()),
    expiring: expiringProductIds(db(), today(), monthsFromToday(expiryMonths())),
    months: expiryMonths(),
  }));
  read("products:detail", (id: string) => {
    const product = getProduct(db(), id);
    if (!product) throw new Error("no such product");
    return { product, batches: batchesOf(db(), id), movements: movementsOf(db(), id, 60) };
  });
  write("products:add", (product: NewProduct) => addProduct(db(), context.deviceId(), product));
  write("products:update", (id: string, changes: Partial<NewProduct>) => updateProduct(db(), context.deviceId(), id, changes));
  write("products:archive", (id: string) => archiveProduct(db(), context.deviceId(), id));
  write("products:import", (rows: ImportRow[]) => importProducts(db(), context.deviceId(), Array.isArray(rows) ? rows : []));
  write("stock:receive", (input: Reception) => receiveStock(db(), context.deviceId(), input));
  write("stock:adjust", (input: Adjustment) => adjustStock(db(), context.deviceId(), input));

  /* ── Selling ────────────────────────────────────────────────────────── */

  write("sales:record", async (sale: NewSale) => {
    const recorded = recordSale(db(), context.deviceId(), sale);
    let printed: { ok: boolean; reason?: string } | null = null;
    if (getSetting(db(), "print_auto") === "1") printed = await printSale(recorded.id);
    return { ...recorded, printed };
  });
  write("sales:void", (saleId: string, reason: string) => voidSale(db(), context.deviceId(), saleId, reason, null));
  read("sales:detail", (id: string) => saleDetail(db(), id));
  read("sales:between", (from: string, to: string) => salesBetween(db(), from, to));

  /* ── Customers ──────────────────────────────────────────────────────── */

  read("customers:list", (term?: string) => listCustomers(db(), typeof term === "string" ? term : ""));
  read("customers:detail", (id: string) => {
    const customer = getCustomer(db(), id);
    if (!customer) throw new Error("no such customer");
    return { customer, ledger: ledgerOf(db(), id) };
  });
  write("customers:add", (input: NewCustomer) => addCustomer(db(), context.deviceId(), input));
  write("customers:update", (id: string, input: NewCustomer) => updateCustomer(db(), context.deviceId(), id, input));
  write(
    "customers:pay",
    (input: { customerId: string; amount: number; payment: "cash" | "mobile"; mobileApp?: string; paymentReference?: string; note?: string }) =>
      recordPayment(db(), context.deviceId(), input)
  );

  /* ── The till drawer ────────────────────────────────────────────────── */

  read("cash:current", () => openSession(db()));
  read("cash:history", () => pastSessions(db(), 30));
  write("cash:open", (openingFloat: number) => startSession(db(), context.deviceId(), { openingFloat }));
  write("cash:close", (counted: number, note?: string) => closeSession(db(), context.deviceId(), { counted, note }));

  /* ── Reports ────────────────────────────────────────────────────────── */

  read("reports:summary", (period: Period) => summary(db(), period));
  read("reports:top", (period: Period) => topProducts(db(), period, 10));
  read("reports:pastExpiry", (period: Period) => pastExpirySales(db(), period));
  read("reports:trial", () => trialSummary(db()));
  read("reports:daily", (days: number) => dailyTotals(db(), Math.min(Math.max(days, 1), 366)));
  read("audit:recent", () => recentAudit(db(), 150));
  /* The staff names that came from the website, for Settings to show. */
  read("staff:list", () =>
    db().prepare("select name, role from staff where active = 1 order by case role when 'manager' then 0 else 1 end, name collate nocase").all() as {
      name: string;
      role: "manager" | "cashier";
    }[]
  );
  read("audit:between", (from: string, to: string) => auditBetween(db(), String(from), String(to)));

  ipcMain.handle("reports:export", async (_event, period: Period, fileName: string): Promise<Answer<string | null>> => {
    try {
      const language = context.configuration()?.language.app ?? "fr";
      const rows = salesBetween(db(), period.from, period.to, 100_000);
      const header = ["numero", "date", "total", "paiement", "application", "client", "statut", "annule_la_vente", "raison"];
      const cell = (value: string) => `"${value.replace(/"/g, '""')}"`;
      const lines = rows
        .slice()
        .reverse()
        .map((row) =>
          [
            String(row.number),
            formatDateTime(new Date(row.occurredAt), language),
            formatAmount(row.total, language),
            row.payment,
            row.mobileApp ?? "",
            row.customerName ?? "",
            row.status,
            row.reversesNumber === null ? "" : String(row.reversesNumber),
            row.voidReason ?? "",
          ]
            .map(cell)
            .join(";")
        );
      const target = await dialog.showSaveDialog(context.window() ?? undefined!, {
        defaultPath: join(app.getPath("documents"), fileName.replace(/[^\w.-]+/g, "-")),
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (target.canceled || !target.filePath) return { ok: true, value: null };
      /* A byte-order mark, so Excel opens the accents and the Arabic as written. */
      writeFileSync(target.filePath, `\uFEFF${[header.join(";"), ...lines].join("\r\n")}\r\n`, "utf8");
      return { ok: true, value: target.filePath };
    } catch (error) {
      return { ok: false, reason: reasonOf(error) };
    }
  });

  /* ── Printing ───────────────────────────────────────────────────────── */

  /* Receipts always on the 80 mm roll (Adel, 2026-09-25); lists and reports print on A4 by themselves. */
  const printSettings = (): PrintSettings => ({
    printer: getSetting(db(), "print_printer"),
    paper: "80",
  });

  async function printSale(saleId: string) {
    const configuration = context.configuration();
    const sale = saleDetail(db(), saleId);
    if (!configuration || !sale) return { ok: false, reason: "no_sale" };
    return printHtml(receiptHtml(configuration, sale, printSettings().paper), printSettings());
  }

  ipcMain.handle("print:settings", () => ({ ...printSettings(), auto: getSetting(db(), "print_auto") === "1" }));
  ipcMain.handle("print:save", (_event, input: { printer: string | null; auto: boolean }) => {
    /* No printer named means this computer's default one. */
    if (input.printer) setSetting(db(), "print_printer", input.printer);
    else db().prepare("delete from settings_local where key = 'print_printer'").run();
    setSetting(db(), "print_auto", input.auto ? "1" : "0");
    return true;
  });
  ipcMain.handle("print:printers", async () => {
    const window = context.window();
    if (!window) return [];
    const printers = await window.webContents.getPrintersAsync();
    return printers.map((printer) => ({ name: printer.name, label: printer.displayName || printer.name }));
  });
  ipcMain.handle("print:receipt", (_event, saleId: string) => printSale(saleId));
  /*
   * The receipt exactly as it prints, for the screen to show before anyone
   * prints or saves it. The same page as the printer and the PDF get, on the
   * paper this computer prints on.
   */
  ipcMain.handle("print:receiptHtml", (_event, saleId: string): Answer<string> => {
    const configuration = context.configuration();
    const sale = saleDetail(db(), String(saleId));
    if (!configuration || !sale) return { ok: false, reason: "no_sale" };
    return { ok: true, value: receiptHtml(configuration, sale, printSettings().paper) };
  });
  /* The receipt as a PDF: to send to a customer, or keep with the day's papers. Offered in Downloads. */
  ipcMain.handle("print:receiptPdf", async (_event, saleId: string): Promise<Answer<string | null>> => {
    try {
      const configuration = context.configuration();
      const sale = saleDetail(db(), String(saleId));
      if (!configuration || !sale) throw new Error("no_sale");
      const name = `recu-${sale.number}.pdf`;
      const pdf = await tablePdf(receiptHtml(configuration, sale, "80"));
      /* A walk cannot answer a save dialog: its copy goes next to its pictures. */
      if (process.env.OUAQT_WALK) {
        const file = join(process.env.OUAQT_WALK, name);
        writeFileSync(file, pdf);
        return { ok: true, value: file };
      }
      const target = await dialog.showSaveDialog(context.window() ?? undefined!, {
        defaultPath: join(app.getPath("downloads"), name),
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (target.canceled || !target.filePath) return { ok: true, value: null };
      writeFileSync(target.filePath, pdf);
      return { ok: true, value: target.filePath };
    } catch (error) {
      return { ok: false, reason: reasonOf(error) };
    }
  });
  ipcMain.handle("print:test", async () => {
    const configuration = context.configuration();
    if (!configuration) return { ok: false, reason: "no_configuration" };
    return printHtml(testHtml(configuration, printSettings().paper), printSettings());
  });

  /* ── Backups ────────────────────────────────────────────────────────── */

  ipcMain.handle("backup:info", () => backupInfo(db(), context.dataFolder()));

  ipcMain.handle("backup:save", async (): Promise<Answer<string | null>> => {
    try {
      const target = await dialog.showSaveDialog(context.window() ?? undefined!, {
        defaultPath: join(app.getPath("documents"), defaultBackupName()),
        filters: [{ name: "OUAQT", extensions: ["db"] }],
      });
      if (target.canceled || !target.filePath) return { ok: true, value: null };
      const ok = await manualBackup(db(), target.filePath);
      return ok ? { ok: true, value: target.filePath } : { ok: false, reason: "backup_failed" };
    } catch (error) {
      return { ok: false, reason: reasonOf(error) };
    }
  });

  /*
   * A restore is two steps, so the screen can ask "are you sure" with the
   * copy's own figures in front of him. The path chosen stays here in the
   * main process: the screen confirms, it never names a file.
   */
  let chosen: string | null = null;
  ipcMain.handle("backup:pick", async (): Promise<Answer<{ sales: number } | null>> => {
    const picked = await dialog.showOpenDialog(context.window() ?? undefined!, {
      properties: ["openFile"],
      filters: [{ name: "OUAQT", extensions: ["db"] }],
    });
    if (picked.canceled || picked.filePaths.length === 0) return { ok: true, value: null };
    const check = checkRestore(picked.filePaths[0], getSetting(db(), "business_id"));
    if (!check.ok) return { ok: false, reason: check.reason };
    chosen = picked.filePaths[0];
    return { ok: true, value: { sales: check.sales } };
  });

  ipcMain.handle("backup:restore", async (): Promise<Answer<null>> => {
    if (!chosen) return { ok: false, reason: "nothing_chosen" };
    const from = chosen;
    chosen = null;
    try {
      /*
       * Closed first, so everything still in the write-ahead log is in the
       * file; the swap then keeps that file as "avant-restauration" beside
       * the daily copies, and the app starts again on the restored one.
       */
      context.closeDatabase();
      replaceDatabase(context.dataFolder(), context.databaseFile(), from);
      app.relaunch();
      app.exit(0);
      return { ok: true, value: null };
    } catch (error) {
      return { ok: false, reason: reasonOf(error) };
    }
  });
}
