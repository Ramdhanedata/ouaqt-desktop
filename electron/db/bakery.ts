import type Database from "better-sqlite3";
import { audit } from "./audit";
import { addCashMovement, receivedFor } from "./cashbook";
import { recordMovement, today } from "./products";
import { stamp } from "./rows";
import { recordSale, type NewSale, type RecordedSale } from "./sales";

/*
 * A bakery's day: what came out of the oven, what sold, what was left at
 * closing, and the orders customers placed ahead with a deposit.
 *
 * Production is a movement in, like a delivery from a supplier, and what is
 * left at closing is a movement out when the owner counts it as lost. So the
 * shelf figure, the day's production and the day's losses all come from the
 * same rows, and "made 200, sold 170, threw 30" adds up by itself.
 */

export type DayLine = {
  productId: string;
  name: string;
  nameArabic: string | null;
  produced: number;
  sold: number;
  lost: number;
  onHand: number;
};

function dayBounds(day: string): { from: string; to: string } {
  const [year, month, date] = day.split("-").map(Number);
  const start = new Date(year, month - 1, date);
  const end = new Date(year, month - 1, date + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

export function recordProduction(
  database: Database.Database,
  deviceId: string,
  items: { productId: string; quantity: number }[],
  staffId: string | null = null,
  now = new Date()
): number {
  const write = database.transaction(() => {
    let lines = 0;
    for (const item of items) {
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) continue;
      recordMovement(database, deviceId, {
        productId: item.productId,
        quantity: item.quantity,
        reason: "production",
        reference: today(now),
        staffId,
        occurredAt: now.toISOString(),
      });
      lines += 1;
    }
    if (lines > 0) audit(database, deviceId, { staffId, subject: "production", action: "recorded", detail: { lines } });
    return lines;
  });
  return write();
}

/* What was left at closing and will not be sold: a movement out, reason loss. */
export function recordUnsold(
  database: Database.Database,
  deviceId: string,
  items: { productId: string; quantity: number }[],
  staffId: string | null = null,
  now = new Date()
): number {
  const write = database.transaction(() => {
    let lines = 0;
    for (const item of items) {
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) continue;
      recordMovement(database, deviceId, {
        productId: item.productId,
        quantity: -item.quantity,
        reason: "loss",
        reference: today(now),
        staffId,
        occurredAt: now.toISOString(),
      });
      lines += 1;
    }
    if (lines > 0) audit(database, deviceId, { staffId, subject: "production", action: "unsold", detail: { lines } });
    return lines;
  });
  return write();
}

/* One day, per product: made, sold, lost, and what the shelf holds now. */
export function dayOf(database: Database.Database, day: string): DayLine[] {
  const { from, to } = dayBounds(day);
  const rows = database
    .prepare(
      `select p.id, p.name, p.name_arabic,
              coalesce(sum(case when m.reason = 'production' then m.quantity end), 0) as produced,
              coalesce(-sum(case when m.reason = 'sale' then m.quantity end), 0)
                - coalesce(sum(case when m.reason = 'return' then m.quantity end), 0) as sold,
              coalesce(-sum(case when m.reason = 'loss' then m.quantity end), 0) as lost,
              (select coalesce(sum(all_m.quantity), 0) from stock_movements all_m where all_m.product_id = p.id) as on_hand
         from products p
         left join stock_movements m on m.product_id = p.id and m.occurred_at >= ? and m.occurred_at < ?
        where p.archived_at is null and p.tracked = 1
        group by p.id
        order by p.name collate nocase`
    )
    .all(from, to) as { id: string; name: string; name_arabic: string | null; produced: number; sold: number; lost: number; on_hand: number }[];
  return rows.map((row) => ({
    productId: row.id,
    name: row.name,
    nameArabic: row.name_arabic,
    produced: row.produced,
    sold: row.sold,
    lost: row.lost,
    onHand: row.on_hand,
  }));
}

export type Preorder = {
  id: string;
  number: number;
  customer: string;
  phone: string | null;
  dueOn: string;
  total: number;
  deposit: number;
  received: number;
  status: "pending" | "ready" | "collected" | "cancelled";
  note: string | null;
  lines: { productId: string; name: string; quantity: number; unitPrice: number }[];
};

function blank(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/*
 * An order for later, with its deposit. The deposit is money received now,
 * in the cash book; the sale is written when the order is collected, and
 * says how much was already paid.
 */
export function createPreorder(
  database: Database.Database,
  deviceId: string,
  input: {
    customer: string;
    phone?: string | null;
    dueOn: string;
    lines: { productId: string; quantity: number; unitPrice: number }[];
    deposit?: number;
    depositPayment?: "cash" | "mobile";
    note?: string | null;
    staffId?: string | null;
  },
  now = new Date()
): string {
  const customer = blank(input.customer);
  if (!customer) throw new Error("an order needs a name");
  if (!DATE.test(input.dueOn)) throw new Error("a date is YYYY-MM-DD");
  if (input.lines.length === 0) throw new Error("an order needs something in it");
  const total = input.lines.reduce((sum, line) => sum + Math.round(line.quantity * line.unitPrice), 0);
  const deposit = input.deposit ?? 0;
  if (!Number.isInteger(deposit) || deposit < 0 || deposit > total) throw new Error("a deposit is between nothing and the total");

  const write = database.transaction(() => {
    const row = stamp(database, deviceId);
    const number = (database.prepare("select coalesce(max(number), 0) + 1 as n from preorders").get() as { n: number }).n;
    database
      .prepare(
        `insert into preorders (id, device_id, created_at, counter, number, customer, phone, due_on, total, deposit, note, staff_id)
         values (@id, @device_id, @created_at, @counter, @number, @customer, @phone, @due_on, @total, @deposit, @note, @staff_id)`
      )
      .run({
        ...row,
        number,
        customer,
        phone: blank(input.phone),
        due_on: input.dueOn,
        total,
        deposit,
        note: blank(input.note),
        staff_id: input.staffId ?? null,
      });
    for (const line of input.lines) {
      const lineRow = stamp(database, deviceId);
      database
        .prepare(
          `insert into preorder_lines (id, device_id, created_at, counter, preorder_id, product_id, quantity, unit_price)
           values (@id, @device_id, @created_at, @counter, @preorder_id, @product_id, @quantity, @unit_price)`
        )
        .run({ ...lineRow, preorder_id: row.id, product_id: line.productId, quantity: line.quantity, unit_price: line.unitPrice });
    }
    if (deposit > 0) {
      addCashMovement(
        database,
        deviceId,
        { direction: "in", amount: deposit, payment: input.depositPayment ?? "cash", reason: "deposit", reference: row.id, note: customer, staffId: input.staffId ?? null },
        now
      );
    }
    return row.id;
  });
  return write();
}

export function listPreorders(database: Database.Database, which: "open" | "all" = "open"): Preorder[] {
  const rows = database
    .prepare(
      `select * from preorders ${which === "open" ? "where status in ('pending', 'ready')" : ""}
        order by due_on, number`
    )
    .all() as {
    id: string;
    number: number;
    customer: string;
    phone: string | null;
    due_on: string;
    total: number;
    deposit: number;
    status: Preorder["status"];
    note: string | null;
  }[];
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    customer: row.customer,
    phone: row.phone,
    dueOn: row.due_on,
    total: row.total,
    deposit: row.deposit,
    received: receivedFor(database, row.id),
    status: row.status,
    note: row.note,
    lines: (
      database
        .prepare(
          `select l.product_id, p.name, l.quantity, l.unit_price from preorder_lines l join products p on p.id = l.product_id
            where l.preorder_id = ? order by l.counter`
        )
        .all(row.id) as { product_id: string; name: string; quantity: number; unit_price: number }[]
    ).map((line) => ({ productId: line.product_id, name: line.name, quantity: line.quantity, unitPrice: line.unit_price })),
  }));
}

export function markPreorderReady(database: Database.Database, id: string): void {
  database.prepare("update preorders set status = 'ready' where id = ? and status = 'pending'").run(id);
}

/* Collected: the sale for the whole order, less what the deposit already paid. */
export function collectPreorder(
  database: Database.Database,
  deviceId: string,
  id: string,
  payment: Omit<NewSale, "lines" | "reference" | "prepaid">,
  now = new Date()
): RecordedSale {
  const write = database.transaction(() => {
    const order = listPreorders(database, "all").find((one) => one.id === id);
    if (!order) throw new Error("no such order");
    if (order.status === "collected" || order.status === "cancelled") throw new Error("order closed");
    const sale = recordSale(
      database,
      deviceId,
      {
        ...payment,
        reference: id,
        prepaid: Math.min(order.received, order.total),
        lines: order.lines.map((line) => ({ productId: line.productId, quantity: line.quantity, unitPrice: line.unitPrice })),
      },
      now
    );
    database.prepare("update preorders set status = 'collected', sale_id = ? where id = ?").run(sale.id, id);
    return sale;
  });
  return write();
}

/* Cancelled, with the deposit handed back or kept, as the owner decides. */
export function cancelPreorder(
  database: Database.Database,
  deviceId: string,
  id: string,
  refund: boolean,
  staffId: string | null = null
): void {
  const write = database.transaction(() => {
    const order = listPreorders(database, "all").find((one) => one.id === id);
    if (!order) throw new Error("no such order");
    if (order.status === "collected" || order.status === "cancelled") throw new Error("order closed");
    if (refund && order.received > 0) {
      addCashMovement(database, deviceId, { direction: "out", amount: order.received, reason: "deposit_refund", reference: id, note: order.customer, staffId });
    }
    database.prepare("update preorders set status = 'cancelled' where id = ?").run(id);
    audit(database, deviceId, { staffId, subject: "preorder", subjectId: id, action: "cancelled", detail: { refund } });
  });
  write();
}
