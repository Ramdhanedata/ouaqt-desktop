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

db.close();
rmSync(folder, { recursive: true, force: true });

console.log(failures === 0 ? "\nThe database holds up.\n" : `\n${failures} checks failed.\n`);
process.exit(failures === 0 ? 0 : 1);
