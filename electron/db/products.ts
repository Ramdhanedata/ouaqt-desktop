import type Database from "better-sqlite3";
import { stamp } from "./rows";

/*
 * Products, and how much of each is on hand.
 *
 * The quantity is never stored. It is the sum of the movements, worked out
 * when it is asked for, which is what makes it explicable: when a figure
 * surprises the owner there is a row behind every part of it.
 */

export type Product = {
  id: string;
  name: string;
  nameArabic: string | null;
  barcode: string | null;
  unit: string | null;
  salePrice: number;
  costPrice: number | null;
  lowStock: number | null;
  extra: Record<string, unknown>;
  onHand: number;
};

type Row = {
  id: string;
  name: string;
  name_arabic: string | null;
  barcode: string | null;
  unit: string | null;
  sale_price: number;
  cost_price: number | null;
  low_stock: number | null;
  extra: string | null;
  on_hand: number | null;
};

function toProduct(row: Row): Product {
  return {
    id: row.id,
    name: row.name,
    nameArabic: row.name_arabic,
    barcode: row.barcode,
    unit: row.unit,
    salePrice: row.sale_price,
    costPrice: row.cost_price,
    lowStock: row.low_stock,
    extra: row.extra ? (JSON.parse(row.extra) as Record<string, unknown>) : {},
    onHand: row.on_hand ?? 0,
  };
}

const SELECT = `
  select p.id, p.name, p.name_arabic, p.barcode, p.unit, p.sale_price,
         p.cost_price, p.low_stock, p.extra,
         (select coalesce(sum(m.quantity), 0) from stock_movements m
           where m.product_id = p.id) as on_hand
    from products p
   where p.archived_at is null
`;

export function listProducts(database: Database.Database): Product[] {
  const rows = database.prepare(`${SELECT} order by p.name`).all() as Row[];
  return rows.map(toProduct);
}

/*
 * Search runs over the FTS table when there is a term, because a shop with
 * five thousand products types three letters and expects the list now.
 */
export function searchProducts(
  database: Database.Database,
  term: string
): Product[] {
  const clean = term.trim();
  if (!clean) return listProducts(database);

  const rows = database
    .prepare(
      `${SELECT} and (p.id in (select id from products_fts where products_fts match ?)
                      or p.barcode = ?)
        order by p.name limit 200`
    )
    .all(`${clean.replace(/["']/g, "")}*`, clean) as Row[];
  return rows.map(toProduct);
}

export type NewProduct = {
  name: string;
  nameArabic?: string | null;
  barcode?: string | null;
  unit?: string | null;
  salePrice: number;
  costPrice?: number | null;
  lowStock?: number | null;
  extra?: Record<string, unknown>;
};

export function addProduct(
  database: Database.Database,
  deviceId: string,
  product: NewProduct
): string {
  const row = stamp(database, deviceId);
  database
    .prepare(
      `insert into products
         (id, device_id, created_at, counter, name, name_arabic, barcode, unit,
          sale_price, cost_price, low_stock, extra)
       values (@id, @device_id, @created_at, @counter, @name, @name_arabic,
               @barcode, @unit, @sale_price, @cost_price, @low_stock, @extra)`
    )
    .run({
      ...row,
      name: product.name,
      name_arabic: product.nameArabic ?? null,
      barcode: product.barcode ?? null,
      unit: product.unit ?? null,
      sale_price: product.salePrice,
      cost_price: product.costPrice ?? null,
      low_stock: product.lowStock ?? null,
      extra: product.extra ? JSON.stringify(product.extra) : null,
    });
  return row.id;
}

/*
 * Stock moves by writing a movement, never by setting a number. Positive for
 * what comes in, negative for what goes out.
 */
export function recordMovement(
  database: Database.Database,
  deviceId: string,
  movement: {
    productId: string;
    quantity: number;
    reason: "sale" | "reception" | "adjustment" | "expiry" | "return" | "transfer";
    reference?: string | null;
    staffId?: string | null;
    occurredAt?: string;
  }
): string {
  const row = stamp(database, deviceId);
  database
    .prepare(
      `insert into stock_movements
         (id, device_id, created_at, counter, product_id, quantity, reason,
          reference, staff_id, occurred_at)
       values (@id, @device_id, @created_at, @counter, @product_id, @quantity,
               @reason, @reference, @staff_id, @occurred_at)`
    )
    .run({
      ...row,
      product_id: movement.productId,
      quantity: movement.quantity,
      reason: movement.reason,
      reference: movement.reference ?? null,
      staff_id: movement.staffId ?? null,
      occurred_at: movement.occurredAt ?? row.created_at,
    });
  return row.id;
}

/** What is on hand for one product, from its movements. */
export function onHand(database: Database.Database, productId: string): number {
  const row = database
    .prepare(
      "select coalesce(sum(quantity), 0) as total from stock_movements where product_id = ?"
    )
    .get(productId) as { total: number };
  return row.total;
}
