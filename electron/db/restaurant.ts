import type Database from "better-sqlite3";
import { audit } from "./audit";
import { stamp } from "./rows";
import { recordSale, voidSale, type NewSale, type RecordedSale } from "./sales";
import { clock } from "./clock";

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
  /** A debt account the order will be charged to, chosen before it is paid. */
  customerId: string | null;
  employee: string | null;
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
  customer_id: string | null;
  employee: string | null;
};

const ORDER = `
  select o.id, o.number, o.service, o.table_no, o.guests, o.customer, o.phone, o.address, o.status, o.opened_at,
         o.customer_id, o.employee,
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
    customerId: row.customer_id,
    employee: row.employee,
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
  now = clock()
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
export function sendToKitchen(database: Database.Database, orderId: string, now = clock()): OrderLine[] {
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
  now = clock()
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

/*
 * What the counter changes on an order before it is paid: the way it is
 * served, the table, the debt account it goes on and the employee's name.
 */
export function updateOrder(
  database: Database.Database,
  orderId: string,
  input: { service?: Service; tableNo?: number | null; customerId?: string | null; employee?: string | null }
): void {
  const write = database.transaction(() => {
    mustBeOpen(database, orderId);
    const current = database.prepare("select service, table_no from orders where id = ?").get(orderId) as { service: Service; table_no: number | null };
    const service = input.service ?? current.service;
    const tableNo = service === "dine_in" ? (input.tableNo !== undefined ? input.tableNo : current.table_no) : null;
    if (tableNo !== null && tableNo !== undefined) {
      const taken = database
        .prepare("select id from orders where status = 'open' and service = 'dine_in' and table_no = ? and id <> ?")
        .get(tableNo, orderId) as { id: string } | undefined;
      if (taken) throw new Error("table taken");
    }
    database.prepare("update orders set service = ?, table_no = ? where id = ?").run(service, tableNo ?? null, orderId);
    if (input.customerId !== undefined) {
      if (input.customerId && !database.prepare("select 1 from customers where id = ?").get(input.customerId)) throw new Error("no such customer");
      database.prepare("update orders set customer_id = ?, employee = case when ? is null then null else employee end where id = ?").run(input.customerId, input.customerId, orderId);
    }
    if (input.employee !== undefined) {
      database.prepare("update orders set employee = ? where id = ?").run(blank(input.employee)?.slice(0, 80) ?? null, orderId);
    }
  });
  write();
}

/* The cook's note on one line: no sugar, well done. */
export function setLineNote(database: Database.Database, lineId: string, note: string | null): void {
  const line = database.prepare("select order_id from order_lines where id = ?").get(lineId) as { order_id: string } | undefined;
  if (!line) throw new Error("no such line");
  mustBeOpen(database, line.order_id);
  database.prepare("update order_lines set note = ? where id = ?").run(blank(note)?.slice(0, 120) ?? null, lineId);
}

/*
 * A paid order taken back to the counter to be changed: the sale is voided
 * with its reason, and a new open order holds the same lines, the same way
 * of serving and the same account, ready to be corrected and paid again.
 */
export function reopenSale(
  database: Database.Database,
  deviceId: string,
  saleId: string,
  reason: string,
  staffId: string | null = null,
  now = clock()
): string {
  const write = database.transaction((): string => {
    const sale = database.prepare("select reference, customer_id, employee from sales where id = ?").get(saleId) as
      | { reference: string | null; customer_id: string | null; employee: string | null }
      | undefined;
    if (!sale) throw new Error("no such sale");
    const order = sale.reference
      ? (database.prepare("select id, service, table_no, customer, phone, address from orders where id = ?").get(sale.reference) as
          | { id: string; service: Service; table_no: number | null; customer: string | null; phone: string | null; address: string | null }
          | undefined)
      : undefined;
    voidSale(database, deviceId, saleId, reason, staffId);
    const table = order?.service === "dine_in" && order.table_no
      ? (database.prepare("select id from orders where status = 'open' and service = 'dine_in' and table_no = ?").get(order.table_no) as { id: string } | undefined)
      : undefined;
    const id = startOrder(
      database,
      deviceId,
      {
        service: table ? "takeaway" : (order?.service ?? "takeaway"),
        tableNo: table ? null : order?.table_no ?? null,
        customer: order?.customer ?? null,
        phone: order?.phone ?? null,
        address: order?.address ?? null,
        staffId,
      },
      now
    );
    if (sale.customer_id) {
      database.prepare("update orders set customer_id = ?, employee = ? where id = ?").run(sale.customer_id, sale.employee, id);
    }
    const lines = order
      ? (database
          .prepare("select product_id, quantity, unit_price, note from order_lines where order_id = ? and cancelled_at is null order by counter")
          .all(order.id) as { product_id: string; quantity: number; unit_price: number; note: string | null }[])
      : (database
          .prepare("select product_id, quantity, unit_price, null as note from sale_lines where sale_id = ? and product_id is not null order by counter")
          .all(saleId) as { product_id: string; quantity: number; unit_price: number; note: string | null }[]);
    for (const line of lines) {
      const row = stamp(database, deviceId);
      database
        .prepare(
          `insert into order_lines (id, device_id, created_at, counter, order_id, product_id, quantity, unit_price, note)
           values (@id, @device_id, @created_at, @counter, @order_id, @product_id, @quantity, @unit_price, @note)`
        )
        .run({ ...row, order_id: id, product_id: line.product_id, quantity: line.quantity, unit_price: line.unit_price, note: line.note });
    }
    return id;
  });
  return write();
}

