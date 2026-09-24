import type Database from "better-sqlite3";
import { balanceOf, type Billing } from "./customers";

/*
 * Debt accounts billed by period, as the restaurant app kept them for the
 * companies whose staff eat on account: a month's consumption, what was paid
 * against it, and whether the account is up to date, part paid, unpaid or
 * late. Nothing here is stored: every figure is read from the same ledger as
 * any other credit customer, so an invoice and the balance never disagree.
 */

export type AccountStatus = "paid" | "partial" | "unpaid" | "overdue";

export type AccountPeriod = { from: string; to: string; consumed: number; paid: number };

export type StatementLine = {
  occurredAt: string;
  kind: "sale" | "void" | "payment";
  saleNumber: number | null;
  employee: string | null;
  amount: number;
  payment: string | null;
  mobileApp: string | null;
};

export type AccountStatement = { from: string; to: string; opening: number; consumed: number; paid: number; closing: number; lines: StatementLine[] };

/* Midnight of a local day, as the moments in the database are written. */
function startOf(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toISOString();
}

function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const next = new Date(y, m - 1, d + days);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
}

function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const next = new Date(y, m - 1 + months, 1);
  const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

function nextBoundary(day: string, billing: Billing): string {
  switch (billing) {
    case "daily":
      return addDays(day, 1);
    case "weekly":
      return addDays(day, 7);
    case "biweekly":
      return addDays(day, 14);
    default:
      return addMonths(day, 1);
  }
}

/*
 * The account's periods, newest first: from its billing start, one period
 * after another up to today. "to" is the day after the period's last day. An
 * account billed when he chooses has one period, from its start to today.
 */
export function accountPeriods(database: Database.Database, customerId: string, today: string, max = 12): AccountPeriod[] {
  const account = database.prepare("select billing, billing_start, created_at from customers where id = ?").get(customerId) as
    | { billing: Billing | null; billing_start: string | null; created_at: string }
    | undefined;
  if (!account) throw new Error("no such customer");
  const billing = account.billing ?? "monthly";
  const created = new Date(account.created_at);
  const start =
    account.billing_start ??
    `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, "0")}-${String(created.getDate()).padStart(2, "0")}`;
  const end = addDays(today, 1);

  const bounds: [string, string][] = [];
  if (billing === "custom") {
    bounds.push([start, end]);
  } else {
    let from = start;
    /* Far past a real account's life; a guard against a start typed a century ago. */
    for (let guard = 0; from < end && guard < 5000; guard += 1) {
      const to = nextBoundary(from, billing);
      bounds.push([from, to]);
      from = to;
    }
  }

  return bounds
    .slice(-max)
    .reverse()
    .map(([from, to]) => {
      const sums = database
        .prepare(
          `select coalesce(sum(case when sale_id is not null then amount end), 0) as consumed,
                  coalesce(sum(case when sale_id is null then -amount end), 0) as paid
             from credit_entries where customer_id = ? and occurred_at >= ? and occurred_at < ?`
        )
        .get(customerId, startOf(from), startOf(to)) as { consumed: number; paid: number };
      return { from, to: addDays(to, -1), consumed: sums.consumed, paid: sums.paid };
    });
}

/* One period's invoice: what was owed at its start, every line in it, and what is owed at its end. */
export function accountStatement(database: Database.Database, customerId: string, from: string, to: string): AccountStatement {
  const after = addDays(to, 1);
  const opening = (
    database.prepare("select coalesce(sum(amount), 0) as n from credit_entries where customer_id = ? and occurred_at < ?").get(customerId, startOf(from)) as {
      n: number;
    }
  ).n;
  const rows = database
    .prepare(
      `select e.occurred_at, e.amount, e.payment, e.mobile_app, s.number, s.reverses_id, s.employee
         from credit_entries e left join sales s on s.id = e.sale_id
        where e.customer_id = ? and e.occurred_at >= ? and e.occurred_at < ?
        order by e.occurred_at, e.counter`
    )
    .all(customerId, startOf(from), startOf(after)) as {
    occurred_at: string;
    amount: number;
    payment: string | null;
    mobile_app: string | null;
    number: number | null;
    reverses_id: string | null;
    employee: string | null;
  }[];
  const lines: StatementLine[] = rows.map((row) => ({
    occurredAt: row.occurred_at,
    kind: row.number === null ? "payment" : row.reverses_id ? "void" : "sale",
    saleNumber: row.number,
    employee: row.employee,
    amount: row.amount,
    payment: row.payment,
    mobileApp: row.mobile_app,
  }));
  const consumed = lines.filter((line) => line.kind !== "payment").reduce((sum, line) => sum + line.amount, 0);
  const paid = lines.filter((line) => line.kind === "payment").reduce((sum, line) => sum - line.amount, 0);
  return { from, to, opening, consumed, paid, closing: opening + consumed - paid, lines };
}

/*
 * Where the account stands today. Paid: nothing owed. Late: something owed
 * from before the current period. Part paid: owed, but a payment came in
 * this period. Unpaid: owed, and nothing paid yet.
 */
export function accountStatus(database: Database.Database, customerId: string, today: string): AccountStatus {
  if (balanceOf(database, customerId) <= 0) return "paid";
  const [current] = accountPeriods(database, customerId, today, 1);
  if (!current) return "unpaid";
  const owedBefore = (
    database.prepare("select coalesce(sum(amount), 0) as n from credit_entries where customer_id = ? and occurred_at < ?").get(customerId, startOf(current.from)) as {
      n: number;
    }
  ).n;
  if (owedBefore - current.paid > 0) return "overdue";
  return current.paid > 0 ? "partial" : "unpaid";
}
