import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { configurationSchema } from "@app-ui/config";
import { verifyLicence, coversDevice, type LicencePayload } from "@app-ui/licence-file";
import { addProduct, adoptImportedBatches, listProducts, recordMovement } from "../db/products";
import { addColumn, listColumns, setColumnValue } from "../db/columns";
import { getSetting, setSetting, stamp } from "../db/rows";
import { LICENCE_PUBLIC_KEY } from "./keys";
import { download, type ActivationAnswer, type RefreshAnswer } from "./network";
import { readLicence, writeDeviceToken, writeLicence } from "./store";

/*
 * Turning an activation answer into a shop.
 *
 * Everything is checked before anything is written: the licence must verify
 * against our key and name this computer, and the configuration must pass the
 * same schema the website checked it with. A half-applied activation, with a
 * licence on disk and no products, is worse than one that did not happen.
 *
 * The database is only ever added to. Products and staff go in when it is
 * empty, which is the first activation; a reinstall on the same machine finds
 * its own data already there and leaves it alone.
 */

export type Applied =
  | { ok: true; payload: LicencePayload; products: number; staff: number }
  | { ok: false; reason: "bad_licence" | "not_this_computer" | "bad_configuration" | "different_business" };

type Imported = {
  name?: unknown;
  price?: unknown;
  quantity?: unknown;
  barcode?: unknown;
  unit?: unknown;
  expiry?: unknown;
  batch?: unknown;
  soldBy?: unknown;
  location?: unknown;
  quantityUnit?: unknown;
};

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

/* The picture's own kind, read from its first bytes: the website keeps PNG and JPEG. */
function dataUrl(bytes: Buffer | null): string | undefined {
  if (!bytes || bytes.length === 0) return undefined;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  return `data:${jpeg ? "image/jpeg" : "image/png"};base64,${bytes.toString("base64")}`;
}

/* The logos this computer already shows, to keep when a new download fails. */
function currentLogos(folder: string): { logo?: string; logoMono?: string } {
  try {
    const file = join(folder, "configuration.json");
    if (!existsSync(file)) return {};
    const business = (JSON.parse(readFileSync(file, "utf8")) as { business?: { logo?: string; logoMono?: string } }).business ?? {};
    return {
      ...(typeof business.logo === "string" ? { logo: business.logo } : {}),
      ...(typeof business.logoMono === "string" ? { logoMono: business.logoMono } : {}),
    };
  } catch {
    return {};
  }
}

/*
 * The logo arrives as two short-lived links. Fetched now, while there is a
 * network, and kept inside the configuration where the receipt already looks
 * for it. A logo that will not download is not a reason to refuse: the
 * shop's name prints instead.
 */
async function withLogo(raw: unknown, logo: { colour: string; mono: string } | null, kept: { logo?: string; logoMono?: string } = {}) {
  const [colour, mono] = logo ? await Promise.all([download(logo.colour), download(logo.mono)]) : [null, null];
  const base = (raw ?? {}) as { business?: Record<string, unknown> };
  /*
   * A logo that does not download this time is not a logo taken away: the
   * one already on this computer stays until a new one arrives whole.
   */
  return configurationSchema.safeParse({
    ...base,
    business: {
      ...(base.business ?? {}),
      ...(dataUrl(colour) ? { logo: dataUrl(colour) } : kept.logo ? { logo: kept.logo } : {}),
      ...(dataUrl(mono) ? { logoMono: dataUrl(mono) } : kept.logoMono ? { logoMono: kept.logoMono } : {}),
    },
  });
}

/*
 * What a product list said beyond name, price and quantity: where a product
 * sits and how it is sold. Kept as the owner's own columns on the stock
 * list, named in his language, so what he wrote in his file is on screen.
 */
const EXTRA_COLUMNS: Record<"location" | "soldBy", Record<"fr" | "ar" | "en", string>> = {
  location: { fr: "Emplacement", ar: "المكان", en: "Location" },
  soldBy: { fr: "Vendu par", ar: "طريقة البيع", en: "Sold by" },
};

function columnFor(database: Database.Database, deviceId: string, key: "location" | "soldBy", language: "fr" | "ar" | "en"): string {
  const label = EXTRA_COLUMNS[key][language];
  const found = listColumns(database, deviceId, "products").find((column) => !column.system && column.label === label);
  return found ? found.id : addColumn(database, deviceId, "products", { label, type: "text" }).id;
}

/* Staff names the app does not have yet; nobody is removed from here. */
function addStaff(database: Database.Database, deviceId: string, staff: { name: string; role: string }[]): number {
  const known = new Set(
    (database.prepare("select lower(name) as name from staff").all() as { name: string }[]).map((row) => row.name)
  );
  let added = 0;
  for (const person of staff) {
    const name = text(person.name);
    if (!name || (person.role !== "manager" && person.role !== "cashier") || known.has(name.toLowerCase())) continue;
    const row = stamp(database, deviceId);
    database
      .prepare(
        `insert into staff (id, device_id, created_at, counter, name, role)
         values (@id, @device_id, @created_at, @counter, @name, @role)`
      )
      .run({ ...row, name, role: person.role });
    known.add(name.toLowerCase());
    added += 1;
  }
  return added;
}

export async function applyActivation(
  database: Database.Database,
  folder: string,
  deviceId: string,
  answer: Extract<ActivationAnswer, { ok: true }>
): Promise<Applied> {
  const payload = await verifyLicence(answer.licence, LICENCE_PUBLIC_KEY);
  if (!payload) return { ok: false, reason: "bad_licence" };
  if (!coversDevice(payload, deviceId)) return { ok: false, reason: "not_this_computer" };

  /* The server refuses another shop's serial already; this is the second lock. */
  const owner = getSetting(database, "business_id");
  if (owner && owner !== payload.businessId) return { ok: false, reason: "different_business" };

  const configuration = await withLogo(answer.configuration, answer.logo, currentLogos(folder));
  if (!configuration.success) return { ok: false, reason: "bad_configuration" };
  const language = configuration.data.language.app;

  let products = 0;
  let staff = 0;

  const write = database.transaction(() => {
    setSetting(database, "business_id", payload.businessId);
    if (answer.serial) setSetting(database, "serial", answer.serial);
    if (answer.configurationVersion !== null) {
      setSetting(database, "configuration_version", String(answer.configurationVersion));
    }

    if (listProducts(database).length === 0) {
      for (const one of answer.products as Imported[]) {
        const name = text(one.name);
        const price = typeof one.price === "number" && Number.isInteger(one.price) ? one.price : null;
        if (!name || price === null) continue;

        const extra: Record<string, unknown> = {};
        for (const key of ["expiry", "batch", "soldBy", "location", "quantityUnit"] as const) {
          const value = text(one[key]);
          if (value) extra[key] = value;
        }

        const id = addProduct(database, deviceId, {
          name,
          salePrice: price,
          barcode: text(one.barcode),
          /* "Boîtes" written beside a quantity is the unit when no unit column said otherwise. */
          unit: text(one.unit) ?? text(one.quantityUnit),
          extra: Object.keys(extra).length ? extra : undefined,
        });
        for (const key of ["location", "soldBy"] as const) {
          const value = text(one[key]);
          if (value) setColumnValue(database, "products", id, columnFor(database, deviceId, key, language), value);
        }

        /* What he had on the shelf, as the first movement, never as a number. */
        const quantity = typeof one.quantity === "number" ? one.quantity : 0;
        if (quantity > 0) {
          recordMovement(database, deviceId, { productId: id, quantity, reason: "reception", reference: "activation" });
        }
        products += 1;
      }
    }

    staff = addStaff(database, deviceId, answer.staff);
  });

  write();

  /* What the import said about batches and expiry becomes real batches. */
  adoptImportedBatches(database, deviceId);

  /* Files last, once the database has everything: the licence is the switch. */
  writeFileSync(join(folder, "configuration.json"), JSON.stringify(configuration.data, null, 2), "utf8");
  writeDeviceToken(folder, answer.deviceToken);
  writeLicence(folder, answer.licence);

  return { ok: true, payload, products, staff };
}

/*
 * What the website said when asked whether anything changed. The new
 * licence always replaces the old one: it is the same shop, freshly signed.
 * A new configuration replaces the old one only when it passes the schema.
 * The shop's products and staff are never touched here: after activation
 * they are this computer's, and only the owner changes them.
 */
export type Refreshed =
  | { ok: true; changed: boolean }
  | { ok: false; reason: "bad_licence" | "not_this_computer" | "different_business" | "bad_configuration" };

export async function applyRefresh(
  database: Database.Database,
  folder: string,
  deviceId: string,
  answer: Extract<RefreshAnswer, { ok: true }>
): Promise<Refreshed> {
  const payload = await verifyLicence(answer.licence, LICENCE_PUBLIC_KEY);
  if (!payload) return { ok: false, reason: "bad_licence" };
  if (!coversDevice(payload, deviceId)) return { ok: false, reason: "not_this_computer" };
  if (getSetting(database, "business_id") !== payload.businessId) return { ok: false, reason: "different_business" };

  /* Changed means something the screens show: the plan, the status, the dates, the name. */
  const before = readLicence(folder);
  const old = before ? await verifyLicence(before, LICENCE_PUBLIC_KEY) : null;
  const shown = (one: LicencePayload | null) =>
    one ? JSON.stringify([one.businessName, one.plan, one.status, one.startsAt, one.endsAt, one.updatesUntil]) : "";
  let changed = shown(old) !== shown(payload);

  if (answer.configuration !== null) {
    const configuration = await withLogo(answer.configuration, answer.logo, currentLogos(folder));
    if (!configuration.success) return { ok: false, reason: "bad_configuration" };
    writeFileSync(join(folder, "configuration.json"), JSON.stringify(configuration.data, null, 2), "utf8");
    if (answer.configurationVersion !== null) setSetting(database, "configuration_version", String(answer.configurationVersion));
    /* Names he added to his staff on the website since. */
    if (Array.isArray(answer.staff)) addStaff(database, deviceId, answer.staff);
    changed = true;
  }

  if (answer.serial) setSetting(database, "serial", answer.serial);
  writeLicence(folder, answer.licence);
  return { ok: true, changed };
}
