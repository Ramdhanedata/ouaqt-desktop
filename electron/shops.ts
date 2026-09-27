import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import Database from "better-sqlite3";

/*
 * The shops on this computer, each in its own folder.
 *
 * One computer used to be one shop for good: the first shop it opened was
 * the only one it would ever open, so an owner who downloaded his pharmacy
 * after trying a hotel kept getting the hotel, whatever he chose on the
 * website. Now a computer can hold more than one, and opens the one he asks
 * for.
 *
 * The rule from LICENCE_API.md stands whole: the database a computer already
 * has is never deleted, overwritten, renamed or moved. The first shop stays
 * exactly where it always was, in the app's own folder; any other shop gets
 * a folder of its own under "Commerces", named by its id; and one small file
 * in the app's folder says which one is open. Going back to the first shop
 * is changing that file, and nothing else.
 */

const POINTER = "commerce-ouvert.json";
const SHOPS = "Commerces";
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ShopOnComputer = {
  folder: string;
  businessId: string;
  name: string;
  nameArabic: string | null;
  pack: string;
  open: boolean;
};

/* A folder for this shop's id. Null for anything that is not an id we issue. */
export function folderFor(base: string, businessId: string): string | null {
  return ID.test(businessId) ? join(base, SHOPS, businessId.toLowerCase()) : null;
}

/* A folder the pointer may name: the app's own, or one under "Commerces". Never anywhere else. */
function allowed(base: string, folder: string): boolean {
  const inside = relative(resolve(base), resolve(folder));
  if (inside === "") return true;
  const parts = inside.split(/[\\/]/);
  return !isAbsolute(inside) && parts.length === 2 && parts[0] === SHOPS && ID.test(parts[1]);
}

/* The folder of the shop that is open: the one the pointer names, or the app's own. */
export function openFolder(base: string): string {
  try {
    const file = join(base, POINTER);
    if (!existsSync(file)) return base;
    const named = (JSON.parse(readFileSync(file, "utf8")) as { folder?: unknown }).folder;
    if (typeof named !== "string") return base;
    const folder = named === "" ? base : join(base, named);
    return allowed(base, folder) && existsSync(folder) ? folder : base;
  } catch {
    return base;
  }
}

export function rememberOpen(base: string, folder: string): void {
  if (!allowed(base, folder)) throw new Error("not a shop folder");
  writeFileSync(join(base, POINTER), JSON.stringify({ folder: relative(resolve(base), resolve(folder)) }), "utf8");
}

export function makeFolder(folder: string): void {
  mkdirSync(folder, { recursive: true });
}

/* One folder read without touching it: its shop's id from the database, its name and trade from the configuration. */
function readShop(folder: string, open: string): ShopOnComputer | null {
  const file = join(folder, "ouaqt.db");
  if (!existsSync(file)) return null;
  let businessId: string | null = null;
  try {
    const db = new Database(file, { readonly: true, fileMustExist: true });
    try {
      const row = db.prepare("select value from settings_local where key = 'business_id'").get() as { value: string } | undefined;
      businessId = row?.value ?? null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
  if (!businessId) return null;
  let name = "";
  let nameArabic: string | null = null;
  let pack = "";
  try {
    const configuration = JSON.parse(readFileSync(join(folder, "configuration.json"), "utf8")) as {
      pack?: unknown;
      business?: { nameLatin?: unknown; nameArabic?: unknown };
    };
    name = typeof configuration.business?.nameLatin === "string" ? configuration.business.nameLatin : "";
    nameArabic = typeof configuration.business?.nameArabic === "string" ? configuration.business.nameArabic : null;
    pack = typeof configuration.pack === "string" ? configuration.pack : "";
  } catch {
    // A shop whose configuration cannot be read is still listed, by its id.
  }
  return { folder, businessId, name, nameArabic, pack, open: resolve(folder) === resolve(open) };
}

/* Every shop this computer holds, the first one first. */
export function shopsOnComputer(base: string, open: string): ShopOnComputer[] {
  const folders = [base];
  const shops = join(base, SHOPS);
  if (existsSync(shops)) {
    for (const entry of readdirSync(shops, { withFileTypes: true })) {
      if (entry.isDirectory() && ID.test(entry.name)) folders.push(join(shops, entry.name));
    }
  }
  return folders.map((folder) => readShop(folder, open)).filter((shop): shop is ShopOnComputer => shop !== null);
}

/* The folder already holding this shop, if the computer has it. */
export function folderOfShop(base: string, businessId: string, open: string): string | null {
  return shopsOnComputer(base, open).find((shop) => shop.businessId === businessId)?.folder ?? null;
}
