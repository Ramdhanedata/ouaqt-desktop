import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import type { Configuration } from "@app-ui/config";
import { formatAmount, formatDateTime, formatQuantity } from "@app-ui/format";
import { dayOf, cancelPreorder, collectPreorder, createPreorder, listPreorders, markPreorderReady, recordProduction, recordUnsold } from "./db/bakery";
import { addCashMovement, cashMovementsBetween, type NewCashMovement } from "./db/cashbook";
import {
  addAdvance,
  addCharge,
  addRoom,
  bookStay,
  cancelStay,
  checkIn,
  checkOut,
  folioOf,
  getStay,
  listRooms,
  listStays,
  occupancy,
  setRoomStatus,
  updateRoom,
} from "./db/hotel";
import { today } from "./db/products";
import { addToOrder, cancelOrder, changeOrderLine, getOrder, moveOrder, openOrders, payOrder, sendToKitchen, startOrder, type Service } from "./db/restaurant";
import { getSetting } from "./db/rows";
import type { NewSale } from "./db/sales";
import {
  addRoute,
  addVehicle,
  boardTicket,
  cancelParcel,
  cancelTicket,
  deliverParcel,
  getTrip,
  listParcels,
  listRoutes,
  listVehicles,
  loadParcel,
  markParcelArrived,
  parcelsOf,
  registerParcel,
  routeTakings,
  scheduleTrip,
  sellTicket,
  setTripStatus,
  ticketsOf,
  tripsBetween,
  updateRoute,
  type Trip,
} from "./db/transport";
import { addLocation, dispatch, dispatchesBetween, ensureLocations, flowsBetween, listLocations, renameLocation, stockByLocation, transfer, type DispatchInput } from "./db/warehouse";
import { documentHtml, printHtml, type Paper, type PrintedDocument, type PrintSettings } from "./print";
import type { Context } from "./ipc";

/*
 * The trades' own requests: a restaurant's orders, a bakery's day and its
 * preorders, a warehouse's places and notes, a hotel's rooms and stays, a
 * transport company's trips, tickets and parcels, and anyone's cash book.
 *
 * Same rules as the shared screens in ipc.ts: every write goes through the
 * licence check, every answer is the value or a short reason, and nothing
 * here reaches the network.
 *
 * Lines that become sales without being products (a room's nights, a seat,
 * a parcel's fee) are worded here in the shop's own language, because the
 * receipt and the reports print them as they are stored.
 */

type Answer<T> = { ok: true; value: T } | { ok: false; reason: string };

type Words = {
  nights: (room: string, nights: number) => string;
  seat: (trip: Trip, seat: number | null) => string;
  parcel: (code: string) => string;
  kitchen: string;
  table: string;
  takeaway: string;
  delivery: string;
  bill: string;
  unpaid: string;
  total: string;
  deliveryNote: string;
  recipient: string;
  from: string;
  manifest: string;
  departs: string;
  vehicle: string;
  driver: string;
  passengers: string;
  parcels: string;
  parcelSlip: string;
  sender: string;
  receiver: string;
  fee: string;
  paidBy: string;
  paidNow: string;
  paidOnArrival: string;
  code: string;
  folio: string;
  advance: string;
  balance: string;
  preorder: string;
  due: string;
  deposit: string;
};

const WORDS: Record<"fr" | "ar" | "en", Words> = {
  fr: {
    nights: (room, n) => `Chambre ${room}, ${n} ${n > 1 ? "nuits" : "nuit"}`,
    seat: (trip, seat) => `${trip.origin} → ${trip.destination}, ${formatDateTime(new Date(trip.departsAt), "fr")}${seat ? `, place ${seat}` : ""}`,
    parcel: (code) => `Colis ${code}`,
    kitchen: "Cuisine",
    table: "Table",
    takeaway: "À emporter",
    delivery: "Livraison",
    bill: "Addition",
    unpaid: "Non payée : à régler à la caisse",
    total: "Total",
    deliveryNote: "Bon de livraison n°",
    recipient: "Pour",
    from: "Depuis",
    manifest: "Liste de départ",
    departs: "Départ",
    vehicle: "Véhicule",
    driver: "Chauffeur",
    passengers: "Voyageurs",
    parcels: "Colis",
    parcelSlip: "Colis",
    sender: "Expéditeur",
    receiver: "Destinataire",
    fee: "Prix",
    paidBy: "Payé",
    paidNow: "au départ",
    paidOnArrival: "à l'arrivée",
    code: "Code",
    folio: "Note de la chambre",
    advance: "Avance reçue",
    balance: "Reste à payer",
    preorder: "Commande n°",
    due: "Pour le",
    deposit: "Acompte",
  },
  ar: {
    nights: (room, n) => `الغرفة ${room}، الليالي: ${n}`,
    seat: (trip, seat) => `${trip.origin} ← ${trip.destination}، ${formatDateTime(new Date(trip.departsAt), "ar")}${seat ? `، المقعد ${seat}` : ""}`,
    parcel: (code) => `طرد ${code}`,
    kitchen: "المطبخ",
    table: "الطاولة",
    takeaway: "للأخذ",
    delivery: "توصيل",
    bill: "الحساب",
    unpaid: "غير مدفوع: يدفع عند الصندوق",
    total: "المجموع",
    deliveryNote: "وصل تسليم رقم",
    recipient: "إلى",
    from: "من",
    manifest: "قائمة الانطلاق",
    departs: "الانطلاق",
    vehicle: "المركبة",
    driver: "السائق",
    passengers: "المسافرون",
    parcels: "الطرود",
    parcelSlip: "طرد",
    sender: "المرسل",
    receiver: "المستلم",
    fee: "الثمن",
    paidBy: "الدفع",
    paidNow: "عند الإرسال",
    paidOnArrival: "عند الوصول",
    code: "الرمز",
    folio: "فاتورة الغرفة",
    advance: "التسبيق المستلم",
    balance: "الباقي للدفع",
    preorder: "طلبية رقم",
    due: "ليوم",
    deposit: "عربون",
  },
  en: {
    nights: (room, n) => `Room ${room}, ${n} ${n > 1 ? "nights" : "night"}`,
    seat: (trip, seat) => `${trip.origin} → ${trip.destination}, ${formatDateTime(new Date(trip.departsAt), "en")}${seat ? `, seat ${seat}` : ""}`,
    parcel: (code) => `Parcel ${code}`,
    kitchen: "Kitchen",
    table: "Table",
    takeaway: "Takeaway",
    delivery: "Delivery",
    bill: "Bill",
    unpaid: "Not paid: to settle at the till",
    total: "Total",
    deliveryNote: "Delivery note no.",
    recipient: "To",
    from: "From",
    manifest: "Departure list",
    departs: "Departs",
    vehicle: "Vehicle",
    driver: "Driver",
    passengers: "Passengers",
    parcels: "Parcels",
    parcelSlip: "Parcel",
    sender: "Sender",
    receiver: "Receiver",
    fee: "Fee",
    paidBy: "Paid",
    paidNow: "on sending",
    paidOnArrival: "on arrival",
    code: "Code",
    folio: "Room bill",
    advance: "Advance received",
    balance: "Left to pay",
    preorder: "Order no.",
    due: "For",
    deposit: "Deposit",
  },
};

export function registerTrades(context: Context): void {
  const db = context.database;
  const device = context.deviceId;
  const language = () => context.configuration()?.language.app ?? "fr";
  const words = () => WORDS[language()] ?? WORDS.fr;
  const money = (minor: number) => `${formatAmount(minor, language())} MRU`;
  const at = (iso: string) => formatDateTime(new Date(iso), language());

  const read = <A extends unknown[], T>(channel: string, run: (...args: A) => T) => {
    ipcMain.handle(channel, (_event, ...args: unknown[]): Answer<T> => {
      try {
        return { ok: true, value: run(...(args as A)) };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) };
      }
    });
  };
  const write = <A extends unknown[], T>(channel: string, run: (...args: A) => T | Promise<T>) => {
    ipcMain.handle(channel, async (_event, ...args: unknown[]): Promise<Answer<T>> => {
      if (!(await context.writable())) return { ok: false, reason: "read_only" };
      try {
        return { ok: true, value: await run(...(args as A)) };
      } catch (error) {
        const code = (error as { code?: string }).code;
        return { ok: false, reason: code ?? (error instanceof Error ? error.message : String(error)) };
      }
    });
  };

  const settings = (): PrintSettings => ({
    printer: getSetting(db(), "print_printer"),
    paper: ((getSetting(db(), "print_paper") as Paper | null) ?? "80") as Paper,
  });
  const print = async (doc: PrintedDocument) => {
    const configuration = context.configuration();
    if (!configuration) return { ok: false, reason: "no_configuration" };
    return printHtml(documentHtml(configuration as Configuration, settings().paper, doc), settings());
  };

  /* ── The cash book: expenses, cash put in or taken out ──────────────── */

  write("cashbook:add", (input: NewCashMovement) => addCashMovement(db(), device(), input));
  read("cashbook:between", (from: string, to: string) => cashMovementsBetween(db(), from, to));

  /* ── Restaurant ─────────────────────────────────────────────────────── */

  read("orders:open", () => openOrders(db()));
  read("orders:get", (id: string) => getOrder(db(), id));
  write("orders:start", (input: { service: Service; tableNo?: number | null; guests?: number | null; customer?: string; phone?: string; address?: string }) =>
    startOrder(db(), device(), input)
  );
  write("orders:add", (input: { orderId: string; productId: string; quantity?: number; note?: string }) => addToOrder(db(), device(), input));
  write("orders:change", (lineId: string, quantity: number) => changeOrderLine(db(), device(), lineId, quantity));
  write("orders:move", (orderId: string, tableNo: number) => moveOrder(db(), orderId, tableNo));
  write("orders:cancel", (orderId: string, reason: string) => cancelOrder(db(), device(), orderId, reason));
  write("orders:send", async (orderId: string, printIt: boolean) => {
    const lines = sendToKitchen(db(), orderId);
    const detail = getOrder(db(), orderId);
    let printed: { ok: boolean; reason?: string } | null = null;
    if (printIt && lines.length > 0 && detail) {
      const w = words();
      const where =
        detail.order.service === "dine_in" ? `${w.table} ${detail.order.tableNo}` : detail.order.service === "takeaway" ? w.takeaway : w.delivery;
      printed = await print({
        title: `${w.kitchen} · ${where}`,
        large: true,
        bare: true,
        meta: [["#", String(detail.order.number)], ["", at(new Date().toISOString())]],
        rows: lines.map((line) => ({
          left: `${formatQuantity(line.quantity, language())} × ${language() === "ar" && line.nameArabic ? line.nameArabic : line.name}`,
          note: line.note ?? undefined,
          strong: true,
        })),
      });
    }
    return { sent: lines.length, printed };
  });
  ipcMain.handle("orders:bill", async (_event, orderId: string) => {
    const detail = getOrder(db(), orderId);
    if (!detail) return { ok: false, reason: "no_order" };
    const w = words();
    const where =
      detail.order.service === "dine_in" ? `${w.table} ${detail.order.tableNo}` : detail.order.service === "takeaway" ? w.takeaway : w.delivery;
    return print({
      title: `${w.bill} · ${where}`,
      meta: [["#", String(detail.order.number)], ["", at(new Date().toISOString())]],
      rows: detail.lines
        .filter((line) => !line.cancelledAt)
        .map((line) => ({
          left: `${formatQuantity(line.quantity, language())} × ${language() === "ar" && line.nameArabic ? line.nameArabic : line.name}`,
          right: formatAmount(Math.round(line.quantity * line.unitPrice), language()),
        })),
      total: [w.total, money(detail.order.total)],
      footer: w.unpaid,
    });
  });
  write("orders:pay", (orderId: string, payment: Omit<NewSale, "lines" | "reference">) => payOrder(db(), device(), orderId, payment));

  /* ── Bakery ─────────────────────────────────────────────────────────── */

  read("bakery:day", (day?: string) => dayOf(db(), day ?? today()));
  write("bakery:produce", (items: { productId: string; quantity: number }[]) => recordProduction(db(), device(), items));
  write("bakery:unsold", (items: { productId: string; quantity: number }[]) => recordUnsold(db(), device(), items));
  read("preorders:list", (which?: "open" | "all") => listPreorders(db(), which ?? "open"));
  write("preorders:create", (input: Parameters<typeof createPreorder>[2]) => createPreorder(db(), device(), input));
  write("preorders:ready", (id: string) => markPreorderReady(db(), id));
  write("preorders:collect", (id: string, payment: Omit<NewSale, "lines" | "reference" | "prepaid">) => collectPreorder(db(), device(), id, payment));
  write("preorders:cancel", (id: string, refund: boolean) => cancelPreorder(db(), device(), id, refund));
  ipcMain.handle("preorders:print", async (_event, id: string) => {
    const order = listPreorders(db(), "all").find((one) => one.id === id);
    if (!order) return { ok: false, reason: "no_order" };
    const w = words();
    return print({
      title: `${w.preorder} ${order.number}`,
      meta: [[w.recipient, order.customer], [w.due, order.dueOn.split("-").reverse().join("/")]],
      rows: order.lines.map((line) => ({ left: `${formatQuantity(line.quantity, language())} × ${line.name}`, right: formatAmount(Math.round(line.quantity * line.unitPrice), language()) })),
      total: [w.total, money(order.total)],
      footer: order.received > 0 ? `${w.deposit} : ${money(order.received)} · ${w.balance} : ${money(order.total - order.received)}` : undefined,
    });
  });

  /* ── Warehouse ──────────────────────────────────────────────────────── */

  const placeNames = () => {
    const count = context.configuration()?.features.warehouse?.locations ?? 1;
    const word = { fr: "Dépôt", ar: "مستودع", en: "Store" }[language()];
    return Array.from({ length: Math.max(1, count) }, (_, index) => `${word} ${index + 1}`);
  };
  read("locations:list", () => (listLocations(db()).length === 0 ? ensureLocations(db(), device(), placeNames()) : listLocations(db())));
  write("locations:add", (name: string) => addLocation(db(), device(), name));
  write("locations:rename", (id: string, name: string) => renameLocation(db(), id, name));
  read("stock:byLocation", () => stockByLocation(db()));
  write("stock:transfer", (input: Parameters<typeof transfer>[2]) => transfer(db(), device(), input));
  write("dispatch:send", (input: DispatchInput) => dispatch(db(), device(), input));
  read("dispatch:between", (from: string, to: string) => dispatchesBetween(db(), from, to));
  read("warehouse:flows", (from: string, to: string) => flowsBetween(db(), from, to));
  ipcMain.handle("dispatch:print", async (_event, id: string) => {
    const note = dispatchesBetween(db(), "2000-01-01", "9999").find((one) => one.id === id);
    if (!note) return { ok: false, reason: "no_note" };
    const w = words();
    return print({
      title: `${w.deliveryNote} ${note.number}`,
      meta: [[w.recipient, note.recipient], ...(note.locationName ? ([[w.from, note.locationName]] as [string, string][]) : []), ["", at(note.occurredAt)]],
      rows: note.lines.map((line) => ({
        left: `${formatQuantity(line.quantity, language())} ${line.unit ?? ""} × ${line.name}`.replace("  ", " "),
        right: line.unitPrice !== null ? formatAmount(Math.round(line.quantity * line.unitPrice), language()) : undefined,
      })),
      total: note.total !== null ? [w.total, money(note.total)] : undefined,
      footer: note.note ?? undefined,
    });
  });

  /* ── Hotel ──────────────────────────────────────────────────────────── */

  read("rooms:list", () => listRooms(db()));
  write("rooms:add", (input: { number: string; kind?: string; rate: number; capacity?: number }) => addRoom(db(), device(), input));
  write("rooms:update", (id: string, input: { kind?: string; rate?: number; capacity?: number }) => updateRoom(db(), id, input));
  write("rooms:status", (id: string, status: "available" | "cleaning" | "out_of_service") => setRoomStatus(db(), id, status));
  read("stays:list", (which?: "current" | "all") => listStays(db(), which ?? "current"));
  read("stays:get", (id: string) => getStay(db(), id));
  write("stays:book", (input: Parameters<typeof bookStay>[2]) => bookStay(db(), device(), input));
  write("stays:checkIn", (id: string) => checkIn(db(), id));
  write("stays:advance", (id: string, amount: number, payment: "cash" | "mobile") => addAdvance(db(), device(), id, amount, payment));
  write("stays:charge", (input: { stayId: string; label: string; quantity?: number; unitPrice: number }) => addCharge(db(), device(), input));
  read("stays:folio", (id: string) => folioOf(db(), id, words().nights));
  write("stays:checkOut", (id: string, payment: Omit<NewSale, "lines" | "reference" | "prepaid">) => checkOut(db(), device(), id, payment, words().nights));
  write("stays:cancel", (id: string, refund: boolean) => cancelStay(db(), device(), id, refund));
  read("hotel:occupancy", (from: string, to: string) => occupancy(db(), from, to));
  ipcMain.handle("stays:print", async (_event, id: string) => {
    const folio = folioOf(db(), id, words().nights);
    const w = words();
    return print({
      title: `${w.folio} · ${folio.stay.roomNumber}`,
      meta: [[w.recipient, folio.stay.guest], ["", `${folio.stay.arrivesOn.split("-").reverse().join("/")} → ${folio.stay.leavesOn.split("-").reverse().join("/")}`]],
      rows: folio.lines.map((line) => ({ left: line.label, right: formatAmount(line.total, language()) })),
      total: [w.total, money(folio.total)],
      footer: folio.received > 0 ? `${w.advance} : ${money(folio.received)} · ${w.balance} : ${money(folio.balance)}` : undefined,
    });
  });

  /* ── Transport ──────────────────────────────────────────────────────── */

  read("routes:list", () => listRoutes(db()));
  write("routes:add", (input: { origin: string; destination: string; fare: number; parcelFee?: number | null }) => addRoute(db(), device(), input));
  write("routes:update", (id: string, input: { fare?: number; parcelFee?: number | null }) => updateRoute(db(), id, input));
  read("vehicles:list", () => listVehicles(db()));
  write("vehicles:add", (input: { plate: string; seats: number }) => addVehicle(db(), device(), input));
  read("trips:between", (from: string, to: string) => tripsBetween(db(), from, to));
  read("trips:detail", (id: string) => {
    const trip = getTrip(db(), id);
    if (!trip) throw new Error("no such trip");
    return { trip, tickets: ticketsOf(db(), id), parcels: parcelsOf(db(), id) };
  });
  write("trips:schedule", (input: Parameters<typeof scheduleTrip>[2]) => scheduleTrip(db(), device(), input));
  write("trips:status", (id: string, status: "departed" | "arrived" | "cancelled") => setTripStatus(db(), device(), id, status));
  write("tickets:sell", (input: { tripId: string; seat?: number | null; passenger: string; phone?: string; fare?: number; payment: Omit<NewSale, "lines" | "reference"> }) =>
    sellTicket(db(), device(), { ...input, label: words().seat })
  );
  write("tickets:board", (id: string) => boardTicket(db(), id));
  write("tickets:cancel", (id: string, reason: string) => cancelTicket(db(), device(), id, reason));
  read("parcels:list", (which?: "open" | "all", term?: string) => listParcels(db(), which ?? "open", term ?? ""));
  write("parcels:register", (input: Omit<Parameters<typeof registerParcel>[2], "label">) => registerParcel(db(), device(), { ...input, label: words().parcel }));
  write("parcels:load", (id: string, tripId: string) => loadParcel(db(), id, tripId));
  write("parcels:arrived", (id: string) => markParcelArrived(db(), id));
  write("parcels:deliver", (id: string, payment: Omit<NewSale, "lines" | "reference"> | null) => deliverParcel(db(), device(), id, payment, words().parcel));
  write("parcels:cancel", (id: string, reason: string) => cancelParcel(db(), device(), id, reason));
  read("transport:takings", (from: string, to: string) => routeTakings(db(), from, to));
  ipcMain.handle("trips:manifest", async (_event, id: string) => {
    const trip = getTrip(db(), id);
    if (!trip) return { ok: false, reason: "no_trip" };
    const w = words();
    const tickets = ticketsOf(db(), id).filter((ticket) => ticket.status !== "cancelled");
    const parcels = parcelsOf(db(), id);
    return print({
      title: `${w.manifest} · ${trip.origin} → ${trip.destination}`,
      meta: [
        [w.departs, at(trip.departsAt)],
        ...(trip.plate ? ([[w.vehicle, trip.plate]] as [string, string][]) : []),
        ...(trip.driver ? ([[w.driver, trip.driver]] as [string, string][]) : []),
        [w.passengers, `${tickets.length} / ${trip.seats}`],
      ],
      rows: [
        ...tickets.map((ticket) => ({ left: `${ticket.seat ?? "-"} · ${ticket.passenger}`, right: ticket.phone ?? "" })),
        ...(parcels.length > 0 ? [{ left: `${w.parcels} (${parcels.length})`, strong: true }] : []),
        ...parcels.map((parcel) => ({ left: `${parcel.code} · ${parcel.receiver}`, right: parcel.receiverPhone ?? "" })),
      ],
    });
  });
  ipcMain.handle("parcels:print", async (_event, id: string) => {
    const parcel = listParcels(db(), "all").find((one) => one.id === id);
    if (!parcel) return { ok: false, reason: "no_parcel" };
    const w = words();
    return print({
      title: `${w.parcelSlip} ${parcel.code}`,
      large: true,
      meta: [
        [w.code, parcel.code],
        [w.sender, `${parcel.sender}${parcel.senderPhone ? ` · ${parcel.senderPhone}` : ""}`],
        [w.receiver, `${parcel.receiver}${parcel.receiverPhone ? ` · ${parcel.receiverPhone}` : ""}`],
        ...(parcel.destination ? ([["→", parcel.destination]] as [string, string][]) : []),
      ],
      rows: parcel.description ? [{ left: parcel.description }] : [],
      total: [w.fee, money(parcel.fee)],
      footer: `${w.paidBy} ${parcel.paidBy === "sender" ? w.paidNow : w.paidOnArrival}`,
    });
  });
}
