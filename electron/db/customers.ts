import type Database from "better-sqlite3";
import { audit } from "./audit";
import { stamp } from "./rows";

/*
 * Customers who buy on credit, and what each one owes.
 *
 * The balance is the sum of the ledger, never a column somebody remembers to
 * update: a sale on credit adds, a payment subtracts, a voided credit sale
 * takes its own amount back out. The owner can read every line that makes up
 * the number he is about to ask for.
 */

export type Customer = {
  id: string;
  name: string;
  phone: string | null;
  creditLimit: number | null;
  note: string | null;
  balance: number;
  lastActivity: string | null;
};

const SELECT = `
  select c.id, c.name, c.phone, c.credit_limit, c.note,
         (select coalesce(sum(e.amount), 0) from credit_entries e where e.customer_id = c.id) as balance,
         (select max(e.occurred_at) from credit_entries e where e.customer_id = c.id) as last_activity
    from customers c
   where c.archived_at is null
`;

type Row = {
  id: string;
  name: string;
  phone: string | null;
  credit_limit: number | null;
  note: string | null;
  balance: number;
  last_activity: string | null;
};

function toCustomer(row: Row): Customer {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    creditLimit: row.credit_limit,
    note: row.note,
    balance: row.balance,
    lastActivity: row.last_activity,
  };
}

export function balanceOf(database: Database.Database, customerId: string): number {
  const row = database
    .prepare("select coalesce(sum(amount), 0) as balance from credit_entries where customer_id = ?")
    .get(customerId) as { balance: number };
  return row.balance;
}

/* Those who owe first, the largest debt at the top, then everyone else by name. */
export function listCustomers(database: Database.Database, term = ""): Customer[] {
  const clean = term.trim().toLowerCase();
  const rows = database
    .prepare(
      `${SELECT} ${clean ? "and (lower(c.name) like @like or c.phone like @like)" : ""}
        order by case when balance > 0 then 0 else 1 end, balance desc, c.name collate nocase`
    )
    .all(clean ? { like: `%${clean}%` } : {}) as Row[];
  return rows.map(toCustomer);
}

export function getCustomer(database: Database.Database, id: string): Customer | null {
  const row = database.prepare(`${SELECT} and c.id = ?`).get(id) as Row | undefined;
  return row ? toCustomer(row) : null;
}

export type NewCustomer = { name: string; phone?: string | null; creditLimit?: number | null; note?: string | null };

function blank(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

export function addCustomer(
  database: Database.Database,
  deviceId: string,
  input: NewCustomer,
  staffId: string | null = null
): string {
  const name = blank(input.name);
  if (!name) throw new Error("a customer needs a name");
  if (input.creditLimit !== null && input.creditLimit !== undefined && (!Number.isInteger(input.creditLimit) || input.creditLimit < 0)) {
    throw new Error("a limit is a whole number of minor units");
  }
  const row = stamp(database, deviceId);
  database
    .prepare(
      `insert into customers (id, device_id, created_at, counter, name, phone, credit_limit, note)
       values (@id, @device_id, @created_at, @counter, @name, @phone, @credit_limit, @note)`
    )
    .run({ ...row, name, phone: blank(input.phone), credit_limit: input.creditLimit ?? null, note: blank(input.note) });
  audit(database, deviceId, { staffId, subject: "customer", subjectId: row.id, action: "created", detail: { name } });
  return row.id;
}

export function updateCustomer(
  database: Database.Database,
  deviceId: string,
  id: string,
  input: NewCustomer,
  staffId: string | null = null
): void {
  const name = blank(input.name);
  if (!name) throw new Error("a customer needs a name");
  database
    .prepare("update customers set name = @name, phone = @phone, credit_limit = @credit_limit, note = @note where id = @id")
    .run({ id, name, phone: blank(input.phone), credit_limit: input.creditLimit ?? null, note: blank(input.note) });
  audit(database, deviceId, { staffId, subject: "customer", subjectId: id, action: "updated", detail: { name } });
}

export type LedgerLine = {
  id: string;
  occurredAt: string;
  amount: number;
  kind: "sale" | "void" | "payment";
  saleNumber: number | null;
  payment: string | null;
  note: string | null;
  /** What he owed once this line was written. */
  balanceAfter: number;
};

export function ledgerOf(database: Database.Database, customerId: string): LedgerLine[] {
  const rows = database
    .prepare(
      `select e.id, e.occurred_at, e.amount, e.payment, e.note, s.number, s.reverses_id
         from credit_entries e
         left join sales s on s.id = e.sale_id
        where e.customer_id = ?
        order by e.occurred_at, e.counter`
    )
    .all(customerId) as {
    id: string;
    occurred_at: string;
    amount: number;
    payment: string | null;
    note: string | null;
    number: number | null;
    reverses_id: string | null;
  }[];

  let running = 0;
  const lines = rows.map((row) => {
    running += row.amount;
    return {
      id: row.id,
      occurredAt: row.occurred_at,
      amount: row.amount,
      kind: (row.number === null ? "payment" : row.reverses_id ? "void" : "sale") as LedgerLine["kind"],
      saleNumber: row.number,
      payment: row.payment,
      note: row.note,
      balanceAfter: running,
    };
  });
  return lines.reverse();
}

/*
 * Money paid against a debt. It never takes the balance below zero: an
 * overpayment is change to hand back, not credit to keep, and a till that
 * silently owed its customers money would be a surprise at closing.
 */
export function recordPayment(
  database: Database.Database,
  deviceId: string,
  input: { customerId: string; amount: number; payment: "cash" | "mobile"; note?: string | null; staffId?: string | null },
  now = new Date()
): { balance: number } {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new Error("a payment pays something");
  const write = database.transaction(() => {
    const owed = balanceOf(database, input.customerId);
    if (input.amount > owed) throw new Error("more than is owed");
    const row = stamp(database, deviceId);
    database
      .prepare(
        `insert into credit_entries (id, device_id, created_at, counter, customer_id, sale_id, amount, staff_id, occurred_at, payment, note)
         values (@id, @device_id, @created_at, @counter, @customer_id, null, @amount, @staff_id, @occurred_at, @payment, @note)`
      )
      .run({
        ...row,
        customer_id: input.customerId,
        amount: -input.amount,
        staff_id: input.staffId ?? null,
        occurred_at: now.toISOString(),
        payment: input.payment,
        note: blank(input.note),
      });
    audit(database, deviceId, {
      staffId: input.staffId ?? null,
      subject: "customer",
      subjectId: input.customerId,
      action: "paid",
      detail: { amount: input.amount, payment: input.payment },
    });
    return { balance: owed - input.amount };
  });
  return write();
}

/** Cash paid against debts in a stretch of time, which the till holds. */
export function cashPaymentsBetween(database: Database.Database, from: string, to = "9999"): number {
  const row = database
    .prepare(
      `select coalesce(sum(-amount), 0) as total from credit_entries
        where sale_id is null and payment = 'cash' and occurred_at >= ? and occurred_at < ?`
    )
    .get(from, to) as { total: number };
  return row.total;
}

export function paymentsBetween(database: Database.Database, from: string, to: string): { cash: number; mobile: number } {
  const rows = database
    .prepare(
      `select payment, coalesce(sum(-amount), 0) as total from credit_entries
        where sale_id is null and occurred_at >= ? and occurred_at < ? group by payment`
    )
    .all(from, to) as { payment: string | null; total: number }[];
  return {
    cash: rows.find((row) => row.payment === "cash")?.total ?? 0,
    mobile: rows.find((row) => row.payment === "mobile")?.total ?? 0,
  };
}

/** Everyone who owes, and the total the shop is waiting for. */
export function totalOwed(database: Database.Database): { customers: number; total: number } {
  const row = database
    .prepare(
      `select count(*) as customers, coalesce(sum(balance), 0) as total
         from (select customer_id, sum(amount) as balance from credit_entries group by customer_id)
        where balance > 0`
    )
    .get() as { customers: number; total: number };
  return row;
}
