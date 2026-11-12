import type Database from "better-sqlite3";
import { audit } from "./audit";

/*
 * Taking back something entered by mistake, as if it had never been entered.
 *
 * Voiding (sales.ts) keeps the sale and writes its reversal beside it, which
 * is right when goods really came back. A sale rung up twice, on the wrong
 * day or for the wrong amount did not happen at all, and the owner wants it
 * gone from the day's count. So here the rows themselves are deleted, with
 * everything they left behind: the lines, the parts paid two ways, the stock
 * taken, the customer's debt, the void if there was one, and the trade's own
 * record the sale paid for (the order, ticket, stay, wash, cake ordered
 * ahead) with any deposit or advance taken on it.
 *
 * Deleting is noted by the sync triggers like any other change, so the
 * shop's other devices lose the row too. The journal keeps one line saying
 * what was deleted, how much and when, so the owner can still see it was.
 */

/* What a trade writes about a sale it was paid by, and the rows hanging off it. */
const PAID_RECORDS: { table: string; children?: { table: string; column: string } }[] = [
  { table: "orders", children: { table: "order_lines", column: "order_id" } },
  { table: "preorders", children: { table: "preorder_lines", column: "preorder_id" } },
  { table: "stays", children: { table: "stay_charges", column: "stay_id" } },
  { table: "wash_jobs", children: { table: "wash_job_lines", column: "job_id" } },
  { table: "tickets" },
  { table: "parcels" },
  { table: "dispatches" },
];

const marks = (count: number) => Array.from({ length: count }, () => "?").join(", ");

function tableExists(database: Database.Database, name: string): boolean {
  return database.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(name) !== undefined;
}

/* A trade's record, its lines, and the money and stock it moved on its own. */
function eraseRecord(database: Database.Database, table: string, childTable: { table: string; column: string } | undefined, id: string): void {
  database.prepare("delete from cash_movements where reference = ?").run(id);
  database.prepare("delete from stock_movements where reference = ?").run(id);
  if (childTable && tableExists(database, childTable.table)) {
    database.prepare(`delete from ${childTable.table} where ${childTable.column} = ?`).run(id);
  }
  database.prepare(`delete from ${table} where id = ?`).run(id);
}

export type Erased = { number: number; total: number };

/*
 * One sale gone, wherever it was picked: the sale itself or its reversal both
 * take the pair away.
 */
export function deleteSale(database: Database.Database, deviceId: string, saleId: string, staffId: string | null = null): Erased {
  const write = database.transaction((): Erased => {
    const picked = database.prepare("select id, reverses_id from sales where id = ?").get(saleId) as
      | { id: string; reverses_id: string | null }
      | undefined;
    if (!picked) throw new Error("no such sale");
    const rootId = picked.reverses_id ?? picked.id;
    const root = database.prepare("select number, total, occurred_at from sales where id = ?").get(rootId) as
      | { number: number; total: number; occurred_at: string }
      | undefined;
    if (!root) throw new Error("no such sale");

    const ids = [rootId, ...(database.prepare("select id from sales where reverses_id = ?").all(rootId) as { id: string }[]).map((row) => row.id)];
    const among = `(${marks(ids.length)})`;

    for (const record of PAID_RECORDS) {
      if (!tableExists(database, record.table)) continue;
      const rows = database.prepare(`select id from ${record.table} where sale_id in ${among}`).all(...ids) as { id: string }[];
      for (const row of rows) eraseRecord(database, record.table, record.children, row.id);
    }

    database.prepare(`delete from stock_movements where reference in ${among}`).run(...ids);
    database.prepare(`delete from credit_entries where sale_id in ${among}`).run(...ids);
    database.prepare(`delete from sale_payments where sale_id in ${among}`).run(...ids);
    database.prepare(`delete from sale_lines where sale_id in ${among}`).run(...ids);
    database.prepare("delete from sales where reverses_id = ?").run(rootId);
    database.prepare("delete from sales where id = ?").run(rootId);

    audit(database, deviceId, {
      staffId,
      subject: "sale",
      subjectId: rootId,
      action: "deleted",
      detail: { number: root.number, total: root.total, at: root.occurred_at },
    });
    return { number: root.number, total: root.total };
  });
  return write();
}

/* Money put in or taken out of the till by mistake. */
export function deleteCashMovement(database: Database.Database, deviceId: string, id: string, staffId: string | null = null): void {
  const write = database.transaction(() => {
    const row = database.prepare("select direction, amount, reason from cash_movements where id = ?").get(id) as
      | { direction: string; amount: number; reason: string }
      | undefined;
    if (!row) throw new Error("no such movement");
    database.prepare("delete from cash_movements where id = ?").run(id);
    audit(database, deviceId, { staffId, subject: "cash", subjectId: id, action: "deleted", detail: { direction: row.direction, amount: row.amount, reason: row.reason } });
  });
  write();
}

/*
 * A line of a customer's account. A payment entered by mistake goes on its
 * own; a sale on the account goes with the whole sale.
 */
export function deleteLedgerLine(database: Database.Database, deviceId: string, id: string, staffId: string | null = null): void {
  const row = database.prepare("select customer_id, sale_id, amount from credit_entries where id = ?").get(id) as
    | { customer_id: string; sale_id: string | null; amount: number }
    | undefined;
  if (!row) throw new Error("no such line");
  if (row.sale_id) {
    deleteSale(database, deviceId, row.sale_id, staffId);
    return;
  }
  const write = database.transaction(() => {
    database.prepare("delete from credit_entries where id = ?").run(id);
    audit(database, deviceId, { staffId, subject: "customer", subjectId: row.customer_id, action: "payment_deleted", detail: { amount: -row.amount } });
  });
  write();
}

/*
 * A line of a product's stock history. Stock sold goes with its sale; stock
 * received, counted or written off goes on its own, and a batch nothing else
 * touches any more goes with it.
 */
export function deleteStockMovement(database: Database.Database, deviceId: string, id: string, staffId: string | null = null): void {
  const row = database.prepare("select product_id, quantity, reason, reference, batch_id from stock_movements where id = ?").get(id) as
    | { product_id: string; quantity: number; reason: string; reference: string | null; batch_id: string | null }
    | undefined;
  if (!row) throw new Error("no such movement");
  if ((row.reason === "sale" || row.reason === "return") && row.reference) {
    const sale = database.prepare("select id from sales where id = ?").get(row.reference) as { id: string } | undefined;
    if (sale) {
      deleteSale(database, deviceId, sale.id, staffId);
      return;
    }
  }
  const write = database.transaction(() => {
    database.prepare("delete from stock_movements where id = ?").run(id);
    if (row.batch_id) {
      const used =
        database.prepare("select 1 from stock_movements where batch_id = ? limit 1").get(row.batch_id) !== undefined ||
        database.prepare("select 1 from sale_lines where batch_id = ? limit 1").get(row.batch_id) !== undefined;
      if (!used) {
        const batch = database.prepare("select reception_id from batches where id = ?").get(row.batch_id) as { reception_id: string | null } | undefined;
        database.prepare("delete from batches where id = ?").run(row.batch_id);
        if (batch?.reception_id) {
          const left = database.prepare("select 1 from batches where reception_id = ? limit 1").get(batch.reception_id) !== undefined;
          if (!left) database.prepare("delete from receptions where id = ?").run(batch.reception_id);
        }
      }
    }
    audit(database, deviceId, {
      staffId,
      subject: "product",
      subjectId: row.product_id,
      action: "movement_deleted",
      detail: { quantity: row.quantity, reason: row.reason },
    });
  });
  write();
}

/*
 * Starting again from nothing: every sale of every month, every debt and
 * payment, the till's days and movements, the stock's history, each trade's
 * orders, stays, tickets, parcels and washes, the imports and the journal.
 * What the owner set up is kept (settings, staff, rooms, routes, payment
 * apps), and so are the products and customers unless he asks for them to
 * go too. Children before parents, so the database holds together at every
 * step. Deleting is noted by the sync triggers, so the shop's other devices
 * are emptied the same way.
 */
const ACTIVITY = [
  "sale_payments",
  "credit_entries",
  "sale_lines",
  "order_lines",
  "orders",
  "preorder_lines",
  "preorders",
  "stay_charges",
  "stays",
  "tickets",
  "parcels",
  "trips",
  "wash_job_lines",
  "wash_jobs",
  "dispatches",
  "stock_movements",
  "batches",
  "receptions",
  "cash_movements",
  "cash_sessions",
  "maintenance_issues",
  "sales",
  "sale_imports",
];
const CATALOG = ["column_values", "products", "customers"];

export function eraseEverything(
  database: Database.Database,
  deviceId: string,
  options: { products?: boolean } = {},
  staffId: string | null = null
): { sales: number } {
  const write = database.transaction(() => {
    /* Checked once, at the end, rather than row by row in an order every table must agree with. */
    database.pragma("defer_foreign_keys = ON");
    const sales = (database.prepare("select count(*) as n from sales where reverses_id is null").get() as { n: number }).n;
    /* A sale points back at the one it reverses: the reversals go first. */
    database.prepare("delete from sales where reverses_id is not null").run();
    for (const table of [...ACTIVITY, ...(options.products ? CATALOG : [])]) {
      if (tableExists(database, table)) database.prepare(`delete from ${table}`).run();
    }
    const broken = database.pragma("foreign_key_check") as { table: string; parent: string }[];
    if (broken.length > 0) throw new Error(`still pointed at: ${[...new Set(broken.map((row) => `${row.table} -> ${row.parent}`))].join(", ")}`);
    database.prepare("delete from audit_local").run();
    audit(database, deviceId, { staffId, subject: "shop", action: "erased", detail: { sales, products: Boolean(options.products) } });
    return { sales };
  });
  return write();
}
