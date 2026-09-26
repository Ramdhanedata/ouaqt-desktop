import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { audit } from "./audit";
import { recordMovement } from "./products";
import { stamp } from "./rows";
import { recordSale, type Payment } from "./sales";
import { clock } from "./clock";

/*
 * A warehouse: goods kept in several places, coming in, moving between the
 * places, and leaving on a delivery note to a customer, one of the owner's
 * own shops or a site.
 *
 * Every figure is still a sum of movements. What a place holds is the sum of
 * the movements that name it; a movement that names no place belongs to the
 * first one, which is how a shop that started with a single store room keeps
 * its history when it opens a second.
 */

export type Location = { id: string; name: string };

export function listLocations(database: Database.Database): Location[] {
  return database
    .prepare("select id, name from locations where archived_at is null order by created_at, counter")
    .all() as Location[];
}

/* The first place, made when there is none, so a warehouse always has one. */
export function ensureLocations(database: Database.Database, deviceId: string, names: string[]): Location[] {
  const existing = listLocations(database);
  if (existing.length > 0) return existing;
  const write = database.transaction(() => {
    for (const name of names) {
      const row = stamp(database, deviceId);
      database
        .prepare("insert into locations (id, device_id, created_at, counter, name) values (@id, @device_id, @created_at, @counter, @name)")
        .run({ ...row, name });
    }
  });
  write();
  return listLocations(database);
}

export function addLocation(database: Database.Database, deviceId: string, name: string): string {
  const clean = name.trim();
  if (!clean) throw new Error("a place needs a name");
  const row = stamp(database, deviceId);
  database
    .prepare("insert into locations (id, device_id, created_at, counter, name) values (@id, @device_id, @created_at, @counter, @name)")
    .run({ ...row, name: clean });
  return row.id;
}

export function renameLocation(database: Database.Database, id: string, name: string): void {
  const clean = name.trim();
  if (!clean) throw new Error("a place needs a name");
  database.prepare("update locations set name = ? where id = ?").run(clean, id);
}

/* For every product, what each place holds. */
export function stockByLocation(database: Database.Database): { productId: string; locationId: string; quantity: number }[] {
  const first = listLocations(database)[0]?.id ?? null;
  const rows = database
    .prepare(
      `select product_id, location_id, sum(quantity) as quantity from stock_movements
        group by product_id, location_id`
    )
    .all() as { product_id: string; location_id: string | null; quantity: number }[];
  const merged = new Map<string, { productId: string; locationId: string; quantity: number }>();
  for (const row of rows) {
    const locationId = row.location_id ?? first ?? "";
    const key = `${row.product_id}|${locationId}`;
    const current = merged.get(key);
    if (current) current.quantity += row.quantity;
    else merged.set(key, { productId: row.product_id, locationId, quantity: row.quantity });
  }
  return [...merged.values()];
}

export function heldAt(database: Database.Database, productId: string, locationId: string): number {
  return stockByLocation(database).find((row) => row.productId === productId && row.locationId === locationId)?.quantity ?? 0;
}

/* From one place to another: two movements with the same reference. */
export function transfer(
  database: Database.Database,
  deviceId: string,
  input: { productId: string; quantity: number; from: string; to: string; note?: string | null; staffId?: string | null }
): string {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) throw new Error("a transfer moves something");
  if (input.from === input.to) throw new Error("a transfer goes somewhere else");
  const write = database.transaction(() => {
    const reference = randomUUID();
    recordMovement(database, deviceId, { productId: input.productId, quantity: -input.quantity, reason: "transfer", reference, locationId: input.from, staffId: input.staffId ?? null });
    recordMovement(database, deviceId, { productId: input.productId, quantity: input.quantity, reason: "transfer", reference, locationId: input.to, staffId: input.staffId ?? null });
    audit(database, deviceId, {
      staffId: input.staffId ?? null,
      subject: "product",
      subjectId: input.productId,
      action: "transferred",
      detail: { quantity: input.quantity, from: input.from, to: input.to, note: (input.note ?? "").trim() || null },
    });
    return reference;
  });
  return write();
}

export type Destination = "customers" | "my_shops" | "sites";

export type DispatchInput = {
  destination: Destination;
  recipient: string;
  locationId: string | null;
  lines: { productId: string; quantity: number; unitPrice?: number }[];
  /** Sold to the recipient, rather than only sent. */
  sell?: { payment: Payment; customerId?: string | null; mobileApp?: string | null };
  note?: string | null;
  staffId?: string | null;
};

/*
 * Goods leaving, on a numbered note. Sent to one of the owner's own shops or
 * to a site, it is a movement out and nothing more. Sold, it is a sale, from
 * that place, and the note carries the sale's number too.
 */
export function dispatch(database: Database.Database, deviceId: string, input: DispatchInput, now = clock()): { id: string; number: number; saleId: string | null } {
  const recipient = input.recipient.trim();
  if (!recipient) throw new Error("a note needs who it goes to");
  if (input.lines.length === 0) throw new Error("a note needs something on it");
  const write = database.transaction(() => {
    const row = stamp(database, deviceId);
    const number = (database.prepare("select coalesce(max(number), 0) + 1 as n from dispatches").get() as { n: number }).n;
    let saleId: string | null = null;
    if (input.sell) {
      const sale = recordSale(
        database,
        deviceId,
        {
          payment: input.sell.payment,
          customerId: input.sell.customerId ?? null,
          mobileApp: input.sell.mobileApp ?? null,
          reference: row.id,
          locationId: input.locationId,
          lines: input.lines.map((line) => ({ productId: line.productId, quantity: line.quantity, unitPrice: line.unitPrice ?? 0 })),
        },
        now
      );
      saleId = sale.id;
    } else {
      for (const line of input.lines) {
        if (!Number.isFinite(line.quantity) || line.quantity <= 0) throw new Error("a line moves something");
        recordMovement(database, deviceId, {
          productId: line.productId,
          quantity: -line.quantity,
          reason: "dispatch",
          reference: row.id,
          locationId: input.locationId,
          staffId: input.staffId ?? null,
          occurredAt: now.toISOString(),
        });
      }
    }
    database
      .prepare(
        `insert into dispatches (id, device_id, created_at, counter, number, occurred_at, destination, recipient, location_id, sale_id, note, staff_id)
         values (@id, @device_id, @created_at, @counter, @number, @occurred_at, @destination, @recipient, @location_id, @sale_id, @note, @staff_id)`
      )
      .run({
        ...row,
        number,
        occurred_at: now.toISOString(),
        destination: input.destination,
        recipient,
        location_id: input.locationId,
        sale_id: saleId,
        note: (input.note ?? "").trim() || null,
        staff_id: input.staffId ?? null,
      });
    audit(database, deviceId, { staffId: input.staffId ?? null, subject: "dispatch", subjectId: row.id, action: "sent", detail: { number, recipient, sold: Boolean(saleId) } });
    return { id: row.id, number, saleId };
  });
  return write();
}

export type Dispatch = {
  id: string;
  number: number;
  occurredAt: string;
  destination: Destination;
  recipient: string;
  locationName: string | null;
  saleNumber: number | null;
  total: number | null;
  note: string | null;
  lines: { productId: string; name: string; unit: string | null; quantity: number; unitPrice: number | null }[];
};

export function dispatchesBetween(database: Database.Database, from: string, to: string): Dispatch[] {
  const rows = database
    .prepare(
      `select d.*, l.name as location_name, s.number as sale_number, s.total as sale_total
         from dispatches d
         left join locations l on l.id = d.location_id
         left join sales s on s.id = d.sale_id
        where d.occurred_at >= ? and d.occurred_at < ?
        order by d.occurred_at desc`
    )
    .all(from, to) as {
    id: string;
    number: number;
    occurred_at: string;
    destination: Destination;
    recipient: string;
    location_name: string | null;
    sale_id: string | null;
    sale_number: number | null;
    sale_total: number | null;
    note: string | null;
  }[];
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    occurredAt: row.occurred_at,
    destination: row.destination,
    recipient: row.recipient,
    locationName: row.location_name,
    saleNumber: row.sale_number,
    total: row.sale_total,
    note: row.note,
    lines: row.sale_id
      ? (
          database
            .prepare(
              `select l.product_id, p.name, p.unit, l.quantity, l.unit_price from sale_lines l join products p on p.id = l.product_id
                where l.sale_id = ? order by l.counter`
            )
            .all(row.sale_id) as { product_id: string; name: string; unit: string | null; quantity: number; unit_price: number }[]
        ).map((line) => ({ productId: line.product_id, name: line.name, unit: line.unit, quantity: line.quantity, unitPrice: line.unit_price }))
      : (
          database
            .prepare(
              `select m.product_id, p.name, p.unit, -m.quantity as quantity from stock_movements m join products p on p.id = m.product_id
                where m.reference = ? and m.reason = 'dispatch' order by m.counter`
            )
            .all(row.id) as { product_id: string; name: string; unit: string | null; quantity: number }[]
        ).map((line) => ({ productId: line.product_id, name: line.name, unit: line.unit, quantity: line.quantity, unitPrice: null })),
  }));
}

/* What came in and went out over a period, per product: the warehouse's own report. */
/*
 * Every movement of a period, one line each, newest first: the day's
 * journal a storekeeper reads beside the form he fills. Sales are left out,
 * since the till has its own list; what is here is what came in, went out,
 * moved between places or was corrected.
 */
export type JournalLine = {
  id: string;
  at: string;
  name: string;
  unit: string | null;
  quantity: number;
  reason: string;
  place: string | null;
};

export function journalBetween(database: Database.Database, from: string, to: string, limit = 60): JournalLine[] {
  return database
    .prepare(
      `select m.id, m.occurred_at as at, p.name, p.unit, m.quantity, m.reason, l.name as place
         from stock_movements m
         join products p on p.id = m.product_id
         left join locations l on l.id = m.location_id
        where m.occurred_at >= ? and m.occurred_at < ? and m.reason <> 'sale'
        order by m.occurred_at desc, m.counter desc
        limit ?`
    )
    .all(from, to, limit) as JournalLine[];
}

export function flowsBetween(
  database: Database.Database,
  from: string,
  to: string
): { productId: string; name: string; unit: string | null; received: number; sent: number; sold: number; adjusted: number }[] {
  const rows = database
    .prepare(
      `select p.id, p.name, p.unit,
              coalesce(sum(case when m.reason = 'reception' then m.quantity end), 0) as received,
              coalesce(-sum(case when m.reason = 'dispatch' then m.quantity end), 0) as sent,
              coalesce(-sum(case when m.reason = 'sale' then m.quantity end), 0) - coalesce(sum(case when m.reason = 'return' then m.quantity end), 0) as sold,
              coalesce(sum(case when m.reason in ('adjustment', 'expiry', 'loss') then m.quantity end), 0) as adjusted
         from stock_movements m join products p on p.id = m.product_id
        where m.occurred_at >= ? and m.occurred_at < ?
        group by p.id
        order by p.name collate nocase`
    )
    .all(from, to) as { id: string; name: string; unit: string | null; received: number; sent: number; sold: number; adjusted: number }[];
  return rows.map((row) => ({ productId: row.id, name: row.name, unit: row.unit, received: row.received, sent: row.sent, sold: row.sold, adjusted: row.adjusted }));
}
