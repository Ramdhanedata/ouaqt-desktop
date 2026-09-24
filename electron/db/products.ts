import type Database from "better-sqlite3";
import { audit } from "./audit";
import { stamp } from "./rows";
import { clock } from "./clock";

/*
 * Products, and how much of each is on hand.
 *
 * The quantity is never stored. It is the sum of the movements, worked out
 * when it is asked for, which is what makes it explicable: when a figure
 * surprises the owner there is a row behind every part of it.
 *
 * A pharmacy receives the same medicine several times, with several expiry
 * dates, so what is on hand is also split by batch. A batch's remainder is
 * the sum of the movements that name it, and a sale takes from the batch that
 * expires first.
 */

export type Product = {
  id: string;
  name: string;
  nameArabic: string | null;
  genericName: string | null;
  category: string | null;
  barcode: string | null;
  unit: string | null;
  salePrice: number;
  costPrice: number | null;
  lowStock: number | null;
  extra: Record<string, unknown>;
  onHand: number;
  /** The earliest expiry among the batches that still have stock, YYYY-MM-DD. */
  nextExpiry: string | null;
  /** False for a menu item or a service: sold, never counted on a shelf. */
  tracked: boolean;
};

type Row = {
  id: string;
  name: string;
  name_arabic: string | null;
  generic_name: string | null;
  category: string | null;
  barcode: string | null;
  unit: string | null;
  sale_price: number;
  cost_price: number | null;
  low_stock: number | null;
  extra: string | null;
  on_hand: number | null;
  next_expiry: string | null;
  tracked: number;
};

function toProduct(row: Row): Product {
  return {
    id: row.id,
    name: row.name,
    nameArabic: row.name_arabic,
    genericName: row.generic_name,
    category: row.category,
    barcode: row.barcode,
    unit: row.unit,
    salePrice: row.sale_price,
    costPrice: row.cost_price,
    lowStock: row.low_stock,
    extra: row.extra ? (JSON.parse(row.extra) as Record<string, unknown>) : {},
    onHand: row.on_hand ?? 0,
    nextExpiry: row.next_expiry,
    tracked: row.tracked === 1,
  };
}

const REMAINING = `(select coalesce(sum(m.quantity), 0) from stock_movements m where m.batch_id = b.id)`;

const SELECT = `
  select p.id, p.name, p.name_arabic, p.generic_name, p.category, p.barcode,
         p.unit, p.sale_price, p.cost_price, p.low_stock, p.extra, p.tracked,
         (select coalesce(sum(m.quantity), 0) from stock_movements m
           where m.product_id = p.id) as on_hand,
         (select min(b.expires_on) from batches b
           where b.product_id = p.id and b.expires_on is not null
             and ${REMAINING} > 0) as next_expiry
    from products p
   where p.archived_at is null
`;

export function listProducts(database: Database.Database): Product[] {
  const rows = database.prepare(`${SELECT} order by p.name collate nocase`).all() as Row[];
  return rows.map(toProduct);
}

export function getProduct(database: Database.Database, id: string): Product | null {
  const row = database.prepare(`${SELECT} and p.id = ?`).get(id) as Row | undefined;
  return row ? toProduct(row) : null;
}

/*
 * What somebody typed, as an FTS query: every word must match the start of a
 * word in one of the names. Each word is quoted, so a letter FTS reads as an
 * operator (a hyphen, a star, a quote) is only ever a letter.
 */
export function searchQuery(term: string): string | null {
  const words = term
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/"/g, ""))
    .filter((word) => word.length > 0);
  if (words.length === 0) return null;
  return words.map((word) => `"${word}"*`).join(" ");
}

/*
 * Search runs over the FTS table, because a shop with five thousand products
 * types three letters and expects the list now. A barcode is matched whole,
 * which is what a scanner sends.
 */
/* A LIKE pattern that matches the text anywhere, with its own % and _ taken literally. */
export function likeOf(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/* Also finds a product by what the owner wrote in his own columns. */
export function searchProducts(database: Database.Database, term: string, limit = 60): Product[] {
  const clean = term.trim();
  if (!clean) return listProducts(database);
  const query = searchQuery(clean);

  const rows = database
    .prepare(
      `${SELECT} and (p.barcode = @exact
                      or (@query is not null and p.rowid in
                          (select rowid from products_search where products_search match @query))
                      or p.id in (select row_id from column_values
                                   where list = 'products' and value like @like escape '\\'))
        order by case when p.barcode = @exact then 0 else 1 end, p.name collate nocase
        limit @limit`
    )
    .all({ exact: clean, query, like: likeOf(clean), limit }) as Row[];
  return rows.map(toProduct);
}

export function findByBarcode(database: Database.Database, code: string): Product | null {
  const clean = code.trim();
  if (!clean) return null;
  const row = database.prepare(`${SELECT} and p.barcode = ? limit 1`).get(clean) as Row | undefined;
  return row ? toProduct(row) : null;
}

export type NewProduct = {
  name: string;
  nameArabic?: string | null;
  genericName?: string | null;
  category?: string | null;
  barcode?: string | null;
  unit?: string | null;
  salePrice: number;
  costPrice?: number | null;
  lowStock?: number | null;
  extra?: Record<string, unknown>;
  tracked?: boolean;
};

function blank(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

function checkMoney(value: number | null | undefined, what: string): void {
  if (value === null || value === undefined) return;
  if (!Number.isInteger(value) || value < 0) throw new Error(`${what} must be a whole number of minor units`);
}

export function addProduct(
  database: Database.Database,
  deviceId: string,
  product: NewProduct,
  staffId: string | null = null
): string {
  const name = blank(product.name);
  if (!name) throw new Error("a product needs a name");
  checkMoney(product.salePrice, "the sale price");
  checkMoney(product.costPrice, "the cost price");

  const row = stamp(database, deviceId);
  database
    .prepare(
      `insert into products
         (id, device_id, created_at, counter, name, name_arabic, generic_name,
          category, barcode, unit, sale_price, cost_price, low_stock, extra, tracked)
       values (@id, @device_id, @created_at, @counter, @name, @name_arabic,
               @generic_name, @category, @barcode, @unit, @sale_price,
               @cost_price, @low_stock, @extra, @tracked)`
    )
    .run({
      ...row,
      name,
      name_arabic: blank(product.nameArabic),
      generic_name: blank(product.genericName),
      category: blank(product.category),
      barcode: blank(product.barcode),
      unit: blank(product.unit),
      sale_price: product.salePrice,
      cost_price: product.costPrice ?? null,
      low_stock: product.lowStock ?? null,
      extra: product.extra && Object.keys(product.extra).length ? JSON.stringify(product.extra) : null,
      tracked: product.tracked === false ? 0 : 1,
    });
  audit(database, deviceId, { staffId, subject: "product", subjectId: row.id, action: "created", detail: { name } });
  return row.id;
}

/*
 * A product's description changes in place: its name, its price, its
 * threshold. That is the one kind of row here that is edited, because it
 * describes rather than records. The change itself is recorded, with what it
 * was before, in the audit log.
 */
export function updateProduct(
  database: Database.Database,
  deviceId: string,
  id: string,
  changes: Partial<NewProduct>,
  staffId: string | null = null
): void {
  const before = getProduct(database, id);
  if (!before) throw new Error("no such product");
  if (changes.name !== undefined && !blank(changes.name)) throw new Error("a product needs a name");
  checkMoney(changes.salePrice, "the sale price");
  checkMoney(changes.costPrice, "the cost price");

  const next = {
    name: changes.name !== undefined ? (blank(changes.name) as string) : before.name,
    name_arabic: changes.nameArabic !== undefined ? blank(changes.nameArabic) : before.nameArabic,
    generic_name: changes.genericName !== undefined ? blank(changes.genericName) : before.genericName,
    category: changes.category !== undefined ? blank(changes.category) : before.category,
    barcode: changes.barcode !== undefined ? blank(changes.barcode) : before.barcode,
    unit: changes.unit !== undefined ? blank(changes.unit) : before.unit,
    sale_price: changes.salePrice ?? before.salePrice,
    cost_price: changes.costPrice !== undefined ? changes.costPrice : before.costPrice,
    low_stock: changes.lowStock !== undefined ? changes.lowStock : before.lowStock,
    tracked: changes.tracked !== undefined ? (changes.tracked ? 1 : 0) : before.tracked ? 1 : 0,
  };

  database
    .prepare(
      `update products set name = @name, name_arabic = @name_arabic,
              generic_name = @generic_name, category = @category,
              barcode = @barcode, unit = @unit, sale_price = @sale_price,
              cost_price = @cost_price, low_stock = @low_stock, tracked = @tracked
        where id = @id`
    )
    .run({ ...next, id });

  const changed: Record<string, { from: unknown; to: unknown }> = {};
  const compare: [string, unknown, unknown][] = [
    ["name", before.name, next.name],
    ["nameArabic", before.nameArabic, next.name_arabic],
    ["genericName", before.genericName, next.generic_name],
    ["category", before.category, next.category],
    ["barcode", before.barcode, next.barcode],
    ["unit", before.unit, next.unit],
    ["salePrice", before.salePrice, next.sale_price],
    ["costPrice", before.costPrice, next.cost_price],
    ["lowStock", before.lowStock, next.low_stock],
    ["tracked", before.tracked ? 1 : 0, next.tracked],
  ];
  for (const [key, from, to] of compare) if (from !== to) changed[key] = { from, to };
  if (Object.keys(changed).length > 0) {
    audit(database, deviceId, { staffId, subject: "product", subjectId: id, action: "updated", detail: changed });
  }
}

/*
 * A product is archived, never deleted: its sales still name it. It leaves
 * the lists and the search, and every figure it took part in stays whole.
 */
export function archiveProduct(
  database: Database.Database,
  deviceId: string,
  id: string,
  staffId: string | null = null
): void {
  database.prepare("update products set archived_at = ? where id = ? and archived_at is null").run(new Date().toISOString(), id);
  audit(database, deviceId, { staffId, subject: "product", subjectId: id, action: "archived" });
}

export type Movement = {
  productId: string;
  quantity: number;
  reason: "sale" | "reception" | "adjustment" | "expiry" | "return" | "transfer" | "production" | "loss" | "dispatch";
  reference?: string | null;
  staffId?: string | null;
  occurredAt?: string;
  batchId?: string | null;
  /** Which of a warehouse's places; none means the shop's only one. */
  locationId?: string | null;
};

/*
 * Stock moves by writing a movement, never by setting a number. Positive for
 * what comes in, negative for what goes out.
 */
export function recordMovement(database: Database.Database, deviceId: string, movement: Movement): string {
  if (!Number.isFinite(movement.quantity) || movement.quantity === 0) {
    throw new Error("a movement moves something");
  }
  const row = stamp(database, deviceId);
  database
    .prepare(
      `insert into stock_movements
         (id, device_id, created_at, counter, product_id, quantity, reason,
          reference, staff_id, occurred_at, batch_id, location_id)
       values (@id, @device_id, @created_at, @counter, @product_id, @quantity,
               @reason, @reference, @staff_id, @occurred_at, @batch_id, @location_id)`
    )
    .run({
      ...row,
      product_id: movement.productId,
      quantity: movement.quantity,
      reason: movement.reason,
      reference: movement.reference ?? null,
      staff_id: movement.staffId ?? null,
      occurred_at: movement.occurredAt ?? row.created_at,
      batch_id: movement.batchId ?? null,
      location_id: movement.locationId ?? null,
    });
  return row.id;
}

/** What is on hand for one product, from its movements. */
export function onHand(database: Database.Database, productId: string): number {
  const row = database
    .prepare("select coalesce(sum(quantity), 0) as total from stock_movements where product_id = ?")
    .get(productId) as { total: number };
  return row.total;
}

export type Batch = {
  id: string;
  lot: string | null;
  expiresOn: string | null;
  costPrice: number | null;
  receivedAt: string;
  remaining: number;
};

export function batchesOf(database: Database.Database, productId: string, withEmpty = false): Batch[] {
  const rows = database
    .prepare(
      `select b.id, b.lot, b.expires_on, b.cost_price, b.created_at, ${REMAINING} as remaining
         from batches b
        where b.product_id = ?
        order by case when b.expires_on is null then 1 else 0 end, b.expires_on, b.created_at`
    )
    .all(productId) as {
    id: string;
    lot: string | null;
    expires_on: string | null;
    cost_price: number | null;
    created_at: string;
    remaining: number;
  }[];
  return rows
    .map((row) => ({
      id: row.id,
      lot: row.lot,
      expiresOn: row.expires_on,
      costPrice: row.cost_price,
      receivedAt: row.created_at,
      remaining: row.remaining,
    }))
    .filter((batch) => withEmpty || batch.remaining > 0);
}

/** Today as the batches write it, in this computer's own time zone. */
export function today(now = clock()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/*
 * Which batches a sale of this quantity takes from: the one that expires
 * first, then the next, then stock that came in without a batch. An expired
 * batch is used only once the pharmacist has been warned and chose to go
 * ahead, and each part taken from one says so. What nothing covers is taken
 * without a batch, so the stock total is still right.
 */
export type Part = { batchId: string | null; quantity: number; expired?: { lot: string | null; expiresOn: string } };

export function allocate(
  database: Database.Database,
  productId: string,
  quantity: number,
  now = clock(),
  options: { pastExpiry?: boolean } = {}
): Part[] {
  const date = today(now);
  const batches = batchesOf(database, productId);
  const usable = batches.filter((batch) => !batch.expiresOn || batch.expiresOn >= date);
  const parts: Part[] = [];
  let left = quantity;
  const take = (batchId: string | null, available: number, expired?: Part["expired"]) => {
    const amount = Math.min(left, available);
    if (amount <= 0) return;
    parts.push({ batchId, quantity: amount, ...(expired ? { expired } : {}) });
    left -= amount;
  };

  for (const batch of usable) take(batch.id, batch.remaining);
  if (!options.pastExpiry) {
    if (left > 0) parts.push({ batchId: null, quantity: left });
    return parts;
  }

  const inBatches = batches.reduce((sum, batch) => sum + Math.max(0, batch.remaining), 0);
  take(null, onHand(database, productId) - inBatches);
  for (const batch of batches) {
    if (batch.expiresOn && batch.expiresOn < date) take(batch.id, batch.remaining, { lot: batch.lot, expiresOn: batch.expiresOn });
  }
  if (left > 0) parts.push({ batchId: null, quantity: left });
  return parts;
}

/*
 * What a ticket would sell past expiry: for each line whose valid stock does
 * not cover it, the expired batches it would take from. Asked before the
 * sale, so the screen can name the product and the date and let the
 * pharmacist decide.
 */
export type PastExpiry = { productId: string; name: string; nameArabic: string | null; lot: string | null; expiresOn: string; quantity: number };

export function pastExpiryOf(
  database: Database.Database,
  lines: { productId?: string | null; quantity: number }[],
  now = clock()
): PastExpiry[] {
  const out: PastExpiry[] = [];
  for (const line of lines) {
    if (!line.productId) continue;
    const product = getProduct(database, line.productId);
    if (!product || !product.tracked) continue;
    for (const part of allocate(database, line.productId, line.quantity, now, { pastExpiry: true })) {
      if (part.expired) {
        out.push({ productId: product.id, name: product.name, nameArabic: product.nameArabic, lot: part.expired.lot, expiresOn: part.expired.expiresOn, quantity: part.quantity });
      }
    }
  }
  return out;
}

export type Reception = {
  productId: string;
  quantity: number;
  lot?: string | null;
  expiresOn?: string | null;
  costPrice?: number | null;
  supplierName?: string | null;
  note?: string | null;
  staffId?: string | null;
  locationId?: string | null;
};

function supplierId(database: Database.Database, deviceId: string, name: string | null): string | null {
  if (!name) return null;
  const found = database
    .prepare("select id from suppliers where lower(name) = lower(?) limit 1")
    .get(name) as { id: string } | undefined;
  if (found) return found.id;
  const row = stamp(database, deviceId);
  database
    .prepare("insert into suppliers (id, device_id, created_at, counter, name) values (@id, @device_id, @created_at, @counter, @name)")
    .run({ ...row, name });
  return row.id;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/*
 * Goods coming in: the reception, the batch it brought and the movement that
 * puts it on the shelf, in one transaction. The latest cost becomes the
 * product's cost, which is what the stock is valued at.
 */
export function receiveStock(database: Database.Database, deviceId: string, input: Reception): { batchId: string | null } {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) throw new Error("a reception brings something in");
  const expiresOn = blank(input.expiresOn);
  if (expiresOn && !DATE.test(expiresOn)) throw new Error("an expiry date is YYYY-MM-DD");
  checkMoney(input.costPrice, "the cost price");

  const write = database.transaction(() => {
    const reception = stamp(database, deviceId);
    database
      .prepare(
        `insert into receptions (id, device_id, created_at, counter, supplier_id, occurred_at, note)
         values (@id, @device_id, @created_at, @counter, @supplier_id, @occurred_at, @note)`
      )
      .run({
        ...reception,
        supplier_id: supplierId(database, deviceId, blank(input.supplierName)),
        occurred_at: reception.created_at,
        note: blank(input.note),
      });

    const lot = blank(input.lot);
    let batchId: string | null = null;
    if (lot || expiresOn) {
      const batch = stamp(database, deviceId);
      database
        .prepare(
          `insert into batches (id, device_id, created_at, counter, product_id, lot, expires_on, cost_price, reception_id)
           values (@id, @device_id, @created_at, @counter, @product_id, @lot, @expires_on, @cost_price, @reception_id)`
        )
        .run({
          ...batch,
          product_id: input.productId,
          lot,
          expires_on: expiresOn,
          cost_price: input.costPrice ?? null,
          reception_id: reception.id,
        });
      batchId = batch.id;
    }

    recordMovement(database, deviceId, {
      productId: input.productId,
      quantity: input.quantity,
      reason: "reception",
      reference: reception.id,
      staffId: input.staffId ?? null,
      batchId,
      locationId: input.locationId ?? null,
    });

    if (input.costPrice !== null && input.costPrice !== undefined) {
      database.prepare("update products set cost_price = ? where id = ?").run(input.costPrice, input.productId);
    }

    audit(database, deviceId, {
      staffId: input.staffId ?? null,
      subject: "product",
      subjectId: input.productId,
      action: "received",
      detail: { quantity: input.quantity, lot, expiresOn },
    });
    return { batchId };
  });
  return write();
}

export type Adjustment = {
  productId: string;
  /** What the shelf actually holds, counted. The movement is the difference. */
  counted?: number;
  /** Or a quantity out, for a broken or expired box. */
  out?: number;
  reason: "adjustment" | "expiry";
  batchId?: string | null;
  note?: string | null;
  staffId?: string | null;
  locationId?: string | null;
};

/*
 * Correcting the stock. A count writes the difference between what the
 * movements say and what is on the shelf; a loss writes what left. Either way
 * the old figure stays explicable: it is the movements before this one.
 */
export function adjustStock(database: Database.Database, deviceId: string, input: Adjustment): number {
  const write = database.transaction((): number => {
    let delta: number;
    if (input.counted !== undefined) {
      if (!Number.isFinite(input.counted) || input.counted < 0) throw new Error("a count is zero or more");
      const current = input.batchId
        ? (batchesOf(database, input.productId, true).find((batch) => batch.id === input.batchId)?.remaining ?? 0)
        : onHand(database, input.productId);
      delta = input.counted - current;
    } else if (input.out !== undefined) {
      if (!Number.isFinite(input.out) || input.out <= 0) throw new Error("a loss takes something out");
      delta = -input.out;
    } else {
      throw new Error("an adjustment is a count or a loss");
    }
    if (delta === 0) return 0;

    recordMovement(database, deviceId, {
      productId: input.productId,
      quantity: delta,
      reason: input.reason,
      reference: blank(input.note),
      staffId: input.staffId ?? null,
      batchId: input.batchId ?? null,
      locationId: input.locationId ?? null,
    });
    audit(database, deviceId, {
      staffId: input.staffId ?? null,
      subject: "product",
      subjectId: input.productId,
      action: input.reason === "expiry" ? "written_off" : "adjusted",
      detail: { delta, batchId: input.batchId ?? null, note: blank(input.note) },
    });
    return delta;
  });
  return write();
}

export type MovementRow = {
  id: string;
  occurredAt: string;
  quantity: number;
  reason: string;
  reference: string | null;
  lot: string | null;
  saleNumber: number | null;
  /** The stock that arrived with activation, from the website's import. */
  opening: boolean;
};

export function movementsOf(database: Database.Database, productId: string, limit = 100): MovementRow[] {
  const rows = database
    .prepare(
      `select m.id, m.occurred_at, m.quantity, m.reason, m.reference, b.lot,
              (select s.number from sales s where s.id = m.reference) as sale_number
         from stock_movements m
         left join batches b on b.id = m.batch_id
        where m.product_id = ?
        order by m.occurred_at desc, m.counter desc
        limit ?`
    )
    .all(productId, limit) as {
    id: string;
    occurred_at: string;
    quantity: number;
    reason: string;
    reference: string | null;
    lot: string | null;
    sale_number: number | null;
  }[];
  return rows.map((row) => ({
    id: row.id,
    occurredAt: row.occurred_at,
    quantity: row.quantity,
    reason: row.reason,
    /* A sale's reference is its id, which means nothing to anyone: its number does. */
    reference: row.sale_number !== null || row.reason === "reception" || row.reference === "activation" ? null : row.reference,
    lot: row.lot,
    saleNumber: row.sale_number,
    opening: row.reason === "reception" && row.reference === "activation",
  }));
}

/** The date a number of months from today, as the batches write it. */
export function monthsFromToday(months: number, now = clock()): string {
  const later = new Date(now.getFullYear(), now.getMonth() + months, now.getDate());
  return today(later);
}

export type StockOverview = {
  products: number;
  outOfStock: number;
  low: number;
  expiringSoon: number;
  expired: number;
  /** At cost, for the products whose cost is known. */
  value: number;
  withoutCost: number;
};

/** The products with a batch past its date and boxes still on the shelf. */
export function expiredProductIds(database: Database.Database, now = clock()): string[] {
  return (
    database
      .prepare(
        `select distinct b.product_id from batches b
          where b.expires_on is not null and b.expires_on < ? and ${REMAINING} > 0`
      )
      .all(today(now)) as { product_id: string }[]
  ).map((row) => row.product_id);
}

/** The products with a batch expiring between two dates, boxes still on the shelf. */
export function expiringProductIds(database: Database.Database, from: string, to: string): string[] {
  return (
    database
      .prepare(
        `select distinct b.product_id from batches b
          where b.expires_on is not null and b.expires_on >= ? and b.expires_on <= ? and ${REMAINING} > 0`
      )
      .all(from, to) as { product_id: string }[]
  ).map((row) => row.product_id);
}

/*
 * The four questions the stock screen answers before anything is clicked:
 * what has run out, what is running low, what expires soon and what already
 * has. Expired means a batch past its date with boxes still on the shelf.
 */
export function stockOverview(database: Database.Database, expiryMonths: number, now = clock()): StockOverview {
  /* Only what is counted on a shelf; a menu item is never "out of stock". */
  const products = listProducts(database).filter((product) => product.tracked);
  const date = today(now);
  const soon = monthsFromToday(expiryMonths, now);

  let value = 0;
  let withoutCost = 0;
  for (const product of products) {
    if (product.onHand <= 0) continue;
    if (product.costPrice === null) withoutCost += 1;
    else value += Math.round(product.onHand * product.costPrice);
  }

  return {
    products: products.length,
    outOfStock: products.filter((product) => product.onHand <= 0).length,
    low: products.filter(
      (product) => product.onHand > 0 && product.lowStock !== null && product.onHand <= product.lowStock
    ).length,
    /*
     * Counted per batch, not from the product's next expiry: a product with
     * an expired batch and another expiring next month is in both counts.
     */
    expiringSoon: expiringProductIds(database, date, soon).length,
    expired: expiredProductIds(database, now).length,
    value,
    withoutCost,
  };
}

/*
 * A database from 0.1 kept the imported batch and expiry on the product
 * itself. Each such product gets a real batch, and the opening stock that
 * came with activation is attributed to it, so its expiry is followed from
 * now on like any other. Run at start; it does nothing the second time.
 */
export function adoptImportedBatches(database: Database.Database, deviceId: string): number {
  const candidates = database
    .prepare(
      `select p.id, p.extra from products p
        where p.extra is not null
          and not exists (select 1 from batches b where b.product_id = p.id)`
    )
    .all() as { id: string; extra: string }[];

  let adopted = 0;
  const write = database.transaction(() => {
    for (const candidate of candidates) {
      const extra = JSON.parse(candidate.extra) as Record<string, unknown>;
      const lot = typeof extra.batch === "string" ? extra.batch.trim() : "";
      const rawExpiry = typeof extra.expiry === "string" ? extra.expiry.trim() : "";
      const expiresOn = DATE.test(rawExpiry) ? rawExpiry : null;
      if (!lot && !expiresOn) continue;

      const batch = stamp(database, deviceId);
      database
        .prepare(
          `insert into batches (id, device_id, created_at, counter, product_id, lot, expires_on)
           values (@id, @device_id, @created_at, @counter, @product_id, @lot, @expires_on)`
        )
        .run({ ...batch, product_id: candidate.id, lot: lot || null, expires_on: expiresOn });

      /*
       * Naming the batch on the opening movement is an attribution, not a
       * change to what happened: the quantity and the date stay as written.
       */
      database
        .prepare(
          `update stock_movements set batch_id = ?
            where product_id = ? and reason = 'reception' and reference = 'activation' and batch_id is null`
        )
        .run(batch.id, candidate.id);
      adopted += 1;
    }
  });
  write();
  return adopted;
}

export type ImportRow = {
  name: string;
  /** In minor units, already in the new ouguiya. */
  price: number;
  quantity: number;
  barcode?: string | null;
  expiry?: string | null;
  batch?: string | null;
  unit?: string | null;
  category?: string | null;
};

/*
 * A spreadsheet of products, added in one go: each row a product, and its
 * quantity received as a batch with its lot and expiry, so the stock can be
 * explained like any other. A name already in the stock is left as it is and
 * reported, rather than doubled or overwritten.
 */
export function importProducts(database: Database.Database, deviceId: string, rows: ImportRow[], staffId: string | null = null): { added: number; skipped: string[] } {
  const write = database.transaction(() => {
    const known = new Set(
      (database.prepare("select lower(name) as name from products where archived_at is null").all() as { name: string }[]).map((row) => row.name)
    );
    let added = 0;
    const skipped: string[] = [];
    for (const row of rows.slice(0, 10_000)) {
      const name = (row.name ?? "").trim();
      if (!name || !Number.isInteger(row.price) || row.price <= 0) continue;
      if (known.has(name.toLowerCase())) {
        skipped.push(name);
        continue;
      }
      const id = addProduct(database, deviceId, {
        name,
        salePrice: row.price,
        barcode: row.barcode ?? null,
        unit: row.unit ?? null,
        category: row.category ?? null,
      });
      known.add(name.toLowerCase());
      const quantity = Number(row.quantity);
      if (Number.isFinite(quantity) && quantity > 0) {
        receiveStock(database, deviceId, {
          productId: id,
          quantity,
          lot: row.batch ?? null,
          expiresOn: row.expiry && /^\d{4}-\d{2}-\d{2}$/.test(row.expiry) ? row.expiry : null,
          note: "import",
          staffId,
        });
      }
      added += 1;
    }
    audit(database, deviceId, { staffId, subject: "product", action: "imported", detail: { added, skipped: skipped.length } });
    return { added, skipped };
  });
  return write();
}
