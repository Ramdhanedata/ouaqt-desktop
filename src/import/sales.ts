import type { Pack } from "@app-ui/packs";
import { toMajor, toMinor } from "@app-ui/money";
import { simplify } from "../../vendor/ouaqt-website/builder/import/columns";
import { currencyDoubt, mentionsOldMoney, toNewOuguiya, type CurrencyDoubt } from "../../vendor/ouaqt-website/builder/import/currency";
import { code, isBlank, isBlankRow, parseNumber, text, westernDigits } from "../../vendor/ouaqt-website/builder/import/normalise";
import { findHeaderRow, isTotalRow } from "../../vendor/ouaqt-website/builder/import/table";
import type { ImportedSale, ImportedSaleLine } from "../../electron/db/imports";

/*
 * Reading a spreadsheet of sales, whichever way the shop kept it.
 *
 * A book of sales comes in two shapes. A line per item sold: the date, what
 * it was, how many, the price, the amount. Or a line per day: the date and
 * what the day took. Both are read here, in the three languages, with the
 * headers matched loosely as the product import does.
 *
 * What an owner's book really looks like is taken as it is: the date written
 * once at the top of each day and left blank below it, a TOTAL at the bottom
 * of each day or of the month, dates as Excel keeps them or as typed, day
 * first (as here) or month first (as an export from abroad), amounts with
 * spaces, commas and "MRU".
 *
 * Nothing here throws, and nothing is written: the screen shows what was
 * understood, the database decides what is new.
 */

export type SalesField = "date" | "time" | "ticket" | "payment" | "quantity" | "total" | "unitPrice" | "name";
export type SalesColumns = Partial<Record<SalesField, { index: number; header: string }>>;

/* Whole headers, compared after accents, case and punctuation are stripped. */
const exact: Record<SalesField, string[]> = {
  date: ["date", "jour", "le", "day", "date de vente", "date vente", "date de la vente", "date operation", "sale date", "التاريخ", "تاريخ", "اليوم", "تاريخ البيع"],
  time: ["heure", "time", "hour", "الساعة", "الوقت", "ساعة"],
  ticket: ["ticket", "n ticket", "no ticket", "numero ticket", "numero de ticket", "n", "no", "num", "numero", "facture", "n facture", "no facture", "numero de facture", "recu", "n recu", "bon", "invoice", "receipt", "رقم", "رقم الفاتورة", "الفاتورة", "رقم الوصل", "الوصل"],
  payment: ["paiement", "mode de paiement", "mode paiement", "mode", "reglement", "mode de reglement", "payment", "payment method", "moyen de paiement", "طريقة الدفع", "الدفع", "وسيلة الدفع"],
  quantity: ["quantite", "quantites", "qte", "qty", "quantity", "nombre", "nbr", "nb", "quantite vendue", "الكمية", "كمية", "العدد"],
  total: [
    "total", "montant", "montant total", "prix total", "total ttc", "ttc", "chiffre", "chiffre d affaires", "ca", "recette", "recettes",
    "vente", "ventes", "ventes du jour", "total ventes", "total vente", "encaisse", "somme", "amount", "total amount", "sales", "revenue",
    "المبلغ", "المجموع", "الإجمالي", "الاجمالي", "المبيعات", "المداخيل", "القيمة", "مبلغ",
  ],
  unitPrice: ["prix", "prix unitaire", "prix de vente", "pu", "p u", "unit price", "price", "tarif", "السعر", "سعر", "سعر الوحدة", "سعر البيع", "الثمن"],
  name: [
    "nom", "name", "designation", "produit", "article", "libelle", "description", "service", "prestation", "plat", "medicament", "item", "product",
    "الاسم", "اسم", "المنتج", "الصنف", "الخدمة", "البيان", "المادة", "التسمية",
  ],
};

/* Words found inside a longer header, tried in this order once no header matched whole. */
const partial: [SalesField, string[]][] = [
  ["date", ["date", "تاريخ"]],
  ["time", ["heure", "time", "الساعة", "الوقت"]],
  ["ticket", ["ticket", "facture", "invoice", "receipt", "فاتورة", "وصل"]],
  ["payment", ["paiement", "reglement", "payment", "الدفع"]],
  ["quantity", ["quantite", "qte", "qty", "quantity", "nombre", "الكمية", "عدد"]],
  /* A price per unit says so; it goes before the amounts so "prix de vente unitaire" is not read as a day's takings. */
  ["unitPrice", ["unitaire", "unit price", "الوحدة"]],
  ["total", ["total", "montant", "recette", "chiffre", "vente", "amount", "revenue", "sales", "المبلغ", "المجموع", "الإجمالي", "الاجمالي", "مبيعات", "المداخيل"]],
  ["unitPrice", ["prix", "price", "tarif", "سعر", "الثمن"]],
  ["name", ["nom", "designation", "produit", "article", "libelle", "description", "service", "prestation", "medicament", "product", "الاسم", "المنتج", "الصنف", "الخدمة", "البيان"]],
];

/* Columns that look like ours and are not: an expiry is not the day of the sale, a purchase price is not what was taken, a customer is not an item. */
const notADay = ["peremption", "expiration", "expiry", "dlc", "dluo", "validite", "الانتهاء", "الصلاحية"];
const notMoneyIn = ["achat", "cout", "cost", "purchase", "شراء", "التكلفة", "remise", "discount", "تخفيض"];
const notAnItem = ["client", "customer", "caissier", "vendeur", "serveur", "العميل", "الزبون", "البائع"];

function excluded(field: SalesField, cell: string): boolean {
  if (field === "date") return notADay.some((word) => cell.includes(word));
  if (field === "total" || field === "unitPrice") return notMoneyIn.some((word) => cell.includes(word));
  if (field === "name") return notAnItem.some((word) => cell.includes(word));
  return false;
}

export function findSalesColumns(header: unknown[]): SalesColumns {
  const simplified = header.map(simplify);
  const map: SalesColumns = {};
  const used = new Set<number>();
  const take = (field: SalesField, index: number) => {
    map[field] = { index, header: String(header[index] ?? "").trim() };
    used.add(index);
  };
  for (const field of Object.keys(exact) as SalesField[]) {
    const index = simplified.findIndex((cell, at) => !used.has(at) && cell !== "" && exact[field].includes(cell) && !excluded(field, cell));
    if (index >= 0) take(field, index);
  }
  for (const [field, words] of partial) {
    if (map[field]) continue;
    const index = simplified.findIndex((cell, at) => !used.has(at) && cell !== "" && !excluded(field, cell) && words.some((word) => cell.includes(word)));
    if (index >= 0) take(field, index);
  }
  return map;
}

const LOOK_DOWN = 25; // not-a-rule: how far down a title and a few blank rows may push the header

/*
 * A header names columns; it holds no figure and no date. A line of the book
 * whose note happens to say "المبلغ" or "total" is still a line of the book,
 * and taking it for the header lost every row above it.
 */
function holdsData(row: unknown[]): boolean {
  return row.some((cell) => {
    if (typeof cell === "number") return true;
    if (cell instanceof Date) return true;
    if (typeof cell !== "string" || cell.trim() === "") return false;
    if (parseSaleDate(cell) !== null) return true;
    return /^[\s\d\u0660-\u0669\u06f0-\u06f9.,']+(?:\s*(?:mru|um|mro))?$/i.test(cell.trim()) && parseNumber(cell) !== null;
  });
}

/* The row that names the most of a sales book's columns, with something to count in it. */
export function findSalesHeader(rows: unknown[][]): { index: number; columns: SalesColumns } {
  let best = { index: -1, columns: {} as SalesColumns, score: 0 };
  rows.slice(0, LOOK_DOWN).forEach((row, index) => {
    if (isBlankRow(row) || holdsData(row)) return;
    const columns = findSalesColumns(row);
    if (!columns.total && !columns.unitPrice) return;
    const score = Object.keys(columns).length + (columns.date ? 2 : 0);
    if (score > best.score) best = { index, columns, score };
  });
  return { index: best.index, columns: best.columns };
}

/* ── Dates ──────────────────────────────────────────────────────────────── */

export type DateOrder = "dmy" | "mdy";

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const MS_IN_A_DAY = 86_400_000;

const months: Record<string, number> = {
  janvier: 1, janv: 1, jan: 1, january: 1, fevrier: 2, fevr: 2, fev: 2, feb: 2, february: 2, mars: 3, mar: 3, march: 3, avril: 4, avr: 4, apr: 4, april: 4,
  mai: 5, may: 5, juin: 6, jun: 6, june: 6, juillet: 7, juil: 7, jul: 7, july: 7, aout: 8, aou: 8, aug: 8, august: 8, septembre: 9, sept: 9, sep: 9, september: 9,
  octobre: 10, oct: 10, october: 10, novembre: 11, nov: 11, november: 11, decembre: 12, dec: 12, december: 12,
  يناير: 1, فبراير: 2, مارس: 3, أبريل: 4, ابريل: 4, مايو: 5, يونيو: 6, يوليو: 7, أغسطس: 8, اغسطس: 8, سبتمبر: 9, أكتوبر: 10, اكتوبر: 10, نوفمبر: 11, ديسمبر: 12,
};

const pad = (value: number) => String(value).padStart(2, "0");

function realDay(year: number, month: number, date: number): string | null {
  if (year < 100) year += 2000;
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || date < 1 || date > 31) return null; // not-a-rule: a shop's records, not history
  const check = new Date(Date.UTC(year, month - 1, date));
  if (check.getUTCMonth() !== month - 1) return null;
  return `${year}-${pad(month)}-${pad(date)}`;
}

function clockTime(hours: number, minutes: number): string | null {
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${pad(hours)}:${pad(minutes)}`;
}

/** A time of day as written: 14:30, 14h30, 14h, 2:30 PM, or Excel's fraction of a day. */
export function parseTime(cell: unknown): string | null {
  if (isBlank(cell)) return null;
  if (typeof cell === "number") {
    const fraction = cell - Math.floor(cell);
    if (fraction <= 0) return null;
    const minutes = Math.round(fraction * 24 * 60);
    return clockTime(Math.floor(minutes / 60) % 24, minutes % 60);
  }
  const raw = westernDigits(text(cell)).toLowerCase();
  const match = raw.match(/^(\d{1,2})\s*(?:[:h]\s*(\d{2})?)\s*(am|pm)?/);
  if (!match) return null;
  let hours = Number(match[1]);
  if (match[3] === "pm" && hours < 12) hours += 12;
  if (match[3] === "am" && hours === 12) hours = 0;
  return clockTime(hours, Number(match[2] ?? 0));
}

/** The day of a sale, and its time when the same cell holds one. */
export function parseSaleDate(cell: unknown, order: DateOrder = "dmy"): { day: string; time: string | null } | null {
  if (isBlank(cell)) return null;
  if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
    const day = realDay(cell.getFullYear(), cell.getMonth() + 1, cell.getDate());
    return day ? { day, time: cell.getHours() || cell.getMinutes() ? clockTime(cell.getHours(), cell.getMinutes()) : null } : null;
  }
  if (typeof cell === "number") {
    /* Excel's serial days, from 1990 to 2100: anything else in a date column is not a date. */
    if (cell < 32_874 || cell > 73_051) return null; // not-a-rule: 1 January 1990 and 31 December 2100 as Excel counts them
    const date = new Date(EXCEL_EPOCH + Math.floor(cell) * MS_IN_A_DAY);
    const day = realDay(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
    return day ? { day, time: parseTime(cell) } : null;
  }
  const raw = westernDigits(text(cell)).toLowerCase();
  const timeOf = (rest: string | undefined) => (rest ? parseTime(rest.trim()) : null);

  const iso = raw.match(/^(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})(?:[ t]+(.*))?$/);
  if (iso) {
    const day = realDay(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    return day ? { day, time: timeOf(iso[4]) } : null;
  }
  const numeric = raw.match(/^(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{2}|\d{4})(?:[ t,]+(.*))?$/);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    const [date, month] = order === "dmy" ? [first, second] : [second, first];
    const day = realDay(Number(numeric[3]), month, date);
    return day ? { day, time: timeOf(numeric[4]) } : null;
  }
  const named = simplify(raw).match(/^(?:[\p{L}]+\s+)?(\d{1,2})\s+([\p{L}]+)\s+(\d{2}|\d{4})(?:\s+(.*))?$/u);
  if (named) {
    const month = months[named[2]] ?? months[named[2].slice(0, 4)] ?? months[named[2].slice(0, 3)];
    const day = month ? realDay(Number(named[3]), month, Number(named[1])) : null;
    return day ? { day, time: named[4] ? parseTime(named[4].replace(" ", ":")) : null } : null;
  }
  return null;
}

/*
 * Day first or month first, for the whole column at once. A 13 or more in the
 * first place settles it one way, in the second the other; when nothing does,
 * day first, as dates are written here.
 */
export function dateOrderOf(cells: unknown[]): DateOrder {
  let dayFirst = 0;
  let monthFirst = 0;
  for (const cell of cells) {
    if (typeof cell !== "string") continue;
    const match = westernDigits(cell.trim()).match(/^(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*\d{2,4}/);
    if (!match) continue;
    if (Number(match[1]) > 12) dayFirst += 1;
    if (Number(match[2]) > 12) monthFirst += 1;
  }
  return monthFirst > dayFirst ? "mdy" : "dmy";
}

/* ── Payment ───────────────────────────────────────────────────────────── */

export function paymentOf(cell: unknown): { payment: ImportedSale["payment"]; mobileApp: string | null } {
  const raw = text(cell);
  const plain = simplify(raw);
  if (plain === "") return { payment: "cash", mobileApp: null };
  if (/(espece|cash|liquide|comptant|caisse|نقد|كاش)/.test(plain)) return { payment: "cash", mobileApp: null };
  if (/(credit|dette|a terme|dain|دين|آجل|اجل|كريدي)/.test(plain)) return { payment: "credit", mobileApp: null };
  if (/(bankily|masrvi|sedad|click|bimbank|bim bank|amanty|gaza|wallet|virement|carte|card|banque|bank|بنكيلي|مصرفي|تحويل|سداد|موبايل|mobile)/.test(plain)) {
    const generic = /^(mobile|paiement mobile|virement|carte|card|wallet|موبايل|تحويل)$/.test(plain);
    return { payment: "mobile", mobileApp: generic ? null : raw.slice(0, 40) };
  }
  return { payment: "cash", mobileApp: null };
}

/* ── The rows ──────────────────────────────────────────────────────────── */

export type SalesProblemCode = "no_amount" | "bad_amount" | "negative_amount" | "bad_quantity" | "bad_date";

export type SalesProblem = { row: number; code: SalesProblemCode; found?: string };

export type SalesParse = {
  sales: ImportedSale[];
  problems: SalesProblem[];
  columns: SalesColumns;
  headerRow: number;
  /** No column held the day: the owner says which day the whole file is. */
  needsDay: boolean;
  dateOrder: DateOrder;
  firstDay: string | null;
  lastDay: string | null;
  /** In minor units. */
  total: number;
  lines: number;
  totalRows: number;
  currency: CurrencyDoubt;
};

export type SalesOptions = {
  pack: Pack;
  columns?: SalesColumns;
  currency?: "new" | "old";
  /** The day for every row of a file with no dates in it. */
  day?: string | null;
  dateOrder?: DateOrder;
};

/* A short, stable fingerprint, so the same row read twice is known for what it is. */
export function fingerprint(value: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    a = Math.imul(a ^ unit, 0x01000193) >>> 0;
    b = Math.imul(b ^ unit, 0x5bd1e995) >>> 0;
  }
  return `x${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}

const MAX_ROWS = 20_000; // not-a-rule: a few years of a busy shop's lines

export function parseSales(rows: unknown[][], options: SalesOptions): SalesParse {
  const header = options.columns ? { index: Math.max(0, findSalesHeader(rows).index), columns: options.columns } : findSalesHeader(rows);
  const columns = header.columns;
  const empty: SalesParse = {
    sales: [],
    problems: [],
    columns,
    headerRow: header.index + 1,
    needsDay: false,
    dateOrder: "dmy",
    firstDay: null,
    lastDay: null,
    total: 0,
    lines: 0,
    totalRows: 0,
    currency: { ask: false, why: null, median: null },
  };
  if (header.index < 0 || (!columns.total && !columns.unitPrice)) return empty;

  const body = rows.slice(header.index + 1, header.index + 1 + MAX_ROWS);
  const cell = (row: unknown[], field: SalesField) => (columns[field] ? row[columns[field]!.index] : undefined);
  const order = options.dateOrder ?? dateOrderOf(body.map((row) => cell(row, "date")));
  const needsDay = !columns.date;
  const fallback = options.day && /^\d{4}-\d{2}-\d{2}$/.test(options.day) ? options.day : null;

  const problems: SalesProblem[] = [];
  const moneyCells: unknown[] = [];
  const read: { row: number; day: string; time: string | null; ticket: string; payment: ImportedSale["payment"]; mobileApp: string | null; line: ImportedSaleLine }[] = [];
  let carried: { day: string; time: string | null } | null = null;
  let totalRows = 0;

  body.forEach((row, offset) => {
    const number = header.index + offset + 2;
    if (isBlankRow(row)) return;
    if (isTotalRow(row)) {
      totalRows += 1;
      return;
    }

    /* The date written once at the top of the day holds for the rows under it. */
    let when: { day: string; time: string | null } | null;
    if (needsDay) {
      /* Until he says which day, the rows are read with none, to show him what is there. */
      when = { day: fallback ?? "", time: null };
    } else {
      const raw = cell(row, "date");
      if (isBlank(raw)) {
        when = carried;
      } else {
        when = parseSaleDate(raw, order);
        if (!when) {
          problems.push({ row: number, code: "bad_date", found: text(raw) });
          return;
        }
        carried = when;
      }
      if (!when) {
        problems.push({ row: number, code: "bad_date" });
        return;
      }
    }

    const rawTotal = cell(row, "total");
    const rawUnit = cell(row, "unitPrice");
    const rawQuantity = cell(row, "quantity");
    const quantityRead = isBlank(rawQuantity) ? 1 : parseNumber(rawQuantity);
    if (quantityRead === null || quantityRead <= 0) {
      /* A line with nothing sold and nothing taken is a note, not a sale. */
      if (isBlank(rawTotal) && isBlank(rawUnit)) return;
      problems.push({ row: number, code: "bad_quantity", found: text(rawQuantity) });
      return;
    }
    const totalRead = isBlank(rawTotal) ? null : parseNumber(rawTotal);
    const unitRead = isBlank(rawUnit) ? null : parseNumber(rawUnit);
    if (totalRead === null && unitRead === null) {
      if (isBlank(rawTotal) && isBlank(rawUnit)) {
        /* A row that names a day and nothing else is a heading inside the book. */
        if (isBlank(cell(row, "name"))) return;
        problems.push({ row: number, code: "no_amount" });
      } else {
        problems.push({ row: number, code: "bad_amount", found: text(rawTotal ?? rawUnit) });
      }
      return;
    }
    const amount = totalRead ?? (unitRead as number) * quantityRead;
    if (amount < 0) {
      problems.push({ row: number, code: "negative_amount", found: text(rawTotal ?? rawUnit) });
      return;
    }
    /* Nothing taken: a free line or an empty cell Excel filled in. Not a sale, and not worth a complaint. */
    if (amount === 0) return;
    moneyCells.push(rawTotal ?? rawUnit);

    const convert = (value: number) => toMinor(options.currency === "old" ? toNewOuguiya(value) : value);
    const total = convert(amount);
    const unitPrice = unitRead !== null ? convert(unitRead) : Math.round(total / quantityRead);
    const time = (columns.time ? parseTime(cell(row, "time")) : null) ?? when.time;
    const { payment, mobileApp } = paymentOf(cell(row, "payment"));
    read.push({
      row: number,
      day: when.day,
      time,
      ticket: columns.ticket ? code(cell(row, "ticket")) : "",
      payment,
      mobileApp,
      line: { label: text(cell(row, "name")) || null, quantity: quantityRead, unitPrice, total },
    });
  });

  /* With a ticket number, the lines of one ticket are one sale; without one, each line is its own. */
  const groups = new Map<string, typeof read>();
  read.forEach((one, index) => {
    const key = one.ticket ? `${one.day}|${one.ticket}` : `row${index}`;
    const group = groups.get(key);
    if (group) group.push(one);
    else groups.set(key, [one]);
  });

  const seen = new Map<string, number>();
  const sales: ImportedSale[] = [...groups.values()].map((group) => {
    const first = group[0];
    const lines = group.map((one) => one.line);
    const shape = `${first.day}|${first.time ?? ""}|${first.ticket}|${lines.map((line) => `${simplify(line.label ?? "")}~${line.quantity}~${line.total}`).join(";")}`;
    const occurrence = (seen.get(shape) ?? 0) + 1;
    seen.set(shape, occurrence);
    return {
      day: first.day,
      time: first.time,
      payment: first.payment,
      mobileApp: first.mobileApp,
      lines,
      key: fingerprint(`${shape}#${occurrence}`),
      row: first.row,
    };
  });

  const days = sales.map((sale) => sale.day).sort();
  const totals = sales.map((sale) => sale.lines.reduce((sum, line) => sum + line.total, 0));
  return {
    sales,
    problems,
    columns,
    headerRow: header.index + 1,
    needsDay: needsDay && !fallback,
    dateOrder: order,
    firstDay: days[0] ?? null,
    lastDay: days[days.length - 1] ?? null,
    total: totals.reduce((sum, value) => sum + value, 0),
    lines: read.length,
    totalRows,
    /*
     * Old ouguiyas are suspected from the prices of things sold. A day's
     * takings is a big number by nature, so a book of days is only asked
     * about when it says so itself.
     */
    currency:
      options.currency !== undefined
        ? { ask: false, why: null, median: null }
        : !columns.unitPrice && !columns.name
          ? { ask: mentionsOldMoney(columns.total?.header ?? "", moneyCells), why: mentionsOldMoney(columns.total?.header ?? "", moneyCells) ? "said_um" : null, median: null }
          : currencyDoubt({
            pack: options.pack,
            priceHeader: (columns.unitPrice ?? columns.total)?.header ?? "",
            priceCells: moneyCells,
            prices: read.map((one) => toMajor(one.line.unitPrice)),
          }),
  };
}

/* ── Which kind of file ─────────────────────────────────────────────────── */

export type FileKind = "sales" | "products" | "unknown";

/*
 * A book of sales has days in it; a product list has names and prices and no
 * days. When the days are there and most rows read as dates, it is sales.
 * When there is no date but the money column says "ventes" or "recette", it
 * is still sales, and the owner is asked which day. Otherwise a list with
 * names and prices is products.
 */
export function kindOf(rows: unknown[][], pack: Pack): FileKind {
  const sales = findSalesHeader(rows);
  if (sales.index >= 0 && sales.columns.date) {
    const body = rows.slice(sales.index + 1, sales.index + 201).filter((row) => !isBlankRow(row) && !isTotalRow(row)); // not-a-rule: enough rows to judge by
    const order = dateOrderOf(body.map((row) => row[sales.columns.date!.index]));
    const dated = body.filter((row) => {
      const value = row[sales.columns.date!.index];
      return isBlank(value) || parseSaleDate(value, order) !== null;
    }).length;
    if (body.length > 0 && dated / body.length >= 0.5) return "sales"; // not-a-rule: most rows, not every one
  }
  const takings = sales.columns.total && /(vente|recette|chiffre|revenue|sales|مبيعات|المداخيل)/.test(simplify(sales.columns.total.header));
  if (sales.index >= 0 && takings && !sales.columns.name) return "sales";
  if (findHeaderRow(rows, pack).confident) return "products";
  if (sales.index >= 0 && sales.columns.total) return "sales";
  return "unknown";
}

/* The sheet of a workbook most likely to hold what was asked for: the one that reads as that kind, with the most rows. */
export function sheetFor(sheets: Record<string, unknown[][]>, kind: Exclude<FileKind, "unknown">, pack: Pack): string | null {
  /*
   * For sales, the sheet that reads as the most sales, then the one whose
   * name says so ("Ventes", "مبيعات"): not merely the longest, which is as
   * often the expenses beside them.
   */
  const weight = (name: string, rows: unknown[][]) =>
    kind === "sales"
      ? parseSales(rows, { pack, currency: "new" }).sales.length * 2 + (/(vente|sales|recette|مبيعات|المبيعات)/.test(simplify(name)) ? 1 : 0)
      : rows.filter((row) => !isBlankRow(row)).length;
  const ranked = Object.entries(sheets)
    .filter(([, rows]) => kindOf(rows, pack) === kind)
    .map(([name, rows]) => ({ name, weight: weight(name, rows) }))
    .sort((a, b) => b.weight - a.weight);
  return ranked[0]?.name ?? null;
}
