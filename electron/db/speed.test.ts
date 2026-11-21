import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { keepStatements, migrate, readMigrations } from "./open";
import { forgetSellCheck, keepYes, keptYes } from "../licence/sell-check";

function shop() {
  const db = keepStatements(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  migrate(db, readMigrations("electron/db/migrations"));
  return db;
}

const plan = (db: Database.Database, sql: string) =>
  (db.prepare(`explain query plan ${sql}`).all() as { detail: string }[]).map((row) => row.detail).join(" / ");

describe("statements are compiled once", () => {
  it("hands back the same statement for the same SQL, and it still answers right", () => {
    const db = keepStatements(new Database(":memory:"));
    db.exec("create table t (n integer)");
    const first = db.prepare("insert into t (n) values (?)");
    expect(db.prepare("insert into t (n) values (?)")).toBe(first);
    for (let n = 1; n <= 3; n += 1) db.prepare("insert into t (n) values (?)").run(n);
    expect(db.prepare("select sum(n) as s from t").get()).toEqual({ s: 6 });
    expect(db.prepare("select count(*) as c from t").get()).toEqual({ c: 3 });
  });

  it("keeps a bounded number, dropping the one used least recently", () => {
    const db = keepStatements(new Database(":memory:"));
    const oldest = db.prepare("select 0");
    const kept = db.prepare("select 1");
    for (let n = 2; n < 401; n += 1) {
      db.prepare(`select ${n}`);
      if (n % 50 === 0) db.prepare("select 1");
    }
    expect(db.prepare("select 1")).toBe(kept);
    expect(db.prepare("select 0")).not.toBe(oldest);
  });
});

describe("a shop with a long history reads by index", () => {
  it("finds the last sale number without reading every sale", () => {
    expect(plan(shop(), "select coalesce(max(number), 0) as last from sales")).toMatch(/sales_number_idx/);
  });

  it("adds up a product's or a batch's stock from the index alone", () => {
    const db = shop();
    expect(plan(db, "select coalesce(sum(quantity), 0) from stock_movements where product_id = 'p'")).toMatch(/COVERING INDEX movements_product_quantity_idx/);
    expect(plan(db, "select coalesce(sum(quantity), 0) from stock_movements where batch_id = 'b'")).toMatch(/COVERING INDEX movements_batch_quantity_idx/);
  });
});

describe("the licence answer before a write", () => {
  it("trusts a yes for half a minute, never a no, and forgets on a new licence", () => {
    forgetSellCheck();
    expect(keptYes("/shop", "d", 1_000)).toBe(false);
    keepYes("/shop", "d", true, 1_000);
    expect(keptYes("/shop", "d", 20_000)).toBe(true);
    expect(keptYes("/shop", "d", 31_001)).toBe(false);
    expect(keptYes("/other", "d", 2_000)).toBe(false);
    /* A clock set back does not stretch the trust. */
    expect(keptYes("/shop", "d", 500)).toBe(false);
    keepYes("/shop", "d", false, 2_000);
    expect(keptYes("/shop", "d", 2_001)).toBe(false);
    keepYes("/shop", "d", true, 3_000);
    forgetSellCheck();
    expect(keptYes("/shop", "d", 3_001)).toBe(false);
  });
});
