import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { configurationSchema } from "@app-ui/config";
import { verifyLicence, coversDevice, type LicencePayload } from "@app-ui/licence-file";
import { addProduct, adoptImportedBatches, listProducts, recordMovement } from "../db/products";
import { getSetting, setSetting, stamp } from "../db/rows";
import { LICENCE_PUBLIC_KEY } from "./keys";
import { download, type ActivationAnswer } from "./network";
import { writeDeviceToken, writeLicence } from "./store";

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

function dataUrl(bytes: Buffer | null): string | undefined {
  if (!bytes || bytes.length === 0) return undefined;
  return `data:image/png;base64,${bytes.toString("base64")}`;
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

  /*
   * The logo arrives as two short-lived links. Fetched now, while there is a
   * network, and kept inside the configuration where the receipt already
   * looks for it. A logo that will not download is not a reason to refuse:
   * the shop's name prints instead.
   */
  const [colour, mono] = answer.logo
    ? await Promise.all([download(answer.logo.colour), download(answer.logo.mono)])
    : [null, null];

  const raw = (answer.configuration ?? {}) as { business?: Record<string, unknown> };
  const withLogo = {
    ...raw,
    business: {
      ...(raw.business ?? {}),
      ...(dataUrl(colour) ? { logo: dataUrl(colour) } : {}),
      ...(dataUrl(mono) ? { logoMono: dataUrl(mono) } : {}),
    },
  };

  const configuration = configurationSchema.safeParse(withLogo);
  if (!configuration.success) return { ok: false, reason: "bad_configuration" };

  let products = 0;
  let staff = 0;

  const write = database.transaction(() => {
    setSetting(database, "business_id", payload.businessId);
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
          unit: text(one.unit),
          extra: Object.keys(extra).length ? extra : undefined,
        });

        /* What he had on the shelf, as the first movement, never as a number. */
        const quantity = typeof one.quantity === "number" ? one.quantity : 0;
        if (quantity > 0) {
          recordMovement(database, deviceId, { productId: id, quantity, reason: "reception", reference: "activation" });
        }
        products += 1;
      }
    }

    const hasStaff = database.prepare("select count(*) as n from staff").get() as { n: number };
    if (hasStaff.n === 0) {
      for (const person of answer.staff) {
        if (!text(person.name) || (person.role !== "manager" && person.role !== "cashier")) continue;
        const row = stamp(database, deviceId);
        database
          .prepare(
            `insert into staff (id, device_id, created_at, counter, name, role)
             values (@id, @device_id, @created_at, @counter, @name, @role)`
          )
          .run({ ...row, name: person.name.trim(), role: person.role });
        staff += 1;
      }
    }
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
