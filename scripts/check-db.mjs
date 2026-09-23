/*
 * Proves the database does what the brief asks, without Electron.
 *
 * Migrations apply once each, the tables exist, WAL is on, search finds an
 * accented name typed without accents, and stock is the sum of its movements.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const { readFileSync, readdirSync } = require("node:fs");

const folder = mkdtempSync(join(tmpdir(), "ouaqt-"));
const file = join(folder, "ouaqt.db");
const db = new Database(file);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const migrations = readdirSync("electron/db/migrations").filter((n) => n.endsWith(".sql")).sort();
db.exec("create table if not exists schema_migrations (name text primary key, applied_at text not null)");
for (const name of migrations) {
  const run = db.transaction(() => {
    db.exec(readFileSync(join("electron/db/migrations", name), "utf8"));
    db.prepare("insert into schema_migrations (name, applied_at) values (?, ?)").run(name, new Date().toISOString());
  });
  run();
}

let failures = 0;
const check = (what, passed, detail = "") => {
  if (!passed) failures += 1;
  console.log(`  ${passed ? "pass" : "FAIL"}  ${what}${detail ? `  ${detail}` : ""}`);
  /* On the build machines a failure is also an annotation, readable on the run's page without opening the log. */
  if (!passed && process.env.GITHUB_ACTIONS) console.log(`::error title=check-db::${what}${detail ? `  ${detail}` : ""}`.replace(/\r?\n/g, " "));
};

console.log("\nThe shop's database\n");
check("WAL is on", db.pragma("journal_mode", { simple: true }) === "wal");
check("it passes its integrity check", db.pragma("integrity_check", { simple: true }) === "ok");

const tables = db.prepare("select name from sqlite_master where type='table'").all().map((r) => r.name);
for (const wanted of ["products", "stock_movements", "sales", "sale_lines", "customers", "credit_entries", "cash_sessions", "staff", "settings_local", "sync_state", "audit_local"]) {
  check(`${wanted} exists`, tables.includes(wanted));
}

const applied = db.prepare("select count(*) as n from schema_migrations").get().n;
check("each migration applied once", applied === migrations.length, `${applied} of ${migrations.length}`);

/* A product, then movements, then the quantity as their sum. */
const now = new Date().toISOString();
db.prepare(`insert into products (id, device_id, created_at, counter, name, sale_price)
            values (?, 'device-one', ?, 1, ?, ?)`).run("p1", now, "Crème Béta", 25000);

const add = db.prepare(`insert into stock_movements (id, device_id, created_at, counter, product_id, quantity, reason, occurred_at)
                        values (?, 'device-one', ?, ?, 'p1', ?, ?, ?)`);
add.run("m1", now, 2, 50, "reception", now);
add.run("m2", now, 3, -2, "sale", now);
add.run("m3", now, 4, -1, "expiry", now);

const onHand = db.prepare("select coalesce(sum(quantity), 0) as q from stock_movements where product_id = 'p1'").get().q;
check("stock is the sum of its movements", onHand === 47, `${onHand}`);

const found = db.prepare("select name from products_search where products_search match ?").all("creme*");
check("search finds an accented name typed without accents", found.length === 1, found[0]?.name ?? "");

const byArabic = db.prepare("select rowid from products_search where products_search match ?").all("Béta*");
check("search finds it by the second word too", byArabic.length === 1);

/* ── A sale, which is the thing this app must never get wrong ──────────── */

const shop = require(join(process.cwd(), "dist/main/db.js"));
const deviceId = shop.deviceIdOf(db);

console.log("\nSelling\n");

const paracetamol = shop.addProduct(db, deviceId, { name: "Paracétamol 500mg", salePrice: 12050 });
const gloves = shop.addProduct(db, deviceId, { name: "Gants, boîte", salePrice: 40000 });
shop.recordMovement(db, deviceId, { productId: paracetamol, quantity: 100, reason: "reception" });
shop.recordMovement(db, deviceId, { productId: gloves, quantity: 10, reason: "reception" });

const sale = shop.recordSale(db, deviceId, {
  payment: "cash",
  lines: [
    { productId: paracetamol, quantity: 2, unitPrice: 12050 },
    { productId: gloves, quantity: 1, unitPrice: 40000 },
  ],
});

check("the total is the sum of the lines, in the smallest unit", sale.total === 64100, String(sale.total));
check("the total is a whole number of minor units", Number.isInteger(sale.total));
check("the stock fell by what was sold", shop.onHand(db, paracetamol) === 98, String(shop.onHand(db, paracetamol)));

const lineCount = db.prepare("select count(*) as n from sale_lines where sale_id = ?").get(sale.id).n;
check("every line was written", lineCount === 2, String(lineCount));

const soldMovements = db.prepare("select count(*) as n from stock_movements where reference = ? and reason = 'sale'").get(sale.id).n;
check("every line moved its own stock", soldMovements === 2, String(soldMovements));

/* A quantity that is not whole, at a price that does not divide evenly. */
const flour = shop.addProduct(db, deviceId, { name: "Farine, au kilo", salePrice: 9999 });
shop.recordMovement(db, deviceId, { productId: flour, quantity: 50, reason: "reception" });
const weighed = shop.recordSale(db, deviceId, {
  payment: "cash",
  lines: [{ productId: flour, quantity: 0.25, unitPrice: 9999 }],
});
check("a quarter kilo still costs a whole number of minor units", Number.isInteger(weighed.total) && weighed.total === 2500, String(weighed.total));

/* Credit puts the debt on a customer, and cash does not. */
const customerId = "customer-one";
db.prepare(`insert into customers (id, device_id, created_at, counter, name) values (?, ?, ?, 999, ?)`)
  .run(customerId, deviceId, now, "Client à crédit");

const owed = shop.recordSale(db, deviceId, {
  payment: "credit",
  customerId,
  lines: [{ productId: gloves, quantity: 1, unitPrice: 40000 }],
});
const balance = db.prepare("select coalesce(sum(amount), 0) as total from credit_entries where customer_id = ?").get(customerId).total;
check("a credit sale is owed by the customer", balance === owed.total, String(balance));

let refused = false;
try { shop.recordSale(db, deviceId, { payment: "credit", lines: [{ productId: gloves, quantity: 1, unitPrice: 40000 }] }); }
catch { refused = true; }
check("credit with nobody to owe it is refused", refused);

let empty = false;
try { shop.recordSale(db, deviceId, { payment: "cash", lines: [] }); }
catch { empty = true; }
check("a sale with no lines is refused", empty);

/* ── Voiding, which must never remove what happened ────────────────────── */

console.log("\nVoiding\n");

const before = shop.onHand(db, gloves);
shop.voidSale(db, deviceId, owed.id, "Le client a rendu la boîte", null);

check("the stock came back", shop.onHand(db, gloves) === before + 1, String(shop.onHand(db, gloves)));
check("the debt was reversed", db.prepare("select coalesce(sum(amount), 0) as t from credit_entries where customer_id = ?").get(customerId).t === 0);

const originalStill = db.prepare("select status, total from sales where id = ?").get(owed.id);
check("the original sale is still there, marked voided", originalStill?.status === "voided" && originalStill.total === 40000);

const reversal = db.prepare("select total, void_reason from sales where reverses_id = ?").get(owed.id);
check("the reversal is its own row, with the reason on it", reversal?.total === -40000 && Boolean(reversal.void_reason));

let twice = false;
try { shop.voidSale(db, deviceId, owed.id, "again", null); } catch { twice = true; }
check("a sale cannot be voided twice", twice);

/* Numbers and counters, which is what two tills merging depends on. */
const numbers = db.prepare("select number from sales order by number").all().map((r) => r.number);
check("every sale has its own number", new Set(numbers).size === numbers.length);
const counters = db.prepare("select counter from sales union all select counter from sale_lines").all().map((r) => r.counter);
check("no two rows share a counter", new Set(counters).size === counters.length);

/* ── What the screens after the till rely on ───────────────────────────── */

console.log("\nSearch, batches and expiry\n");

const doliprane = shop.addProduct(db, deviceId, {
  name: "Doliprane 1000",
  genericName: "Paracétamol",
  nameArabic: "دوليبران",
  barcode: "3400930000000",
  salePrice: 15000,
  lowStock: 5,
});
check("the till's own search finds a product by its generic name", shop.searchProducts(db, "paracet").some((p) => p.id === doliprane));
check("and by its Arabic name", shop.searchProducts(db, "دولي").some((p) => p.id === doliprane));
check("and by two words typed in any order", shop.searchProducts(db, "1000 doli").some((p) => p.id === doliprane));
check("a barcode is found whole, first", shop.searchProducts(db, "3400930000000")[0]?.id === doliprane);
check("a quote or a star typed in the box is only a letter", Array.isArray(shop.searchProducts(db, 'dol"i* -')));

const day = new Date(2026, 8, 23, 10, 0, 0);
shop.receiveStock(db, deviceId, { productId: doliprane, quantity: 10, lot: "L-LATE", expiresOn: "2027-06-30", costPrice: 9000 });
shop.receiveStock(db, deviceId, { productId: doliprane, quantity: 4, lot: "L-SOON", expiresOn: "2026-11-30", costPrice: 8800 });
shop.receiveStock(db, deviceId, { productId: doliprane, quantity: 3, lot: "L-OLD", expiresOn: "2026-08-31" });
check("three receptions put seventeen on the shelf", shop.onHand(db, doliprane) === 17, String(shop.onHand(db, doliprane)));
check("the product knows its next expiry", shop.getProduct(db, doliprane).nextExpiry === "2026-08-31");
check("the latest cost becomes the product's cost", shop.getProduct(db, doliprane).costPrice === 8800);

const soonFirst = shop.recordSale(db, deviceId, { payment: "cash", lines: [{ productId: doliprane, quantity: 6, unitPrice: 15000 }] }, day);
const byLot = Object.fromEntries(shop.batchesOf(db, doliprane, true).map((b) => [b.lot, b.remaining]));
check("a sale takes the batch that expires first", byLot["L-SOON"] === 0 && byLot["L-LATE"] === 8, JSON.stringify(byLot));
check("and never an expired one", byLot["L-OLD"] === 3);

shop.voidSale(db, deviceId, soonFirst.id, "Erreur de saisie", null);
const back = Object.fromEntries(shop.batchesOf(db, doliprane, true).map((b) => [b.lot, b.remaining]));
check("a void puts the stock back into the batches it came from", back["L-SOON"] === 4 && back["L-LATE"] === 10, JSON.stringify(back));

let refusedVoid = false;
try { shop.voidSale(db, deviceId, soonFirst.id, "", null); } catch { refusedVoid = true; }
check("a void needs a reason", refusedVoid);

const overview = shop.stockOverview(db, 3, day);
check("the stock screen counts the expired batch still on the shelf", overview.expired >= 1, JSON.stringify(overview));
check("and what expires within the alert months", overview.expiringSoon >= 1);

shop.adjustStock(db, deviceId, { productId: doliprane, out: 3, reason: "expiry", batchId: shop.batchesOf(db, doliprane).find((b) => b.lot === "L-OLD").id });
check("writing off the expired boxes empties that batch", shop.stockOverview(db, 3, day).expired === overview.expired - 1);
shop.adjustStock(db, deviceId, { productId: doliprane, counted: 12, reason: "adjustment", note: "Inventaire" });
check("a count writes the difference, and the shelf says what was counted", shop.onHand(db, doliprane) === 12, String(shop.onHand(db, doliprane)));

console.log("\nDiscounts, mobile payments and change\n");

const discounted = shop.recordSale(db, deviceId, {
  payment: "cash",
  discount: 1500,
  received: 20000,
  lines: [{ productId: doliprane, quantity: 1, unitPrice: 15000 }],
});
check("a discount comes off the total", discounted.total === 13500, String(discounted.total));
check("the change is what was handed over less the total", discounted.change === 6500, String(discounted.change));
let tooMuch = false;
try { shop.recordSale(db, deviceId, { payment: "cash", discount: 20000, lines: [{ productId: doliprane, quantity: 1, unitPrice: 15000 }] }); } catch { tooMuch = true; }
check("a discount larger than the ticket is refused", tooMuch);

const byApp = shop.recordSale(db, deviceId, { payment: "mobile", mobileApp: "Bankily", lines: [{ productId: doliprane, quantity: 1, unitPrice: 15000 }] });
check("a mobile payment keeps the app's name", shop.saleDetail(db, byApp.id).mobileApp === "Bankily");

console.log("\nCredit, and the till at closing\n");

const aminata = shop.addCustomer(db, deviceId, { name: "Client test", phone: "22200000", creditLimit: 20000 });
shop.recordSale(db, deviceId, { payment: "credit", customerId: aminata, lines: [{ productId: doliprane, quantity: 1, unitPrice: 15000 }] });
check("a credit sale adds to what he owes", shop.balanceOf(db, aminata) === 15000);
let overLimit = false;
try { shop.recordSale(db, deviceId, { payment: "credit", customerId: aminata, lines: [{ productId: doliprane, quantity: 1, unitPrice: 15000 }] }); } catch (error) { overLimit = error.code === "credit_limit"; }
check("a sale past his limit is refused, and says why", overLimit);

const session = shop.startSession(db, deviceId, { openingFloat: 50000 });
check("a drawer opens with its float", session.expected === 50000, String(session.expected));
let twiceOpen = false;
try { shop.startSession(db, deviceId, { openingFloat: 0 }); } catch { twiceOpen = true; }
check("a second drawer cannot open over the first", twiceOpen);

const paid = shop.recordPayment(db, deviceId, { customerId: aminata, amount: 5000, payment: "cash" });
check("a payment brings the debt down", paid.balance === 10000 && shop.balanceOf(db, aminata) === 10000);
let overpaid = false;
try { shop.recordPayment(db, deviceId, { customerId: aminata, amount: 999999, payment: "cash" }); } catch { overpaid = true; }
check("a payment larger than the debt is refused", overpaid);

const cashSale = shop.recordSale(db, deviceId, { payment: "cash", lines: [{ productId: doliprane, quantity: 2, unitPrice: 15000 }] });
const cashVoided = shop.recordSale(db, deviceId, { payment: "cash", lines: [{ productId: doliprane, quantity: 1, unitPrice: 15000 }] });
shop.voidSale(db, deviceId, cashVoided.id, "Retour client", null);
const mid = shop.openSession(db);
check("the drawer expects the float, cash sales and cash paid on debts, net of voids", mid.expected === 50000 + 30000 + 5000, String(mid.expected));

const closed = shop.closeSession(db, deviceId, { counted: 84000, note: "Pièce manquante" });
check("closing says the difference plainly", closed.difference === -1000 && closed.counted === 84000, JSON.stringify({ e: closed.expected, d: closed.difference }));
check("and nothing is open afterwards", shop.openSession(db) === null);
check("the ledger lists every line with the balance after it", shop.ledgerOf(db, aminata)[0].balanceAfter === 10000);

console.log("\nReports\n");

const all = shop.summary(db, { from: "2000-01-01", to: "9999" });
const netByRows = db.prepare("select coalesce(sum(total), 0) as t from sales").get().t;
check("the report's net is every sale and reversal added up", all.net === netByRows, `${all.net} ${netByRows}`);
check("voids are counted and their total is negative", all.voids.count >= 3 && all.voids.total < 0, JSON.stringify(all.voids));
check("the discounts given are reported", all.discounts === 1500, String(all.discounts));
check("money by app keeps Bankily apart", all.byApp.some((row) => row.app === "Bankily" && row.total === 15000), JSON.stringify(all.byApp));
check("the cash difference at closing reaches the report", all.cashDifferences.count === 1 && all.cashDifferences.total === -1000);
check("a margin is worked out where a cost is known", all.margin.amount > 0, JSON.stringify(all.margin));
const top = shop.topProducts(db, { from: "2000-01-01", to: "9999" }, 3);
check("the best seller is at the top", top.length > 0 && top[0].total >= (top[1]?.total ?? 0));

console.log("\nA database from 0.1\n");

const imported = shop.addProduct(db, deviceId, { name: "Amoxicilline 500", salePrice: 3000, extra: { batch: "A123", expiry: "2027-01-31" } });
shop.recordMovement(db, deviceId, { productId: imported, quantity: 20, reason: "reception", reference: "activation" });
check("an imported batch is adopted once", shop.adoptImportedBatches(db, deviceId) === 1);
check("and not twice", shop.adoptImportedBatches(db, deviceId) === 0);
const adopted = shop.batchesOf(db, imported)[0];
check("its opening stock now belongs to that batch", adopted?.lot === "A123" && adopted.remaining === 20 && adopted.expiresOn === "2027-01-31", JSON.stringify(adopted));

const actions = db.prepare("select action from audit_local").all().map((r) => r.action);
check("the audit log has the receptions, the voids and the closing", ["received", "voided", "closed", "paid"].every((a) => actions.includes(a)));

/* ── The other trades ─────────────────────────────────────────────────── */

console.log("\nServices, deposits and expenses\n");

const service = shop.recordSale(db, deviceId, { payment: "cash", lines: [{ label: "Consultation", quantity: 1, unitPrice: 50000 }] });
check("a line can be a service with no product", shop.saleDetail(db, service.id).items[0].name === "Consultation");
check("and moves no stock", db.prepare("select count(*) as n from stock_movements where reference = ?").get(service.id).n === 0);
let noLabel = false;
try { shop.recordSale(db, deviceId, { payment: "cash", lines: [{ quantity: 1, unitPrice: 100 }] }); } catch { noLabel = true; }
check("a line with neither a product nor a label is refused", noLabel);

const menuItem = shop.addProduct(db, deviceId, { name: "Thé à la menthe", salePrice: 5000, category: "Boissons", tracked: false });
shop.recordSale(db, deviceId, { payment: "cash", lines: [{ productId: menuItem, quantity: 3, unitPrice: 5000 }] });
check("a menu item is sold without being counted on a shelf", shop.onHand(db, menuItem) === 0);
check("and is never reported out of stock", !shop.stockOverview(db, 3).outOfStock || shop.listProducts(db).filter((p) => p.tracked && p.onHand <= 0).length === shop.stockOverview(db, 3).outOfStock);

shop.startSession(db, deviceId, { openingFloat: 10000 });
shop.addCashMovement(db, deviceId, { direction: "out", amount: 3000, reason: "expense", category: "Électricité" });
shop.addCashMovement(db, deviceId, { direction: "in", amount: 2000, reason: "float_added" });
const withBook = shop.openSession(db);
check("an expense and cash put in change what the drawer should hold", withBook.expected === 10000 - 3000 + 2000, String(withBook.expected));
shop.closeSession(db, deviceId, { counted: withBook.expected });
const expenses = shop.summary(db, { from: "2000-01-01", to: "9999" }).expenses;
check("expenses are reported by category", expenses.total === 3000 && expenses.byCategory[0].category === "Électricité", JSON.stringify(expenses));

console.log("\nRestaurant\n");

const tea = menuItem;
const plate = shop.addProduct(db, deviceId, { name: "Thiéboudiène", salePrice: 25000, category: "Plats", tracked: false });
const order = shop.startOrder(db, deviceId, { service: "dine_in", tableNo: 4, guests: 2 });
check("tapping a table already eating opens its order, not a second one", shop.startOrder(db, deviceId, { service: "dine_in", tableNo: 4 }) === order);
shop.addToOrder(db, deviceId, { orderId: order, productId: plate });
shop.addToOrder(db, deviceId, { orderId: order, productId: plate });
shop.addToOrder(db, deviceId, { orderId: order, productId: tea, quantity: 2 });
const firstRound = shop.sendToKitchen(db, order);
check("the kitchen gets what was ordered, once", firstRound.length === 2 && firstRound.find((l) => l.productId === plate).quantity === 2);
check("and nothing twice", shop.sendToKitchen(db, order).length === 0);
shop.addToOrder(db, deviceId, { orderId: order, productId: tea });
const lines = shop.getOrder(db, order).lines;
check("a dish ordered after the kitchen saw the first round is its own line", lines.filter((l) => l.productId === tea).length === 2);
shop.changeOrderLine(db, deviceId, lines.find((l) => l.productId === tea && !l.sentAt).id, 0);
check("a line taken off is kept, marked cancelled", shop.getOrder(db, order).lines.some((l) => l.cancelledAt));
check("the order's total leaves it out", shop.getOrder(db, order).order.total === 2 * 25000 + 2 * 5000, String(shop.getOrder(db, order).order.total));
const paidOrder = shop.payOrder(db, deviceId, order, { payment: "cash", received: 70000 });
check("paying writes one sale with the order's lines", paidOrder.total === 60000 && paidOrder.change === 10000);
check("and frees the table", !shop.openOrders(db).some((o) => o.tableNo === 4));
let paidTwice = false;
try { shop.payOrder(db, deviceId, order, { payment: "cash" }); } catch { paidTwice = true; }
check("a paid order cannot be paid again", paidTwice);

console.log("\nBakery\n");

const baguette = shop.addProduct(db, deviceId, { name: "Baguette", salePrice: 1000, unit: "pièce" });
const cake = shop.addProduct(db, deviceId, { name: "Gâteau d'anniversaire", salePrice: 150000, tracked: false });
const bakeDay = new Date();
shop.recordProduction(db, deviceId, [{ productId: baguette, quantity: 200 }], null, bakeDay);
shop.recordSale(db, deviceId, { payment: "cash", lines: [{ productId: baguette, quantity: 170, unitPrice: 1000 }] }, bakeDay);
shop.recordUnsold(db, deviceId, [{ productId: baguette, quantity: 30 }], null, bakeDay);
const dayLine = shop.dayOf(db, shop.today(bakeDay)).find((l) => l.productId === baguette);
check("made 200, sold 170, lost 30, and the shelf is empty", dayLine.produced === 200 && dayLine.sold === 170 && dayLine.lost === 30 && dayLine.onHand === 0, JSON.stringify(dayLine));

shop.startSession(db, deviceId, { openingFloat: 0 });
const preorder = shop.createPreorder(db, deviceId, { customer: "Client gâteau", dueOn: "2030-01-01", lines: [{ productId: cake, quantity: 1, unitPrice: 150000 }], deposit: 50000 });
check("a deposit is in the drawer the day it is paid", shop.openSession(db).expected === 50000);
const collected = shop.collectPreorder(db, deviceId, preorder, { payment: "cash", received: 100000 });
check("collected, the sale is the whole order", collected.total === 150000 && collected.change === 0, JSON.stringify(collected));
check("and the drawer counts only what was paid at collection", shop.openSession(db).expected === 150000, String(shop.openSession(db).expected));
const cancelled = shop.createPreorder(db, deviceId, { customer: "Client annulé", dueOn: "2030-01-02", lines: [{ productId: cake, quantity: 1, unitPrice: 150000 }], deposit: 20000 });
shop.cancelPreorder(db, deviceId, cancelled, true);
check("a cancelled order hands its deposit back", shop.openSession(db).expected === 150000, String(shop.openSession(db).expected));
shop.closeSession(db, deviceId, { counted: 150000 });

console.log("\nWarehouse\n");

const [mainStore, secondStore] = shop.ensureLocations(db, deviceId, ["Dépôt principal", "Magasin 2"]);
check("a warehouse always has its places", mainStore && secondStore && shop.ensureLocations(db, deviceId, ["x"]).length === 2);
const cement = shop.addProduct(db, deviceId, { name: "Ciment 50 kg", salePrice: 45000, unit: "sac" });
shop.receiveStock(db, deviceId, { productId: cement, quantity: 100, locationId: mainStore.id });
shop.transfer(db, deviceId, { productId: cement, quantity: 30, from: mainStore.id, to: secondStore.id });
check("a transfer moves stock between places and not out of the warehouse", shop.heldAt(db, cement, mainStore.id) === 70 && shop.heldAt(db, cement, secondStore.id) === 30 && shop.onHand(db, cement) === 100);
const sent = shop.dispatch(db, deviceId, { destination: "sites", recipient: "Chantier Tevragh Zeina", locationId: mainStore.id, lines: [{ productId: cement, quantity: 20 }] });
check("goods sent to a site leave that place on a numbered note", sent.number === 1 && shop.heldAt(db, cement, mainStore.id) === 50 && !sent.saleId);
const sold = shop.dispatch(db, deviceId, { destination: "customers", recipient: "Entreprise cliente", locationId: secondStore.id, lines: [{ productId: cement, quantity: 10, unitPrice: 45000 }], sell: { payment: "cash" } });
check("goods sold on a note are a sale, from their own place", Boolean(sold.saleId) && shop.heldAt(db, cement, secondStore.id) === 20);
const notes = shop.dispatchesBetween(db, "2000-01-01", "9999");
check("each note lists its lines", notes.length === 2 && notes.every((n) => n.lines.length === 1 && n.lines[0].quantity > 0));
const flows = shop.flowsBetween(db, "2000-01-01", "9999").find((f) => f.productId === cement);
check("the warehouse report reads in, sent and sold", flows.received === 100 && flows.sent === 20 && flows.sold === 10, JSON.stringify(flows));

console.log("\nHotel\n");

const room = shop.addRoom(db, deviceId, { number: "12", kind: "Double", rate: 250000 });
let sameRoom = false;
try { shop.addRoom(db, deviceId, { number: "12", rate: 1 }); } catch { sameRoom = true; }
check("two rooms cannot share a number", sameRoom);
shop.startSession(db, deviceId, { openingFloat: 0 });
const stay = shop.bookStay(db, deviceId, { roomId: room, guest: "Client hôtel", arrivesOn: "2030-03-01", leavesOn: "2030-03-04", advance: 100000 });
let doubleBooked = false;
try { shop.bookStay(db, deviceId, { roomId: room, guest: "Autre", arrivesOn: "2030-03-03", leavesOn: "2030-03-05" }); } catch { doubleBooked = true; }
check("a room cannot be booked twice for the same night", doubleBooked);
check("but can be for the night it is left", Boolean(shop.bookStay(db, deviceId, { roomId: room, guest: "Suivant", arrivesOn: "2030-03-04", leavesOn: "2030-03-05" })));
check("an advance is in the drawer the day it is paid", shop.openSession(db).expected === 100000);
shop.checkIn(db, stay, new Date(2030, 2, 1, 14));
shop.addCharge(db, deviceId, { stayId: stay, label: "Blanchisserie", unitPrice: 20000 });
const label = (number, nights) => `Chambre ${number}, ${nights} nuits`;
const folio = shop.folioOf(db, stay, label, new Date(2030, 2, 4, 11));
check("the bill counts the nights and the extras", folio.nights === 3 && folio.total === 3 * 250000 + 20000 && folio.balance === 770000 - 100000, JSON.stringify({ n: folio.nights, t: folio.total, b: folio.balance }));
const departure = shop.checkOut(db, deviceId, stay, { payment: "cash", received: 670000 }, label, new Date(2030, 2, 4, 11));
check("departure is one sale for the whole bill, the advance already paid", departure.total === 770000 && departure.change === 0);
check("and the room goes to cleaning", shop.listRooms(db, new Date(2030, 2, 4, 12)).find((r) => r.id === room).state === "cleaning");
check("the drawer holds the advance and the balance, once each", shop.openSession(db).expected === 770000, String(shop.openSession(db).expected));
shop.closeSession(db, deviceId, { counted: 770000 });
const occ = shop.occupancy(db, "2030-03-01", "2030-03-08");
check("occupancy counts the nights sold", occ.sold === 3, JSON.stringify(occ));

console.log("\nTransport\n");

const route = shop.addRoute(db, deviceId, { origin: "Nouakchott", destination: "Nouadhibou", fare: 80000, parcelFee: 20000 });
const bus = shop.addVehicle(db, deviceId, { plate: "AA-1234-00", seats: 2 });
const trip = shop.scheduleTrip(db, deviceId, { routeId: route, vehicleId: bus, driver: "Chauffeur test", departsAt: "2030-04-01T08:00:00" });
const ticketLabel = (t, seat) => `${t.origin} → ${t.destination}, siège ${seat ?? "-"}`;
const first = shop.sellTicket(db, deviceId, { tripId: trip, seat: 1, passenger: "Passager un", payment: { payment: "cash", received: 100000 }, label: ticketLabel });
check("a ticket is a sale for the fare", first.change === 20000 && shop.saleDetail(db, first.saleId).total === 80000);
let seatTwice = false;
try { shop.sellTicket(db, deviceId, { tripId: trip, seat: 1, passenger: "Autre", payment: { payment: "cash" }, label: ticketLabel }); } catch (error) { seatTwice = error.message === "seat taken"; }
check("a seat cannot be sold twice", seatTwice);
shop.sellTicket(db, deviceId, { tripId: trip, seat: 2, passenger: "Passager deux", payment: { payment: "mobile", mobileApp: "Bankily" }, label: ticketLabel });
let full = false;
try { shop.sellTicket(db, deviceId, { tripId: trip, passenger: "Trop", payment: { payment: "cash" }, label: ticketLabel }); } catch (error) { full = error.message === "trip full"; }
check("a full bus sells no more", full);
shop.cancelTicket(db, deviceId, first.ticketId, "Voyage reporté");
check("a cancelled ticket frees its seat and voids its sale", shop.getTrip(db, trip).sold === 1 && db.prepare("select status from sales where id = ?").get(first.saleId).status === "voided");
const parcelLabel = (code) => `Colis ${code}`;
const parcel = shop.registerParcel(db, deviceId, { routeId: route, tripId: trip, sender: "Expéditeur", receiver: "Destinataire", receiverPhone: "22000000", fee: 20000, paidBy: "receiver", label: parcelLabel });
check("a parcel paid on arrival is no sale yet", parcel.saleId === null && /^P\d{6}-001$/.test(parcel.code), parcel.code);
shop.setTripStatus(db, deviceId, trip, "departed");
shop.setTripStatus(db, deviceId, trip, "arrived");
check("the bus arriving brings its parcels", shop.listParcels(db, "open", parcel.code)[0].status === "arrived");
const handed = shop.deliverParcel(db, deviceId, parcel.id, { payment: "cash" }, parcelLabel);
check("handed over, the receiver's fee is a sale", Boolean(handed.saleId) && shop.listParcels(db, "all", parcel.code)[0].status === "delivered");
const takings = shop.routeTakings(db, "2000-01-01", "9999")[0];
check("takings per route count tickets and parcels, not cancelled ones", takings.tickets === 1 && takings.ticketTotal === 80000 && takings.parcels === 1 && takings.parcelTotal === 20000, JSON.stringify(takings));

console.log("\nTime\n");

const moments = Array.from({ length: 2000 }, () => shop.clock().getTime());
check("the clock never gives the same millisecond twice", moments.every((ms, i) => i === 0 || ms > moments[i - 1]));

console.log("\nPast expiry\n");

const old = shop.addProduct(db, deviceId, { name: "Sirop Ancien", salePrice: 2000 });
shop.receiveStock(db, deviceId, { productId: old, quantity: 5, lot: "OLD1", expiresOn: "2020-01-31" });
const warned = shop.pastExpiryOf(db, [{ productId: old, quantity: 2 }]);
check("a line that can only come from an expired batch is named before the sale", warned.length === 1 && warned[0].name === "Sirop Ancien" && warned[0].lot === "OLD1" && warned[0].expiresOn === "2020-01-31", JSON.stringify(warned));
const fresh = shop.addProduct(db, deviceId, { name: "Sirop Neuf", salePrice: 2000 });
shop.receiveStock(db, deviceId, { productId: fresh, quantity: 5, lot: "NEW1", expiresOn: "2099-12-31" });
check("a line covered by stock in date is not", shop.pastExpiryOf(db, [{ productId: fresh, quantity: 2 }]).length === 0);
const goneAhead = shop.recordSale(db, deviceId, { payment: "cash", pastExpiry: true, lines: [{ productId: old, quantity: 2, unitPrice: 2000 }] });
const marked = db.prepare("select past_expiry, batch_id from sale_lines where sale_id = ?").get(goneAhead.id);
check("sold anyway, the line is marked and takes from the expired batch", marked.past_expiry === 1 && shop.batchesOf(db, old)[0].remaining === 3, JSON.stringify(marked));
check("and the log says who sold what past its date", db.prepare("select count(*) as n from audit_local where action = 'sold_past_expiry'").get().n === 1);
const listed = shop.pastExpirySales(db, { from: "2000-01-01", to: "9999" });
check("the reports list it, with its batch date", listed.length === 1 && listed[0].name === "Sirop Ancien" && listed[0].expiresOn === "2020-01-31" && listed[0].quantity === 2, JSON.stringify(listed));
const normal = shop.recordSale(db, deviceId, { payment: "cash", lines: [{ productId: fresh, quantity: 1, unitPrice: 2000 }] });
check("an ordinary sale is not marked", db.prepare("select past_expiry from sale_lines where sale_id = ?").get(normal.id).past_expiry === 0);

db.close();
rmSync(folder, { recursive: true, force: true });

console.log(failures === 0 ? "\nThe database holds up.\n" : `\n${failures} checks failed.\n`);
process.exit(failures === 0 ? 0 : 1);
