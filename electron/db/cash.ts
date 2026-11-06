import type Database from "better-sqlite3";
import { audit } from "./audit";
import { cashbookBetween } from "./cashbook";
import { cashPaymentsBetween } from "./customers";
import { deviceIdOf, stamp } from "./rows";
import { cashTakenSince } from "./sales";
import { clock } from "./clock";

/*
 * The till drawer: always open, counted at closing, and the difference said
 * plainly.
 *
 * Nobody types a float any more. A drawer opens by itself the first time it
 * is looked at, and closing one opens the next at the same instant, so the
 * new day starts on its own and no sale ever falls between two drawers. The
 * float column stays for the drawers opened with one before, which keep it.
 *
 * What the drawer should hold is worked out from the records, never typed:
 * cash sales, minus cash handed back on voided sales, plus cash paid against
 * debts, plus cash put in, minus cash taken out. The cashier types one
 * number, what he counted, and the app says whether it matches.
 *
 * Each device has its own drawer, because each holds its own cash. A shop's
 * phone and computer see each other's sales, but this device's count is only
 * ever about what this device took. The others' closings are shown, and said
 * to be theirs.
 */

export type CashSession = {
  id: string;
  openedAt: string;
  closedAt: string | null;
  openingFloat: number;
  cashSales: number;
  cashPayments: number;
  /** Cash put in or taken out that is not a sale: deposits, expenses, withdrawals. */
  cashIn: number;
  cashOut: number;
  /** Taken through a payment application while the session was open: not in the drawer, but his. */
  byApp: { app: string; total: number }[];
  expected: number;
  counted: number | null;
  difference: number | null;
  note: string | null;
  /** Closed on another of the shop's devices. */
  otherDevice: boolean;
};

type Row = {
  id: string;
  device_id: string;
  opened_at: string;
  closed_at: string | null;
  opening_float: number;
  counted: number | null;
  expected: number | null;
  difference: number | null;
  note: string | null;
};

function withFigures(database: Database.Database, row: Row): CashSession {
  const until = row.closed_at ?? undefined;
  const cashSales = cashTakenSince(database, row.opened_at, until, row.device_id);
  const cashPayments = cashPaymentsBetween(database, row.opened_at, until, row.device_id);
  const book = cashbookBetween(database, row.opened_at, until ?? "9999", row.device_id);
  const expected =
    row.closed_at && row.expected !== null
      ? row.expected
      : row.opening_float + cashSales + cashPayments + book.cashIn - book.cashOut;
  return {
    id: row.id,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    openingFloat: row.opening_float,
    cashSales,
    cashPayments,
    cashIn: book.cashIn,
    cashOut: book.cashOut,
    byApp: database
      .prepare(
        /* Sales and debts paid through each application: both landed on its account, not in the drawer. */
        `select app, sum(total) as total from (
           select coalesce(mobile_app, '') as app, due as total from sale_takings
            where method = 'mobile' and occurred_at >= @from and occurred_at < @to and device_id = @device
           union all
           select coalesce(mobile_app, '') as app, -amount as total from credit_entries
            where sale_id is null and payment = 'mobile' and occurred_at >= @from and occurred_at < @to and device_id = @device
         ) group by app order by total desc`
      )
      .all({ from: row.opened_at, to: until ?? "9999", device: row.device_id }) as { app: string; total: number }[],
    expected,
    counted: row.counted,
    difference: row.difference,
    note: row.note,
    otherDevice: row.device_id !== deviceIdOf(database),
  };
}

export function openSession(database: Database.Database): CashSession | null {
  const row = database
    .prepare("select * from cash_sessions where closed_at is null and device_id = ? order by opened_at desc limit 1")
    .get(deviceIdOf(database)) as Row | undefined;
  return row ? withFigures(database, row) : null;
}

function insertSession(
  database: Database.Database,
  deviceId: string,
  input: { openedAt: string; openingFloat: number; staffId?: string | null; automatic?: boolean }
): void {
  const row = stamp(database, deviceId);
  database
    .prepare(
      `insert into cash_sessions (id, device_id, created_at, counter, opened_at, opening_float, staff_id)
       values (@id, @device_id, @created_at, @counter, @opened_at, @opening_float, @staff_id)`
    )
    .run({ ...row, opened_at: input.openedAt, opening_float: input.openingFloat, staff_id: input.staffId ?? null });
  audit(database, deviceId, {
    staffId: input.staffId ?? null,
    subject: "cash",
    subjectId: row.id,
    action: "opened",
    detail: input.automatic ? { automatic: true } : { openingFloat: input.openingFloat },
  });
}

export function startSession(
  database: Database.Database,
  deviceId: string,
  input: { openingFloat?: number; staffId?: string | null } = {},
  now = clock()
): CashSession {
  const openingFloat = input.openingFloat ?? 0;
  if (!Number.isInteger(openingFloat) || openingFloat < 0) throw new Error("a float is zero or more");
  const write = database.transaction(() => {
    if (openSession(database)) throw new Error("already open");
    insertSession(database, deviceId, { openedAt: now.toISOString(), openingFloat, staffId: input.staffId });
    return openSession(database) as CashSession;
  });
  return write();
}

/*
 * This device's drawer, opened if none is. It starts where the last one this
 * device closed stopped, or at midnight if that was before today, so sales
 * made before anyone looked at the drawer still count in it, and a shop that
 * stayed shut for a week does not find the week's cash expected today.
 */
export function ensureSession(database: Database.Database, deviceId: string, now = clock()): CashSession {
  const write = database.transaction(() => {
    const current = openSession(database);
    if (current) return current;
    const lastClose = database
      .prepare("select max(closed_at) as at from cash_sessions where device_id = ? and closed_at is not null")
      .get(deviceIdOf(database)) as { at: string | null };
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const openedAt = lastClose.at && lastClose.at > midnight ? lastClose.at : midnight;
    insertSession(database, deviceId, { openedAt, openingFloat: 0, automatic: true });
    return openSession(database) as CashSession;
  });
  return write();
}

/*
 * Closing writes what was expected and what was counted onto the session
 * itself, once. After that the session is a record: what the drawer held
 * that evening does not change because a sale was voided the next morning.
 *
 * The next drawer opens in the same breath, at the very moment this one
 * closed, with nothing in it: the next day is ready without anyone opening it.
 */
export function closeSession(
  database: Database.Database,
  deviceId: string,
  input: { counted: number; note?: string | null; staffId?: string | null },
  now = clock()
): CashSession {
  if (!Number.isInteger(input.counted) || input.counted < 0) throw new Error("a count is zero or more");
  const write = database.transaction(() => {
    const current = openSession(database);
    if (!current) throw new Error("nothing is open");
    const closedAt = now.toISOString();
    const me = deviceIdOf(database);
    const cashSales = cashTakenSince(database, current.openedAt, closedAt, me);
    const cashPayments = cashPaymentsBetween(database, current.openedAt, closedAt, me);
    const book = cashbookBetween(database, current.openedAt, closedAt, me);
    const expected = current.openingFloat + cashSales + cashPayments + book.cashIn - book.cashOut;
    const difference = input.counted - expected;
    const note = (input.note ?? "").trim() || null;
    database
      .prepare(
        `update cash_sessions set closed_at = @closed_at, counted = @counted, expected = @expected,
                difference = @difference, note = @note
          where id = @id and closed_at is null`
      )
      .run({ id: current.id, closed_at: closedAt, counted: input.counted, expected, difference, note });
    audit(database, deviceId, {
      staffId: input.staffId ?? null,
      subject: "cash",
      subjectId: current.id,
      action: "closed",
      detail: { expected, counted: input.counted, difference },
    });
    insertSession(database, deviceId, { openedAt: closedAt, openingFloat: 0, staffId: input.staffId, automatic: true });
    const row = database.prepare("select * from cash_sessions where id = ?").get(current.id) as Row;
    return withFigures(database, row);
  });
  return write();
}

export function pastSessions(database: Database.Database, limit = 30): CashSession[] {
  const rows = database
    .prepare("select * from cash_sessions where closed_at is not null order by closed_at desc limit ?")
    .all(limit) as Row[];
  return rows.map((row) => withFigures(database, row));
}

/** Closings in a stretch of time where the count did not match. */
export function differencesBetween(database: Database.Database, from: string, to: string): { count: number; total: number } {
  const row = database
    .prepare(
      `select count(*) as count, coalesce(sum(difference), 0) as total from cash_sessions
        where closed_at >= ? and closed_at < ? and difference is not null and difference != 0`
    )
    .get(from, to) as { count: number; total: number };
  return row;
}
