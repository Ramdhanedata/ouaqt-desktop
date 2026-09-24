import type Database from "better-sqlite3";
import { audit } from "./audit";
import { stamp } from "./rows";

/*
 * The payment applications the owner keeps: the list the "Application"
 * payment offers, in his order, first the one he uses most.
 *
 * The app connects to none of them and checks nothing. It records which one
 * the customer paid through, and the transaction number when the cashier
 * notes it, so the reports and the cash screen can say what came in how.
 */

export type PaymentApp = { id: string; name: string; logo: string | null; position: number };

const NAME_MAX = 40; // not-a-rule: long enough for "Orange Money Business"
const LOGO_MAX = 60_000; // not-a-rule: a small picture, a few tens of kilobytes at most

export function listPaymentApps(database: Database.Database): PaymentApp[] {
  return database
    .prepare("select id, name, logo, position from payment_apps where active = 1 order by position, created_at")
    .all() as PaymentApp[];
}

function cleanName(name: string): string {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) throw new Error("an application needs a name");
  if (clean.length > NAME_MAX) throw new Error("that name is too long");
  return clean;
}

export function addPaymentApp(database: Database.Database, deviceId: string, name: string): string {
  const clean = cleanName(name);
  const last = database.prepare("select coalesce(max(position), 0) as p from payment_apps where active = 1").get() as { p: number };
  const row = stamp(database, deviceId);
  database
    .prepare(
      "insert into payment_apps (id, device_id, created_at, counter, name, position) values (@id, @device_id, @created_at, @counter, @name, @position)"
    )
    .run({ ...row, name: clean, position: last.p + 1 });
  audit(database, deviceId, { staffId: null, subject: "payment_app", subjectId: row.id, action: "added", detail: { name: clean } });
  return row.id;
}

export function renamePaymentApp(database: Database.Database, deviceId: string, id: string, name: string): void {
  const clean = cleanName(name);
  database.prepare("update payment_apps set name = ? where id = ?").run(clean, id);
  audit(database, deviceId, { staffId: null, subject: "payment_app", subjectId: id, action: "renamed", detail: { name: clean } });
}

/* A data URL, or null to go back to the name alone. */
export function setPaymentAppLogo(database: Database.Database, id: string, logo: string | null): void {
  if (logo !== null && (!/^data:image\/(png|jpeg|svg\+xml);base64,/.test(logo) || logo.length > LOGO_MAX)) {
    throw new Error("that picture cannot be used");
  }
  database.prepare("update payment_apps set logo = ? where id = ?").run(logo, id);
}

/* Taken out of the payment dialog; the sales made through it keep its name. */
export function removePaymentApp(database: Database.Database, deviceId: string, id: string): void {
  database.prepare("update payment_apps set active = 0 where id = ?").run(id);
  audit(database, deviceId, { staffId: null, subject: "payment_app", subjectId: id, action: "removed" });
}

/* One place up or down the list: the one he uses most goes first. */
export function movePaymentApp(database: Database.Database, id: string, direction: "up" | "down"): void {
  const apps = listPaymentApps(database);
  const index = apps.findIndex((app) => app.id === id);
  const other = apps[direction === "up" ? index - 1 : index + 1];
  if (index === -1 || !other) return;
  const swap = database.transaction(() => {
    apps.forEach((app, position) => database.prepare("update payment_apps set position = ? where id = ?").run(position + 1, app.id));
    database.prepare("update payment_apps set position = ? where id = ?").run(direction === "up" ? index : index + 2, id);
    database.prepare("update payment_apps set position = ? where id = ?").run(index + 1, other.id);
  });
  swap();
}
