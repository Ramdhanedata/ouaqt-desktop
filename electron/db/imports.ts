import type Database from "better-sqlite3";
import { audit } from "./audit";
import { stamp } from "./rows";
import { clock } from "./clock";
import { dayKey } from "../../src/periods";

/*
 * Sales brought in from a spreadsheet, joined to the ones rung up here.
 *
 * Each becomes an ordinary sale on its own day, so the reports, the charts
 * and the week and month comparisons add it in without knowing. Three rules
 * keep the figures honest:
 *
 *   - A row already brought in is not brought in again. Its fingerprint is
 *     the day, the time, the ticket, the item, the quantity and the amount,
 *     and which time that same row appears in the file, so a file read twice
 *     adds nothing and a longer copy of last month's file adds only the new
 *     rows.
 *   - A day the shop already recorded in OUAQT is left alone unless the owner
 *     says otherwise: those sales are already counted, and the spreadsheet
 *     is usually a copy of them.
 *   - The drawer never counts them. That money was not in today's till.
 *
 * Nothing moves on the shelves either: these sales are history, and today's
 * stock is whatever was counted.
 */

export type ImportedSaleLine = {
  label: string | null;
  quantity: number;
  /** In minor units. */
  unitPrice: number;
  /** In minor units: what the line came to, as the file says. */
  total: number;
};

export type ImportedSale = {
  /** YYYY-MM-DD, in this device's own days. */
  day: string;
  /** HH:MM, when the file gives one. */
  time: string | null;
  payment: "cash" | "mobile" | "credit";
  mobileApp: string | null;
  lines: ImportedSaleLine[];
  /** The row's fingerprint, worked out from the file. */
  key: string;
  /** The line in his file, to point at when something is wrong. */
  row: number;
};

export type SalesImportCheck = {
  /** Sales in the file not yet in the shop. */
  fresh: number;
  /** Sales already brought in from this file or an earlier copy of it. */
  already: number;
  /** Days of the file the shop already recorded in OUAQT, and how many of the file's sales fall on them. */
  ownDays: string[];
  onOwnDays: number;
  /** The new sales' total, in minor units, with and without the days already recorded. */
  freshTotal: number;
  freshTotalWithoutOwnDays: number;
};

const MAX_SALES = 20_000; // not-a-rule: a few years of a busy shop's lines, and no more in one go

function valid(sale: ImportedSale): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(sale.day) &&
    (sale.time === null || /^\d{2}:\d{2}$/.test(sale.time)) &&
    typeof sale.key === "string" &&
    sale.key.length > 0 &&
    Array.isArray(sale.lines) &&
    sale.lines.length > 0 &&
    sale.lines.every(
      (line) =>
        Number.isFinite(line.quantity) &&
        line.quantity > 0 &&
        Number.isInteger(line.unitPrice) &&
        Number.isInteger(line.total) &&
        line.total > 0
    )
  );
}

/* The moment a sale is filed under: its own time when the file has one, midday otherwise, so it stays in its day whatever the clock does. */
function momentOf(sale: ImportedSale): string {
  const [year, month, date] = sale.day.split("-").map(Number);
  const [hours, minutes] = sale.time ? sale.time.split(":").map(Number) : [12, 0];
  return new Date(year, month - 1, date, hours, minutes).toISOString();
}

/* The days the shop recorded sales on itself, between two days. */
function ownSaleDays(database: Database.Database, first: string, last: string): Set<string> {
  const [fy, fm, fd] = first.split("-").map(Number);
  const [ly, lm, ld] = last.split("-").map(Number);
  const from = new Date(fy, fm - 1, fd).toISOString();
  const to = new Date(ly, lm - 1, ld + 1).toISOString();
  const rows = database
    .prepare("select occurred_at from sales where import_id is null and occurred_at >= ? and occurred_at < ?")
    .all(from, to) as { occurred_at: string }[];
  return new Set(rows.map((row) => dayKey(new Date(row.occurred_at))));
}

function knownKeys(database: Database.Database): Set<string> {
  const rows = database.prepare("select import_key from sales where import_key is not null").all() as { import_key: string }[];
  return new Set(rows.map((row) => row.import_key));
}

const totalOf = (sale: ImportedSale) => sale.lines.reduce((sum, line) => sum + line.total, 0);

export function checkSalesImport(database: Database.Database, input: ImportedSale[]): SalesImportCheck {
  const sales = input.slice(0, MAX_SALES).filter(valid);
  const known = knownKeys(database);
  const fresh = sales.filter((sale) => !known.has(sale.key));
  const days = fresh.map((sale) => sale.day).sort();
  const own = days.length > 0 ? ownSaleDays(database, days[0], days[days.length - 1]) : new Set<string>();
  const onOwn = fresh.filter((sale) => own.has(sale.day));
  const freshTotal = fresh.reduce((sum, sale) => sum + totalOf(sale), 0);
  return {
    fresh: fresh.length,
    already: sales.length - fresh.length,
    ownDays: [...new Set(onOwn.map((sale) => sale.day))].sort(),
    onOwnDays: onOwn.length,
    freshTotal,
    freshTotalWithoutOwnDays: freshTotal - onOwn.reduce((sum, sale) => sum + totalOf(sale), 0),
  };
}

export type SalesImportResult = { importId: string | null; added: number; total: number; already: number; skippedOwnDays: number; firstDay: string | null; lastDay: string | null };

export function importSales(
  database: Database.Database,
  deviceId: string,
  input: { sales: ImportedSale[]; fileName?: string | null; includeOwnDays?: boolean; staffId?: string | null },
  now = clock()
): SalesImportResult {
  const write = database.transaction((): SalesImportResult => {
    const sales = (Array.isArray(input.sales) ? input.sales : []).slice(0, MAX_SALES).filter(valid);
    const known = knownKeys(database);
    const fresh = sales.filter((sale) => !known.has(sale.key));
    const days = fresh.map((sale) => sale.day).sort();
    const own = days.length > 0 && !input.includeOwnDays ? ownSaleDays(database, days[0], days[days.length - 1]) : new Set<string>();
    const taken = fresh.filter((sale) => !own.has(sale.day));
    const already = sales.length - fresh.length;
    const skippedOwnDays = fresh.length - taken.length;

    if (taken.length === 0) return { importId: null, added: 0, total: 0, already, skippedOwnDays, firstDay: null, lastDay: null };

    const batch = stamp(database, deviceId);
    const takenDays = taken.map((sale) => sale.day).sort();
    const grand = taken.reduce((sum, sale) => sum + totalOf(sale), 0);
    database
      .prepare(
        `insert into sale_imports (id, device_id, created_at, counter, file_name, sales, total, first_day, last_day)
         values (@id, @device_id, @created_at, @counter, @file_name, @sales, @total, @first_day, @last_day)`
      )
      .run({
        ...batch,
        file_name: (input.fileName ?? "").trim().slice(0, 120) || null,
        sales: taken.length,
        total: grand,
        first_day: takenDays[0],
        last_day: takenDays[takenDays.length - 1],
      });

    /* A product of the same name is the same thing: its sales then count under it in the best sellers. */
    const catalogue = database
      .prepare("select id, lower(trim(name)) as name, lower(trim(coalesce(name_arabic, ''))) as arabic from products where archived_at is null")
      .all() as { id: string; name: string; arabic: string }[];
    /* Known by its name in either language. */
    const products = new Map([...catalogue.filter((row) => row.arabic).map((row) => [row.arabic, row.id] as const), ...catalogue.map((row) => [row.name, row.id] as const)]);
    const insertSale = database.prepare(
      `insert into sales (id, device_id, created_at, counter, number, occurred_at, staff_id, total, payment, mobile_app, import_id, import_key)
       values (@id, @device_id, @created_at, @counter, 0, @occurred_at, @staff_id, @total, @payment, @mobile_app, @import_id, @import_key)`
    );
    const insertLine = database.prepare(
      `insert into sale_lines (id, device_id, created_at, counter, sale_id, product_id, quantity, unit_price, line_total, label, kind)
       values (@id, @device_id, @created_at, @counter, @sale_id, @product_id, @quantity, @unit_price, @line_total, @label, @kind)`
    );

    for (const sale of taken) {
      const head = stamp(database, deviceId);
      insertSale.run({
        ...head,
        occurred_at: momentOf(sale),
        staff_id: input.staffId ?? null,
        total: totalOf(sale),
        payment: sale.payment === "mobile" || sale.payment === "credit" ? sale.payment : "cash",
        mobile_app: sale.payment === "mobile" ? (sale.mobileApp ?? "").trim().slice(0, 40) || null : null,
        import_id: batch.id,
        import_key: sale.key.slice(0, 80),
      });
      for (const line of sale.lines) {
        const label = (line.label ?? "").trim().slice(0, 160) || null;
        const productId = label ? (products.get(label.toLowerCase()) ?? null) : null;
        insertLine.run({
          ...stamp(database, deviceId),
          sale_id: head.id,
          product_id: productId,
          quantity: line.quantity,
          unit_price: line.unitPrice,
          line_total: line.total,
          /* With no name in the file, the line still says what it is. */
          label: productId ? null : (label ?? "—"),
          kind: productId ? "product" : "service",
        });
      }
    }

    audit(database, deviceId, {
      staffId: input.staffId ?? null,
      subject: "sale",
      subjectId: batch.id,
      action: "imported",
      detail: { sales: taken.length, total: grand, already, skippedOwnDays, at: now.toISOString() },
    });
    return { importId: batch.id, added: taken.length, total: grand, already, skippedOwnDays, firstDay: takenDays[0], lastDay: takenDays[takenDays.length - 1] };
  });
  return write();
}

export type SaleImport = { id: string; createdAt: string; fileName: string | null; sales: number; total: number; firstDay: string | null; lastDay: string | null };

/* The imports still in the figures, newest first, so a wrong one can be found and taken out. */
export function saleImports(database: Database.Database): SaleImport[] {
  const rows = database
    .prepare("select id, created_at, file_name, sales, total, first_day, last_day from sale_imports where undone_at is null order by created_at desc limit 50")
    .all() as { id: string; created_at: string; file_name: string | null; sales: number; total: number; first_day: string | null; last_day: string | null }[];
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    fileName: row.file_name,
    sales: row.sales,
    total: row.total,
    firstDay: row.first_day,
    lastDay: row.last_day,
  }));
}

/*
 * Takes one import back out, whole: its sales and their lines go, and the
 * import is kept as a record that it was undone. Only imported sales can go
 * this way; a sale rung up here is never deleted.
 */
export function undoImport(database: Database.Database, deviceId: string, importId: string, staffId: string | null = null, now = clock()): number {
  const write = database.transaction((): number => {
    const one = database.prepare("select id from sale_imports where id = ? and undone_at is null").get(importId) as { id: string } | undefined;
    if (!one) return 0;
    const ids = (database.prepare("select id from sales where import_id = ?").all(importId) as { id: string }[]).map((row) => row.id);
    const dropLines = database.prepare("delete from sale_lines where sale_id = ?");
    const dropSale = database.prepare("delete from sales where id = ? and import_id is not null");
    for (const id of ids) {
      dropLines.run(id);
      dropSale.run(id);
    }
    database.prepare("update sale_imports set undone_at = ? where id = ?").run(now.toISOString(), importId);
    audit(database, deviceId, { staffId, subject: "sale", subjectId: importId, action: "import_undone", detail: { sales: ids.length } });
    return ids.length;
  });
  return write();
}
