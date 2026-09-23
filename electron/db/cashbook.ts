import type Database from "better-sqlite3";
import { audit } from "./audit";
import { stamp } from "./rows";

/*
 * Money in and out of the till that is not a sale.
 *
 * An expense paid from the drawer, cash taken to the bank, a bakery's
 * deposit on a cake ordered for Friday, a hotel guest's advance. Each is a
 * row with its reason, so the drawer's expected cash at closing still adds
 * up, and the owner can see where the money went.
 *
 * A deposit or an advance is money received, not a sale: the sale is
 * recorded when the goods or the stay are handed over, and says how much of
 * it was already paid, so the takings are counted once.
 */

export type CashReason = "expense" | "withdrawal" | "deposit" | "deposit_refund" | "advance" | "float_added" | "other";

export type CashMovement = {
  id: string;
  occurredAt: string;
  direction: "in" | "out";
  amount: number;
  payment: "cash" | "mobile";
  reason: CashReason;
  category: string | null;
  note: string | null;
  reference: string | null;
};

export type NewCashMovement = {
  direction: "in" | "out";
  amount: number;
  payment?: "cash" | "mobile";
  reason: CashReason;
  category?: string | null;
  note?: string | null;
  reference?: string | null;
  staffId?: string | null;
};

function blank(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

export function addCashMovement(
  database: Database.Database,
  deviceId: string,
  input: NewCashMovement,
  now = new Date()
): string {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new Error("an amount is more than zero");
  const row = stamp(database, deviceId);
  database
    .prepare(
      `insert into cash_movements (id, device_id, created_at, counter, occurred_at, direction, amount, payment, reason, category, note, reference, staff_id)
       values (@id, @device_id, @created_at, @counter, @occurred_at, @direction, @amount, @payment, @reason, @category, @note, @reference, @staff_id)`
    )
    .run({
      ...row,
      occurred_at: now.toISOString(),
      direction: input.direction,
      amount: input.amount,
      payment: input.payment ?? "cash",
      reason: input.reason,
      category: blank(input.category),
      note: blank(input.note),
      reference: input.reference ?? null,
      staff_id: input.staffId ?? null,
    });
  audit(database, deviceId, {
    staffId: input.staffId ?? null,
    subject: "cash",
    subjectId: row.id,
    action: input.reason,
    detail: { direction: input.direction, amount: input.amount, category: blank(input.category) },
  });
  return row.id;
}

export function cashMovementsBetween(database: Database.Database, from: string, to: string): CashMovement[] {
  const rows = database
    .prepare(
      `select id, occurred_at, direction, amount, payment, reason, category, note, reference
         from cash_movements where occurred_at >= ? and occurred_at < ? order by occurred_at desc, counter desc`
    )
    .all(from, to) as {
    id: string;
    occurred_at: string;
    direction: "in" | "out";
    amount: number;
    payment: "cash" | "mobile";
    reason: CashReason;
    category: string | null;
    note: string | null;
    reference: string | null;
  }[];
  return rows.map((row) => ({
    id: row.id,
    occurredAt: row.occurred_at,
    direction: row.direction,
    amount: row.amount,
    payment: row.payment,
    reason: row.reason,
    category: row.category,
    note: row.note,
    reference: row.reference,
  }));
}

/*
 * A stretch of time in the cash book: cash in and out of the drawer, and the
 * expenses by category, whatever they were paid with.
 */
export function cashbookBetween(
  database: Database.Database,
  from: string,
  to: string
): { cashIn: number; cashOut: number; expenses: { total: number; byCategory: { category: string; total: number }[] } } {
  const drawer = database
    .prepare(
      `select coalesce(sum(case when direction = 'in' then amount else 0 end), 0) as cash_in,
              coalesce(sum(case when direction = 'out' then amount else 0 end), 0) as cash_out
         from cash_movements where payment = 'cash' and occurred_at >= ? and occurred_at < ?`
    )
    .get(from, to) as { cash_in: number; cash_out: number };
  const byCategory = database
    .prepare(
      `select coalesce(category, '') as category, sum(amount) as total from cash_movements
        where reason = 'expense' and occurred_at >= ? and occurred_at < ?
        group by coalesce(category, '') order by total desc`
    )
    .all(from, to) as { category: string; total: number }[];
  return {
    cashIn: drawer.cash_in,
    cashOut: drawer.cash_out,
    expenses: { total: byCategory.reduce((sum, row) => sum + row.total, 0), byCategory },
  };
}

/** What was received ahead for one record: a preorder's deposit, a stay's advances. */
export function receivedFor(database: Database.Database, reference: string): number {
  const row = database
    .prepare(
      `select coalesce(sum(case when direction = 'in' then amount else -amount end), 0) as total
         from cash_movements where reference = ? and reason in ('deposit', 'advance', 'deposit_refund')`
    )
    .get(reference) as { total: number };
  return row.total;
}
