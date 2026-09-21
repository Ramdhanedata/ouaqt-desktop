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

db.close();
rmSync(folder, { recursive: true, force: true });

console.log(failures === 0 ? "\nThe database holds up.\n" : `\n${failures} checks failed.\n`);
process.exit(failures === 0 ? 0 : 1);
