import type { Configuration } from "@app-ui/index";

/*
 * The machine, as the screens see it.
 *
 * Everything the interface can do is on this one type. If a capability is not
 * written here it does not exist in the renderer, which is the point: the
 * list of things the screens can reach should be readable in a minute.
 */

export type ConfigurationResult =
  | { ok: true; configuration: Configuration }
  | { ok: false; reason: "missing" | "unreadable" | "invalid"; detail?: string };

export type DatabaseState = { ready: boolean; tables: number; file?: string };

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

export type SaleResult =
  | { ok: true; sale: { id: string; number: number; total: number } }
  | { ok: false; reason: string };

export type SaleSummary = {
  id: string;
  number: number;
  occurredAt: string;
  total: number;
  payment: string;
  status: string;
};

export type Bridge = {
  readConfiguration: () => Promise<ConfigurationResult>;
  databaseState: () => Promise<DatabaseState>;
  products: (term?: string) => Promise<Product[]>;
  recordSale: (sale: NewSale) => Promise<SaleResult>;
  recentSales: (limit?: number) => Promise<SaleSummary[]>;
  voidSale: (
    saleId: string,
    reason: string,
    staffId: string | null
  ) => Promise<{ ok: boolean; reason?: string }>;
  cashExpected: (since: string) => Promise<number>;
};

/*
 * The preload script puts it here. Declared as unknown on window and narrowed
 * once, so a screen cannot quietly widen what it is allowed to reach.
 */
export const machine = (window as unknown as { ouaqt: Bridge }).ouaqt;
