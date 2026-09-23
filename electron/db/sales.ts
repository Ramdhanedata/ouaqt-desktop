import type Database from "better-sqlite3";
import { audit } from "./audit";
import { balanceOf } from "./customers";
import { allocate, recordMovement } from "./products";
import { stamp } from "./rows";
import { clock } from "./clock";

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

/*
 * A line is a product from the shelf, or a service: a night in a room, a
 * seat on a bus, a parcel's fee. A service has a label instead of a product
 * and moves no stock.
 */
export type SaleLine = {
  productId?: string | null;
  label?: string | null;
  kind?: "product" | "service" | "room" | "ticket" | "parcel";
  reference?: string | null;
  quantity: number;
  unitPrice: number;
  batchId?: string | null;
};

export type Payment = "cash" | "credit" | "mobile";

export type NewSale = {
  lines: SaleLine[];
  payment: Payment;
  customerId?: string | null;
  staffId?: string | null;
  /** Taken off the whole ticket, in minor units. Never more than the ticket. */
  discount?: number;
  /** Which app, for a mobile payment: Bankily, Masrvi, Sedad... */
  mobileApp?: string | null;
  /** What the customer handed over in cash, for the change on the receipt. */
  received?: number | null;
  /** Part of the total already received: a deposit, an advance. */
  prepaid?: number;
  /** The record this sale settles: a table's order, a stay, a preorder. */
  reference?: string | null;
  /** The warehouse place the goods leave from, where there are several. */
  locationId?: string | null;
  /*
   * The pharmacist was warned that part of this ticket is past its expiry
   * date and chose to sell it. Only then are expired batches taken, and each
   * line that took from one is marked.
   */
  pastExpiry?: boolean;
};

export type RecordedSale = { id: string; number: number; total: number; change: number | null };

export class SaleRefused extends Error {
  constructor(readonly code: "no_lines" | "no_customer" | "credit_limit" | "bad_discount" | "bad_line") {
    super(code);
  }
}

function nextNumber(database: Database.Database): number {
  const row = database.prepare("select coalesce(max(number), 0) as last from sales").get() as { last: number };
  return row.last + 1;
}

export function recordSale(database: Database.Database, deviceId: string, sale: NewSale, now = clock()): RecordedSale {
  if (sale.lines.length === 0) throw new SaleRefused("no_lines");
  if (sale.payment === "credit" && !sale.customerId) throw new SaleRefused("no_customer");
  for (const line of sale.lines) {
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) throw new SaleRefused("bad_line");
    if (!Number.isInteger(line.unitPrice) || line.unitPrice < 0) throw new SaleRefused("bad_line");
    if (!line.productId && !(line.label ?? "").trim()) throw new SaleRefused("bad_line");
  }

  /*
   * Line totals are rounded to the smallest unit here and nowhere else, so
   * the total is exactly the sum of what the receipt prints.
   */
  const lines = sale.lines.map((line) => ({ ...line, lineTotal: Math.round(line.quantity * line.unitPrice) }));
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const discount = sale.discount ?? 0;
  if (!Number.isInteger(discount) || discount < 0 || discount > subtotal) throw new SaleRefused("bad_discount");
  const total = subtotal - discount;
  const prepaid = sale.prepaid ?? 0;
  if (!Number.isInteger(prepaid) || prepaid < 0 || prepaid > total) throw new SaleRefused("bad_discount");
  /* What is still to pay at the counter, which the change is worked out from. */
  const due = total - prepaid;

  const received = sale.payment === "cash" && typeof sale.received === "number" && sale.received >= due ? sale.received : null;

  const write = database.transaction((): RecordedSale => {
    if (sale.payment === "credit" && sale.customerId) {
      const customer = database
        .prepare("select credit_limit from customers where id = ?")
        .get(sale.customerId) as { credit_limit: number | null } | undefined;
      if (!customer) throw new SaleRefused("no_customer");
      if (customer.credit_limit !== null && balanceOf(database, sale.customerId) + due > customer.credit_limit) {
        throw new SaleRefused("credit_limit");
      }
    }

    const head = stamp(database, deviceId);
    const number = nextNumber(database);
    const at = now.toISOString();

    database
      .prepare(
        `insert into sales
           (id, device_id, created_at, counter, number, occurred_at, staff_id,
            total, payment, customer_id, discount, mobile_app, received, prepaid, reference)
         values (@id, @device_id, @created_at, @counter, @number, @occurred_at,
                 @staff_id, @total, @payment, @customer_id, @discount, @mobile_app, @received,
                 @prepaid, @reference)`
      )
      .run({
        ...head,
        number,
        occurred_at: at,
        staff_id: sale.staffId ?? null,
        total,
        payment: sale.payment,
        customer_id: sale.customerId ?? null,
        discount,
        mobile_app: sale.payment === "mobile" ? (sale.mobileApp ?? "").trim() || null : null,
        received,
        prepaid,
        reference: sale.reference ?? null,
      });

    for (const line of lines) {
      /*
       * The batch that expires first goes first. One line on the receipt can
       * take from two batches when the first runs out; the stock moves per
       * batch so each one's remainder stays right.
       */
      /* A service, or a product nobody counts on a shelf, moves no stock. */
      const tracked =
        line.productId &&
        (database.prepare("select tracked from products where id = ?").get(line.productId) as { tracked: number } | undefined)
          ?.tracked === 1;
      const parts = !tracked
        ? []
        : line.batchId
          ? [{ batchId: line.batchId, quantity: line.quantity }]
          : allocate(database, line.productId as string, line.quantity, now, { pastExpiry: sale.pastExpiry });
      const expiredParts = parts.filter((part) => part.expired);

      const row = stamp(database, deviceId);
      database
        .prepare(
          `insert into sale_lines
             (id, device_id, created_at, counter, sale_id, product_id, quantity,
              unit_price, line_total, batch_id, label, kind, reference, past_expiry)
           values (@id, @device_id, @created_at, @counter, @sale_id, @product_id,
                   @quantity, @unit_price, @line_total, @batch_id, @label, @kind, @reference, @past_expiry)`
        )
        .run({
          ...row,
          sale_id: head.id,
          product_id: line.productId ?? null,
          quantity: line.quantity,
          unit_price: line.unitPrice,
          line_total: line.lineTotal,
          batch_id: parts[0]?.batchId ?? null,
          label: (line.label ?? "").trim() || null,
          kind: line.kind ?? (line.productId ? "product" : "service"),
          reference: line.reference ?? null,
          past_expiry: expiredParts.length > 0 ? 1 : 0,
        });

      for (const part of expiredParts) {
        audit(database, deviceId, {
          staffId: sale.staffId ?? null,
          subject: "sale",
          subjectId: head.id,
          action: "sold_past_expiry",
          detail: { productId: line.productId, quantity: part.quantity, lot: part.expired?.lot ?? null, expiresOn: part.expired?.expiresOn },
        });
      }

      for (const part of parts) {
        recordMovement(database, deviceId, {
          productId: line.productId as string,
          quantity: -part.quantity,
          reason: "sale",
          reference: head.id,
          staffId: sale.staffId ?? null,
          occurredAt: at,
          batchId: part.batchId,
          locationId: sale.locationId ?? null,
        });
      }
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
          amount: due,
          staff_id: sale.staffId ?? null,
          occurred_at: at,
        });
    }

    return { id: head.id, number, total, change: received === null ? null : received - due };
  });

  return write();
}

/*
 * A sale is never edited and never deleted. Voiding writes a second sale that
 * reverses the first, with the reason and the person who did it, and puts the
 * stock back into the very batches it came out of.
 */
export function voidSale(
  database: Database.Database,
  deviceId: string,
  saleId: string,
  reason: string,
  staffId: string | null
): string {
  const why = reason.trim();
  if (!why) throw new Error("a void needs its reason");

  const write = database.transaction((): string => {
    const original = database
      .prepare("select id, number, total, payment, customer_id, status, reverses_id, mobile_app, prepaid, reference from sales where id = ?")
      .get(saleId) as
      | {
          id: string;
          number: number;
          total: number;
          payment: string;
          customer_id: string | null;
          status: string;
          reverses_id: string | null;
          mobile_app: string | null;
          prepaid: number;
          reference: string | null;
        }
      | undefined;

    if (!original) throw new Error("no such sale");
    if (original.status === "voided") throw new Error("already voided");
    if (original.reverses_id) throw new Error("a reversal is not voided");

    const head = stamp(database, deviceId);
    database
      .prepare(
        `insert into sales
           (id, device_id, created_at, counter, number, occurred_at, staff_id,
            total, payment, customer_id, status, reverses_id, void_reason, mobile_app, prepaid, reference)
         values (@id, @device_id, @created_at, @counter, @number, @occurred_at,
                 @staff_id, @total, @payment, @customer_id, 'recorded', @reverses_id,
                 @void_reason, @mobile_app, @prepaid, @reference)`
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
        void_reason: why,
        mobile_app: original.mobile_app,
        /* The advance was not handed back by this void; the drawer math cancels. */
        prepaid: -original.prepaid,
        reference: original.reference,
      });

    database.prepare("update sales set status = 'voided' where id = ?").run(saleId);

    const taken = database
      .prepare("select product_id, quantity, batch_id, location_id from stock_movements where reference = ? and reason = 'sale'")
      .all(saleId) as { product_id: string; quantity: number; batch_id: string | null; location_id: string | null }[];

    for (const movement of taken) {
      recordMovement(database, deviceId, {
        productId: movement.product_id,
        quantity: -movement.quantity,
        reason: "return",
        reference: head.id,
        staffId,
        occurredAt: head.created_at,
        batchId: movement.batch_id,
        locationId: movement.location_id,
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
          amount: -(original.total - original.prepaid),
          staff_id: staffId,
          occurred_at: head.created_at,
        });
    }

    audit(database, deviceId, {
      staffId,
      subject: "sale",
      subjectId: saleId,
      action: "voided",
      detail: { number: original.number, total: original.total, reason: why },
    });

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
  mobileApp: string | null;
  customerName: string | null;
  /** Set on a reversal: the number of the sale it cancels. */
  reversesNumber: number | null;
  voidReason: string | null;
  lines: number;
};

const SUMMARY = `
  select s.id, s.number, s.occurred_at, s.total, s.payment, s.status, s.mobile_app,
         s.void_reason, c.name as customer_name,
         (select o.number from sales o where o.id = s.reverses_id) as reverses_number,
         (select count(*) from sale_lines l where l.sale_id = s.id) as lines
    from sales s
    left join customers c on c.id = s.customer_id
`;

type SummaryRow = {
  id: string;
  number: number;
  occurred_at: string;
  total: number;
  payment: string;
  status: string;
  mobile_app: string | null;
  void_reason: string | null;
  customer_name: string | null;
  reverses_number: number | null;
  lines: number;
};

function toSummary(row: SummaryRow): SaleSummary {
  return {
    id: row.id,
    number: row.number,
    occurredAt: row.occurred_at,
    total: row.total,
    payment: row.payment,
    status: row.status,
    mobileApp: row.mobile_app,
    customerName: row.customer_name,
    reversesNumber: row.reverses_number,
    voidReason: row.void_reason,
    lines: row.lines,
  };
}

export function recentSales(database: Database.Database, limit = 50): SaleSummary[] {
  const rows = database.prepare(`${SUMMARY} order by s.occurred_at desc, s.number desc limit ?`).all(limit) as SummaryRow[];
  return rows.map(toSummary);
}

export function salesBetween(database: Database.Database, from: string, to: string, limit = 1000): SaleSummary[] {
  const rows = database
    .prepare(`${SUMMARY} where s.occurred_at >= ? and s.occurred_at < ? order by s.occurred_at desc, s.number desc limit ?`)
    .all(from, to, limit) as SummaryRow[];
  return rows.map(toSummary);
}

export type SaleDetail = SaleSummary & {
  discount: number;
  received: number | null;
  prepaid: number;
  subtotal: number;
  items: { productId: string; name: string; nameArabic: string | null; quantity: number; unitPrice: number; lineTotal: number; lot: string | null; expiresOn: string | null }[];
};

export function saleDetail(database: Database.Database, id: string): SaleDetail | null {
  const row = database.prepare(`${SUMMARY} where s.id = ?`).get(id) as SummaryRow | undefined;
  if (!row) return null;
  const extra = database.prepare("select discount, received, reverses_id, prepaid from sales where id = ?").get(id) as {
    discount: number;
    received: number | null;
    reverses_id: string | null;
    prepaid: number;
  };
  /* A reversal prints the lines of the sale it cancels. */
  const linesOf = extra.reverses_id ?? id;
  const items = database
    .prepare(
      `select coalesce(l.product_id, '') as product_id, coalesce(p.name, l.label, '') as name, p.name_arabic,
              l.quantity, l.unit_price, l.line_total, b.lot, b.expires_on
         from sale_lines l
         left join products p on p.id = l.product_id
         left join batches b on b.id = l.batch_id
        where l.sale_id = ?
        order by l.counter`
    )
    .all(linesOf) as {
    product_id: string;
    name: string;
    name_arabic: string | null;
    quantity: number;
    unit_price: number;
    line_total: number;
    lot: string | null;
    expires_on: string | null;
  }[];
  const subtotal = items.reduce((sum, item) => sum + item.line_total, 0);
  return {
    ...toSummary(row),
    discount: extra.discount,
    received: extra.received,
    prepaid: extra.prepaid,
    subtotal,
    items: items.map((item) => ({
      productId: item.product_id,
      name: item.name,
      nameArabic: item.name_arabic,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      lineTotal: item.line_total,
      lot: item.lot,
      expiresOn: item.expires_on,
    })),
  };
}

/*
 * What the till should hold from sales since a moment: every cash sale and
 * every cash reversal, whatever its status. A sale voided later still
 * brought its cash in, and its reversal took it back out, so the two cancel
 * without either being left out.
 */
export function cashTakenSince(database: Database.Database, since: string, until?: string): number {
  /* Less what was received beforehand, which the drawer counted when it came in. */
  const row = database
    .prepare(
      `select coalesce(sum(total - prepaid), 0) as total from sales
        where payment = 'cash' and occurred_at >= ? and occurred_at < ?`
    )
    .get(since, until ?? "9999") as { total: number };
  return row.total;
}
