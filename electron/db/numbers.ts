import type Database from "better-sqlite3";
import { getSetting, setSetting } from "./rows";

/*
 * The numbers people read: receipts, orders, tickets, stays, wash jobs,
 * delivery notes, pre-orders.
 *
 * A shop with one device counts 1, 2, 3, as it always has. A shop whose
 * phone and computer both sell would hand out the same number twice when
 * both sell before hearing of each other, so each device takes its own share
 * of the numbers: with two devices one takes the odd ones and the other the
 * even ones, with three every third, and so on. The numbers still go up in
 * the order things happened; a device simply skips the ones that belong to
 * the others. The share comes from the server's list of the shop's active
 * devices (sync/client.ts), so every device works it out the same way.
 */

const SHARE_KEY = "number_share";

/** Which numbers are this device's: those that leave `slot` when divided by `of`. */
export type NumberShare = { slot: number; of: number };

export function numberShareOf(database: Database.Database): NumberShare {
  const saved = getSetting(database, SHARE_KEY);
  const match = saved ? /^(\d+)\/(\d+)$/.exec(saved) : null;
  if (!match) return { slot: 0, of: 1 };
  const slot = Number(match[1]);
  const of = Number(match[2]);
  return of > 1 && slot < of ? { slot, of } : { slot: 0, of: 1 };
}

/** From the shop's active devices, as the server lists them: each one's place in that list, sorted, is its share. */
export function shareFromDevices(me: string, devices: readonly string[]): NumberShare {
  const all = [...new Set(devices)].sort();
  const slot = all.indexOf(me);
  return slot < 0 || all.length < 2 ? { slot: 0, of: 1 } : { slot, of: all.length };
}

/** Saves this device's share. Says whether it changed. */
export function saveNumberShare(database: Database.Database, share: NumberShare): boolean {
  const value = share.of > 1 ? `${share.slot}/${share.of}` : "0/1";
  if ((getSetting(database, SHARE_KEY) ?? "0/1") === value) return false;
  setSetting(database, SHARE_KEY, value);
  return true;
}

/** The first number after `last` that is this device's. */
export function nextInShare(last: number, share: NumberShare): number {
  let next = last + 1;
  if (share.of > 1) while (next % share.of !== share.slot) next += 1;
  return next;
}

const NUMBERED = new Set(["sales", "orders", "tickets", "stays", "wash_jobs", "dispatches", "preorders"]);

/** The next number for a new row of `table`, after every number this device has seen there, its own or another's. */
export function nextNumber(database: Database.Database, table: string): number {
  if (!NUMBERED.has(table)) throw new Error(`not a numbered table: ${table}`);
  const last = (database.prepare(`select coalesce(max(number), 0) as last from ${table}`).get() as { last: number }).last;
  return nextInShare(last, numberShareOf(database));
}
