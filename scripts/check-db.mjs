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

db.close();
rmSync(folder, { recursive: true, force: true });

console.log(failures === 0 ? "\nThe database holds up.\n" : `\n${failures} checks failed.\n`);
process.exit(failures === 0 ? 0 : 1);
