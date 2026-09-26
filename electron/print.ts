import { BrowserWindow } from "electron";
import type { Configuration } from "@app-ui/config";
import { formatAmount, formatDateTime, formatQuantity } from "@app-ui/format";
import type { ReceiptContext } from "./db/receipts";
import type { SaleDetail } from "./db/sales";

/*
 * The printed receipt.
 *
 * Drawn as its own small page, in a window nobody sees, and sent to the
 * printer from there. Printing the till's own window instead would send the
 * whole screen's height to a thermal printer, which feeds a metre of blank
 * paper for a four-line ticket.
 *
 * Black on white, the monochrome logo, and nothing a thermal head cannot do.
 * Latin text is monospaced so it looks typed; Arabic uses a font that joins
 * its letters, because a monospaced one prints them loose.
 */

export type Paper = "58" | "80" | "a4";

export type PrintSettings = { printer: string | null; paper: Paper };

type Words = {
  receipt: string;
  order: string;
  ticket: string;
  stay: string;
  parcel: string;
  voidOf: string;
  date: string;
  time: string;
  dineIn: string;
  takeaway: string;
  delivery: string;
  table: string;
  guests: string;
  article: string;
  designation: string;
  qty: string;
  unitPrice: string;
  amount: string;
  subtotal: string;
  discount: string;
  total: string;
  totalPaid: string;
  stayTotal: string;
  advance: string;
  balancePaid: string;
  payments: string;
  cash: string;
  mobile: string;
  credit: string;
  received: string;
  change: string;
  customer: string;
  guest: string;
  room: string;
  arrival: string;
  departure: string;
  nights: string;
  route: string;
  departs: string;
  seat: string;
  passenger: string;
  phone: string;
  vehicle: string;
  fare: string;
  sender: string;
  receiver: string;
  contents: string;
  weight: string;
  parcelFee: string;
  paidBySender: string;
  paidByReceiver: string;
  dueOn: string;
  lot: string;
  expires: string;
  thanksRestaurant: string;
  thanksHotel: string;
  thanksTicket: string;
  thanksParcel: string;
  thanksBakery: string;
  thanksShop: string;
  thanksTrust: string;
  test: string;
  testLine: string;
};

const words: Record<"fr" | "ar" | "en", Words> = {
  fr: {
    receipt: "Reçu n°",
    order: "Commande n°",
    ticket: "Billet n°",
    stay: "Séjour n°",
    parcel: "Colis",
    voidOf: "Annulation de la vente n°",
    date: "Date",
    time: "Heure",
    dineIn: "Sur place",
    takeaway: "À emporter",
    delivery: "Livraison",
    table: "Table",
    guests: "{n} couverts",
    article: "Article",
    designation: "Désignation",
    qty: "Qté",
    unitPrice: "P.U.",
    amount: "Montant",
    subtotal: "Sous-total",
    discount: "Remise",
    total: "Total",
    totalPaid: "Total payé",
    stayTotal: "Total du séjour",
    advance: "Avance versée",
    balancePaid: "Reste payé",
    payments: "Paiements",
    cash: "Espèces",
    mobile: "Application",
    credit: "À crédit",
    received: "Reçu",
    change: "Rendu",
    customer: "Client",
    guest: "Client",
    room: "Chambre",
    arrival: "Arrivée",
    departure: "Départ",
    nights: "Nuits",
    route: "Trajet",
    departs: "Départ",
    seat: "Place",
    passenger: "Passager",
    phone: "Téléphone",
    vehicle: "Véhicule",
    fare: "Tarif",
    sender: "Expéditeur",
    receiver: "Destinataire",
    contents: "Contenu",
    weight: "Poids",
    parcelFee: "Frais d'envoi",
    paidBySender: "Payé à l'envoi",
    paidByReceiver: "Payé au retrait",
    dueOn: "Pour le",
    lot: "Lot",
    expires: "Exp.",
    thanksRestaurant: "Merci pour votre visite",
    thanksHotel: "Merci de votre séjour, au plaisir de vous revoir",
    thanksTicket: "Présentez ce billet à l'embarquement. Bon voyage.",
    thanksParcel: "Le destinataire présente ce reçu pour retirer le colis.",
    thanksBakery: "Merci et à bientôt",
    thanksShop: "Merci de votre visite",
    thanksTrust: "Merci de votre confiance",
    test: "Essai d'impression",
    testLine: "Si vous lisez ceci, l'imprimante est prête.",
  },
  ar: {
    receipt: "وصل رقم",
    order: "طلب رقم",
    ticket: "تذكرة رقم",
    stay: "إقامة رقم",
    parcel: "طرد",
    voidOf: "إلغاء عملية البيع رقم",
    date: "التاريخ",
    time: "الساعة",
    dineIn: "في المطعم",
    takeaway: "سفري",
    delivery: "توصيل",
    table: "طاولة",
    guests: "{n} أشخاص",
    article: "الصنف",
    designation: "البيان",
    qty: "الكمية",
    unitPrice: "السعر",
    amount: "المبلغ",
    subtotal: "المجموع الجزئي",
    discount: "تخفيض",
    total: "المجموع",
    totalPaid: "المبلغ المدفوع",
    stayTotal: "مجموع الإقامة",
    advance: "العربون المدفوع",
    balancePaid: "الباقي المدفوع",
    payments: "الدفع",
    cash: "نقدا",
    mobile: "تطبيق",
    credit: "بالدين",
    received: "المستلم",
    change: "الباقي",
    customer: "الزبون",
    guest: "النزيل",
    room: "الغرفة",
    arrival: "الوصول",
    departure: "المغادرة",
    nights: "الليالي",
    route: "الخط",
    departs: "الانطلاق",
    seat: "المقعد",
    passenger: "المسافر",
    phone: "الهاتف",
    vehicle: "المركبة",
    fare: "ثمن التذكرة",
    sender: "المرسل",
    receiver: "المرسل إليه",
    contents: "المحتوى",
    weight: "الوزن",
    parcelFee: "رسوم الإرسال",
    paidBySender: "مدفوع عند الإرسال",
    paidByReceiver: "مدفوع عند الاستلام",
    dueOn: "موعد التسليم",
    lot: "الدفعة",
    expires: "ينتهي",
    thanksRestaurant: "شكرا لزيارتكم",
    thanksHotel: "شكرا لإقامتكم، نتطلع لرؤيتكم مجددا",
    thanksTicket: "قدموا هذه التذكرة عند الصعود. رحلة سعيدة.",
    thanksParcel: "يقدم المرسل إليه هذا الوصل لاستلام الطرد.",
    thanksBakery: "شكرا، إلى اللقاء",
    thanksShop: "شكرا لزيارتكم",
    thanksTrust: "شكرا لثقتكم",
    test: "تجربة الطباعة",
    testLine: "إذا قرأت هذا، فالطابعة جاهزة.",
  },
  en: {
    receipt: "Receipt no.",
    order: "Order no.",
    ticket: "Ticket no.",
    stay: "Stay no.",
    parcel: "Parcel",
    voidOf: "Void of sale no.",
    date: "Date",
    time: "Time",
    dineIn: "Eat in",
    takeaway: "Takeaway",
    delivery: "Delivery",
    table: "Table",
    guests: "{n} guests",
    article: "Item",
    designation: "Description",
    qty: "Qty",
    unitPrice: "Price",
    amount: "Amount",
    subtotal: "Subtotal",
    discount: "Discount",
    total: "Total",
    totalPaid: "Total paid",
    stayTotal: "Stay total",
    advance: "Advance paid",
    balancePaid: "Balance paid",
    payments: "Payments",
    cash: "Cash",
    mobile: "App",
    credit: "On credit",
    received: "Received",
    change: "Change",
    customer: "Customer",
    guest: "Guest",
    room: "Room",
    arrival: "Arrival",
    departure: "Departure",
    nights: "Nights",
    route: "Route",
    departs: "Departure",
    seat: "Seat",
    passenger: "Passenger",
    phone: "Phone",
    vehicle: "Vehicle",
    fare: "Fare",
    sender: "Sender",
    receiver: "Receiver",
    contents: "Contents",
    weight: "Weight",
    parcelFee: "Sending fee",
    paidBySender: "Paid at sending",
    paidByReceiver: "Paid at collection",
    dueOn: "For",
    lot: "Batch",
    expires: "Exp.",
    thanksRestaurant: "Thank you for your visit",
    thanksHotel: "Thank you for staying with us, we hope to see you again",
    thanksTicket: "Show this ticket when boarding. Have a good journey.",
    thanksParcel: "The receiver shows this receipt to collect the parcel.",
    thanksBakery: "Thank you, see you soon",
    thanksShop: "Thank you for your visit",
    thanksTrust: "Thank you for your trust",
    test: "Test print",
    testLine: "If you can read this, the printer is ready.",
  },
};

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

const WIDTH_MM: Record<Paper, number> = { "58": 58, "80": 80, a4: 80 }; // not-a-rule: the two thermal rolls, and a receipt-width block on A4

function page(configuration: Configuration, paper: Paper, body: string): string {
  const language = configuration.language.app;
  const rtl = language === "ar";
  const { business, receipt } = configuration;
  const width = WIDTH_MM[paper];
  const small = paper === "58";

  const header = [
    receipt.showLogo && business.logoMono ? `<img class="logo" src="${escape(business.logoMono)}" alt="">` : "",
    `<div class="name">${escape(business.nameLatin)}</div>`,
    business.nameArabic ? `<div class="name ar">${escape(business.nameArabic)}</div>` : "",
    receipt.showAddress && business.address ? `<div>${escape(business.address)}</div>` : "",
    receipt.showPhone && business.phone ? `<div dir="ltr">${escape(business.phone)}</div>` : "",
  ].join("");

  const footer = receipt.footer ? `<div class="rule"></div><div class="centre">${escape(receipt.footer)}</div>` : "";

  return `<!doctype html>
<html lang="${language}" dir="${rtl ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8">
<style>
  @page { margin: 0; ${paper === "a4" ? "size: A4;" : `size: ${width}mm auto;`} }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body {
    width: ${width}mm;
    padding: 3mm ${small ? 2 : 4}mm 6mm;
    font-family: ${rtl ? '"Geeza Pro", "Noto Naskh Arabic", "Segoe UI", Arial, sans-serif' : '"Courier New", ui-monospace, monospace'};
    font-size: ${small ? 11 : 13}px;
    line-height: 1.35;
    ${paper === "a4" ? "margin: 10mm auto;" : ""}
  }
  .centre { text-align: center; }
  .head { text-align: center; margin-bottom: 2mm; }
  .logo { max-width: 60%; max-height: 22mm; display: block; margin: 0 auto 2mm; filter: grayscale(1); }
  .name { font-weight: bold; font-size: ${small ? 13 : 16}px; }
  .ar { font-family: "Geeza Pro", "Noto Naskh Arabic", "Segoe UI", Arial, sans-serif; }
  .rule { border-top: 1px dashed #000; margin: 2mm 0; }
  .row { display: flex; justify-content: space-between; gap: 2mm; }
  .row span:last-child { white-space: nowrap; }
  .item { margin-bottom: 1.2mm; }
  .qty { opacity: 0.9; }
  .total { font-weight: bold; font-size: ${small ? 13 : 16}px; }
  .num { direction: ltr; unicode-bidi: isolate; }
  .title { font-weight: bold; font-size: ${small ? 13 : 15}px; margin-bottom: 1mm; }
  .meta { margin: 0.4mm 0; }
  .small { font-size: ${small ? 10 : 11}px; opacity: 0.8; }
  .label { font-size: ${small ? 10 : 11}px; text-transform: uppercase; letter-spacing: 0.04em; }
  .route { font-weight: bold; font-size: ${small ? 15 : 19}px; margin: 1.5mm 0; }
  .boarding { display: flex; justify-content: space-around; align-items: center; border: 1.5px solid #000; border-radius: 2mm; padding: 2mm; margin: 2mm 0; }
  .big { font-weight: bold; font-size: ${small ? 13 : 16}px; }
  .huge { font-weight: bold; font-size: ${small ? 26 : 34}px; line-height: 1; }
  .seat { border-inline-start: 1.5px dashed #000; padding-inline-start: 3mm; }
  .party { text-align: start; margin: 1mm 0; }
  /* The name takes what the figures leave: on an 80 mm roll every millimetre of it is a letter. */
  .cols { display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto; column-gap: 3mm; row-gap: 1.6mm; align-items: start; }
  .cols .heading { font-size: ${small ? 10 : 11}px; text-transform: uppercase; letter-spacing: 0.04em; }
  .cols .span { grid-column: 1 / -1; }
  .cols .item-name { min-width: 0; overflow-wrap: break-word; }
  .under { display: block; font-size: ${small ? 10 : 11}px; font-style: italic; opacity: 0.85; margin-top: -1.2mm; }
  .end { text-align: end; }
  .rule.thin { border-top-style: dotted; margin: 1mm 0; }
  .strong { font-weight: bold; }
  .section { font-weight: bold; text-transform: uppercase; margin: 2mm 0 1mm; }
  .grand { font-weight: bold; font-size: ${small ? 15 : 19}px; text-transform: uppercase; align-items: baseline; }
  .thanks { margin-top: 2mm; }
</style>
</head>
<body>
  <div class="head">${header}</div>
  <div class="rule"></div>
  ${body}
  ${footer}
</body>
</html>`;
}

/*
 * The receipt, laid out for the trade that prints it.
 *
 * Every receipt has the same bones: the shop at the top, what the paper is
 * and when, the lines in columns, what was paid and how, and a word of
 * thanks. What differs is what the customer needs to keep. A table's bill
 * says the table and the kind of service, and what the kitchen was asked. A
 * hotel's says the room, the dates and the nights, and takes off the
 * advance. A bus ticket is the boarding pass: the route, the departure and
 * the seat, large. A parcel's names who sent it and who collects it. A
 * pharmacy's gives each product's batch and date. The context comes from
 * what the sale settled (db/receipts.ts); a sale that settled nothing is a
 * sale at the counter.
 */
export function receiptHtml(configuration: Configuration, sale: SaleDetail, paper: Paper, context: ReceiptContext | null = null): string {
  const language = configuration.language.app;
  const w = words[language] ?? words.fr;
  const pack = configuration.pack;
  const reversal = sale.reversesNumber !== null;
  const sign = reversal ? -1 : 1;
  /* Whole ouguiyas are printed whole: "150", not "150,00", as a till roll writes them. */
  const amount = (minor: number) => {
    const text = minor % 100 === 0 ? formatQuantity(minor / 100, language) : formatAmount(minor, language);
    return `<span class="num">${escape(text)}</span>`;
  };
  const withCurrency = (minor: number) => `<span class="num">${escape(minor % 100 === 0 ? formatQuantity(minor / 100, language) : formatAmount(minor, language))} MRU</span>`;
  const when = new Date(sale.occurredAt);
  const pad = (value: number) => String(value).padStart(2, "0");
  const dateText = (date: Date) =>
    language === "en" ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` : `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
  const dayText = (isoDay: string) => {
    const [year, month, dayOfMonth] = isoDay.slice(0, 10).split("-");
    return language === "en" ? `${year}-${month}-${dayOfMonth}` : `${dayOfMonth}/${month}/${year}`;
  };
  const clockText = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  /* French sets a space before a colon; Arabic and English do not. */
  const colon = language === "fr" ? " :" : ":";
  const line = (label: string, value: string) => `<div class="meta"><span>${escape(label)}${colon}</span> <span class="num">${escape(value)}</span></div>`;
  const pair = (label: string, value: string, cls = "") => `<div class="row ${cls}"><span>${escape(label)}</span><span>${value}</span></div>`;

  /* ── What the paper is, and when ─────────────────────────────────────── */

  const head: string[] = [];
  if (reversal) head.push(`<div class="title">${escape(w.voidOf)} <span class="num">${sale.reversesNumber}</span></div>`);

  if (context?.kind === "ticket") {
    head.push(`<div class="title">${escape(w.ticket)} <span class="num">${context.number}</span></div>`);
    head.push(`<div class="route">${escape(context.origin)} → ${escape(context.destination)}</div>`);
    const departs = new Date(context.departsAt);
    head.push(`<div class="boarding">
      <div><div class="label">${escape(w.departs)}</div><div class="big num">${escape(dateText(departs))}</div><div class="big num">${escape(clockText(departs))}</div></div>
      ${context.seat ? `<div class="seat"><div class="label">${escape(w.seat)}</div><div class="huge num">${context.seat}</div></div>` : ""}
    </div>`);
    head.push(line(w.passenger, context.passenger));
    if (context.phone) head.push(line(w.phone, context.phone));
    if (context.plate) head.push(line(w.vehicle, context.plate));
  } else if (context?.kind === "parcel") {
    head.push(`<div class="title">${escape(w.parcel)} <span class="num">${escape(context.code)}</span></div>`);
    if (context.origin && context.destination) head.push(`<div class="route">${escape(context.origin)} → ${escape(context.destination)}</div>`);
    head.push(line(w.date, `${dateText(when)} ${clockText(when)}`));
    head.push(`<div class="rule"></div>`);
    head.push(`<div class="party"><div class="label">${escape(w.sender)}</div><div><b>${escape(context.sender)}</b></div>${context.senderPhone ? `<div class="num">${escape(context.senderPhone)}</div>` : ""}</div>`);
    head.push(`<div class="party"><div class="label">${escape(w.receiver)}</div><div><b>${escape(context.receiver)}</b></div>${context.receiverPhone ? `<div class="num">${escape(context.receiverPhone)}</div>` : ""}</div>`);
    if (context.description) head.push(line(w.contents, context.description));
    if (context.weight) head.push(line(w.weight, `${formatQuantity(context.weight, language)} kg`));
  } else if (context?.kind === "stay") {
    head.push(`<div class="title">${escape(w.stay)} <span class="num">${context.number}</span></div>`);
    head.push(line(w.guest, context.guest));
    head.push(line(w.room, [context.room, context.roomKind].filter(Boolean).join(" · ")));
    head.push(line(w.arrival, dayText(context.checkedInAt ?? context.arrivesOn)));
    head.push(line(w.departure, dayText(context.checkedOutAt ?? context.leavesOn)));
  } else if (context?.kind === "order") {
    head.push(`<div class="title">${escape(w.order)} <span class="num">${context.number}</span></div>`);
    head.push(line(w.date, dateText(when)));
    head.push(line(w.time, clockText(when)));
    const service = context.service === "takeaway" ? w.takeaway : context.service === "delivery" ? w.delivery : w.dineIn;
    const table = context.service === "dine_in" && context.table ? ` · ${w.table} ${context.table}` : "";
    const guests = context.service === "dine_in" && context.guests ? ` · ${w.guests.replace("{n}", String(context.guests))}` : "";
    head.push(`<div class="meta"><b>${escape(service + table + guests)}</b></div>`);
    if (context.customer) head.push(line(w.customer, context.customer));
  } else if (context?.kind === "preorder") {
    head.push(`<div class="title">${escape(w.order)} <span class="num">${context.number}</span></div>`);
    head.push(line(w.customer, context.customer));
    head.push(line(w.dueOn, dayText(context.dueOn)));
    head.push(line(w.date, `${dateText(when)} ${clockText(when)}`));
  } else {
    head.push(`<div class="title">${escape(w.receipt)} <span class="num">${sale.number}</span></div>`);
    head.push(line(w.date, dateText(when)));
    head.push(line(w.time, clockText(when)));
  }
  if (context && context.kind !== "stay" && context.kind !== "preorder" && !reversal) {
    /* The sale's own number under the paper's, for whoever looks it up in the till's history. */
    head.push(`<div class="meta small">${escape(w.receipt)} <span class="num">${sale.number}</span></div>`);
  }

  /* ── The lines ───────────────────────────────────────────────────────── */

  /* A ticket and a parcel are one price, said once: no table of one line. */
  const single = context?.kind === "ticket" || context?.kind === "parcel";
  let body = "";
  if (single) {
    body = pair(context?.kind === "ticket" ? w.fare : w.parcelFee, withCurrency(sign * sale.subtotal), "strong");
  } else {
    const heading = context?.kind === "stay" ? w.designation : w.article;
    const rows = sale.items
      .map((item) => {
        const name = language === "ar" && item.nameArabic ? item.nameArabic : item.name;
        const under: string[] = [];
        if (context?.kind === "order") for (const note of context.notes[item.productId] ?? []) under.push(note);
        if (pack === "pharmacy") {
          const facts = [item.genericName, item.lot ? `${w.lot} ${item.lot}` : null, item.expiresOn ? `${w.expires} ${item.expiresOn.slice(5, 7)}/${item.expiresOn.slice(0, 4)}` : null].filter(Boolean);
          if (facts.length > 0) under.push(facts.join(" · "));
        }
        /* A warehouse sells by the sack and the case: the unit says what a quantity counts. */
        if (pack === "warehouse" && item.unit) under.unshift(item.unit);
        /* What is said about a line (the kitchen's note, a batch, a unit) runs under it across the whole width. */
        return `<span class="item-name">${escape(name)}</span>
          <span class="num end">${escape(formatQuantity(item.quantity, language))}</span>
          <span class="end">${amount(item.unitPrice)}</span>
          <span class="end">${amount(sign * item.lineTotal)}</span>
          ${under.map((text) => `<span class="under span">${escape(text)}</span>`).join("")}`;
      })
      .join("");
    /* One grid for the heading and every line, so each column lines up down the whole receipt. */
    body = `<div class="cols">
      <span class="heading">${escape(heading)}</span><span class="heading end">${escape(w.qty)}</span><span class="heading end">${escape(w.unitPrice)}</span><span class="heading end">${escape(w.amount)}</span>
      <div class="rule thin span"></div>${rows}</div>`;
  }

  /* ── What was paid, and how ──────────────────────────────────────────── */

  const sums: string[] = [];
  if (sale.discount > 0) {
    sums.push(pair(w.subtotal, amount(sign * sale.subtotal)));
    sums.push(pair(w.discount, amount(-sign * sale.discount)));
  }
  if (sale.prepaid > 0 && !reversal) {
    sums.push(pair(context?.kind === "stay" ? w.stayTotal : w.total, amount(sale.total)));
    sums.push(pair(w.advance, amount(-sale.prepaid)));
  }
  const paidNow = sale.total - (reversal ? 0 : sale.prepaid);

  const payments: string[] = [];
  if (sale.payment === "credit") {
    payments.push(pair(`${w.credit}${sale.customerName ? `${colon} ${sale.customerName}` : ""}`, withCurrency(sign * paidNow)));
  } else if (sale.parts.length > 1) {
    for (const part of sale.parts) payments.push(pair(part.method === "mobile" ? part.mobileApp || w.mobile : w.cash, withCurrency(Math.abs(part.amount))));
  } else {
    const label = sale.payment === "mobile" ? sale.mobileApp || w.mobile : w.cash;
    payments.push(pair(label, withCurrency(sign * paidNow)));
  }
  if (sale.payment === "cash" && sale.received !== null && !reversal) {
    payments.push(pair(w.received, withCurrency(sale.received)));
    payments.push(pair(w.change, withCurrency(sale.received - paidNow)));
  }
  if (context?.kind === "parcel") payments.push(`<div class="meta">${escape(context.paidBy === "receiver" ? w.paidByReceiver : w.paidBySender)}</div>`);
  if (sale.customerName && sale.payment !== "credit") payments.push(pair(w.customer, escape(sale.customerName)));
  if (sale.employee) payments.push(`<div>${escape(sale.employee)}</div>`);

  const totalLabel = sale.prepaid > 0 && !reversal ? w.balancePaid : w.totalPaid;
  const thanks =
    context?.kind === "ticket"
      ? w.thanksTicket
      : context?.kind === "parcel"
        ? w.thanksParcel
        : pack === "restaurant"
          ? w.thanksRestaurant
          : pack === "hotel"
            ? w.thanksHotel
            : pack === "bakery"
              ? w.thanksBakery
              : pack === "shop"
                ? w.thanksShop
                : w.thanksTrust;

  return page(
    configuration,
    paper,
    `<div class="centre">${head.join("")}</div>
     <div class="rule"></div>
     ${body}
     <div class="rule"></div>
     ${sums.join("")}
     <div class="section">${escape(w.payments)}${colon}</div>
     ${payments.join("")}
     <div class="rule"></div>
     <div class="row grand"><span>${escape(totalLabel)}</span>${withCurrency(sign * paidNow)}</div>
     <div class="rule"></div>
     <div class="centre thanks">${escape(thanks)}</div>`
  );
}

export function testHtml(configuration: Configuration, paper: Paper): string {
  const language = configuration.language.app;
  const w = words[language] ?? words.fr;
  return page(
    configuration,
    paper,
    `<div class="centre"><b>${escape(w.test)}</b></div><div class="rule"></div>
     <div class="centre">${escape(w.testLine)}</div>
     <div class="centre num">${escape(formatDateTime(new Date(), language))}</div>
     <div class="rule"></div>
     <div class="row"><span>ABCDEFGHIJ 0123456789</span><span>1 234,50</span></div>
     <div class="ar">أبجد هوز حطي كلمن</div>`
  );
}

/*
 * Any other paper the counter hands over: the kitchen's ticket, a table's
 * bill before it is paid, a delivery note, a bus's passenger list, a
 * parcel's slip. One layout for all of them, with the shop's name on top,
 * so a new kind of paper is data and not another template.
 */
export type PrintedDocument = {
  title: string;
  /** Printed large, for the kitchen: the table and the dishes must read from a metre away. */
  large?: boolean;
  meta?: [string, string][];
  rows: { left: string; right?: string; strong?: boolean; note?: string }[];
  total?: [string, string];
  footer?: string;
  /** A kitchen ticket has no header: the cook needs the dishes, not the address. */
  bare?: boolean;
  /**
   * A sheet of A4 rather than the till roll: a paper kept or handed over
   * (a delivery note, a hotel folio, a passenger list). Receipts and tickets
   * stay on 80 mm.
   */
  sheet?: boolean;
};

export function documentHtml(configuration: Configuration, paper: Paper, doc: PrintedDocument): string {
  const size = doc.large ? "font-size: 18px; line-height: 1.4;" : "";
  const meta = (doc.meta ?? [])
    .map(([label, value]) => `<div class="row"><span>${escape(label)}</span><span class="num">${escape(value)}</span></div>`)
    .join("");
  const rows = doc.rows
    .map(
      (row) => `<div class="item" style="${row.strong ? "font-weight: bold;" : ""}">
        <div class="row"><span>${escape(row.left)}</span>${row.right !== undefined ? `<span class="num">${escape(row.right)}</span>` : ""}</div>
        ${row.note ? `<div>${escape(row.note)}</div>` : ""}
      </div>`
    )
    .join("");
  const total = doc.total
    ? `<div class="rule"></div><div class="row total"><span>${escape(doc.total[0])}</span><span class="num">${escape(doc.total[1])}</span></div>`
    : "";
  const footer = doc.footer ? `<div class="rule"></div><div class="centre">${escape(doc.footer)}</div>` : "";
  const body = `<div style="${size}"><div class="centre"><b>${escape(doc.title)}</b></div>${meta ? `<div class="rule"></div>${meta}` : ""}<div class="rule"></div>${rows}${total}${footer}</div>`;
  if (!doc.bare) return page(configuration, paper, body);
  const bare = { ...configuration, business: { nameLatin: "" }, receipt: { ...configuration.receipt, showLogo: false, footer: undefined } } as Configuration;
  return page(bare, paper, body).replace('<div class="head"><div class="name"></div></div>\n  <div class="rule"></div>', "");
}

const MICRONS_PER_PX = 264.5833; // not-a-rule: 1 CSS pixel is 1/96 inch

/*
 * Prints a page silently: to the printer chosen in Réglages, or to this
 * computer's default one. Answers whether the printer took it, which is not
 * the same as whether paper came out, and the screen says so.
 */
export async function printHtml(html: string, settings: PrintSettings): Promise<{ ok: boolean; reason?: string }> {
  const window = new BrowserWindow({
    show: false,
    width: 400,
    height: 800,
    webPreferences: { javascript: true, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const heightPx = (await window.webContents.executeJavaScript("document.documentElement.scrollHeight")) as number;
    const widthMm = WIDTH_MM[settings.paper];

    return await new Promise((resolve) => {
      window.webContents.print(
        {
          silent: true,
          deviceName: settings.printer ?? undefined,
          printBackground: true,
          margins: { marginType: "none" },
          pageSize:
            settings.paper === "a4"
              ? "A4"
              : { width: widthMm * 1000, height: Math.max(Math.ceil(heightPx * MICRONS_PER_PX) + 5000, 40_000) },
        },
        (success, reason) => resolve(success ? { ok: true } : { ok: false, reason })
      );
    });
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  } finally {
    if (!window.isDestroyed()) window.close();
  }
}

/*
 * A list as the owner arranged it: his columns, in his order, with his
 * names for them. Printed on A4, never on the till's roll, because a stock
 * list with eight columns does not fit in 80 millimetres. Turned on its side
 * when it has more columns than a portrait page can hold.
 */
export type PrintedTable = {
  title: string;
  header: string[];
  /** Where each column's figures line up: numbers and amounts on the end side. */
  align: ("start" | "end")[];
  rows: string[][];
  /** One cell per column, empty where adding up means nothing. */
  totals?: string[] | null;
};

export const TABLE_LIMITS = { columns: 40, rows: 100_000 } as const; // not-a-rule: far past any shop's list

export function isPrintedTable(value: unknown): value is PrintedTable {
  const table = value as PrintedTable;
  const strings = (list: unknown, max: number) => Array.isArray(list) && list.length <= max && list.every((one) => typeof one === "string");
  return (
    typeof table === "object" &&
    table !== null &&
    typeof table.title === "string" &&
    strings(table.header, TABLE_LIMITS.columns) &&
    Array.isArray(table.align) &&
    table.align.length === table.header.length &&
    table.align.every((one) => one === "start" || one === "end") &&
    Array.isArray(table.rows) &&
    table.rows.length <= TABLE_LIMITS.rows &&
    table.rows.every((row) => strings(row, TABLE_LIMITS.columns) && row.length === table.header.length) &&
    (table.totals === undefined || table.totals === null || (strings(table.totals, TABLE_LIMITS.columns) && table.totals.length === table.header.length))
  );
}

export const WIDE_TABLE = 6; // not-a-rule: past six columns a portrait A4 squeezes them

export function tableHtml(configuration: Configuration, table: PrintedTable): string {
  const language = configuration.language.app;
  const rtl = language === "ar";
  const name = rtl && configuration.business.nameArabic ? configuration.business.nameArabic : configuration.business.nameLatin;
  /* A figure keeps its own left-to-right order inside the cell, and the cell lines up with its heading on either page. */
  const cell = (tag: "th" | "td", text: string, index: number) =>
    table.align[index] === "end" && tag === "td"
      ? `<td class="end"><span class="figure">${escape(text)}</span></td>`
      : `<${tag} class="${table.align[index] === "end" ? "end" : ""}">${escape(text)}</${tag}>`;
  const head = `<tr>${table.header.map((text, index) => cell("th", text, index)).join("")}</tr>`;
  const body = table.rows.map((row) => `<tr>${row.map((text, index) => cell("td", text, index)).join("")}</tr>`).join("");
  const totals = table.totals ? `<tr class="totals">${table.totals.map((text, index) => cell("td", text, index)).join("")}</tr>` : "";

  return `<!doctype html>
<html lang="${language}" dir="${rtl ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8">
<style>
  @page { size: A4 ${table.header.length > WIDE_TABLE ? "landscape" : "portrait"}; margin: 12mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; color: #000; }
  body {
    font-family: ${rtl ? '"Geeza Pro", "Noto Naskh Arabic", "Segoe UI", Tahoma, sans-serif' : '"Helvetica Neue", "Segoe UI", Arial, sans-serif'};
    font-size: 10.5pt;
    line-height: 1.35;
    font-variant-numeric: tabular-nums;
  }
  header { display: flex; justify-content: space-between; align-items: baseline; gap: 8mm; margin-bottom: 5mm; }
  h1 { font-size: 15pt; margin: 0; }
  .shop { font-weight: bold; }
  .when { color: #444; direction: ltr; unicode-bidi: isolate; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th { text-align: start; font-weight: bold; border-bottom: 1.5pt solid #000; padding: 1.5mm 2mm; }
  td { border-bottom: 0.5pt solid #bbb; padding: 1.5mm 2mm; vertical-align: top; }
  .end { text-align: end; }
  td.end { white-space: nowrap; }
  .figure { direction: ltr; unicode-bidi: isolate; }
  .totals td { font-weight: bold; border-top: 1.5pt solid #000; border-bottom: none; }
</style>
</head>
<body>
  <header>
    <div><div class="shop">${escape(name)}</div><h1>${escape(table.title)}</h1></div>
    <div class="when">${escape(formatDateTime(new Date(), language))}</div>
  </header>
  <table><thead>${head}</thead><tbody>${body}${totals}</tbody></table>
</body>
</html>`;
}

/* The same page as a PDF, which the computer's own viewer prints on whatever printer the office has. */
export async function tablePdf(html: string): Promise<Buffer> {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { javascript: false, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return await window.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true });
  } finally {
    if (!window.isDestroyed()) window.close();
  }
}

/* The same list for a spreadsheet: semicolons and a byte-order mark, as Excel in French expects. */
export function tableCsv(table: PrintedTable): string {
  const cell = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const lines = [table.header, ...table.rows, ...(table.totals ? [table.totals] : [])].map((row) => row.map(cell).join(";"));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
