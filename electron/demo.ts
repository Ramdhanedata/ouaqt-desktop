import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { app, type BrowserWindow } from "electron";
import type { Pack } from "@app-ui/packs";
import { seedDemo as seedShop, type PharmacyDemoItem } from "./demo-seed";
import { addCustomer } from "./db/customers";
import { listProducts, today } from "./db/products";
import { newItemLabels } from "../src/i18n/products";
import { screensFor } from "../src/i18n/screens";
import { tradesFor } from "../src/i18n/trades";

/*
 * Demo mode: the till with invented products, for screenshots and for walking
 * through it without a serial.
 *
 * Switched on by OUAQT_DEMO=1, which no installer sets. It runs in its own
 * data folder, beside the real one and never inside it, so a demo can never
 * write an invented product into a shop's actual database. That separation
 * is the whole safety of this file.
 */

export const DEMO = process.env.OUAQT_DEMO === "1";

/** The folder demo mode uses instead of the real one. */
export function demoFolder(real: string): string {
  return join(real, "..", "OUAQT Demo");
}

/* The configuration the demo runs, copied in from the fixtures. */
export function prepareDemoFolder(folder: string, fixture: string): void {
  mkdirSync(folder, { recursive: true });
  copyFileSync(fixture, join(folder, "configuration.json"));
}

/*
 * The invented shop itself lives in demo-seed.ts, where the builder's
 * preview can use it too. The desktop demo's pharmacy is stocked under real
 * medicine names, kept here so they never reach the website.
 */
/*
 * A demo pharmacy: invented stock under real medicine names, with generic
 * names, costs and batches, one of them already expired and one expiring
 * within the alert window, so every screen has something true to show.
 */
const PHARMACY_DEMO: PharmacyDemoItem[] = [
  // not-a-rule: invented demo stock, prices in minor units
  { name: "Doliprane 1000 mg", generic: "Paracétamol", ar: "دوليبران 1000", unit: "Boîte", price: 15000, cost: 9500, low: 10, lots: [{ lot: "DL2402", days: 400, qty: 40 }, { lot: "DL2311", days: -20, qty: 3 }] },
  { name: "Efferalgan 500 mg", generic: "Paracétamol", ar: "إيفيرالغان 500", unit: "Boîte", price: 12000, cost: 7800, low: 10, lots: [{ lot: "EF118", days: 300, qty: 25 }] },
  { name: "Amoxicilline 500 mg", generic: "Amoxicilline", ar: "أموكسيسيلين 500", unit: "Boîte", price: 18000, cost: 11000, low: 8, lots: [{ lot: "AMX77", days: 40, qty: 12 }] },
  { name: "Augmentin 1 g", generic: "Amoxicilline, acide clavulanique", ar: "أوغمنتين 1 غ", unit: "Boîte", price: 45000, cost: 32000, low: 5, lots: [{ lot: "AUG31", days: 500, qty: 6 }] },
  { name: "Spasfon", generic: "Phloroglucinol", ar: "سبازفون", unit: "Boîte", price: 9000, cost: 5500, low: 6, lots: [{ lot: "SP09", days: 250, qty: 4 }] },
  { name: "Smecta", generic: "Diosmectite", ar: "سمكتا", unit: "Boîte", price: 11000, cost: 7000, low: 5, lots: [{ lot: "SM55", days: 600, qty: 18 }] },
  { name: "Ventoline 100 µg", generic: "Salbutamol", ar: "فنتولين", unit: "Flacon", price: 25000, cost: 17000, low: 3, lots: [{ lot: "VT12", days: 700, qty: 7 }] },
  { name: "Voltarène gel", generic: "Diclofénac", ar: "فولتارين جل", unit: "Tube", price: 20000, cost: 13000, low: 4, lots: [{ lot: "VG40", days: 350, qty: 0 }] },
  { name: "Vitamine C 500 mg", generic: "Acide ascorbique", ar: "فيتامين سي 500", unit: "Boîte", price: 6000, cost: 3500, low: 10, lots: [{ lot: "VC88", days: 200, qty: 30 }] },
  { name: "Sérum physiologique", generic: "Chlorure de sodium", ar: "مصل فيزيولوجي", unit: "Boîte", price: 5000, cost: null, low: null, lots: [{ lot: "", days: 0, qty: 50 }] },
];

export function seedDemo(database: Database.Database, deviceId: string, pack: Pack, options: { empty?: boolean } = {}): void {
  seedShop(database, deviceId, pack, { ...options, pharmacyStock: PHARMACY_DEMO });
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/*
 * A window shown without focus paints lazily, and a capture taken straight
 * after a click can return the frame from before it. Two animation frames
 * and a forced repaint make the picture show what is on screen now.
 */
async function shoot(window: BrowserWindow, file: string): Promise<void> {
  await window.webContents.executeJavaScript("new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))");
  window.webContents.invalidate();
  await pause(250);
  const image = await window.webContents.capturePage();
  writeFileSync(file, image.toPNG());
}

/*
 * What on this screen is too small to hit or to read: a visible button,
 * field or link under 44 pixels high, or text under 15 pixels. The page is
 * laid out for a 1366 by 768 laptop, so it is measured there.
 */
export const TARGET_PX = 44; // not-a-rule: the brief's smallest click target
export const TEXT_PX = 15; // not-a-rule: the brief's smallest body text

function measure(window: BrowserWindow, screen: string): Promise<string[]> {
  return window.webContents.executeJavaScript(`(() => {
    const found = [];
    const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"; };
    for (const e of document.querySelectorAll("button, input:not([type=checkbox]):not([type=file]), select, textarea, a[href]")) {
      if (!visible(e) || e.closest(".sr-only")) continue;
      const h = e.getBoundingClientRect().height;
      if (h < ${TARGET_PX} - 0.5) found.push(${JSON.stringify(screen)} + ": target " + Math.round(h) + "px " + (e.innerText || e.getAttribute("aria-label") || e.placeholder || e.tagName).trim().slice(0, 40));
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const e = node.parentElement;
      if (!node.textContent.trim() || !e || seen.has(e) || !visible(e)) continue;
      seen.add(e);
      const size = parseFloat(getComputedStyle(e).fontSize);
      if (size < ${TEXT_PX} - 0.1) found.push(${JSON.stringify(screen)} + ": text " + size + "px " + node.textContent.trim().slice(0, 40));
    }
    return found;
  })()`);
}

/* Press the button whose text is exactly this, the way a cashier would. */
function press(window: BrowserWindow, text: string, nth = 0): Promise<boolean> {
  return window.webContents.executeJavaScript(`(() => {
    const wanted = ${JSON.stringify(text)};
    const buttons = [...document.querySelectorAll("button")]
      .filter((b) => (b.innerText || "").split("\\n")[0].trim() === wanted);
    const target = buttons[${nth}];
    if (!target || target.disabled) return false;
    target.click();
    return true;
  })()`);
}

/* Press the first button whose first line starts with this. */
function pressStarting(window: BrowserWindow, text: string): Promise<boolean> {
  return window.webContents.executeJavaScript(`(() => {
    const wanted = ${JSON.stringify(text)};
    const target = [...document.querySelectorAll("button")]
      .find((b) => (b.innerText || "").split("\\n")[0].trim().startsWith(wanted));
    if (!target || target.disabled) return false;
    target.click();
    return true;
  })()`);
}

/* Type into the first text field on screen, as a person would. */
function type(window: BrowserWindow, text: string): Promise<void> {
  return window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector("main input") || document.querySelector("input");
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(input, ${JSON.stringify(text)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
}

/* Click the first search result, the way the cashier picks one. */
function pickFirstResult(window: BrowserWindow): Promise<boolean> {
  return window.webContents.executeJavaScript(`(() => {
    const target = document.querySelector("main section li button");
    if (!target) return false;
    target.click();
    return true;
  })()`);
}

const NAV: Record<"fr" | "ar", Record<string, string>> = {
  fr: {
    stock: "Stock", customers: "Clients", cash: "Caisse", reports: "Rapports", settings: "Réglages", sale: "Vente", close: "Fermer",
    overview: "Tableau de bord", journal: "Journal des actions",
    float: "Fond de caisse", openCash: "Ouvrir la caisse", counted: "Compté dans la caisse", closeCash: "Clôturer la caisse",
    paid: "Montant payé", save: "Enregistrer", receive: "Réception", quantity: "Quantité", lot: "Lot",
    voidSale: "Annuler la vente", reason: "Erreur de saisie",
  },
  ar: {
    stock: "المخزون", customers: "الزبائن", cash: "الصندوق", reports: "التقارير", settings: "الإعدادات", sale: "بيع", close: "إغلاق",
    overview: "لوحة القيادة", journal: "سجل العمليات",
    float: "رصيد البداية", openCash: "فتح الصندوق", counted: "المعدود في الصندوق", closeCash: "إغلاق الصندوق",
    paid: "المبلغ المدفوع", save: "حفظ", receive: "استلام", quantity: "الكمية", lot: "الدفعة",
    voidSale: "إلغاء البيع", reason: "خطأ في الإدخال",
  },
};

/* Type into the field whose label reads exactly this. */
function typeInto(window: BrowserWindow, label: string, text: string): Promise<boolean> {
  return window.webContents.executeJavaScript(`(() => {
    const wanted = ${JSON.stringify(label)};
    const field = [...document.querySelectorAll("label")].find((l) => (l.querySelector("span")?.innerText || "").trim() === wanted);
    const input = field?.querySelector("input");
    if (!input) return false;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(input, ${JSON.stringify(text)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
}

/*
 * Press the button with this text in whatever is on top: a question being
 * asked if there is one, otherwise the last such button on the page.
 */
function pressLast(window: BrowserWindow, text: string): Promise<boolean> {
  return window.webContents.executeJavaScript(`(() => {
    const wanted = ${JSON.stringify(text)};
    const scope = document.querySelector("[role=alertdialog]") || document;
    const buttons = [...scope.querySelectorAll("button")].filter((b) => (b.innerText || "").split("\\n")[0].trim() === wanted);
    const target = buttons[buttons.length - 1];
    if (!target || target.disabled) return false;
    target.click();
    return true;
  })()`);
}

/* Click a row or list entry, the first one whose text contains this. */
function clickContaining(window: BrowserWindow, selector: string, text: string): Promise<boolean> {
  return window.webContents.executeJavaScript(`(() => {
    const target = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => (e.innerText || "").includes(${JSON.stringify(text)}));
    if (!target) return false;
    target.click();
    return true;
  })()`);
}

const COLUMNS: Record<"fr" | "ar", Record<string, string>> = {
  fr: {
    columns: "Colonnes", name: "Nom de la colonne", choice: "Liste de choix", number: "Nombre", add: "Ajouter la colonne",
    choices: "Choix", shelf: "Rayon", cost: "Poids (kg)", print: "Imprimer", remove: "Supprimer",
    confirm: "Pour confirmer, écrivez le nom de la colonne.",
  },
  ar: {
    columns: "الأعمدة", name: "اسم العمود", choice: "قائمة اختيارات", number: "رقم", add: "أضف العمود",
    choices: "الاختيارات", shelf: "الرف", cost: "الوزن (كغ)", print: "طباعة", remove: "حذف",
    confirm: "للتأكيد، اكتب اسم العمود.",
  },
};

/*
 * The owner's own columns, used the way he would: two added from the stock
 * list, filled in on a product's sheet, sorted, filtered, printed, and one of
 * them deleted by typing its name. Checked in the database each time.
 */
async function useTheColumns(window: BrowserWindow, database: Database.Database, out: string, language: "fr" | "ar", audit: string[]) {
  const nav = NAV[language];
  const words = COLUMNS[language];
  const count = (sql: string, ...args: unknown[]) => (database.prepare(sql).get(...args) as { n: number }).n;
  const done: Record<string, boolean> = {};

  await press(window, nav.stock);
  await pause(800);
  await pressStarting(window, words.columns);
  await pause(600);
  await shoot(window, join(out, "16-columns.png"));

  /* A column is a name and nothing else: it holds whatever he writes. */
  await typeInto(window, words.name, words.shelf);
  await press(window, words.add);
  await pause(600);
  await typeInto(window, words.name, words.cost);
  await press(window, words.add);
  await pause(700);
  await shoot(window, join(out, "17-columns-added.png"));
  audit.push(...(await measure(window, "17-columns")));
  done.columnsAdded = count("select count(*) as n from list_columns where list = 'products' and system = 0") === 2;
  await press(window, nav.close);
  await pause(400);

  await window.webContents.executeJavaScript(`document.querySelector("main tbody tr")?.click()`);
  await pause(800);
  await typeInto(window, words.shelf, "B7");
  await typeInto(window, words.cost, "1,25");
  await pause(200);
  await pressLast(window, nav.save);
  await pause(900);
  await shoot(window, join(out, "18-product-own.png"));
  audit.push(...(await measure(window, "18-product-own")));
  done.valuesSaved = count("select count(*) as n from column_values where list = 'products' and value in ('B7', '1,25')") === 2;
  await press(window, nav.close);
  await pause(500);
  await shoot(window, join(out, "19-stock-columns.png"));

  await pressStarting(window, words.cost);
  await pause(300);
  /* What he wrote in his own column is found from the list's search box. */
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector("main input[aria-label]");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "B7");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await pause(900);
  await shoot(window, join(out, "20-stock-filtered.png"));
  audit.push(...(await measure(window, "20-stock-filtered")));
  done.filtered = (await window.webContents.executeJavaScript(`document.querySelectorAll("main tbody tr").length`)) === 1;

  const started = Date.now();
  await press(window, words.print);
  await pause(2500);
  const temp = app.getPath("temp");
  const printed = readdirSync(temp)
    .filter((file) => file.endsWith(".pdf") && statSync(join(temp, file)).mtimeMs >= started - 1000)
    .sort((a, b) => statSync(join(temp, b)).mtimeMs - statSync(join(temp, a)).mtimeMs)[0];
  if (printed) copyFileSync(join(temp, printed), join(out, "21-stock-list.pdf"));
  done.printed = Boolean(printed);

  await pressStarting(window, words.columns);
  await pause(600);
  await window.webContents.executeJavaScript(`(() => {
    const rows = [...document.querySelectorAll("[role=dialog] li")];
    const row = rows.find((li) => li.querySelector("input")?.value === ${JSON.stringify(words.cost)});
    row?.querySelector(${JSON.stringify(`button[aria-label="${words.remove}"]`)})?.click();
  })()`);
  await pause(400);
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector("[role=alertdialog] input");
    if (!input) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(words.cost)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await pause(300);
  await shoot(window, join(out, "22-delete-column.png"));
  await pressLast(window, words.remove);
  await pause(700);
  done.deleted =
    count("select count(*) as n from list_columns where list = 'products' and system = 0") === 1 &&
    count("select count(*) as n from column_values where list = 'products' and value = '1.25'") === 0;
  await press(window, nav.close);
  await pause(400);

  /* A spreadsheet brought into the stock: two good rows and one without a price. */
  const importLabel = language === "ar" ? "استيراد Excel" : "Importer Excel";
  await press(window, nav.stock);
  await pause(700);
  await press(window, importLabel);
  await pause(600);
  await window.webContents.executeJavaScript(`(() => {
    const csv = "Nom;Prix;Quantité;Lot;Péremption\\nVentoline 100;450;12;V12;03/2027\\nSmecta;250;30;S30;12/2027\\nSans prix;;4;;\\n";
    const file = new File([csv], "produits.csv", { type: "text/csv" });
    const input = document.querySelector("[role=dialog] input[type=file]");
    const box = new DataTransfer();
    box.items.add(file);
    input.files = box.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await pause(1500);
  await shoot(window, join(out, "24-import.png"));
  await pressStarting(window, language === "ar" ? "استيراد 2" : "Importer 2");
  await pause(1000);
  done.imported = count("select count(*) as n from products where name in ('Ventoline 100', 'Smecta') and archived_at is null") === 2;
  await press(window, nav.close);
  await pause(400);

  await press(window, nav.settings);
  await pause(800);
  await window.webContents.executeJavaScript(`(() => {
    const heading = [...document.querySelectorAll("main h2")].find((h) => h.innerText.trim() === ${JSON.stringify(language === "ar" ? "أعمدة القوائم" : "Colonnes des listes")});
    let box = heading?.parentElement;
    while (box && getComputedStyle(box).overflowY !== "auto") box = box.parentElement;
    if (heading && box) box.scrollTop += heading.getBoundingClientRect().top - box.getBoundingClientRect().top - 16;
  })()`);
  await pause(400);
  await shoot(window, join(out, "23-settings-columns.png"));
  audit.push(...(await measure(window, "23-settings")));
  await press(window, nav.sale);
  await pause(400);
  return done;
}

/*
 * The other screens, used rather than looked at: the drawer opened and
 * closed, a debt paid, goods received, a sale voided. Each step is checked in
 * the database afterwards, not on the screen, because the screen saying
 * "done" is not proof that it was.
 */
async function useTheScreens(window: BrowserWindow, database: Database.Database, out: string, language: "fr" | "ar") {
  const nav = NAV[language];
  const count = (sql: string, ...args: unknown[]) => (database.prepare(sql).get(...args) as { n: number }).n;
  const done: Record<string, boolean> = {};
  const step = async (ms = 700) => pause(ms);

  /* The drawer: 500 in the morning, counted 1 300 at night. */
  await press(window, nav.cash);
  await step();
  await typeInto(window, nav.float, "500");
  await press(window, nav.openCash);
  await step(900);
  await typeInto(window, nav.counted, "1300");
  await step(300);
  await pressLast(window, nav.closeCash);
  await step(900);
  await shoot(window, join(out, "10-cash-closed.png"));
  done.cashClosed = count("select count(*) as n from cash_sessions where closed_at is not null and counted = 130000") === 1;

  /* A debt paid: the demo customer pays 100 in cash. */
  await press(window, nav.customers);
  await step();
  await clickContaining(window, "main tbody tr", "Client démo");
  await step();
  await typeInto(window, nav.paid, "100");
  await step(300);
  await pressLast(window, nav.save);
  await step(900);
  await shoot(window, join(out, "11-payment.png"));
  done.debtPaid = count("select count(*) as n from credit_entries where sale_id is null and amount = -10000 and payment = 'cash'") === 1;
  await press(window, nav.close);
  await step(300);

  /* Goods received: 24 boxes of the first product, batch W-24. */
  await press(window, nav.stock);
  await step();
  await window.webContents.executeJavaScript(`document.querySelector("main tbody tr")?.click()`);
  await step();
  await press(window, nav.receive);
  await step(500);
  await typeInto(window, nav.quantity, "24");
  await typeInto(window, nav.lot, "W-24");
  await step(300);
  await pressLast(window, nav.save);
  await step(900);
  await shoot(window, join(out, "12-received.png"));
  done.received = count("select count(*) as n from batches where lot = 'W-24'") === 1;
  await press(window, nav.close);
  await step(300);

  /* A sale voided, with its reason, from Reports. */
  await press(window, nav.reports);
  await step();
  await window.webContents.executeJavaScript(`[...document.querySelectorAll("main tbody tr")].pop()?.click()`);
  await step();
  await press(window, nav.voidSale);
  await step(400);
  await press(window, nav.reason);
  await step(200);
  await pressLast(window, nav.voidSale);
  await step(900);
  await shoot(window, join(out, "13-voided.png"));
  done.voided = count("select count(*) as n from sales where status = 'voided'") >= 1;
  await press(window, nav.close);
  await step(300);
  await press(window, nav.sale);
  return done;
}

/*
 * Walk the till the way a cashier works a pharmacy counter: type the first
 * letters, pick the result, twice for the first product and once for the
 * second, then charge. Then open every other screen once and take its
 * picture. The ticket is read back off the screen before charging, so a
 * stray click can never become a sale.
 */
export async function walkTill(
  window: BrowserWindow,
  database: Database.Database,
  out: string,
  charge: string
): Promise<void> {
  mkdirSync(out, { recursive: true });
  const language = process.env.OUAQT_DEMO_LANG === "ar" ? "ar" : "fr";

  /* A first launch: the language screen, pictured, then the demo's own language chosen on it. */
  if (process.env.OUAQT_DEMO_FIRST_LAUNCH === "1") {
    await pause(1500);
    await shoot(window, join(out, "0-language.png"));
    await press(window, language === "ar" ? "العربية" : "Français");
  }

  await pause(1500);
  await shoot(window, join(out, "1-empty.png"));

  const products = listProducts(database).filter((p) => p.onHand > 0);
  const first = products[0];
  const second = products[1];
  const label = (p: typeof first) => (language === "ar" ? p.nameArabic || p.name : p.name);

  const add = async (product: typeof first) => {
    await type(window, product.name.slice(0, 4));
    await pause(500);
    return pickFirstResult(window);
  };

  const steps = { firstTwice: (await add(first)) && (await add(first)), second: await add(second) };
  await pause(500);
  await shoot(window, join(out, "2-ticket.png"));

  const ticket = (await window.webContents.executeJavaScript(`(() =>
    [...document.querySelectorAll("aside li")].map((li) => li.querySelector("span").innerText.trim())
  )()`)) as string[];
  const expected = [label(first), label(second)];
  const ticketIsRight = ticket.length === expected.length && expected.every((name) => ticket.includes(name));
  const expectedTotal = 2 * first.salePrice + second.salePrice;

  const before = (database.prepare("select coalesce(max(number), 0) as n from sales").get() as { n: number }).n;
  const charged = ticketIsRight ? await pressStarting(window, charge) : false;
  await pause(1000);
  await shoot(window, join(out, "3-after-sale.png"));

  const sale = database.prepare("select number, total, payment from sales where number > ? order by number").all(before) as {
    number: number;
    total: number;
    payment: string;
  }[];

  /* Every other screen, once. */
  const nav = NAV[language];
  const pictures: Record<string, boolean> = {};
  const audit: string[] = await measure(window, "1-sale");
  for (const [file, name] of [
    ["3b-overview", nav.overview],
    ["4-stock", nav.stock],
    ["6-customers", nav.customers],
    ["7-cash", nav.cash],
    ["8-reports", nav.reports],
    ["9-settings", nav.settings],
  ] as const) {
    pictures[file] = await press(window, name);
    await pause(900);
    await shoot(window, join(out, `${file}.png`));
    audit.push(...(await measure(window, file)));
    if (file === "3b-overview") {
      /* The first transaction's receipt: shown as it prints, then downloaded as a PDF. */
      const words = screensFor(language);
      const opened = await press(window, words.receipt);
      await pause(1500);
      await shoot(window, join(out, "3c-receipt.png"));
      audit.push(...(await measure(window, "3c-receipt")));
      await press(window, words.downloadReceipt);
      await pause(1500);
      const pdf = readdirSync(out).some((name) => /^recu-\d+\.pdf$/.test(name));
      await shoot(window, join(out, "3d-receipt-saved.png"));
      pictures["3c-receipt"] = opened && pdf;
      await press(window, words.close);
      await pause(300);
    }
    if (file === "8-reports") {
      /* The log of actions, further down the same page. */
      await window.webContents.executeJavaScript(`(() => {
        const heading = [...document.querySelectorAll("main h2")].find((h) => h.innerText.trim() === ${JSON.stringify(nav.journal)});
        let box = heading?.parentElement;
        while (box && getComputedStyle(box).overflowY !== "auto") box = box.parentElement;
        if (heading && box) box.scrollTop += heading.getBoundingClientRect().top - box.getBoundingClientRect().top - 16;
      })()`);
      await pause(400);
      await shoot(window, join(out, "8b-journal.png"));
      audit.push(...(await measure(window, "8b-journal")));
      /* A sale's receipt from the list at the bottom, without opening the sale. */
      const words = screensFor(language);
      pictures["8c-receipt"] = await press(window, words.receipt);
      await pause(1500);
      await shoot(window, join(out, "8c-receipt.png"));
      await press(window, words.close);
      await pause(300);
    }
    if (file === "4-stock") {
      /* The first product's sheet, with its batches. */
      const opened = (await window.webContents.executeJavaScript(`(() => {
        const row = document.querySelector("main tbody tr");
        if (!row) return false;
        row.click();
        return true;
      })()`)) as boolean;
      await pause(700);
      pictures["5-product"] = opened;
      await shoot(window, join(out, "5-product.png"));
      audit.push(...(await measure(window, "5-product")));
      await press(window, nav.close);
      await pause(300);
    }
  }
  await press(window, nav.sale);
  await pause(500);

  const used = await useTheScreens(window, database, out, language);

  /* Paying through an application: the owner's list opens, the first one is chosen, and the sale says so. */
  await press(window, nav.sale);
  await pause(500);
  await add(first);
  await pause(400);
  await press(window, language === "ar" ? "تطبيق" : "Application");
  await pause(700);
  await shoot(window, join(out, "14-app-dialog.png"));
  audit.push(...(await measure(window, "14-app-dialog")));
  await press(window, "Bankily");
  await pause(500);
  await shoot(window, join(out, "15-app-chosen.png"));
  await pressStarting(window, charge);
  await pause(1000);
  const byApp = database.prepare("select count(*) as n from sales where payment = 'mobile' and mobile_app = 'Bankily'").get() as { n: number };
  pictures["14-app-payment"] = byApp.n === 1;

  Object.assign(used, await useTheColumns(window, database, out, language, audit));

  const onHand = listProducts(database).map((p) => ({ name: p.name, onHand: p.onHand }));
  writeFileSync(
    join(out, "walk.json"),
    JSON.stringify({ steps, ticket, ticketIsRight, charged, sale, expectedTotal, pictures, used, onHand, audit }, null, 2)
  );
}

export function fixtureFor(root: string): string {
  const named = process.env.OUAQT_DEMO_CONFIG;
  if (named && existsSync(named)) return named;
  return join(root, "fixtures", "configuration.pharmacy.json");
}

/* Wait until a button with this text is on screen, or give up. */
async function waitFor(window: BrowserWindow, text: string, seconds: number): Promise<boolean> {
  for (let i = 0; i < seconds * 4; i += 1) {
    const found = (await window.webContents.executeJavaScript(`(() =>
      [...document.querySelectorAll("button")].some((b) => (b.innerText || "").split("\\n")[0].trim() === ${JSON.stringify(text)})
    )()`)) as boolean;
    if (found) return true;
    await pause(250);
  }
  return false;
}

/*
 * Activate a fresh install, the way an owner would, then walk the till.
 *
 * With a serial it types it and presses Valider, like the owner who built on
 * his phone. Without one it waits, because the link passed on the command
 * line is already activating, like the owner who built on this PC.
 *
 * Only ever run in a data folder of its own: see main.ts.
 */
export async function activateAndWalk(
  window: BrowserWindow,
  database: Database.Database,
  out: string,
  serial: string | null,
  charge: string
): Promise<void> {
  mkdirSync(out, { recursive: true });
  await pause(1500);
  /* A first launch asks the language before anything else. */
  if (await press(window, "Français")) await pause(900);
  await shoot(window, join(out, "0-before.png"));

  if (serial) {
    await window.webContents.executeJavaScript(`(() => {
      const input = document.querySelector("input");
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      set.call(input, ${JSON.stringify(serial)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await pause(300);
    await press(window, "Valider");
  }

  /*
   * Opened again without a serial: the app asks the website what changed as
   * it starts. Wait for that answer to land, and for the screen to reload
   * with it, before anything is pictured.
   */
  if (!serial) {
    const versionOf = () =>
      (database.prepare("select value from settings_local where key = 'configuration_version'").get() as { value: string } | undefined)?.value ?? null;
    const before = versionOf();
    for (let waited = 0; waited < 45 && versionOf() === before; waited += 1) await pause(1000);
    await pause(2500);
  }

  /* Activated means the shop's own menu is on screen; Settings is in every trade's. */
  const ready = await waitFor(window, NAV[process.env.OUAQT_DEMO_LANG === "ar" ? "ar" : "fr"].settings, 45);
  await pause(800);
  await shoot(window, join(out, "1-activated.png"));

  const products = listProducts(database);
  const staff = database.prepare("select name, role from staff").all();
  const owner = database.prepare("select value from settings_local where key = 'business_id'").get() as
    | { value: string }
    | undefined;

  writeFileSync(
    join(out, "activation.json"),
    JSON.stringify(
      {
        ready,
        products: products.map((p) => ({ name: p.name, price: p.salePrice, onHand: p.onHand, extra: p.extra })),
        staff,
        businessId: owner?.value ?? null,
      },
      null,
      2
    )
  );

  /* What came from the website, as the owner sees it: his shop in Settings, his products with their columns. */
  if (ready) {
    await press(window, NAV.fr.settings);
    await pause(900);
    await shoot(window, join(out, "2-settings.png"));
    await press(window, NAV.fr.stock);
    await pause(900);
    await shoot(window, join(out, "3-stock.png"));
    await press(window, NAV.fr.sale);
    await pause(500);
  }
  const held = (() => {
    try {
      const business = (JSON.parse(readFileSync(join(process.env.OUAQT_DATA_FOLDER ?? "", "configuration.json"), "utf8")) as { business: Record<string, string | undefined> }).business;
      const hash = (url?: string) => (url ? createHash("sha256").update(Buffer.from(url.split(",")[1] ?? "", "base64")).digest("hex") : null);
      return { nameLatin: business.nameLatin, nameArabic: business.nameArabic, phone: business.phone, address: business.address, logo: hash(business.logo), logoMono: hash(business.logoMono) };
    } catch {
      return null;
    }
  })();
  const columns = database
    .prepare("select c.label, v.value, p.name from column_values v join list_columns c on c.id = v.column_id join products p on p.id = v.row_id order by p.name, c.label")
    .all();
  writeFileSync(join(out, "held.json"), JSON.stringify({ business: held, staff: database.prepare("select name, role from staff order by name").all(), columns, units: listProducts(database).map((p) => [p.name, p.unit]) }, null, 2));

  if (ready && products.length >= 2 && process.env.OUAQT_WALK_TILL === "1") await walkTill(window, database, out, charge);
}

/*
 * Walk a trade's app the way its owner would on the first day: open every
 * section down the side and take its picture, then do the one thing that
 * trade does most, through the screen, and check it in the database. A
 * restaurant serves a table, a hotel takes an arrival, a bus company sells a
 * seat, a bakery records its production, a warehouse takes goods in, a shop
 * sells from its tiles.
 */
export async function walkTrade(window: BrowserWindow, database: Database.Database, out: string, pack: Pack, language: "fr" | "ar"): Promise<void> {
  mkdirSync(out, { recursive: true });
  await pause(1500);
  const t = screensFor(language);
  const tt = tradesFor(language);
  const js = <T>(code: string) => window.webContents.executeJavaScript(code) as Promise<T>;
  const count = (sql: string) => (database.prepare(sql).get() as { n: number }).n;

  const sections = await js<string[]>(`[...document.querySelectorAll("nav button")].map((b) => (b.innerText || "").split("\\n")[0].trim()).filter(Boolean)`);
  const pictures: string[] = [];
  const audit: string[] = [];
  for (const [index, name] of sections.entries()) {
    await press(window, name);
    await pause(900);
    const file = `${String(index + 1).padStart(2, "0")}-${pack}.png`;
    await shoot(window, join(out, file));
    pictures.push(file);
    audit.push(...(await measure(window, file)));
    /* Where the section adds a product, a dish or a service: its form, as the owner fills it in. */
    for (const label of [t.newProduct, tt.newDish, tt.newExtra, ...newItemLabels(language)]) {
      if (!(await press(window, label))) continue;
      await pause(700);
      const form = `${String(index + 1).padStart(2, "0")}b-new.png`;
      await shoot(window, join(out, form));
      audit.push(...(await measure(window, form)));
      await press(window, t.cancel);
      await pause(400);
      break;
    }
  }

  const clickFirst = (selector: string) => js<boolean>(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; e.click(); return true; })()`);
  const pressStartingWithin = (text: string) =>
    js<boolean>(`(() => {
      const scope = document.querySelector("[role=dialog]") || document;
      const target = [...scope.querySelectorAll("button")].reverse().find((b) => (b.innerText || "").trim().startsWith(${JSON.stringify(text)}) && !b.disabled);
      if (!target) return false;
      target.click();
      return true;
    })()`);
  const charge = t.charge.split("{")[0].trim();
  const pay = tt.pay.split("{")[0].trim();

  let action = false;
  let detail = "";
  switch (pack) {
    case "restaurant": {
      /* Two of the first dish and one of the second, paid part by Bankily and the rest in cash. */
      const before = count("select count(*) as n from sales");
      await press(window, sections[0]);
      await pause(800);
      await js(`(() => { const cards = [...document.querySelectorAll("main section .grid > div > button:first-child")]; cards[0]?.click(); })()`);
      await pause(500);
      await js(`(() => { const cards = [...document.querySelectorAll("main section .grid > div > button:first-child")]; cards[0]?.click(); })()`);
      await pause(500);
      await js(`(() => { const cards = [...document.querySelectorAll("main section .grid > div > button:first-child")]; cards[1]?.click(); })()`);
      await pause(800);
      await shoot(window, join(out, "90-order.png"));
      await js(`(() => {
        const input = document.querySelector(${JSON.stringify(`input[aria-label="${tt.amountLabel}"]`)});
        if (!input) return;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "100");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      })()`);
      await pause(300);
      await pressStartingWithin(tt.addApp);
      await pause(600);
      await pressStartingWithin("Bankily");
      await pause(400);
      await pressStartingWithin(tt.restInCash.split("(")[0].trim());
      await pause(500);
      await shoot(window, join(out, "91-split.png"));
      await js(`(() => { const buttons = [...document.querySelectorAll("aside button")]; buttons[buttons.length - 1]?.click(); })()`);
      await pause(1500);
      await shoot(window, join(out, "92-receipt.png"));
      await pressStartingWithin(t.close);
      await pause(500);
      await pressStartingWithin(tt.history);
      await pause(900);
      await shoot(window, join(out, "93-history.png"));
      await js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`);
      await pause(400);
      await pressStartingWithin(tt.endOfDay);
      await pause(900);
      await shoot(window, join(out, "94-end-of-day.png"));
      await js(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`);
      await pause(300);
      /* A company's account: an order put on it with the employee's name, then its month's invoice. */
      /* This computer's own id, from the sale just recorded. */
      const device = (database.prepare("select device_id from sales order by counter desc limit 1").get() as { device_id: string }).device_id;
      const company = addCustomer(database, device, { name: "Société Démo", contact: "Mme Diop", billing: "monthly", billingStart: `${today().slice(0, 8)}01` });
      /* The account was made in Clients, as the owner would; the counter reads the accounts when it opens. */
      await press(window, tt.navMenu);
      await pause(500);
      await press(window, tt.navCounter);
      await pause(900);
      await js(`(() => { const cards = [...document.querySelectorAll("main section .grid > div > button:first-child")]; cards[2]?.click(); })()`);
      await pause(800);
      await js(`(() => {
        const select = document.querySelector(${JSON.stringify(`label[title="${tt.accountLabel}"] select`)});
        if (!select) return;
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, ${JSON.stringify(company)});
        select.dispatchEvent(new Event("change", { bubbles: true }));
      })()`);
      await pause(800);
      await js(`(() => {
        const input = document.querySelector(${JSON.stringify(`input[placeholder="${tt.employee}"]`)});
        if (!input) return;
        input.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "Ahmed");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.blur();
      })()`);
      await pause(800);
      await shoot(window, join(out, "95-on-account.png"));
      await js(`(() => { const buttons = [...document.querySelectorAll("aside button")]; buttons[buttons.length - 1]?.click(); })()`);
      await pause(1200);
      await pressStartingWithin(t.close);
      await pause(400);
      const onAccount = count(`select count(*) as n from sales where payment = 'credit' and employee = 'Ahmed' and customer_id = '${company}'`);
      await press(window, sections.find((name) => name === t.customersTitle) ?? t.customersTitle);
      await pause(900);
      await shoot(window, join(out, "96-accounts.png"));
      await js(`(() => { const row = [...document.querySelectorAll("main tbody tr")].find((r) => (r.innerText || "").includes("Société Démo")); row?.click(); })()`);
      await pause(900);
      await pressStartingWithin(t.openInvoice);
      await pause(900);
      await shoot(window, join(out, "97-invoice.png"));
      const paidInParts = count("select count(*) as n from sale_payments where mobile_app = 'Bankily' and amount = 10000");
      action = count("select count(*) as n from sales") === before + 2 && paidInParts === 1 && onAccount === 1;
      detail = `sales ${before} -> ${count("select count(*) as n from sales")}, Bankily part ${paidInParts}, on account ${onAccount}`;
      break;
    }
    case "hotel": {
      const before = count("select count(*) as n from stays where status = 'in'");
      await press(window, sections[0]);
      await pause(700);
      await js(`(() => { const b = [...document.querySelectorAll("main button")].find((b) => (b.innerText || "").trim().startsWith("101")); b && b.click(); })()`);
      await pause(800);
      await typeInto(window, tt.guest, "Client walk");
      await pause(300);
      await pressStartingWithin(tt.checkIn);
      await pause(1200);
      await shoot(window, join(out, "90-arrival.png"));
      /* An occupied room's panel, a booking open beside the list, and a problem reported in an empty room. */
      await js(`(() => { const b = [...document.querySelectorAll("main button")].find((b) => (b.innerText || "").trim().startsWith("102")); b && b.click(); })()`);
      await pause(900);
      await shoot(window, join(out, "91-room-panel.png"));
      await pressStartingWithin(t.close);
      await pause(400);
      await press(window, tt.staysTitle);
      await pause(900);
      await js(`(() => { document.querySelector("main ul li button")?.click(); })()`);
      await pause(900);
      await shoot(window, join(out, "92-bookings.png"));
      await press(window, tt.roomsTitle);
      await pause(900);
      await js(`(() => { const b = [...document.querySelectorAll("main button")].find((b) => (b.innerText || "").trim().startsWith("104")); b && b.click(); })()`);
      await pause(800);
      await typeInto(window, tt.issueLabel, "Climatisation en panne");
      await pause(300);
      await pressStartingWithin(tt.reportIssue);
      await pause(900);
      await shoot(window, join(out, "93-maintenance.png"));
      const reported = count("select count(*) as n from maintenance_issues where status = 'open'");
      action = count("select count(*) as n from stays where status = 'in'") === before + 1 && reported === 1;
      detail = `in the hotel ${before} -> ${count("select count(*) as n from stays where status = 'in'")}, issues ${reported}`;
      break;
    }
    case "transport": {
      const before = count("select count(*) as n from tickets where status != 'cancelled'");
      await press(window, sections[0]);
      await pause(700);
      await clickFirst("main ul li button");
      await pause(900);
      /* The seat plan beside the departures: seat 3 is free in the demo. */
      await js(`(() => { const b = [...document.querySelectorAll("main button[aria-pressed]")].find((b) => (b.innerText || "").trim() === "3"); b && b.click(); })()`);
      await pause(500);
      await typeInto(window, tt.passenger, "Passager walk");
      await pause(500);
      await pressStartingWithin(pay);
      await pause(1200);
      await shoot(window, join(out, "90-ticket.png"));
      action = count("select count(*) as n from tickets where status != 'cancelled'") === before + 1;
      detail = `tickets ${before} -> ${count("select count(*) as n from tickets where status != 'cancelled'")}`;
      break;
    }
    case "bakery": {
      const before = count("select count(*) as n from stock_movements where reason = 'production'");
      await press(window, tt.navProduction);
      await pause(800);
      await js(`(() => {
        const input = document.querySelector("main tbody input");
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        set.call(input, "12");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      })()`);
      await pause(300);
      await pressStartingWithin(tt.saveProduction);
      await pause(1000);
      await shoot(window, join(out, "90-production.png"));
      action = count("select count(*) as n from stock_movements where reason = 'production'") === before + 1;
      detail = `production lines ${before} -> ${count("select count(*) as n from stock_movements where reason = 'production'")}`;
      break;
    }
    case "warehouse": {
      const before = count("select count(*) as n from stock_movements where reason = 'reception'");
      await press(window, tt.navMoves);
      await pause(800);
      await js(`(() => { const s = document.querySelector("main select"); s.value = s.options[1].value; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
      await pause(300);
      await typeInto(window, t.quantity, "10");
      await pause(300);
      await pressStartingWithin(tt.saveIn);
      await pause(1000);
      await shoot(window, join(out, "90-goods-in.png"));
      action = count("select count(*) as n from stock_movements where reason = 'reception'") === before + 1;
      detail = `receptions ${before} -> ${count("select count(*) as n from stock_movements where reason = 'reception'")}`;
      break;
    }
    default: {
      const before = count("select count(*) as n from sales");
      await press(window, sections.find((name) => name === (language === "ar" ? "بيع" : "Vente")) ?? sections[0]);
      await pause(800);
      await clickFirst("main section .grid button");
      await pause(500);
      await pressStartingWithin(charge);
      await pause(1200);
      await shoot(window, join(out, "90-sale.png"));
      action = count("select count(*) as n from sales") === before + 1;
      detail = `sales ${before} -> ${count("select count(*) as n from sales")}`;
    }
  }

  writeFileSync(join(out, "walk.json"), JSON.stringify({ pack, language, sections, pictures, action, detail, audit }, null, 2));
}

/*
 * The licence screens, as an owner meets them: OUAQT_DEMO_LICENCE names the
 * state (see demoLicence in main.ts). The window is photographed and
 * measured; on an ended licence "I have paid" is pressed too, and in a demo
 * the answer is "not yet", which is photographed as well.
 */
export async function walkLicence(window: BrowserWindow, out: string, language: "fr" | "ar"): Promise<void> {
  mkdirSync(out, { recursive: true });
  await pause(2000);
  const audit: string[] = [];
  await shoot(window, join(out, "1-licence.png"));
  audit.push(...(await measure(window, "1-licence")));
  const checked = await pressStarting(window, language === "ar" ? "دفعت" : "J'ai payé");
  if (checked) {
    await pause(1200);
    await shoot(window, join(out, "2-checked.png"));
    audit.push(...(await measure(window, "2-checked")));
  }
  const text = (await window.webContents.executeJavaScript("document.body.innerText")) as string;
  /* The QR code read back the way a phone would, to prove it opens the right page. */
  const scanned = (await window.webContents.executeJavaScript(`(async () => {
    const svg = document.querySelector("svg[data-pay-link]");
    if (!svg) return "no_code";
    if (!("BarcodeDetector" in window)) return "no_detector";
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }));
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 480;
    canvas.getContext("2d").drawImage(image, 0, 0, 480, 480);
    const found = await new BarcodeDetector({ formats: ["qr_code"] }).detect(canvas);
    return found[0] ? found[0].rawValue : "unreadable";
  })()`)) as string;
  writeFileSync(join(out, "walk.json"), JSON.stringify({ checked, audit, scanned, text }, null, 2));
}
