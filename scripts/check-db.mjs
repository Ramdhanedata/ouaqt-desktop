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
shop.receiveStock(db, deviceId, { productId: doliprane, quantity: 10, lot: "LATE1", expiresOn: "2027-06-30", costPrice: 9000 });
shop.receiveStock(db, deviceId, { productId: doliprane, quantity: 4, lot: "SOON1", expiresOn: "2026-11-30", costPrice: 8800 });
shop.receiveStock(db, deviceId, { productId: doliprane, quantity: 3, lot: "OLD9", expiresOn: "2026-08-31" });
check("three receptions put seventeen on the shelf", shop.onHand(db, doliprane) === 17, String(shop.onHand(db, doliprane)));
check("the product knows its next expiry", shop.getProduct(db, doliprane).nextExpiry === "2026-08-31");
check("the latest cost becomes the product's cost", shop.getProduct(db, doliprane).costPrice === 8800);
check(
  "the stock list shows the lots on the shelf, the one a sale takes first first",
  JSON.stringify(shop.getProduct(db, doliprane).lots) === JSON.stringify(["OLD9", "SOON1", "LATE1"]),
  JSON.stringify(shop.getProduct(db, doliprane).lots)
);

/* A lot number is letters and digits: spaces are dropped, anything else is refused. */
const lotted = shop.addProduct(db, deviceId, { name: "Sirop lot", salePrice: 5000 });
shop.receiveStock(db, deviceId, { productId: lotted, quantity: 2, lot: " AB 12 ", expiresOn: "2027-01-31" });
check("a lot typed with spaces is kept as its letters and digits", shop.getProduct(db, lotted).lots[0] === "AB12", JSON.stringify(shop.getProduct(db, lotted).lots));
let refusedLot = false;
try { shop.receiveStock(db, deviceId, { productId: lotted, quantity: 1, lot: "AB-12" }); } catch { refusedLot = true; }
check("a lot with anything but letters and digits is refused", refusedLot && shop.onHand(db, lotted) === 2);

const soonFirst = shop.recordSale(db, deviceId, { payment: "cash", lines: [{ productId: doliprane, quantity: 6, unitPrice: 15000 }] }, day);
const byLot = Object.fromEntries(shop.batchesOf(db, doliprane, true).map((b) => [b.lot, b.remaining]));
check("a sale takes the batch that expires first", byLot["SOON1"] === 0 && byLot["LATE1"] === 8, JSON.stringify(byLot));
check("and never an expired one", byLot["OLD9"] === 3);

shop.voidSale(db, deviceId, soonFirst.id, "Erreur de saisie", null);
const back = Object.fromEntries(shop.batchesOf(db, doliprane, true).map((b) => [b.lot, b.remaining]));
check("a void puts the stock back into the batches it came from", back["SOON1"] === 4 && back["LATE1"] === 10, JSON.stringify(back));

let refusedVoid = false;
try { shop.voidSale(db, deviceId, soonFirst.id, "", null); } catch { refusedVoid = true; }
check("a void needs a reason", refusedVoid);

const overview = shop.stockOverview(db, 3, day);
check("the stock screen counts the expired batch still on the shelf", overview.expired >= 1, JSON.stringify(overview));
check("and what expires within the alert months", overview.expiringSoon >= 1);

shop.adjustStock(db, deviceId, { productId: doliprane, out: 3, reason: "expiry", batchId: shop.batchesOf(db, doliprane).find((b) => b.lot === "OLD9").id });
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

const session = shop.startSession(db, deviceId);
check("a drawer opens with nothing to type", session.openingFloat === 0 && session.expected === 0, String(session.expected));
let twiceOpen = false;
try { shop.startSession(db, deviceId); } catch { twiceOpen = true; }
check("a second drawer cannot open over the first", twiceOpen);
check("opening it again by itself finds the same drawer", shop.ensureSession(db, deviceId).id === session.id);

const paid = shop.recordPayment(db, deviceId, { customerId: aminata, amount: 5000, payment: "cash" });
check("a payment brings the debt down", paid.balance === 10000 && shop.balanceOf(db, aminata) === 10000);
let overpaid = false;
try { shop.recordPayment(db, deviceId, { customerId: aminata, amount: 999999, payment: "cash" }); } catch { overpaid = true; }
check("a payment larger than the debt is refused", overpaid);

const cashSale = shop.recordSale(db, deviceId, { payment: "cash", lines: [{ productId: doliprane, quantity: 2, unitPrice: 15000 }] });
const cashVoided = shop.recordSale(db, deviceId, { payment: "cash", lines: [{ productId: doliprane, quantity: 1, unitPrice: 15000 }] });
shop.voidSale(db, deviceId, cashVoided.id, "Retour client", null);
const mid = shop.openSession(db);
check("the drawer expects cash sales and cash paid on debts, net of voids", mid.expected === 30000 + 5000, String(mid.expected));

const closed = shop.closeSession(db, deviceId, { counted: 34000, note: "Pièce manquante" });
check("closing says the difference plainly", closed.difference === -1000 && closed.counted === 34000, JSON.stringify({ e: closed.expected, d: closed.difference }));
const nextDrawer = shop.openSession(db);
check(
  "and the next day's drawer is open at once, empty, from the very moment of closing",
  nextDrawer !== null && nextDrawer.id !== closed.id && nextDrawer.openingFloat === 0 && nextDrawer.expected === 0 && nextDrawer.openedAt === closed.closedAt,
  JSON.stringify(nextDrawer)
);

/* A fresh drawer from here: the one open is counted and closed, and the next opens by itself. */
const freshDrawer = () => {
  const now = shop.openSession(db);
  if (now) shop.closeSession(db, deviceId, { counted: Math.max(0, now.expected) });
  return shop.openSession(db);
};
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

freshDrawer();
shop.addCashMovement(db, deviceId, { direction: "in", amount: 5000, reason: "float_added" });
shop.addCashMovement(db, deviceId, { direction: "out", amount: 3000, reason: "expense", category: "Électricité" });
const withBook = shop.openSession(db);
check("an expense and cash put in change what the drawer should hold", withBook.expected === 5000 - 3000, String(withBook.expected));
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

freshDrawer();
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
freshDrawer();
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

console.log("\nPayment applications\n");

const seeded = shop.listPaymentApps(db).map((app) => app.name);
check("the five apps most early owners use are there from the start", JSON.stringify(seeded) === JSON.stringify(["Bankily", "Masrvi", "SEDAD", "BimBank", "Click"]), JSON.stringify(seeded));
const wave = shop.addPaymentApp(db, deviceId, "Wave");
shop.renamePaymentApp(db, deviceId, wave, "Wave Sénégal");
shop.movePaymentApp(db, wave, "up");
const afterMove = shop.listPaymentApps(db).map((app) => app.name);
check("an owner adds one, renames it and moves it up his list", afterMove.at(-2) === "Wave Sénégal" && afterMove.at(-1) === "Click", JSON.stringify(afterMove));
const paidByApp = shop.recordSale(db, deviceId, { payment: "mobile", mobileApp: "Bankily", paymentReference: "TX-4471", lines: [{ label: "Service", quantity: 1, unitPrice: 7000 }] });
check("the sale keeps the app and the transaction number", db.prepare("select mobile_app, payment_reference from sales where id = ?").get(paidByApp.id).payment_reference === "TX-4471");
shop.removePaymentApp(db, deviceId, "bankily");
check("a removed app is no longer offered", !shop.listPaymentApps(db).some((app) => app.name === "Bankily"));
check("and last month's sales still say Bankily", shop.summary(db, { from: "2000-01-01", to: "9999" }).byApp.some((row) => row.app === "Bankily"));
const debtor = shop.addCustomer(db, deviceId, { name: "Client Masrvi" });
shop.recordSale(db, deviceId, { payment: "credit", customerId: debtor, lines: [{ label: "Service", quantity: 1, unitPrice: 5000 }] });
shop.recordPayment(db, deviceId, { customerId: debtor, amount: 3000, payment: "mobile", mobileApp: "Masrvi", paymentReference: "MS-88" });
check("a debt paid through an app says which one", shop.ledgerOf(db, debtor)[0].mobileApp === "Masrvi");
check("and the reports count it under that app", shop.summary(db, { from: "2000-01-01", to: "9999" }).debtByApp.some((row) => row.app === "Masrvi" && row.total === 3000));
let unnamed = false;
try { shop.addPaymentApp(db, deviceId, "   "); } catch { unnamed = true; }
check("an app with no name is refused", unnamed);

console.log("\nColumns\n");

const stockColumns = shop.listColumns(db, deviceId, "products");
check("the stock list starts with the app's own columns, in their order", stockColumns.map((c) => c.key).join() === "name,category,stock,price,lot,expiry" && stockColumns.every((c) => c.system));
const shelf = shop.addColumn(db, deviceId, "products", { label: "Rayon", type: "choice", choices: ["A", "B", " B ", ""] });
check("an owner adds a list of choices, kept clean", JSON.stringify(shelf.choices) === '["A","B"]', JSON.stringify(shelf.choices));
const cost = shop.addColumn(db, deviceId, "products", { label: "Prix d'achat", type: "number" });
const sirop = shop.addProduct(db, deviceId, { name: "Sirop Rayon", salePrice: 1500 });
shop.setColumnValue(db, "products", sirop, cost.id, "1 250,5");
shop.setColumnValue(db, "products", sirop, shelf.id, "B");
check("a number typed the French way is kept as a number", shop.columnValues(db, "products")[sirop][cost.id] === "1250.5");
let badValues = 0;
for (const [column, value] of [[cost.id, "douze"], [shelf.id, "C"]]) {
  try { shop.setColumnValue(db, "products", sirop, column, value); } catch { badValues += 1; }
}
check("a word in a number column, or a choice he never wrote, is refused", badValues === 2);
check("search finds a product by what he wrote in his own columns", shop.searchProducts(db, "B").some((p) => p.id === sirop) && !shop.searchProducts(db, "%").some((p) => p.id === sirop));
const price = stockColumns.find((c) => c.key === "price");
shop.renameColumn(db, price.id, "Prix public");
shop.setColumnHidden(db, stockColumns.find((c) => c.key === "category").id, true);
shop.moveColumn(db, deviceId, cost.id, "up");
const reshaped = shop.listColumns(db, deviceId, "products");
check("the app's own columns are renamed, hidden and moved around", reshaped.find((c) => c.key === "price").label === "Prix public" && reshaped.find((c) => c.key === "category").hidden && reshaped.at(-2).id === cost.id, JSON.stringify(reshaped.map((c) => c.key)));
let kept = 0;
try { shop.deleteColumn(db, deviceId, price.id); } catch { kept += 1; }
try { shop.setColumnHidden(db, stockColumns.find((c) => c.key === "name").id, true); } catch { kept += 1; }
/* A menu shows neither the expiry nor the lot number: both are a pharmacy's. */
const onMenu = () => shop.listColumns(db, deviceId, "products").filter((c) => c.key !== "expiry" && c.key !== "lot");
const named = (c) => (c.id === cost.id ? "cost" : c.id === shelf.id ? "shelf" : c.key);
shop.moveColumn(db, deviceId, cost.id, "up", onMenu().map((c) => c.id));
check("on a menu, which has no expiry or lot column, one move up is one place up", onMenu().map(named).join() === "name,category,stock,cost,price,shelf", onMenu().map(named).join());
check("but the price cannot be deleted, and the name cannot be hidden", kept === 2 && shop.listColumns(db, deviceId, "products").length === 8);
shop.deleteColumn(db, deviceId, cost.id);
check("deleting his own column takes what was written in it", !(cost.id in (shop.columnValues(db, "products")[sirop] ?? {})) && db.prepare("select count(*) as n from audit_local where subject = 'column' and action = 'deleted'").get().n === 1);
for (let i = shop.listColumns(db, deviceId, "customers").filter((c) => !c.system).length; i < shop.CUSTOM_LIMIT; i += 1) shop.addColumn(db, deviceId, "customers", { label: `Note ${i + 1}`, type: "text" });
let listFull = false;
try { shop.addColumn(db, deviceId, "customers", { label: "Une de trop", type: "text" }); } catch (error) { listFull = error.message === "limit"; }
check(`a list takes ${shop.CUSTOM_LIMIT} columns of his own, and says so after`, listFull);

console.log("\nThe counter\n");

const counterFrom = shop.clock().toISOString();
const dish = shop.addProduct(db, deviceId, { name: "Plat du jour", salePrice: 30000, tracked: false });
/* Other checks date sales ahead of now, so what is compared here is the difference each step makes. */
const splitRange = { from: counterFrom, to: "9999" };
const counterBefore = shop.summary(db, splitRange);
const drawerBefore = shop.cashTakenSince(db, counterFrom);
const appBefore = counterBefore.byApp.find((row) => row.app === "Bankily")?.total ?? 0;
const split = shop.recordSale(db, deviceId, {
  payment: "cash",
  parts: [
    { method: "cash", amount: 10000 },
    { method: "mobile", amount: 20000, mobileApp: "Bankily", reference: "BK-1" },
  ],
  lines: [{ productId: dish, quantity: 1, unitPrice: 30000 }],
});
const splitSummary = shop.summary(db, splitRange);
check("a bill paid two ways is counted in its two parts", splitSummary.byPayment.cash - counterBefore.byPayment.cash === 10000 && splitSummary.byPayment.mobile - counterBefore.byPayment.mobile === 20000);
check("the app part is on that app's line", (splitSummary.byApp.find((row) => row.app === "Bankily")?.total ?? 0) - appBefore === 20000);
check("and only the cash part is expected in the drawer", shop.cashTakenSince(db, counterFrom) - drawerBefore === 10000);
check("the receipt knows both parts", shop.saleDetail(db, split.id).parts.length === 2);
let partsWrong = false;
try {
  shop.recordSale(db, deviceId, { payment: "cash", parts: [{ method: "cash", amount: 100 }, { method: "mobile", amount: 100, mobileApp: "Masrvi" }], lines: [{ productId: dish, quantity: 1, unitPrice: 30000 }] });
} catch (error) { partsWrong = error.code === "bad_parts"; }
check("parts that do not add up to the bill are refused", partsWrong);
shop.voidSale(db, deviceId, split.id, "Erreur", null);
const afterVoid = shop.summary(db, splitRange);
check("voiding it takes both parts back", afterVoid.byPayment.cash === counterBefore.byPayment.cash && afterVoid.byPayment.mobile === counterBefore.byPayment.mobile && shop.cashTakenSince(db, counterFrom) === drawerBefore);

const company = shop.addCustomer(db, deviceId, { name: "Société Repas", contact: "Mme Diop", billing: "monthly", billingStart: "2026-01-01" });
const c_order = shop.startOrder(db, deviceId, { service: "takeaway" });
shop.addToOrder(db, deviceId, { orderId: c_order, productId: dish });
shop.addToOrder(db, deviceId, { orderId: c_order, productId: dish });
const line = shop.getOrder(db, c_order).lines[0];
shop.setLineNote(db, line.id, "sans piment");
shop.updateOrder(db, c_order, { service: "dine_in", tableNo: 3, customerId: company, employee: "Ahmed" });
const held = shop.getOrder(db, c_order);
check("an order changes its way of serving, its table and its account counterBefore it is paid", held.order.service === "dine_in" && held.order.tableNo === 3 && held.order.customerId === company && held.order.employee === "Ahmed" && held.lines[0].note === "sans piment" && held.lines[0].quantity === 2);
const onAccount = shop.payOrder(db, deviceId, c_order, { payment: "credit", customerId: company, employee: "Ahmed" });
check("paid on the company's account, with the employee's name", shop.saleDetail(db, onAccount.id).employee === "Ahmed" && shop.balanceOf(db, company) === 60000);
const reopened = shop.reopenSale(db, deviceId, onAccount.id, "Modifier la commande");
const again = shop.getOrder(db, reopened);
check("a paid c_order reopened comes back whole, and its sale is voided", again.order.status === "open" && again.lines.length === 1 && again.lines[0].quantity === 2 && again.lines[0].note === "sans piment" && again.order.customerId === company && shop.balanceOf(db, company) === 0);
shop.payOrder(db, deviceId, reopened, { payment: "credit", customerId: company, employee: "Ahmed" });

const today = new Date().toISOString().slice(0, 10);
const periods = shop.accountPeriods(db, company, today);
check("a monthly account has its months, this one first", periods.length >= 1 && periods[0].consumed === 60000 && periods[0].from <= today && periods[0].to >= today, JSON.stringify(periods[0]));
check("owed and nothing paid: unpaid", shop.accountStatus(db, company, today) === "unpaid");
shop.recordPayment(db, deviceId, { customerId: company, amount: 20000, payment: "cash" });
check("a payment this month: part paid", shop.accountStatus(db, company, today) === "partial");
const statement = shop.accountStatement(db, company, periods[0].from, periods[0].to);
check("the month's invoice adds up", statement.consumed === 60000 && statement.paid === 20000 && statement.closing === statement.opening + 40000, JSON.stringify({ ...statement, lines: statement.lines.length }));
shop.recordPayment(db, deviceId, { customerId: company, amount: 40000, payment: "cash" });
check("paid off: paid", shop.accountStatus(db, company, today) === "paid");

console.log("\nThe front desk\n");

const floorRoom = shop.addRoom(db, deviceId, { number: "305", kind: "Double", rate: 250000 });
const suite = shop.addRoom(db, deviceId, { number: "Suite A", kind: "Suite", rate: 600000, floor: 4 });
const board = shop.listRooms(db);
check("a room numbered 305 is on the third floor; one with another name, where it was put", board.find((r) => r.id === floorRoom).floor === 3 && board.find((r) => r.id === suite).floor === 4);
const leak = shop.reportIssue(db, deviceId, { roomId: floorRoom, issue: "Fuite sous le lavabo", assignedTo: "Moussa" });
check("an empty room with a problem goes to maintenance", shop.listRooms(db).find((r) => r.id === floorRoom).state === "maintenance" && shop.listRooms(db).find((r) => r.id === floorRoom).openIssues === 1);
shop.resolveIssue(db, deviceId, leak, "Joint changé");
check("put right, it goes to cleaning before the next guest", shop.listRooms(db).find((r) => r.id === floorRoom).state === "cleaning" && shop.issuesOf(db, floorRoom)[0].status === "resolved");
shop.setRoomStatus(db, floorRoom, "available");
const dayPlus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const deskToday = shop.today();
const deskIn3 = dayPlus(3);
const guestStay = shop.bookStay(db, deviceId, { roomId: floorRoom, guest: "Mme Sow", arrivesOn: deskToday, leavesOn: deskIn3, rate: 250000, checkInNow: true });
check("the board shows what the guest in a room still owes", shop.listRooms(db).find((r) => r.id === floorRoom).balance > 0);
const deskIn5 = dayPlus(5);
shop.editStay(db, deviceId, guestStay, { leavesOn: deskIn5 });
check("a stay is extended", shop.getStay(db, guestStay).leavesOn === deskIn5);
const other = shop.bookStay(db, deviceId, { roomId: suite, guest: "M. Ba", arrivesOn: deskToday, leavesOn: deskIn3, rate: 600000 });
let moved = false;
try { shop.editStay(db, deviceId, guestStay, { roomId: suite }); } catch (error) { moved = error.message === "room taken"; }
check("but not moved into a room another guest has for those nights", moved);
shop.cancelStay(db, deviceId, other, false);
shop.editStay(db, deviceId, guestStay, { roomId: suite });
check("moved, the room left behind goes to cleaning", shop.getStay(db, guestStay).roomId === suite && shop.listRooms(db).find((r) => r.id === floorRoom).state === "cleaning");
const desk_lines = shop.stayLines(db);
check("each booking says whether it is paid", desk_lines.find((l) => l.id === guestStay).paid === "unpaid" && desk_lines.find((l) => l.id === other).status === "cancelled");

console.log("\nImport\n");

const fromSheet = shop.importProducts(db, deviceId, [
  { name: "Ventoline 100", price: 45000, quantity: 12, batch: "V12", expiry: "2027-03-31" },
  { name: "Sirop Rayon", price: 1500, quantity: 3 },
  { name: "Sans prix", price: 0, quantity: 1 },
]);
const fromSheetFirst = shop.searchProducts(db, "Ventoline")[0];
check("a spreadsheet's products come in with their stock, lot and expiry", fromSheet.added === 1 && fromSheetFirst && fromSheetFirst.onHand === 12 && shop.batchesOf(db, fromSheetFirst.id)[0].lot === "V12");
check("a name already in the stock is left alone and said", fromSheet.skipped.includes("Sirop Rayon"));

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

console.log("\nHealth cover\n");

/*
 * A pharmacy conventionnée with a fund: the fund pays its share, the customer
 * the rest. Dated on a day of their own so no other check's sales are counted.
 */
const coverDay = { from: "2030-05-02T00:00:00.000Z", to: "2030-05-03T00:00:00.000Z" };
const coverAt = new Date("2030-05-02T10:00:00.000Z");
const boxed = shop.addProduct(db, deviceId, { name: "Boîte Remboursée", salePrice: 64000 });
shop.recordMovement(db, deviceId, { productId: boxed, quantity: 50, reason: "reception" });

const covered = shop.recordSale(db, deviceId, {
  payment: "cash",
  received: 30000,
  lines: [{ productId: boxed, quantity: 1, unitPrice: 64000 }],
  cover: { payer: "cnam", memberNumber: "  10482731 ", share: 67 },
}, coverAt);
check("the fund's part is its share of the sale, rounded once", covered.covered === 42880, JSON.stringify(covered));
check("the change is worked out on what the customer pays", covered.change === 30000 - (64000 - 42880), String(covered.change));
const coverRow = db.prepare("select cover_payer, cover_member, cover_share, covered, total from sales where id = ?").get(covered.id);
check("the sale keeps the fund, the number without its spaces, and the share", coverRow.cover_payer === "cnam" && coverRow.cover_member === "10482731" && coverRow.cover_share === 67 && coverRow.total === 64000, JSON.stringify(coverRow));
check("the drawer expects only the customer's part", shop.cashTakenSince(db, coverDay.from, coverDay.to) === 21120, String(shop.cashTakenSince(db, coverDay.from, coverDay.to)));

const coverSummary = shop.summary(db, coverDay);
check("the report puts the fund's part apart from cash", coverSummary.byPayment.insurance === 42880 && coverSummary.byPayment.cash === 21120, JSON.stringify(coverSummary.byPayment));
check("and says which fund", coverSummary.byFund.length === 1 && coverSummary.byFund[0].payer === "cnam" && coverSummary.byFund[0].total === 42880, JSON.stringify(coverSummary.byFund));
check("takings still add up to the sales", coverSummary.net === 64000, String(coverSummary.net));

const detail = shop.saleDetail(db, covered.id);
check("the sale's detail carries the number and the share for the receipt", detail.covered === 42880 && detail.coverPayer === "cnam" && detail.coverMember === "10482731" && detail.coverShare === 67);

const coveredSplit = shop.recordSale(db, deviceId, {
  payment: "cash",
  lines: [{ productId: boxed, quantity: 1, unitPrice: 64000 }],
  cover: { payer: "cnass", memberNumber: "20931157", share: 50 },
  parts: [{ method: "cash", amount: 20000 }, { method: "mobile", amount: 12000, mobileApp: "Bankily" }],
}, coverAt);
const splitTakings = db.prepare("select method, amount from sale_takings where sale_id = ? order by method").all(coveredSplit.id);
check("a covered sale paid two ways: the parts add up to the customer's share", coveredSplit.covered === 32000 && JSON.stringify(splitTakings) === JSON.stringify([{ method: "cash", amount: 20000 }, { method: "insurance", amount: 32000 }, { method: "mobile", amount: 12000 }]), JSON.stringify(splitTakings));

let partsRefused = false;
try {
  shop.recordSale(db, deviceId, {
    payment: "cash",
    lines: [{ productId: boxed, quantity: 1, unitPrice: 64000 }],
    cover: { payer: "cnass", memberNumber: "20931157", share: 50 },
    parts: [{ method: "cash", amount: 40000 }, { method: "mobile", amount: 24000, mobileApp: "Bankily" }],
  }, coverAt);
} catch (error) { partsRefused = error?.code === "bad_parts"; }
check("parts that pay the whole sale when a fund pays half are refused", partsRefused);

const insured = shop.addCustomer(db, deviceId, { name: "Client Assuré" });
const onCredit = shop.recordSale(db, deviceId, {
  payment: "credit",
  customerId: insured,
  lines: [{ productId: boxed, quantity: 1, unitPrice: 10000 }],
  cover: { payer: "other", memberNumber: "M-77", share: 90 },
}, coverAt);
check("on credit, the customer owes only his part", shop.balanceOf(db, insured) === 1000 && onCredit.covered === 9000, String(shop.balanceOf(db, insured)));

const claims = shop.claimsBetween(db, coverDay.from, coverDay.to);
check("the claims list every covered sale, fund by fund", claims.length === 3 && claims.map((claim) => claim.payer).join(",") === "cnam,cnass,other", JSON.stringify(claims.map((claim) => claim.payer)));
check("each claim says the number and what the fund owes", claims[0].memberNumber === "10482731" && claims[0].covered === 42880 && claims[0].total === 64000 && claims[0].share === 67);

shop.voidSale(db, deviceId, covered.id, "Ordonnance refusée", null);
const coverReversal = db.prepare("select covered, cover_payer, total from sales where reverses_id = ?").get(covered.id);
check("a void reverses the fund's part too", coverReversal.covered === -42880 && coverReversal.cover_payer === "cnam" && coverReversal.total === -64000, JSON.stringify(coverReversal));
check("a voided sale is not claimed", shop.claimsBetween(db, coverDay.from, coverDay.to).every((claim) => claim.saleId !== covered.id));
const reversalTaken = db.prepare("select method, amount from sale_takings where sale_id = (select id from sales where reverses_id = ?) order by method").all(covered.id);
check("and gives back only what the customer paid", JSON.stringify(reversalTaken) === JSON.stringify([{ method: "cash", amount: -21120 }, { method: "insurance", amount: -42880 }]), JSON.stringify(reversalTaken));
shop.voidSale(db, deviceId, onCredit.id, "Erreur", null);
check("a voided covered sale on credit takes back only the customer's debt", shop.balanceOf(db, insured) === 0, String(shop.balanceOf(db, insured)));

const refusedCover = (cover) => {
  try {
    shop.recordSale(db, deviceId, { payment: "cash", lines: [{ productId: boxed, quantity: 1, unitPrice: 64000 }], cover }, coverAt);
    return false;
  } catch (error) {
    return error?.code === "bad_cover";
  }
};
check("a cover with no member number is refused", refusedCover({ payer: "cnam", memberNumber: "  ", share: 67 }));
check("a share over a hundred is refused", refusedCover({ payer: "cnam", memberNumber: "1", share: 150 }));
check("a fund the app does not know is refused", refusedCover({ payer: "cnss", memberNumber: "1", share: 67 }));

const plain = shop.recordSale(db, deviceId, { payment: "cash", lines: [{ productId: boxed, quantity: 1, unitPrice: 64000 }] }, coverAt);
check("a sale with no fund is what it always was", plain.covered === 0 && db.prepare("select covered, cover_payer from sales where id = ?").get(plain.id).covered === 0);

shop.setCoverShare(db, "cnam", 67);
shop.setCoverShare(db, "cnass", 250);
check("the manager's usual shares are kept, a whole percent at most a hundred", JSON.stringify(shop.coverShares(db)) === JSON.stringify({ cnam: 67, cnass: 100 }), JSON.stringify(shop.coverShares(db)));
shop.setCoverShare(db, "cnass", null);
check("and one can be taken away", JSON.stringify(shop.coverShares(db)) === JSON.stringify({ cnam: 67 }));
let unknownFund = false;
try { shop.setCoverShare(db, "cnss", 50); } catch { unknownFund = true; }
check("a share for a fund the app does not know is refused", unknownFund);

/* A wash: on the board, paid less its advance, and cancelled with the advance handed back. */
{
  const service = shop.addProduct(db, deviceId, { name: "Lavage test", salePrice: 30000, tracked: false });
  const car = shop.createWashJob(db, deviceId, { kind: "car", plate: "12 34 aa", washer: "Sidi", lines: [{ productId: service, quantity: 1, unitPrice: 30000 }] });
  check("a plate is one thing however it was typed", shop.washJob(db, car).plate === "12 34 AA");
  let refused = false;
  try { shop.createWashJob(db, deviceId, { kind: "car", lines: [{ productId: service, quantity: 1, unitPrice: 30000 }] }); } catch { refused = true; }
  check("a car needs its plate", refused);
  shop.setWashStatus(db, car, "washing");
  shop.setWashStatus(db, car, "ready");
  const piece = shop.createWashJob(db, deviceId, { kind: "upholstery", customer: "Mme T", dueOn: "2030-01-01", deposit: 10000, lines: [{ productId: service, quantity: 2, unitPrice: 30000 }] });
  check("the advance is on the job", shop.washJob(db, piece).received === 10000);
  const paid = shop.payWashJob(db, deviceId, piece, { payment: "cash", received: 50000 });
  check("paid, for the whole job less its advance", shop.saleDetail(db, paid.id).total === 60000 && shop.washJob(db, piece).status === "paid");
  const other = shop.createWashJob(db, deviceId, { kind: "upholstery", customer: "M K", deposit: 5000, lines: [{ productId: service, quantity: 1, unitPrice: 30000 }] });
  shop.cancelWashJob(db, deviceId, other, true);
  check("cancelled, with the advance handed back", shop.washJob(db, other).received === 0);
  check("the board holds only open jobs", shop.listWashJobs(db).every((job) => job.status !== "paid" && job.status !== "cancelled"));
  const report = shop.washReport(db, "2000-01-01T00:00:00.000Z", "2100-01-01T00:00:00.000Z");
  check("the report sees what was paid", report.jobs === 1 && report.upholstery === 1 && report.amount === 60000);
  shop.cancelWashJob(db, deviceId, car, false);
}


/* ── A drawer that opens by itself, and every day kept in the reports ─── */

console.log("\nThe drawer on its own, and the days side by side\n");
{
  const one = new Database(join(folder, "days.db"));
  one.pragma("foreign_keys = ON");
  one.exec("create table if not exists schema_migrations (name text primary key, applied_at text not null)");
  for (const name of migrations) one.exec(readFileSync(join("electron/db/migrations", name), "utf8"));
  const id = shop.deviceIdOf(one);
  const item = shop.addProduct(one, id, { name: "Pain", salePrice: 1000, tracked: false });
  const at = (daysAgo, hour) => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour, 0, 0);
  };
  const sellAt = (when, quantity) => shop.recordSale(one, id, { payment: "cash", lines: [{ productId: item, quantity, unitPrice: 1000 }] }, when);

  /* Sold two days ago, yesterday and this morning, and nobody ever opened the drawer. */
  sellAt(at(2, 10), 4);
  sellAt(at(1, 10), 2);
  const morning = at(0, 0);
  morning.setMinutes(1);
  sellAt(morning, 3);
  const drawer = shop.ensureSession(one, id);
  check("a drawer nobody opened opens by itself at midnight, with no float", drawer.openingFloat === 0 && new Date(drawer.openedAt).getTime() === at(0, 0).getTime(), drawer.openedAt);
  check("and holds today's cash, not the days before", drawer.expected === 3000, String(drawer.expected));
  const shut = shop.closeSession(one, id, { counted: 3000 });
  check("counted right, it closes exact", shut.difference === 0);
  check("and the next day's drawer starts where it stopped", shop.openSession(one)?.openedAt === shut.closedAt);
  shop.recordSale(one, id, { payment: "cash", lines: [{ productId: item, quantity: 1, unitPrice: 1000 }] });
  check("a sale after closing falls in the next drawer, not in none", shop.openSession(one)?.expected === 1000, String(shop.openSession(one)?.expected));

  const days = shop.totalsBy(one, "day", 3);
  check("each day keeps its own sales after its drawer closed", days.map((d) => d.net).join(",") === "4000,2000,4000", days.map((d) => `${d.start}:${d.net}`).join(" "));
  check("and its own count", days.map((d) => d.count).join(",") === "1,1,2");
  check("the days run oldest first and end today", days[2].from === new Date(at(0, 0)).toISOString() && days[0].start < days[2].start);
  const weeks = shop.totalsBy(one, "week", 2);
  check("a week starts on Monday", new Date(weeks[1].from).getDay() === 1 && weeks.length === 2);
  check("weeks hold every day sold, whatever week they fell in", weeks[0].net + weeks[1].net === 10000, weeks.map((w) => w.net).join(","));
  const months = shop.totalsBy(one, "month", 12);
  check("a year by month adds up to every sale", months.length === 12 && months.reduce((sum, m) => sum + m.net, 0) === 10000 && new Date(months[11].from).getDate() === 1);
  const pastDay = shop.totalsBy(one, "day", 1, at(2, 12));
  check("a day long past is read on its own", pastDay[0].net === 4000 && pastDay[0].start === shop.totalsBy(one, "day", 3)[0].start);
  check("the first sale's day is known", shop.firstSaleDay(one) === days[0].start, String(shop.firstSaleDay(one)));
  one.close();
}

/* ── A shop's devices seeing each other's work ───────────────────────── */

console.log("\nTwo devices of one shop\n");
{
  const migrationSql = migrations.map((name) => [name, readFileSync(join("electron/db/migrations", name), "utf8")]);
  const device = (name) => {
    const one = new Database(join(folder, `${name}.db`));
    one.pragma("journal_mode = WAL");
    one.pragma("foreign_keys = ON");
    one.exec("create table if not exists schema_migrations (name text primary key, applied_at text not null)");
    for (const [file, sql] of migrationSql) {
      one.transaction(() => {
        one.exec(sql);
        one.prepare("insert into schema_migrations (name, applied_at) values (?, ?)").run(file, new Date().toISOString());
      })();
    }
    const id = shop.deviceIdOf(one);
    shop.watchChanges(one);
    shop.setSetting(one, "business_id", "shop-1");
    return { db: one, id, name };
  };
  /* The relay, without the network: everything queued on one device, written on the other. */
  const send = (from, to) => {
    shop.startSharing(from.db);
    let moved = 0;
    for (;;) {
      const { rows, upTo } = shop.nextChanges(from.db, 200000);
      if (rows.length === 0 && !upTo) break;
      /* Through JSON, as on the wire. */
      moved += shop.applyChanges(to.db, JSON.parse(JSON.stringify(rows)));
      shop.markSent(from.db, upTo);
    }
    return moved;
  };
  const both = (a, b) => {
    send(a, b);
    send(b, a);
    send(a, b);
  };
  const stockOf = (one, id) => shop.onHand(one.db, id);
  const day = { from: "2000-01-01T00:00:00.000Z", to: "2100-01-01T00:00:00.000Z" };
  const sell = (one, productId, quantity, unitPrice, payment = "cash") =>
    shop.recordSale(one.db, one.id, { lines: [{ productId, quantity, unitPrice }], payment });
  const count = (one, table) => one.db.prepare(`select count(*) as n from ${table}`).get().n;

  const pc = device("pc");
  const phone = device("phone");

  /* The same list imported on both at activation: one shop, not two. */
  const riceOnPc = shop.addProduct(pc.db, pc.id, { name: "Riz 5 kg", salePrice: 30000 });
  shop.recordMovement(pc.db, pc.id, { productId: riceOnPc, quantity: 50, reason: "reception", reference: "activation" });
  const riceOnPhone = shop.addProduct(phone.db, phone.id, { name: "Riz 5 kg", salePrice: 30000 });
  shop.recordMovement(phone.db, phone.id, { productId: riceOnPhone, quantity: 50, reason: "reception", reference: "activation" });
  const teaOnPc = shop.addProduct(pc.db, pc.id, { name: "Thé", salePrice: 5000 });
  shop.recordMovement(pc.db, pc.id, { productId: teaOnPc, quantity: 20, reason: "reception" });
  both(pc, phone);
  check("a product imported on both devices is one product", count(pc, "products") === 2 && count(phone, "products") === 2, `${count(pc, "products")} and ${count(phone, "products")}`);
  check("its opening stock is counted once", stockOf(pc, riceOnPc) === 50 && stockOf(phone, riceOnPhone) === 50, `${stockOf(pc, riceOnPc)} and ${stockOf(phone, riceOnPhone)}`);
  check("what only one device had reaches the other", stockOf(phone, teaOnPc) === 20);

  /* A sale on one appears on the other. */
  const onPc = sell(pc, riceOnPc, 2, 30000);
  both(pc, phone);
  const seen = shop.saleDetail(phone.db, onPc.id);
  check("a sale on the computer appears on the phone", seen?.total === 60000);
  check("with its line on the phone's own product", seen?.items[0]?.productId === riceOnPhone);
  check("and the stock follows", stockOf(phone, riceOnPhone) === 48 && stockOf(pc, riceOnPc) === 48);

  /* And the other way round. */
  const onPhone = sell(phone, riceOnPhone, 1, 30000, "cash");
  both(pc, phone);
  check("a sale on the phone appears on the computer", shop.saleDetail(pc.db, onPhone.id)?.total === 30000);
  check("both see the same day", shop.summary(pc.db, day).net === shop.summary(phone.db, day).net && shop.summary(pc.db, day).count === 2);

  /* Selling apart: nothing lost, nothing counted twice. */
  const before = shop.summary(pc.db, day).net;
  const apart = [sell(pc, riceOnPc, 3, 30000), sell(phone, riceOnPhone, 4, 30000), sell(pc, teaOnPc, 1, 5000), sell(phone, teaOnPc, 2, 5000)];
  check("each device kept selling on its own", shop.saleDetail(pc.db, apart[1].id) === null && shop.saleDetail(phone.db, apart[0].id) === null);
  both(pc, phone);
  const expectedNet = before + 3 * 30000 + 4 * 30000 + 3 * 5000;
  check("selling apart, every sale arrives on both", shop.summary(pc.db, day).net === expectedNet && shop.summary(phone.db, day).net === expectedNet, `${shop.summary(pc.db, day).net} ${shop.summary(phone.db, day).net} ${expectedNet}`);
  check("and the stock adds up on both", stockOf(pc, riceOnPc) === 40 && stockOf(phone, riceOnPhone) === 40, `${stockOf(pc, riceOnPc)} ${stockOf(phone, riceOnPhone)}`);
  check("the same number of sales on both", count(pc, "sales") === count(phone, "sales") && count(pc, "sales") === 6);

  /* Receiving a thing twice changes nothing. */
  const salesBefore = count(phone, "sales");
  shop.queueEverything(pc.db);
  send(pc, phone);
  check("everything sent again changes nothing", count(phone, "sales") === salesBefore && stockOf(phone, riceOnPhone) === 40 && shop.summary(phone.db, day).net === expectedNet);
  check("what was received is not sent back", shop.waitingToSend(phone.db) === 0);

  /* An edit: the later one wins, on both. */
  shop.updateProduct(pc.db, pc.id, riceOnPc, { salePrice: 31000 });
  both(pc, phone);
  check("a price changed on the computer changes on the phone", shop.listProducts(phone.db).find((one) => one.id === riceOnPhone)?.salePrice === 31000);
  shop.updateProduct(phone.db, phone.id, riceOnPhone, { salePrice: 32000 });
  both(pc, phone);
  check("and changed back from the phone, the computer follows", shop.listProducts(pc.db).find((one) => one.id === riceOnPc)?.salePrice === 32000);
  shop.updateProduct(pc.db, pc.id, teaOnPc, { salePrice: 6000 });
  shop.updateProduct(phone.db, phone.id, teaOnPc, { salePrice: 7000 });
  both(pc, phone);
  const teaPc = shop.listProducts(pc.db).find((one) => one.id === teaOnPc)?.salePrice;
  const teaPhone = shop.listProducts(phone.db).find((one) => one.id === teaOnPc)?.salePrice;
  check("two edits made apart settle on the same answer on both", teaPc === teaPhone, `${teaPc} and ${teaPhone}`);

  /* A voided sale, a customer's debt. */
  shop.voidSale(phone.db, phone.id, onPc.id, "erreur");
  both(pc, phone);
  check("a sale voided on the phone is voided on the computer", shop.saleDetail(pc.db, onPc.id)?.status === "voided");
  check("and the shop's takings agree", shop.summary(pc.db, day).net === shop.summary(phone.db, day).net);
  const customer = shop.addCustomer(pc.db, pc.id, { name: "Mme Diop", phone: "22000000" });
  both(pc, phone);
  const debt = shop.recordSale(phone.db, phone.id, { lines: [{ productId: riceOnPhone, quantity: 1, unitPrice: 32000 }], payment: "credit", customerId: customer });
  both(pc, phone);
  check("a debt taken on the phone is owed on the computer", shop.summary(pc.db, day).owed.total === shop.summary(phone.db, day).owed.total && shop.summary(pc.db, day).owed.total === 32000, String(shop.summary(pc.db, day).owed.total));
  check("the debt's sale points at the same customer", shop.saleDetail(pc.db, debt.id)?.customerName === "Mme Diop");

  /* Each device has its own drawer. */
  shop.startSession(pc.db, pc.id);
  both(pc, phone);
  check("a till opened on the computer is not open on the phone", shop.openSession(phone.db) === null);
  shop.startSession(phone.db, phone.id);
  const beforeCash = shop.openSession(phone.db).expected;
  sell(pc, teaOnPc, 1, 5000);
  sell(phone, teaOnPc, 1, 5000);
  both(pc, phone);
  check("a cash sale on the computer is not in the phone's drawer", shop.openSession(phone.db).expected === beforeCash + 5000, `${shop.openSession(phone.db).expected} vs ${beforeCash + 5000}`);
  check("and the computer's drawer has only its own", shop.openSession(pc.db).expected === 5000, String(shop.openSession(pc.db).expected));
  shop.closeSession(pc.db, pc.id, { counted: 5000 });
  both(pc, phone);
  const past = shop.pastSessions(phone.db);
  check("the phone sees the computer's closing, marked as another device's", past.length === 1 && past[0].otherDevice === true && past[0].counted === 5000);
  check("the computer's next drawer is its own, and not open on the phone", shop.openSession(pc.db)?.openingFloat === 0 && shop.openSession(phone.db)?.id !== shop.openSession(pc.db)?.id);
  check("and the phone's own till is still open", shop.openSession(phone.db) !== null);
  shop.closeSession(phone.db, phone.id, { counted: beforeCash + 5000 });
  both(pc, phone);

  /* The owner's own column, and a cell deleted. */
  const column = shop.addColumn(pc.db, pc.id, "products", { label: "Rayon", type: "text" });
  shop.setColumnValue(pc.db, "products", riceOnPc, column.id, "A3");
  both(pc, phone);
  const cell = () => phone.db.prepare("select value from column_values where list = 'products' and row_id = ? and column_id = ?").get(riceOnPhone, column.id)?.value;
  check("a column and its value reach the other device, on its own product", cell() === "A3", String(cell()));
  shop.setColumnValue(pc.db, "products", riceOnPc, column.id, null);
  both(pc, phone);
  check("and a value cleared is cleared there too", cell() === undefined || cell() === null, String(cell()));

  /* A third device, joining late, gets everything, whoever made it. */
  const late = device("late");
  const third = shop.startSharing(late.db);
  check("a new device asks the others to send everything", third && shop.getSetting(late.db, "sync_ask_again") === "1");
  shop.queueEverything(phone.db);
  send(phone, late);
  check("it receives the shop as it is", count(late, "sales") === count(pc, "sales") && shop.summary(late.db, day).net === shop.summary(pc.db, day).net, `${count(late, "sales")} ${count(pc, "sales")}`);
  check("with the stock right", stockOf(late, riceOnPhone) === stockOf(phone, riceOnPhone));

  /* A device updated first: what this one cannot take yet is kept, not lost. */
  const newer = { t: "products", i: "from-the-future", n: 1, a: "2099-01-01T00:00:00.000Z", d: "other", v: { id: "from-the-future", device_id: "other", created_at: "2099-01-01T00:00:00.000Z", counter: 1, name: "Nouveau", sale_price: 100, a_later_column: "x" } };
  const table = { t: "a_later_table", i: "1", n: 1, a: "2099-01-01T00:00:00.000Z", d: "other", v: { id: "1" } };
  shop.applyChanges(phone.db, [newer, table]);
  check("a row with a column this version lacks still goes in", shop.listProducts(phone.db).some((one) => one.id === "from-the-future"));
  check("and it and an unknown table are kept for after the update", count(phone, "sync_pending") === 2, String(count(phone, "sync_pending")));
  check("an unknown thing is not thrown away when tried again too early", shop.tryKeptChanges(phone.db) === 0 && count(phone, "sync_pending") === 2);
  phone.db.exec("alter table products add column a_later_column text; create table a_later_table (id text primary key)");
  check("after the update, it is taken", shop.tryKeptChanges(phone.db) === 2 && count(phone, "sync_pending") === 0);
  check("with the column it could not hold before", phone.db.prepare("select a_later_column as x from products where id = 'from-the-future'").get().x === "x");

  /* Two parcels apart with the same code: both kept. */
  const code = { t: "parcels", n: 1, a: "2026-01-01T00:00:00.000Z" };
  const route = shop.addRoute ? shop.addRoute(pc.db, pc.id, { origin: "Nouakchott", destination: "Atar", fare: 100, parcelFee: 50 }) : null;
  if (route) {
    const base = { sender: "A", receiver: "B", fee: 100, code: "P-1", status: "received", paid_by: "sender", device_id: "x", created_at: "2026-01-01T00:00:00.000Z", counter: 1, route_id: route };
    const columns = pc.db.prepare("select name, \"notnull\" as required, dflt_value as fallback from pragma_table_info('parcels')").all();
    const full = (id) => Object.fromEntries(columns.map((c) => [c.name, c.name === "id" ? id : base[c.name] ?? (c.required && c.fallback === null ? "x" : null)]));
    shop.applyChanges(pc.db, [{ ...code, i: "p1", d: "aa", t: "parcels", v: full("p1") }]);
    shop.applyChanges(pc.db, [{ ...code, i: "p2", d: "bbbb", t: "parcels", v: full("p2") }]);
    const codes = pc.db.prepare("select code from parcels where id in ('p1', 'p2') order by id").all().map((row) => row.code);
    check("two parcels with one code are both kept", codes.length === 2 && codes[0] !== codes[1], codes.join(", "));
  }

  pc.db.close();
  phone.db.close();
  late.db.close();
}

db.close();
rmSync(folder, { recursive: true, force: true });

console.log(failures === 0 ? "\nThe database holds up.\n" : `\n${failures} checks failed.\n`);
process.exit(failures === 0 ? 0 : 1);
