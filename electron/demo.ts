import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { app, type BrowserWindow } from "electron";
import { sampleProducts } from "@app-ui/sample-data";
import type { Pack } from "@app-ui/packs";
import { recordProduction, createPreorder } from "./db/bakery";
import { addCashMovement } from "./db/cashbook";
import { addCustomer } from "./db/customers";
import { addCharge, addRoom, bookStay, setRoomStatus } from "./db/hotel";
import { addProduct, listProducts, receiveStock, recordMovement, today } from "./db/products";
import { addToOrder, sendToKitchen, startOrder } from "./db/restaurant";
import { recordSale } from "./db/sales";
import { addRoute, addVehicle, registerParcel, scheduleTrip, sellTicket } from "./db/transport";
import { ensureLocations } from "./db/warehouse";
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

/* Invented stock for a trade, with the categories its screens group by. */
function seedCatalog(
  database: Database.Database,
  deviceId: string,
  items: { name: string; ar: string; price: number; category: string; unit?: string; qty?: number; tracked?: boolean; barcode?: string; locationId?: string }[]
): void {
  for (const item of items) {
    const id = addProduct(database, deviceId, {
      name: item.name,
      nameArabic: item.ar,
      salePrice: item.price,
      category: item.category,
      unit: item.unit,
      barcode: item.barcode,
      lowStock: item.tracked === false ? null : 5,
      tracked: item.tracked !== false,
      costPrice: item.tracked === false ? null : Math.round(item.price * 0.7),
    });
    if (item.tracked !== false && item.qty) {
      receiveStock(database, deviceId, { productId: id, quantity: item.qty, locationId: item.locationId ?? null, supplierName: "Grossiste démo" });
    }
  }
}

function seedTrade(database: Database.Database, deviceId: string, pack: Pack): void {
  const now = new Date();
  const at = (days: number, hours: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hours, 0).toISOString();
  switch (pack) {
    case "shop":
      seedCatalog(database, deviceId, [
        { name: "Lait en poudre 400 g", ar: "حليب مجفف 400 غ", price: 18000, category: "Épicerie", unit: "Boîte", qty: 24, barcode: "6111000000001" },
        { name: "Sucre", ar: "سكر", price: 4500, category: "Épicerie", unit: "kg", qty: 50 },
        { name: "Huile 1 litre", ar: "زيت 1 لتر", price: 9000, category: "Épicerie", unit: "Bouteille", qty: 36 },
        { name: "Thé vert", ar: "شاي أخضر", price: 12000, category: "Épicerie", unit: "Paquet", qty: 3 },
        { name: "Savon", ar: "صابون", price: 3000, category: "Hygiène", unit: "Pièce", qty: 60 },
        { name: "Recharge téléphone", ar: "تعبئة رصيد", price: 10000, category: "Services", tracked: false },
      ]);
      return;
    case "general":
      seedCatalog(database, deviceId, [
        { name: "Coupe de cheveux", ar: "قص الشعر", price: 30000, category: "Services", tracked: false },
        { name: "Réparation", ar: "إصلاح", price: 50000, category: "Services", tracked: false },
        { name: "Shampooing", ar: "شامبو", price: 25000, category: "Produits", unit: "Flacon", qty: 12 },
        { name: "Câble de chargeur", ar: "سلك شاحن", price: 15000, category: "Produits", unit: "Pièce", qty: 3 },
      ]);
      addCashMovement(database, deviceId, { direction: "out", amount: 150000, reason: "expense", category: "Loyer" });
      return;
    case "restaurant":
      seedCatalog(database, deviceId, [
        { name: "Thé à la menthe", ar: "شاي بالنعناع", price: 5000, category: "Boissons", tracked: false },
        { name: "Café", ar: "قهوة", price: 8000, category: "Boissons", tracked: false },
        { name: "Jus d'orange", ar: "عصير برتقال", price: 12000, category: "Boissons", tracked: false },
        { name: "Thiéboudiène", ar: "تيبودين", price: 60000, category: "Plats", tracked: false },
        { name: "Poulet grillé", ar: "دجاج مشوي", price: 70000, category: "Plats", tracked: false },
        { name: "Sandwich viande", ar: "سندويتش لحم", price: 25000, category: "Sandwichs", tracked: false },
      ]);
      {
        const order = startOrder(database, deviceId, { service: "dine_in", tableNo: 3, guests: 2 });
        const tea = listProducts(database).find((one) => one.name.startsWith("Thé"));
        const dish = listProducts(database).find((one) => one.name.startsWith("Thiéboudiène"));
        if (tea && dish) {
          addToOrder(database, deviceId, { orderId: order, productId: dish.id, quantity: 2 });
          addToOrder(database, deviceId, { orderId: order, productId: tea.id, quantity: 2 });
          sendToKitchen(database, order);
        }
      }
      return;
    case "bakery":
      seedCatalog(database, deviceId, [
        { name: "Pain", ar: "خبز", price: 2000, category: "Pains", unit: "Pièce" },
        { name: "Baguette", ar: "باغيت", price: 2500, category: "Pains", unit: "Pièce" },
        { name: "Croissant", ar: "كرواسون", price: 5000, category: "Viennoiseries", unit: "Pièce" },
        { name: "Gâteau, part", ar: "قطعة كعك", price: 15000, category: "Pâtisseries", unit: "Pièce" },
      ]);
      recordProduction(
        database,
        deviceId,
        listProducts(database).map((product) => ({ productId: product.id, quantity: product.name === "Pain" ? 200 : 40 }))
      );
      {
        const cake = listProducts(database).find((one) => one.name.startsWith("Gâteau"));
        if (cake) {
          createPreorder(database, deviceId, {
            customer: "Client commande",
            phone: "22 11 11 11",
            dueOn: today(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)),
            lines: [{ productId: cake.id, quantity: 8, unitPrice: cake.salePrice }],
            deposit: 50000,
          });
        }
      }
      return;
    case "warehouse": {
      const [first, second] = ensureLocations(database, deviceId, ["Dépôt principal", "Magasin 2"]);
      seedCatalog(database, deviceId, [
        { name: "Sac de riz 50 kg", ar: "كيس أرز 50 كغ", price: 1200000, category: "Riz", unit: "Sac", qty: 60, locationId: first.id },
        { name: "Carton d'huile", ar: "كرتون زيت", price: 900000, category: "Huile", unit: "Carton", qty: 45, locationId: first.id },
        { name: "Sac de sucre 25 kg", ar: "كيس سكر 25 كغ", price: 750000, category: "Sucre", unit: "Sac", qty: 30, locationId: second?.id ?? first.id },
      ]);
      return;
    }
    case "hotel": {
      const rooms = ["101", "102", "103", "104", "201", "202", "203", "204"].map((number, index) =>
        addRoom(database, deviceId, { number, kind: index % 2 ? "Double" : "Simple", rate: index % 2 ? 250000 : 180000 })
      );
      seedCatalog(database, deviceId, [
        { name: "Petit-déjeuner", ar: "فطور", price: 25000, category: "Repas", tracked: false },
        { name: "Dîner", ar: "عشاء", price: 60000, category: "Repas", tracked: false },
        { name: "Blanchisserie", ar: "غسيل", price: 20000, category: "Services", tracked: false },
        { name: "Eau minérale", ar: "ماء معدني", price: 5000, category: "Boissons", tracked: false },
      ]);
      const stay = bookStay(database, deviceId, {
        roomId: rooms[1],
        guest: "Client hôtel",
        phone: "22 33 33 33",
        idDocument: "NNI 0000000000",
        arrivesOn: today(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)),
        leavesOn: today(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2)),
        advance: 100000,
        checkInNow: true,
      });
      addCharge(database, deviceId, { stayId: stay, label: "Petit-déjeuner", unitPrice: 25000 });
      bookStay(database, deviceId, {
        roomId: rooms[4],
        guest: "Client réservation",
        arrivesOn: today(now),
        leavesOn: today(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3)),
      });
      setRoomStatus(database, rooms[2], "cleaning");
      return;
    }
    case "transport": {
      const route = addRoute(database, deviceId, { origin: "Nouakchott", destination: "Nouadhibou", fare: 80000, parcelFee: 20000 });
      const second = addRoute(database, deviceId, { origin: "Nouakchott", destination: "Rosso", fare: 30000, parcelFee: 10000 });
      const bus = addVehicle(database, deviceId, { plate: "0000-AA-00", seats: 18 });
      const van = addVehicle(database, deviceId, { plate: "1111-BB-11", seats: 12 });
      const morning = scheduleTrip(database, deviceId, { routeId: route, vehicleId: bus, driver: "Chauffeur démo", departsAt: at(0, 8) });
      scheduleTrip(database, deviceId, { routeId: second, vehicleId: van, driver: "Chauffeur démo", departsAt: at(0, 14) });
      scheduleTrip(database, deviceId, { routeId: route, vehicleId: bus, driver: "Chauffeur démo", departsAt: at(1, 8) });
      const label = (trip: { origin: string; destination: string }, seat: number | null) => `${trip.origin} → ${trip.destination}, place ${seat ?? "-"}`;
      sellTicket(database, deviceId, { tripId: morning, seat: 1, passenger: "Voyageur démo", phone: "22 44 44 44", payment: { payment: "cash" }, label });
      sellTicket(database, deviceId, { tripId: morning, seat: 2, passenger: "Voyageuse démo", payment: { payment: "mobile", mobileApp: "Bankily" }, label });
      registerParcel(database, deviceId, {
        routeId: route,
        tripId: morning,
        sender: "Expéditeur démo",
        receiver: "Destinataire démo",
        receiverPhone: "22 55 55 55",
        description: "Carton de vêtements",
        fee: 20000,
        paidBy: "receiver",
        label: (code) => `Colis ${code}`,
      });
      return;
    }
    default:
      return;
  }
}

export function seedDemo(database: Database.Database, deviceId: string, pack: Pack): void {
  /* An empty shop, as on the first day, to see the screens before anything is added. */
  if (process.env.OUAQT_DEMO_EMPTY === "1") return;
  if (listProducts(database).length > 0) return;
  if (pack === "pharmacy") {
    seedPharmacy(database, deviceId);
    return;
  }
  if (pack !== "restaurant" && pack !== "bakery" && pack !== "warehouse" && pack !== "hotel" && pack !== "transport" && pack !== "shop" && pack !== "general") {
    return;
  }
  seedTrade(database, deviceId, pack);
  return;

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

/* Set a text area or a drop-down whose label reads exactly this. */
function setLabelled(window: BrowserWindow, label: string, value: string): Promise<boolean> {
  return window.webContents.executeJavaScript(`(() => {
    const wanted = ${JSON.stringify(label)};
    const scope = document.querySelector("[role=dialog]") || document;
    const field = [...scope.querySelectorAll("label")].find((l) => (l.querySelector("span")?.innerText || "").trim() === wanted);
    const target = field?.querySelector("textarea, select");
    if (!target) return false;
    const proto = target.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(target, ${JSON.stringify(value)});
    target.dispatchEvent(new Event(target.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
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

  await typeInto(window, words.name, words.shelf);
  await press(window, words.choice);
  await pause(200);
  await setLabelled(window, words.choices, "A\nB\nC");
  await pause(200);
  await press(window, words.add);
  await pause(600);
  await typeInto(window, words.name, words.cost);
  await press(window, words.number);
  await pause(200);
  await press(window, words.add);
  await pause(700);
  await shoot(window, join(out, "17-columns-added.png"));
  audit.push(...(await measure(window, "17-columns")));
  done.columnsAdded = count("select count(*) as n from list_columns where list = 'products' and system = 0") === 2;
  await press(window, nav.close);
  await pause(400);

  await window.webContents.executeJavaScript(`document.querySelector("main tbody tr")?.click()`);
  await pause(800);
  await setLabelled(window, words.shelf, "B");
  await typeInto(window, words.cost, "1,25");
  await pause(200);
  await pressLast(window, nav.save);
  await pause(900);
  await shoot(window, join(out, "18-product-own.png"));
  audit.push(...(await measure(window, "18-product-own")));
  done.valuesSaved = count("select count(*) as n from column_values where list = 'products' and value in ('B', '1.25')") === 2;
  await press(window, nav.close);
  await pause(500);
  await shoot(window, join(out, "19-stock-columns.png"));

  await pressStarting(window, words.cost);
  await pause(300);
  await setLabelled(window, words.shelf, "B");
  await pause(500);
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
  for (const [index, name] of sections.entries()) {
    await press(window, name);
    await pause(900);
    const file = `${String(index + 1).padStart(2, "0")}-${pack}.png`;
    await shoot(window, join(out, file));
    pictures.push(file);
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
      const paidInParts = count("select count(*) as n from sale_payments where mobile_app = 'Bankily' and amount = 10000");
      action = count("select count(*) as n from sales") === before + 1 && paidInParts === 1;
      detail = `sales ${before} -> ${count("select count(*) as n from sales")}, Bankily part ${paidInParts}`;
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
      action = count("select count(*) as n from stays where status = 'in'") === before + 1;
      detail = `in the hotel ${before} -> ${count("select count(*) as n from stays where status = 'in'")}`;
      break;
    }
    case "transport": {
      const before = count("select count(*) as n from tickets where status != 'cancelled'");
      await press(window, sections[0]);
      await pause(700);
      await clickFirst("main ul li button");
      await pause(900);
      await js(`(() => { const b = [...document.querySelectorAll("[role=dialog] .grid button")].find((b) => (b.innerText || "").trim() === "3"); b && b.click(); })()`);
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

  writeFileSync(join(out, "walk.json"), JSON.stringify({ pack, language, sections, pictures, action, detail }, null, 2));
}
