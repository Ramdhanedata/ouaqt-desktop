import type { Configuration } from "@app-ui/index";
import type { BackupInfo } from "../electron/backup";
import type { AuditRow } from "../electron/db/audit";
import type { CashSession } from "../electron/db/cash";
import type { Customer, LedgerLine, NewCustomer } from "../electron/db/customers";
import type { Adjustment, Batch, MovementRow, NewProduct, Product, Reception, StockOverview } from "../electron/db/products";
import type { Period, Summary, TopProduct } from "../electron/db/reports";
import type { NewSale, RecordedSale, SaleDetail, SaleSummary } from "../electron/db/sales";
import type { Paper } from "../electron/print";

/*
 * The machine, as the screens see it.
 *
 * Everything the interface can do is on this one type. If a capability is not
 * written here it does not exist in the renderer, which is the point: the
 * list of things the screens can reach should be readable in a few minutes.
 *
 * The shapes come from the database modules themselves, as types only, so a
 * screen and the query it shows can never disagree about a field.
 */

export type {
  AuditRow,
  BackupInfo,
  Batch,
  CashSession,
  Customer,
  LedgerLine,
  MovementRow,
  NewProduct,
  NewSale,
  Paper,
  Period,
  Product,
  SaleDetail,
  SaleSummary,
  StockOverview,
  Summary,
  TopProduct,
};

/** What every write, and most reads, answer: the value, or a reason to say. */
export type Answer<T> = { ok: true; value: T } | { ok: false; reason: string };

export type ConfigurationResult =
  | { ok: true; configuration: Configuration }
  | { ok: false; reason: "missing" | "unreadable" | "invalid"; detail?: string };

export type DatabaseState = { ready: boolean; tables: number; file?: string };

export type AppInfo = { testBuild: boolean; version: string; server: string | null };

export type LicenceState =
  | { kind: "none" }
  | { kind: "demo" }
  | {
      kind: "ok";
      businessName: string;
      plan: string;
      status: "trial" | "active" | "expired_trial" | "renewal_due" | "expired" | "suspended";
      clockWrong: boolean;
      canSell: boolean;
      daysLeft: number | null;
      trialSummaryDays: number;
    };

export type ActivationResult =
  | { ok: true; products: number; staff: number }
  | {
      ok: false;
      error: string;
      because?: string;
      supportWhatsapp?: string;
      via: "serial" | "link";
    };

export type Printed = { ok: boolean; reason?: string };

export type Bridge = {
  readConfiguration: () => Promise<ConfigurationResult>;
  databaseState: () => Promise<DatabaseState>;

  products: (term?: string) => Promise<Product[]>;
  productDetail: (id: string) => Promise<Answer<{ product: Product; batches: Batch[]; movements: MovementRow[] }>>;
  addProduct: (product: NewProduct) => Promise<Answer<string>>;
  updateProduct: (id: string, changes: Partial<NewProduct>) => Promise<Answer<void>>;
  archiveProduct: (id: string) => Promise<Answer<void>>;
  receiveStock: (input: Reception) => Promise<Answer<{ batchId: string | null }>>;
  adjustStock: (input: Adjustment) => Promise<Answer<number>>;
  stockOverview: () => Promise<Answer<StockOverview>>;
  stockFlags: () => Promise<Answer<{ expired: string[]; expiring: string[]; months: number }>>;

  recordSale: (sale: NewSale) => Promise<Answer<RecordedSale & { printed: Printed | null }>>;
  recentSales: (limit?: number) => Promise<SaleSummary[]>;
  voidSale: (saleId: string, reason: string) => Promise<Answer<string>>;
  saleDetail: (id: string) => Promise<Answer<SaleDetail | null>>;
  salesBetween: (from: string, to: string) => Promise<Answer<SaleSummary[]>>;

  customers: (term?: string) => Promise<Answer<Customer[]>>;
  customerDetail: (id: string) => Promise<Answer<{ customer: Customer; ledger: LedgerLine[] }>>;
  addCustomer: (input: NewCustomer) => Promise<Answer<string>>;
  updateCustomer: (id: string, input: NewCustomer) => Promise<Answer<void>>;
  recordPayment: (input: { customerId: string; amount: number; payment: "cash" | "mobile"; note?: string }) => Promise<Answer<{ balance: number }>>;

  cashCurrent: () => Promise<Answer<CashSession | null>>;
  cashHistory: () => Promise<Answer<CashSession[]>>;
  cashOpen: (openingFloat: number) => Promise<Answer<CashSession>>;
  cashClose: (counted: number, note?: string) => Promise<Answer<CashSession>>;

  reportSummary: (period: Period) => Promise<Answer<Summary>>;
  reportTop: (period: Period) => Promise<Answer<TopProduct[]>>;
  reportExport: (period: Period, fileName: string) => Promise<Answer<string | null>>;
  trialSummary: () => Promise<Answer<{ sales: number; creditCustomers: number; creditTotal: number; cashDifferences: number }>>;
  recentAudit: () => Promise<Answer<AuditRow[]>>;

  printSettings: () => Promise<{ printer: string | null; paper: Paper; auto: boolean }>;
  savePrintSettings: (input: { printer: string | null; paper: Paper; auto: boolean }) => Promise<boolean>;
  printers: () => Promise<{ name: string; label: string }[]>;
  printReceipt: (saleId: string) => Promise<Printed>;
  printTest: () => Promise<Printed>;

  backupInfo: () => Promise<BackupInfo>;
  backupSave: () => Promise<Answer<string | null>>;
  backupPick: () => Promise<Answer<{ sales: number } | null>>;
  backupRestore: () => Promise<Answer<null>>;

  appInfo: () => Promise<AppInfo>;
  licenceState: () => Promise<LicenceState>;
  activate: (serial: string) => Promise<ActivationResult>;
  onActivated: (handler: (result: ActivationResult) => void) => () => void;
  openWhatsapp: (number: string) => Promise<void>;
  onUpdateReady: (handler: (info: { version: string }) => void) => () => void;
};

/*
 * The preload script puts it here. Declared as unknown on window and narrowed
 * once, so a screen cannot quietly widen what it is allowed to reach.
 */
export const machine = (window as unknown as { ouaqt: Bridge }).ouaqt;
