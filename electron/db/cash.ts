import type Database from "better-sqlite3";
import { audit } from "./audit";
import { cashPaymentsBetween } from "./customers";
import { stamp } from "./rows";
import { cashTakenSince } from "./sales";

/*
 * The till drawer: opened with a float, counted at closing, and the
 * difference said plainly.
 *
 * What the drawer should hold is worked out from the records, never typed:
 * the float, plus cash sales, minus cash handed back on voided sales, plus
 * cash paid against debts. The cashier types one number, what he counted,
 * and the app says whether it matches.
 *
 * Selling never waits for the drawer to be opened. A shop that forgot to
 * open it in the morning still sells; its first sale simply belongs to no
 * session until one is opened, and the closing count starts from the float.
 */

export type CashSession = {
  id: string;
  openedAt: string;
  closedAt: string | null;
  openingFloat: number;
  cashSales: number;
  cashPayments: number;
  expected: number;
  counted: number | null;
  difference: number | null;
  note: string | null;
};

type Row = {
  id: string;
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
  const cashSales = cashTakenSince(database, row.opened_at, until);
  const cashPayments = cashPaymentsBetween(database, row.opened_at, until);
  const expected = row.closed_at && row.expected !== null ? row.expected : row.opening_float + cashSales + cashPayments;
  return {
    id: row.id,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    openingFloat: row.opening_float,
    cashSales,
    cashPayments,
    expected,
    counted: row.counted,
    difference: row.difference,
    note: row.note,
  };
}

export function openSession(database: Database.Database): CashSession | null {
  const row = database
    .prepare("select * from cash_sessions where closed_at is null order by opened_at desc limit 1")
    .get() as Row | undefined;
  return row ? withFigures(database, row) : null;
}

export function startSession(
  database: Database.Database,
  deviceId: string,
  input: { openingFloat: number; staffId?: string | null },
  now = new Date()
): CashSession {
  if (!Number.isInteger(input.openingFloat) || input.openingFloat < 0) throw new Error("a float is zero or more");
  const write = database.transaction(() => {
    if (openSession(database)) throw new Error("already open");
    const row = stamp(database, deviceId);
    database
      .prepare(
        `insert into cash_sessions (id, device_id, created_at, counter, opened_at, opening_float, staff_id)
         values (@id, @device_id, @created_at, @counter, @opened_at, @opening_float, @staff_id)`
      )
      .run({ ...row, opened_at: now.toISOString(), opening_float: input.openingFloat, staff_id: input.staffId ?? null });
    audit(database, deviceId, {
      staffId: input.staffId ?? null,
      subject: "cash",
      subjectId: row.id,
      action: "opened",
      detail: { openingFloat: input.openingFloat },
    });
    return openSession(database) as CashSession;
  });
  return write();
}

/*
 * Closing writes what was expected and what was counted onto the session
 * itself, once. After that the session is a record: what the drawer held
 * that evening does not change because a sale was voided the next morning.
 */
export function closeSession(
  database: Database.Database,
  deviceId: string,
  input: { counted: number; note?: string | null; staffId?: string | null },
  now = new Date()
): CashSession {
  if (!Number.isInteger(input.counted) || input.counted < 0) throw new Error("a count is zero or more");
  const write = database.transaction(() => {
    const current = openSession(database);
    if (!current) throw new Error("nothing is open");
    const closedAt = now.toISOString();
    const cashSales = cashTakenSince(database, current.openedAt, closedAt);
    const cashPayments = cashPaymentsBetween(database, current.openedAt, closedAt);
    const expected = current.openingFloat + cashSales + cashPayments;
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
