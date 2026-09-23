import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import type { BrowserWindow } from "electron";
import { sampleProducts } from "@app-ui/sample-data";
import type { Pack } from "@app-ui/packs";
import { addCustomer } from "./db/customers";
import { addProduct, listProducts, receiveStock, recordMovement, today } from "./db/products";
import { recordSale } from "./db/sales";

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
 * The invented products for this trade, from the same sample list the
 * builder's preview draws. Only when the demo database is empty, so running
 * the demo twice does not double the stock.
 */
/*
 * A demo pharmacy: invented stock under real medicine names, with generic
 * names, costs and batches, one of them already expired and one expiring
 * within the alert window, so every screen has something true to show.
 */
const PHARMACY_DEMO = [
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

function seedPharmacy(database: Database.Database, deviceId: string): void {
  const now = new Date();
  const inDays = (days: number) => today(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
  for (const item of PHARMACY_DEMO) {
    const id = addProduct(database, deviceId, {
      name: item.name,
      genericName: item.generic,
      nameArabic: item.ar,
      unit: item.unit,
      salePrice: item.price,
      costPrice: item.cost,
      lowStock: item.low,
    });
    for (const batch of item.lots) {
      if (batch.qty <= 0) continue;
      receiveStock(database, deviceId, {
        productId: id,
        quantity: batch.qty,
        lot: batch.lot || null,
        expiresOn: batch.lot ? inDays(batch.days) : null,
        costPrice: item.cost,
        supplierName: "Grossiste démo",
      });
    }
  }

  /* One customer who owes, so the Clients screen shows how a debt reads. */
  const customer = addCustomer(database, deviceId, { name: "Client démo", phone: "22 00 00 00" });
  const product = listProducts(database).find((one) => one.name.startsWith("Smecta"));
  if (product) {
    recordSale(database, deviceId, {
      payment: "credit",
      customerId: customer,
      lines: [{ productId: product.id, quantity: 2, unitPrice: product.salePrice }],
    });
  }
}

export function seedDemo(database: Database.Database, deviceId: string, pack: Pack): void {
  if (listProducts(database).length > 0) return;
  if (pack === "pharmacy") {
    seedPharmacy(database, deviceId);
    return;
  }

  for (const sample of sampleProducts(pack)) {
    const id = addProduct(database, deviceId, {
      name: sample.name.fr,
      nameArabic: sample.name.ar,
      salePrice: sample.price,
    });
    recordMovement(database, deviceId, {
      productId: id,
      quantity: sample.inStock,
      reason: "reception",
    });
  }
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
    float: "Fond de caisse", openCash: "Ouvrir la caisse", counted: "Compté dans la caisse", closeCash: "Clôturer la caisse",
    paid: "Montant payé", save: "Enregistrer", receive: "Réception", quantity: "Quantité", lot: "Lot",
    voidSale: "Annuler la vente", reason: "Erreur de saisie",
  },
  ar: {
    stock: "المخزون", customers: "الزبائن", cash: "الصندوق", reports: "التقارير", settings: "الإعدادات", sale: "بيع", close: "إغلاق",
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
  await clickContaining(window, "main li button", language === "ar" ? "Client démo" : "Client démo");
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
  await pause(1500);
  await shoot(window, join(out, "1-empty.png"));

  const language = process.env.OUAQT_DEMO_LANG === "ar" ? "ar" : "fr";
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
  for (const [file, name] of [
    ["4-stock", nav.stock],
    ["6-customers", nav.customers],
    ["7-cash", nav.cash],
    ["8-reports", nav.reports],
    ["9-settings", nav.settings],
  ] as const) {
    pictures[file] = await press(window, name);
    await pause(900);
    await shoot(window, join(out, `${file}.png`));
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
      await press(window, nav.close);
      await pause(300);
    }
  }
  await press(window, nav.sale);
  await pause(500);

  const used = await useTheScreens(window, database, out, language);

  const onHand = listProducts(database).map((p) => ({ name: p.name, onHand: p.onHand }));
  writeFileSync(
    join(out, "walk.json"),
    JSON.stringify({ steps, ticket, ticketIsRight, charged, sale, expectedTotal, pictures, used, onHand }, null, 2)
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

  /* Activated means the till's own menu is on screen. */
  const ready = await waitFor(window, NAV[process.env.OUAQT_DEMO_LANG === "ar" ? "ar" : "fr"].sale, 45);
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

  if (ready && products.length >= 2) await walkTill(window, database, out, charge);
}
