import type { Configuration } from "@app-ui/index";
import type { BackupInfo } from "../electron/backup";
import type { AuditRow } from "../electron/db/audit";
import type { CashSession } from "../electron/db/cash";
import type { PaymentApp } from "../electron/db/payment-apps";
import type { Column, ColumnType, ListName } from "../electron/db/columns";
import type { Customer, LedgerLine, NewCustomer } from "../electron/db/customers";
import type { Adjustment, Batch, MovementRow, NewProduct, PastExpiry, Product, Reception, StockOverview } from "../electron/db/products";
import type { PastExpirySale, Period, Summary, TopProduct } from "../electron/db/reports";
import type { NewSale, RecordedSale, SaleDetail, SaleSummary } from "../electron/db/sales";
import type { Paper, PrintedTable } from "../electron/print";
import type { CashMovement, NewCashMovement } from "../electron/db/cashbook";
import type { Order, OrderLine, Service } from "../electron/db/restaurant";
import type { DayLine, Preorder } from "../electron/db/bakery";
import type { Dispatch, DispatchInput, Location } from "../electron/db/warehouse";
import type { Folio, Room, Stay } from "../electron/db/hotel";
import type { Parcel, Route, Ticket, Trip, Vehicle } from "../electron/db/transport";

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
  Column,
  ColumnType,
  ListName,
  PrintedTable,
  PaymentApp,
  PastExpiry,
  PastExpirySale,
  CashMovement,
  DayLine,
  Dispatch,
  DispatchInput,
  Folio,
  Location,
  Order,
  OrderLine,
  Parcel,
  Preorder,
  Room,
  Route,
  Service,
  Stay,
  Ticket,
  Trip,
  Vehicle,
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
/* Chosen on this computer: the screens' language (null until the first launch picks one) and the theme. */
export type UiLanguage = "fr" | "ar" | "en";
export type Theme = "light" | "dark";
export type Preferences = { language: UiLanguage | null; theme: Theme };

/* A list as the owner shaped it: every column in his order, what he wrote in his own, by row, and how many of his own it takes. */
export type ListShape = { columns: Column[]; values: Record<string, Record<string, string>>; limit: number };

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
  readPreferences: () => Promise<Preferences>;
  licenceSerial: () => Promise<string | null>;
  openPayment: (language: UiLanguage) => Promise<void>;
  writePreferences: (next: Partial<{ language: UiLanguage; theme: Theme }>) => Promise<Preferences>;
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
  pastExpiry: (lines: { productId?: string | null; quantity: number }[]) => Promise<Answer<PastExpiry[]>>;
  paymentApps: () => Promise<Answer<PaymentApp[]>>;
  addPaymentApp: (name: string) => Promise<Answer<string>>;
  renamePaymentApp: (id: string, name: string) => Promise<Answer<void>>;
  setPaymentAppLogo: (id: string, logo: string | null) => Promise<Answer<void>>;
  removePaymentApp: (id: string) => Promise<Answer<void>>;
  movePaymentApp: (id: string, direction: "up" | "down") => Promise<Answer<void>>;
  /* The owner's own shape for a list: its columns, and what he wrote in his own ones, by row. */
  columns: (list: ListName) => Promise<Answer<ListShape>>;
  addColumn: (list: ListName, input: { label: string; type: ColumnType; choices?: string[] }) => Promise<Answer<Column>>;
  renameColumn: (id: string, label: string | null) => Promise<Answer<void>>;
  hideColumn: (id: string, hidden: boolean) => Promise<Answer<void>>;
  setColumnChoices: (id: string, choices: string[]) => Promise<Answer<void>>;
  moveColumn: (id: string, direction: "up" | "down", among?: string[]) => Promise<Answer<void>>;
  deleteColumn: (id: string) => Promise<Answer<void>>;
  setColumnValue: (list: ListName, rowId: string, columnId: string, value: string | null) => Promise<Answer<void>>;
  exportList: (table: PrintedTable, fileName: string) => Promise<Answer<string | null>>;
  printList: (table: PrintedTable, fileName: string) => Promise<Answer<string>>;
  recentSales: (limit?: number) => Promise<SaleSummary[]>;
  voidSale: (saleId: string, reason: string) => Promise<Answer<string>>;
  saleDetail: (id: string) => Promise<Answer<SaleDetail | null>>;
  salesBetween: (from: string, to: string) => Promise<Answer<SaleSummary[]>>;

  customers: (term?: string) => Promise<Answer<Customer[]>>;
  customerDetail: (id: string) => Promise<Answer<{ customer: Customer; ledger: LedgerLine[] }>>;
  addCustomer: (input: NewCustomer) => Promise<Answer<string>>;
  updateCustomer: (id: string, input: NewCustomer) => Promise<Answer<void>>;
  recordPayment: (input: {
    customerId: string;
    amount: number;
    payment: "cash" | "mobile";
    mobileApp?: string;
    paymentReference?: string;
    note?: string;
  }) => Promise<Answer<{ balance: number }>>;

  cashCurrent: () => Promise<Answer<CashSession | null>>;
  cashHistory: () => Promise<Answer<CashSession[]>>;
  cashOpen: (openingFloat: number) => Promise<Answer<CashSession>>;
  cashClose: (counted: number, note?: string) => Promise<Answer<CashSession>>;

  reportSummary: (period: Period) => Promise<Answer<Summary>>;
  reportTop: (period: Period) => Promise<Answer<TopProduct[]>>;
  reportPastExpiry: (period: Period) => Promise<Answer<PastExpirySale[]>>;
  reportExport: (period: Period, fileName: string) => Promise<Answer<string | null>>;
  trialSummary: () => Promise<Answer<{ sales: number; creditCustomers: number; creditTotal: number; cashDifferences: number }>>;
  recentAudit: () => Promise<Answer<AuditRow[]>>;
  dailyTotals: (days: number) => Promise<Answer<{ day: string; net: number; count: number }[]>>;

  printSettings: () => Promise<{ printer: string | null; paper: Paper; auto: boolean }>;
  savePrintSettings: (input: { printer: string | null; paper: Paper; auto: boolean }) => Promise<boolean>;
  printers: () => Promise<{ name: string; label: string }[]>;
  printReceipt: (saleId: string) => Promise<Printed>;
  printTest: () => Promise<Printed>;

  backupInfo: () => Promise<BackupInfo>;
  backupSave: () => Promise<Answer<string | null>>;
  backupPick: () => Promise<Answer<{ sales: number } | null>>;
  backupRestore: () => Promise<Answer<null>>;

  /* The trades' own screens. */
  cashbookAdd: (input: NewCashMovement) => Promise<Answer<string>>;
  cashbookBetween: (from: string, to: string) => Promise<Answer<CashMovement[]>>;

  openOrders: () => Promise<Answer<Order[]>>;
  getOrder: (id: string) => Promise<Answer<{ order: Order; lines: OrderLine[] } | null>>;
  startOrder: (input: { service: Service; tableNo?: number | null; guests?: number | null; customer?: string; phone?: string; address?: string }) => Promise<Answer<string>>;
  addToOrder: (input: { orderId: string; productId: string; quantity?: number; note?: string }) => Promise<Answer<void>>;
  changeOrderLine: (lineId: string, quantity: number) => Promise<Answer<void>>;
  moveOrder: (orderId: string, tableNo: number) => Promise<Answer<void>>;
  cancelOrder: (orderId: string, reason: string) => Promise<Answer<void>>;
  sendToKitchen: (orderId: string, print: boolean) => Promise<Answer<{ sent: number; printed: Printed | null }>>;
  printBill: (orderId: string) => Promise<Printed>;
  payOrder: (orderId: string, payment: Omit<NewSale, "lines" | "reference">) => Promise<Answer<RecordedSale>>;

  bakeryDay: (day?: string) => Promise<Answer<DayLine[]>>;
  recordProduction: (items: { productId: string; quantity: number }[]) => Promise<Answer<number>>;
  recordUnsold: (items: { productId: string; quantity: number }[]) => Promise<Answer<number>>;
  preorders: (which?: "open" | "all") => Promise<Answer<Preorder[]>>;
  createPreorder: (input: {
    customer: string;
    phone?: string | null;
    dueOn: string;
    lines: { productId: string; quantity: number; unitPrice: number }[];
    deposit?: number;
    depositPayment?: "cash" | "mobile";
    note?: string | null;
  }) => Promise<Answer<string>>;
  preorderReady: (id: string) => Promise<Answer<void>>;
  collectPreorder: (id: string, payment: Omit<NewSale, "lines" | "reference" | "prepaid">) => Promise<Answer<RecordedSale>>;
  cancelPreorder: (id: string, refund: boolean) => Promise<Answer<void>>;
  printPreorder: (id: string) => Promise<Printed>;

  locations: () => Promise<Answer<Location[]>>;
  addLocation: (name: string) => Promise<Answer<string>>;
  renameLocation: (id: string, name: string) => Promise<Answer<void>>;
  stockByLocation: () => Promise<Answer<{ productId: string; locationId: string; quantity: number }[]>>;
  transfer: (input: { productId: string; quantity: number; from: string; to: string; note?: string }) => Promise<Answer<string>>;
  dispatch: (input: DispatchInput) => Promise<Answer<{ id: string; number: number; saleId: string | null }>>;
  dispatchesBetween: (from: string, to: string) => Promise<Answer<Dispatch[]>>;
  printDispatch: (id: string) => Promise<Printed>;
  warehouseFlows: (from: string, to: string) => Promise<Answer<{ productId: string; name: string; unit: string | null; received: number; sent: number; sold: number; adjusted: number }[]>>;

  rooms: () => Promise<Answer<Room[]>>;
  addRoom: (input: { number: string; kind?: string; rate: number; capacity?: number }) => Promise<Answer<string>>;
  updateRoom: (id: string, input: { kind?: string; rate?: number; capacity?: number }) => Promise<Answer<void>>;
  setRoomStatus: (id: string, status: "available" | "cleaning" | "out_of_service") => Promise<Answer<void>>;
  stays: (which?: "current" | "all") => Promise<Answer<Stay[]>>;
  getStay: (id: string) => Promise<Answer<Stay | null>>;
  bookStay: (input: {
    roomId: string;
    guest: string;
    phone?: string | null;
    idDocument?: string | null;
    nationality?: string | null;
    adults?: number;
    arrivesOn: string;
    leavesOn: string;
    rate?: number;
    advance?: number;
    advancePayment?: "cash" | "mobile";
    note?: string | null;
    checkInNow?: boolean;
  }) => Promise<Answer<string>>;
  checkIn: (id: string) => Promise<Answer<void>>;
  addAdvance: (id: string, amount: number, payment: "cash" | "mobile") => Promise<Answer<void>>;
  addCharge: (input: { stayId: string; label: string; quantity?: number; unitPrice: number }) => Promise<Answer<string>>;
  folio: (id: string) => Promise<Answer<Folio>>;
  checkOut: (id: string, payment: Omit<NewSale, "lines" | "reference" | "prepaid">) => Promise<Answer<RecordedSale>>;
  cancelStay: (id: string, refund: boolean) => Promise<Answer<void>>;
  printFolio: (id: string) => Promise<Printed>;
  occupancy: (from: string, to: string) => Promise<Answer<{ roomNights: number; sold: number; percent: number }>>;

  routes: () => Promise<Answer<Route[]>>;
  addRoute: (input: { origin: string; destination: string; fare: number; parcelFee?: number | null }) => Promise<Answer<string>>;
  updateRoute: (id: string, input: { fare?: number; parcelFee?: number | null }) => Promise<Answer<void>>;
  vehicles: () => Promise<Answer<Vehicle[]>>;
  addVehicle: (input: { plate: string; seats: number }) => Promise<Answer<string>>;
  tripsBetween: (from: string, to: string) => Promise<Answer<Trip[]>>;
  tripDetail: (id: string) => Promise<Answer<{ trip: Trip; tickets: Ticket[]; parcels: Parcel[] }>>;
  scheduleTrip: (input: { routeId: string; vehicleId?: string | null; driver?: string | null; departsAt: string; seats?: number }) => Promise<Answer<string>>;
  setTripStatus: (id: string, status: "departed" | "arrived" | "cancelled") => Promise<Answer<void>>;
  printManifest: (id: string) => Promise<Printed>;
  sellTicket: (input: { tripId: string; seat?: number | null; passenger: string; phone?: string; fare?: number; payment: Omit<NewSale, "lines" | "reference"> }) => Promise<
    Answer<{ ticketId: string; number: number; saleId: string; saleNumber: number; change: number | null }>
  >;
  boardTicket: (id: string) => Promise<Answer<void>>;
  cancelTicket: (id: string, reason: string) => Promise<Answer<void>>;
  parcels: (which?: "open" | "all", term?: string) => Promise<Answer<Parcel[]>>;
  registerParcel: (input: {
    routeId: string;
    tripId?: string | null;
    sender: string;
    senderPhone?: string | null;
    receiver: string;
    receiverPhone?: string | null;
    description?: string | null;
    weight?: number | null;
    fee: number;
    paidBy: "sender" | "receiver";
    payment?: Omit<NewSale, "lines" | "reference">;
  }) => Promise<Answer<{ id: string; code: string; saleId: string | null; saleNumber: number | null }>>;
  loadParcel: (id: string, tripId: string) => Promise<Answer<void>>;
  parcelArrived: (id: string) => Promise<Answer<void>>;
  deliverParcel: (id: string, payment: Omit<NewSale, "lines" | "reference"> | null) => Promise<Answer<{ saleId: string | null; saleNumber: number | null }>>;
  cancelParcel: (id: string, reason: string) => Promise<Answer<void>>;
  printParcel: (id: string) => Promise<Printed>;
  routeTakings: (from: string, to: string) => Promise<Answer<{ route: string; tickets: number; ticketTotal: number; parcels: number; parcelTotal: number }[]>>;

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
