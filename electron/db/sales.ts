import type Database from "better-sqlite3";
import { recordMovement } from "./products";
import { stamp } from "./rows";

/*
 * A sale, written in one transaction.
 *
 * The sale, its lines, the stock that left the shelf and the debt if he did
 * not pay all go down together or not at all. A power cut in the middle of
 * this leaves the database as it was before the cashier pressed the key, and
 * never a sale with no lines or stock that moved for nothing.
 *
 * This is the one place in the app where "never lose a sale" is actually
 * decided, which is why it is short enough to read in full.
 */

export type SaleLine = {
  productId: string;
  quantity: number;
  unitPrice: number;
  batchId?: string | null;
};

export type NewSale = {
  lines: SaleLine[];
  payment: "cash" | "credit" | "mobile";
  customerId?: string | null;
  staffId?: string | null;
};

export type RecordedSale = { id: string; number: number; total: number };

function nextNumber(database: Database.Database): number {
  const row = database
    .prepare("select coalesce(max(number), 0) as last from sales")
    .get() as { last: number };
  return row.last + 1;
}

export function recordSale(
  database: Database.Database,
  deviceId: string,
  sale: NewSale
): RecordedSale {
  if (sale.lines.length === 0) throw new Error("a sale with no lines");
  if (sale.payment === "credit" && !sale.customerId) {
    throw new Error("credit needs a customer to owe it");
  }

  /*
   * Line totals are rounded to the smallest unit here and nowhere else, so
   * the total is exactly the sum of what the receipt prints.
   */
  const lines = sale.lines.map((line) => ({
    ...line,
    lineTotal: Math.round(line.quantity * line.unitPrice),
  }));
  const total = lines.reduce((sum, line) => sum + line.lineTotal, 0);

  const write = database.transaction((): RecordedSale => {
    const head = stamp(database, deviceId);
    const number = nextNumber(database);

    database
      .prepare(
        `insert into sales
           (id, device_id, created_at, counter, number, occurred_at, staff_id,
            total, payment, customer_id)
         values (@id, @device_id, @created_at, @counter, @number, @occurred_at,
                 @staff_id, @total, @payment, @customer_id)`
      )
      .run({
        ...head,
        number,
        occurred_at: head.created_at,
        staff_id: sale.staffId ?? null,
        total,
        payment: sale.payment,
        customer_id: sale.customerId ?? null,
      });

    for (const line of lines) {
      const row = stamp(database, deviceId);
      database
        .prepare(
          `insert into sale_lines
             (id, device_id, created_at, counter, sale_id, product_id, quantity,
              unit_price, line_total, batch_id)
           values (@id, @device_id, @created_at, @counter, @sale_id, @product_id,
                   @quantity, @unit_price, @line_total, @batch_id)`
        )
        .run({
          ...row,
          sale_id: head.id,
          product_id: line.productId,
          quantity: line.quantity,
          unit_price: line.unitPrice,
          line_total: line.lineTotal,
          batch_id: line.batchId ?? null,
        });

      recordMovement(database, deviceId, {
        productId: line.productId,
        quantity: -line.quantity,
        reason: "sale",
        reference: head.id,
        staffId: sale.staffId ?? null,
        occurredAt: head.created_at,
      });
    }

    if (sale.payment === "credit" && sale.customerId) {
      const entry = stamp(database, deviceId);
      database
        .prepare(
          `insert into credit_entries
             (id, device_id, created_at, counter, customer_id, sale_id, amount,
              staff_id, occurred_at)
           values (@id, @device_id, @created_at, @counter, @customer_id, @sale_id,
                   @amount, @staff_id, @occurred_at)`
        )
        .run({
          ...entry,
          customer_id: sale.customerId,
          sale_id: head.id,
          amount: total,
          staff_id: sale.staffId ?? null,
          occurred_at: head.created_at,
        });
    }

    return { id: head.id, number, total };
  });

  return write();
}

/*
 * A sale is never edited and never deleted. Voiding writes a second sale that
 * reverses the first, with the reason and the person who did it, and puts the
 * stock back the same way it took it.
 */
export function voidSale(
  database: Database.Database,
  deviceId: string,
  saleId: string,
  reason: string,
  staffId: string | null
): string {
  const write = database.transaction((): string => {
    const original = database
      .prepare("select id, total, payment, customer_id, status from sales where id = ?")
      .get(saleId) as
      | { id: string; total: number; payment: string; customer_id: string | null; status: string }
      | undefined;

    if (!original) throw new Error("no such sale");
    if (original.status === "voided") throw new Error("already voided");

    const head = stamp(database, deviceId);
    database
      .prepare(
        `insert into sales
           (id, device_id, created_at, counter, number, occurred_at, staff_id,
            total, payment, customer_id, status, reverses_id, void_reason)
         values (@id, @device_id, @created_at, @counter, @number, @occurred_at,
                 @staff_id, @total, @payment, @customer_id, 'recorded', @reverses_id,
                 @void_reason)`
      )
      .run({
        ...head,
        number: nextNumber(database),
        occurred_at: head.created_at,
        staff_id: staffId,
        total: -original.total,
        payment: original.payment,
        customer_id: original.customer_id,
        reverses_id: original.id,
        void_reason: reason,
      });

    database.prepare("update sales set status = 'voided' where id = ?").run(saleId);

    const lines = database
      .prepare("select product_id, quantity from sale_lines where sale_id = ?")
      .all(saleId) as { product_id: string; quantity: number }[];

    for (const line of lines) {
      recordMovement(database, deviceId, {
        productId: line.product_id,
        quantity: line.quantity,
        reason: "return",
        reference: head.id,
        staffId,
        occurredAt: head.created_at,
      });
    }

    if (original.payment === "credit" && original.customer_id) {
      const entry = stamp(database, deviceId);
      database
        .prepare(
          `insert into credit_entries
             (id, device_id, created_at, counter, customer_id, sale_id, amount,
              staff_id, occurred_at)
           values (@id, @device_id, @created_at, @counter, @customer_id, @sale_id,
                   @amount, @staff_id, @occurred_at)`
        )
        .run({
          ...entry,
          customer_id: original.customer_id,
          sale_id: head.id,
          amount: -original.total,
          staff_id: staffId,
          occurred_at: head.created_at,
        });
    }

    return head.id;
  });

  return write();
}

export type SaleSummary = {
  id: string;
  number: number;
  occurredAt: string;
  total: number;
  payment: string;
  status: string;
};

export function recentSales(
  database: Database.Database,
  limit = 50
): SaleSummary[] {
  const rows = database
    .prepare(
      `select id, number, occurred_at, total, payment, status
         from sales order by occurred_at desc limit ?`
    )
    .all(limit) as {
    id: string;
    number: number;
    occurred_at: string;
    total: number;
    payment: string;
    status: string;
  }[];

  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    occurredAt: row.occurred_at,
    total: row.total,
    payment: row.payment,
    status: row.status,
  }));
}

/** What the till should hold: cash sales since the session opened. */
export function cashTakenSince(database: Database.Database, since: string): number {
  const row = database
    .prepare(
      `select coalesce(sum(total), 0) as total from sales
        where payment = 'cash' and status = 'recorded' and occurred_at >= ?`
    )
    .get(since) as { total: number };
  return row.total;
}
