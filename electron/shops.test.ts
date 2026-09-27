import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { folderFor, folderOfShop, openFolder, rememberOpen, shopsOnComputer } from "./shops";

/*
 * The shops on one computer: which folder is open, and that nothing can make
 * the app open a folder outside its own, whatever the pointer file says.
 */

const HOTEL = "11111111-1111-4111-8111-111111111111";
const PHARMACY = "22222222-2222-4222-8222-222222222222";
const made: string[] = [];

function computer(): string {
  const base = mkdtempSync(join(tmpdir(), "ouaqt-shops-"));
  made.push(base);
  return base;
}

function shopIn(folder: string, businessId: string, pack: string, name: string) {
  mkdirSync(folder, { recursive: true });
  const db = new Database(join(folder, "ouaqt.db"));
  db.exec("create table settings_local (key text primary key, value text not null, updated_at text)");
  db.prepare("insert into settings_local (key, value, updated_at) values ('business_id', ?, '')").run(businessId);
  db.close();
  writeFileSync(join(folder, "configuration.json"), JSON.stringify({ pack, business: { nameLatin: name } }));
}

afterEach(() => {
  for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe("the open shop's folder", () => {
  it("is the app's own folder until another shop is opened", () => {
    const base = computer();
    expect(openFolder(base)).toBe(base);
  });

  it("follows the pointer to another shop's folder", () => {
    const base = computer();
    const pharmacy = folderFor(base, PHARMACY)!;
    shopIn(pharmacy, PHARMACY, "pharmacy", "Pharmacie");
    rememberOpen(base, pharmacy);
    expect(openFolder(base)).toBe(pharmacy);
    rememberOpen(base, base);
    expect(openFolder(base)).toBe(base);
  });

  it("never leaves the app's folder, whatever the pointer says", () => {
    const base = computer();
    for (const folder of ["..", "../elsewhere", "/etc", "Commerces/not-an-id", "Commerces/../..", `Commerces/${PHARMACY}/deeper`]) {
      writeFileSync(join(base, "commerce-ouvert.json"), JSON.stringify({ folder }));
      expect(openFolder(base), folder).toBe(base);
    }
    expect(() => rememberOpen(base, join(base, ".."))).toThrow();
  });

  it("falls back to the app's folder when the shop's folder is gone", () => {
    const base = computer();
    writeFileSync(join(base, "commerce-ouvert.json"), JSON.stringify({ folder: `Commerces/${PHARMACY}` }));
    expect(openFolder(base)).toBe(base);
  });

  it("only makes folders for ids the website issues", () => {
    const base = computer();
    expect(folderFor(base, "../../x")).toBeNull();
    expect(folderFor(base, PHARMACY)).toBe(join(base, "Commerces", PHARMACY));
  });
});

describe("the shops on a computer", () => {
  it("are the first shop where it always was, and every other in its own folder", () => {
    const base = computer();
    shopIn(base, HOTEL, "hotel", "Hôtel");
    shopIn(folderFor(base, PHARMACY)!, PHARMACY, "pharmacy", "Pharmacie");
    mkdirSync(join(base, "Commerces", "33333333-3333-4333-8333-333333333333"), { recursive: true });

    const shops = shopsOnComputer(base, base);
    expect(shops.map((shop) => [shop.businessId, shop.pack, shop.name, shop.open])).toEqual([
      [HOTEL, "hotel", "Hôtel", true],
      [PHARMACY, "pharmacy", "Pharmacie", false],
    ]);
    expect(folderOfShop(base, PHARMACY, base)).toBe(folderFor(base, PHARMACY));
    expect(folderOfShop(base, "44444444-4444-4444-8444-444444444444", base)).toBeNull();
  });
});
