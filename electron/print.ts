import { BrowserWindow } from "electron";
import type { Configuration } from "@app-ui/config";
import { formatAmount, formatDateTime, formatQuantity } from "@app-ui/format";
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
  voidOf: string;
  subtotal: string;
  discount: string;
  total: string;
  cash: string;
  mobile: string;
  credit: string;
  received: string;
  change: string;
  customer: string;
  test: string;
  testLine: string;
};

const words: Record<"fr" | "ar" | "en", Words> = {
  fr: {
    receipt: "Reçu n°",
    voidOf: "Annulation de la vente n°",
    subtotal: "Sous-total",
    discount: "Remise",
    total: "Total",
    cash: "Espèces",
    mobile: "Application",
    credit: "À crédit",
    received: "Reçu",
    change: "Rendu",
    customer: "Client",
    test: "Essai d'impression",
    testLine: "Si vous lisez ceci, l'imprimante est prête.",
  },
  ar: {
    receipt: "وصل رقم",
    voidOf: "إلغاء عملية البيع رقم",
    subtotal: "المجموع الجزئي",
    discount: "تخفيض",
    total: "المجموع",
    cash: "نقدا",
    mobile: "تطبيق",
    credit: "بالدين",
    received: "المستلم",
    change: "الباقي",
    customer: "الزبون",
    test: "تجربة الطباعة",
    testLine: "إذا قرأت هذا، فالطابعة جاهزة.",
  },
  en: {
    receipt: "Receipt no.",
    voidOf: "Void of sale no.",
    subtotal: "Subtotal",
    discount: "Discount",
    total: "Total",
    cash: "Cash",
    mobile: "App",
    credit: "On credit",
    received: "Received",
    change: "Change",
    customer: "Customer",
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

export function receiptHtml(configuration: Configuration, sale: SaleDetail, paper: Paper): string {
  const language = configuration.language.app;
  const w = words[language] ?? words.fr;
  const money = (minor: number) => `<span class="num">${escape(formatAmount(minor, language))}</span>`;
  const reversal = sale.reversesNumber !== null;
  const sign = reversal ? -1 : 1;

  const title = reversal
    ? `<div class="centre"><b>${escape(w.voidOf)} <span class="num">${sale.reversesNumber}</span></b></div>`
    : "";

  const meta = `
    <div class="row"><span>${escape(w.receipt)} <span class="num">${sale.number}</span></span>
      <span class="num">${escape(formatDateTime(new Date(sale.occurredAt), language))}</span></div>`;

  const items = sale.items
    .map((item) => {
      const name = language === "ar" && item.nameArabic ? item.nameArabic : item.name;
      return `<div class="item">
        <div>${escape(name)}</div>
        <div class="row qty"><span class="num">${escape(formatQuantity(item.quantity, language))} × ${escape(formatAmount(item.unitPrice, language))}</span>
        <span>${money(sign * item.lineTotal)}</span></div>
      </div>`;
    })
    .join("");

  const lines: string[] = [];
  if (sale.discount > 0) {
    lines.push(`<div class="row"><span>${escape(w.subtotal)}</span><span>${money(sign * sale.subtotal)}</span></div>`);
    lines.push(`<div class="row"><span>${escape(w.discount)}</span><span>${money(-sign * sale.discount)}</span></div>`);
  }
  /* The currency inside the number's own left-to-right run, so Arabic prints "765,00 MRU". */
  lines.push(
    `<div class="row total"><span>${escape(w.total)}</span><span class="num">${escape(formatAmount(sale.total, language))} MRU</span></div>`
  );

  const paidBy =
    sale.payment === "mobile"
      ? `${w.mobile}${sale.mobileApp ? ` : ${sale.mobileApp}` : ""}`
      : sale.payment === "credit"
        ? w.credit
        : w.cash;
  if (sale.parts.length > 1) {
    /* Paid two ways: each way on its own line, the app by its name. */
    lines.push(`<div class="rule"></div>`);
    for (const part of sale.parts) {
      const label = part.method === "mobile" ? part.mobileApp || w.mobile : w.cash;
      lines.push(`<div class="row"><span>${escape(label)}</span><span>${money(Math.abs(part.amount))}</span></div>`);
    }
  } else {
    lines.push(`<div class="rule"></div><div>${escape(paidBy)}</div>`);
  }
  if (sale.payment === "cash" && sale.received !== null && !reversal) {
    lines.push(`<div class="row"><span>${escape(w.received)}</span><span>${money(sale.received)}</span></div>`);
    lines.push(`<div class="row"><span>${escape(w.change)}</span><span>${money(sale.received - sale.total)}</span></div>`);
  }
  if (sale.customerName) lines.push(`<div>${escape(w.customer)} : ${escape(sale.customerName)}</div>`);
  if (sale.employee) lines.push(`<div>${escape(sale.employee)}</div>`);

  return page(configuration, paper, `${title}${meta}<div class="rule"></div>${items}<div class="rule"></div>${lines.join("")}`);
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
