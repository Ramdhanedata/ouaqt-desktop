import type Database from "better-sqlite3";
import { audit } from "./audit";
import { stamp } from "./rows";
import { recordSale, type NewSale, type RecordedSale } from "./sales";

/*
 * A restaurant's orders: opened for a table, added to while it eats, sent to
 * the kitchen in rounds, and paid once at the end.
 *
 * An open order is a draft, so its lines change in place until it is paid;
 * that is the one difference from a sale, which never changes. Paying writes
 * the sale in one transaction with the order's own lines, and from then on
 * the sale is the record. What was sent to the kitchen and later taken off
 * is kept, marked cancelled, because a dish made and not paid for is exactly
 * what an owner wants to see.
 */

export type Service = "dine_in" | "takeaway" | "delivery";

export type OrderLine = {
  id: string;
  productId: string;
  name: string;
  nameArabic: string | null;
  category: string | null;
  quantity: number;
  unitPrice: number;
  note: string | null;
  sentAt: string | null;
  cancelledAt: string | null;
};

export type Order = {
  id: string;
  number: number;
  service: Service;
  tableNo: number | null;
  guests: number | null;
  customer: string | null;
  phone: string | null;
  address: string | null;
  status: "open" | "paid" | "cancelled";
  openedAt: string;
  total: number;
  unsent: number;
};

type OrderRow = {
  id: string;
  number: number;
  service: Service;
  table_no: number | null;
  guests: number | null;
  customer: string | null;
  phone: string | null;
  address: string | null;
  status: Order["status"];
  opened_at: string;
  total: number;
  unsent: number;
};

const ORDER = `
  select o.id, o.number, o.service, o.table_no, o.guests, o.customer, o.phone, o.address, o.status, o.opened_at,
         (select coalesce(sum(round(l.quantity * l.unit_price)), 0) from order_lines l
           where l.order_id = o.id and l.cancelled_at is null) as total,
         (select count(*) from order_lines l
           where l.order_id = o.id and l.cancelled_at is null and l.sent_at is null) as unsent
    from orders o
`;

function toOrder(row: OrderRow): Order {
  return {
    id: row.id,
    number: row.number,
    service: row.service,
    tableNo: row.table_no,
    guests: row.guests,
    customer: row.customer,
    phone: row.phone,
    address: row.address,
    status: row.status,
    openedAt: row.opened_at,
    total: row.total,
    unsent: row.unsent,
  };
}

export function openOrders(database: Database.Database): Order[] {
  const rows = database.prepare(`${ORDER} where o.status = 'open' order by o.opened_at`).all() as OrderRow[];
  return rows.map(toOrder);
}

export function getOrder(database: Database.Database, id: string): { order: Order; lines: OrderLine[] } | null {
  const row = database.prepare(`${ORDER} where o.id = ?`).get(id) as OrderRow | undefined;
  if (!row) return null;
  const lines = database
    .prepare(
      `select l.id, l.product_id, p.name, p.name_arabic, p.category, l.quantity, l.unit_price, l.note, l.sent_at, l.cancelled_at
         from order_lines l join products p on p.id = l.product_id
        where l.order_id = ? order by l.counter`
    )
    .all(id) as {
    id: string;
    product_id: string;
    name: string;
    name_arabic: string | null;
    category: string | null;
    quantity: number;
    unit_price: number;
    note: string | null;
    sent_at: string | null;
    cancelled_at: string | null;
  }[];
  return {
    order: toOrder(row),
    lines: lines.map((line) => ({
      id: line.id,
      productId: line.product_id,
      name: line.name,
      nameArabic: line.name_arabic,
      category: line.category,
      quantity: line.quantity,
      unitPrice: line.unit_price,
      note: line.note,
      sentAt: line.sent_at,
      cancelledAt: line.cancelled_at,
    })),
  };
}

function blank(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

export function startOrder(
  database: Database.Database,
  deviceId: string,
  input: { service: Service; tableNo?: number | null; guests?: number | null; customer?: string | null; phone?: string | null; address?: string | null; staffId?: string | null },
  now = new Date()
): string {
  const write = database.transaction(() => {
    if (input.service === "dine_in") {
      if (!input.tableNo || input.tableNo < 1) throw new Error("a table needs its number");
      const taken = database
        .prepare("select id from orders where status = 'open' and service = 'dine_in' and table_no = ?")
        .get(input.tableNo) as { id: string } | undefined;
      /* A table already eating keeps its order: the second tap opens it, not a new one. */
      if (taken) return taken.id;
    }
    const row = stamp(database, deviceId);
    const number = (database.prepare("select coalesce(max(number), 0) + 1 as n from orders").get() as { n: number }).n;
    database
      .prepare(
        `insert into orders (id, device_id, created_at, counter, number, service, table_no, guests, customer, phone, address, opened_at, staff_id)
         values (@id, @device_id, @created_at, @counter, @number, @service, @table_no, @guests, @customer, @phone, @address, @opened_at, @staff_id)`
      )
      .run({
        ...row,
        number,
        service: input.service,
        table_no: input.service === "dine_in" ? input.tableNo : null,
        guests: input.guests ?? null,
        customer: blank(input.customer),
        phone: blank(input.phone),
        address: blank(input.address),
        opened_at: now.toISOString(),
        staff_id: input.staffId ?? null,
      });
    return row.id;
  });
  return write();
}

function mustBeOpen(database: Database.Database, orderId: string): void {
  const row = database.prepare("select status from orders where id = ?").get(orderId) as { status: string } | undefined;
  if (!row) throw new Error("no such order");
  if (row.status !== "open") throw new Error("order closed");
}

/*
 * One more of something. The same dish with the same note, not yet sent, is
 * one line with a larger quantity; once sent it is a new line, because the
 * kitchen has already made the first.
 */
export function addToOrder(
  database: Database.Database,
  deviceId: string,
  input: { orderId: string; productId: string; quantity?: number; note?: string | null }
): void {
  const write = database.transaction(() => {
    mustBeOpen(database, input.orderId);
    const quantity = input.quantity ?? 1;
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("a quantity is more than zero");
    const note = blank(input.note);
    const same = database
      .prepare(
        `select id from order_lines where order_id = ? and product_id = ? and sent_at is null and cancelled_at is null
           and coalesce(note, '') = coalesce(?, '')`
      )
      .get(input.orderId, input.productId, note) as { id: string } | undefined;
    if (same) {
      database.prepare("update order_lines set quantity = quantity + ? where id = ?").run(quantity, same.id);
      return;
    }
    const product = database.prepare("select sale_price from products where id = ?").get(input.productId) as
      | { sale_price: number }
      | undefined;
    if (!product) throw new Error("no such product");
    const row = stamp(database, deviceId);
    database
      .prepare(
        `insert into order_lines (id, device_id, created_at, counter, order_id, product_id, quantity, unit_price, note)
         values (@id, @device_id, @created_at, @counter, @order_id, @product_id, @quantity, @unit_price, @note)`
      )
      .run({ ...row, order_id: input.orderId, product_id: input.productId, quantity, unit_price: product.sale_price, note });
  });
  write();
}

/* A line's quantity changed; at zero it is taken off, and kept as taken off. */
export function changeOrderLine(
  database: Database.Database,
  deviceId: string,
  lineId: string,
  quantity: number,
  staffId: string | null = null
): void {
  const write = database.transaction(() => {
    const line = database.prepare("select order_id, sent_at, quantity from order_lines where id = ?").get(lineId) as
      | { order_id: string; sent_at: string | null; quantity: number }
      | undefined;
    if (!line) throw new Error("no such line");
    mustBeOpen(database, line.order_id);
    if (quantity <= 0) {
      database.prepare("update order_lines set cancelled_at = ? where id = ?").run(new Date().toISOString(), lineId);
      if (line.sent_at) {
        audit(database, deviceId, { staffId, subject: "order", subjectId: line.order_id, action: "line_cancelled_after_kitchen", detail: { lineId } });
      }
      return;
    }
    database.prepare("update order_lines set quantity = ? where id = ?").run(quantity, lineId);
  });
  write();
}

/* What the kitchen has not seen yet, marked as sent, for its ticket. */
export function sendToKitchen(database: Database.Database, orderId: string, now = new Date()): OrderLine[] {
  const write = database.transaction(() => {
    mustBeOpen(database, orderId);
    const detail = getOrder(database, orderId);
    const unsent = (detail?.lines ?? []).filter((line) => !line.sentAt && !line.cancelledAt);
    const at = now.toISOString();
    database.prepare("update order_lines set sent_at = ? where order_id = ? and sent_at is null and cancelled_at is null").run(at, orderId);
    return unsent.map((line) => ({ ...line, sentAt: at }));
  });
  return write();
}

export function moveOrder(database: Database.Database, orderId: string, tableNo: number): void {
  const write = database.transaction(() => {
    mustBeOpen(database, orderId);
    const taken = database
      .prepare("select id from orders where status = 'open' and service = 'dine_in' and table_no = ? and id != ?")
      .get(tableNo, orderId);
    if (taken) throw new Error("table taken");
    database.prepare("update orders set table_no = ?, service = 'dine_in' where id = ?").run(tableNo, orderId);
  });
  write();
}

/*
 * The bill, paid. The sale is written from the order's own lines, so what
 * the table ate is exactly what the receipt and the reports say.
 */
export function payOrder(
  database: Database.Database,
  deviceId: string,
  orderId: string,
  payment: Omit<NewSale, "lines" | "reference">,
  now = new Date()
): RecordedSale {
  const write = database.transaction(() => {
    mustBeOpen(database, orderId);
    const detail = getOrder(database, orderId);
    const lines = (detail?.lines ?? []).filter((line) => !line.cancelledAt);
    if (lines.length === 0) throw new Error("nothing to pay");
    const sale = recordSale(
      database,
      deviceId,
      {
        ...payment,
        reference: orderId,
        lines: lines.map((line) => ({ productId: line.productId, quantity: line.quantity, unitPrice: line.unitPrice })),
      },
      now
    );
    database
      .prepare("update orders set status = 'paid', closed_at = ?, sale_id = ? where id = ?")
      .run(now.toISOString(), sale.id, orderId);
    return sale;
  });
  return write();
}

export function cancelOrder(
  database: Database.Database,
  deviceId: string,
  orderId: string,
  reason: string,
  staffId: string | null = null
): void {
  const why = reason.trim();
  if (!why) throw new Error("a cancellation needs its reason");
  const write = database.transaction(() => {
    mustBeOpen(database, orderId);
    database
      .prepare("update orders set status = 'cancelled', closed_at = ?, note = ? where id = ?")
      .run(new Date().toISOString(), why, orderId);
    audit(database, deviceId, { staffId, subject: "order", subjectId: orderId, action: "cancelled", detail: { reason: why } });
  });
  write();
}
