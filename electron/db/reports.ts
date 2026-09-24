import type Database from "better-sqlite3";
import { differencesBetween } from "./cash";
import { cashbookBetween } from "./cashbook";
import { debtPaymentsByApp, paymentsBetween, totalOwed } from "./customers";
import { clock } from "./clock";

/*
 * What a stretch of days came to, from the sales themselves.
 *
 * Nothing here is stored: every figure is added up from the rows, so the
 * report and the list of sales under it can never disagree. A voided sale is
 * counted where it happened and its reversal where that happened, which is
 * how the money actually moved.
 */

export type Period = { from: string; to: string };

export type Summary = {
  /** Every sale, reversals included: what the shop actually took. */
  net: number;
  /** The sales before any reversal. */
  gross: number;
  count: number;
  average: number;
  voids: { count: number; total: number };
  discounts: number;
  byPayment: { cash: number; mobile: number; credit: number };
  byApp: { app: string; total: number }[];
  /** How many items went out, net of voided sales. */
  itemsSold: number;
  /** What customers paid against their debts in the period. */
  debtPayments: { cash: number; mobile: number };
  /** The part of it paid through each application. */
  debtByApp: { app: string; total: number }[];
  /** Everything owed today, whatever the period. */
  owed: { customers: number; total: number };
  /** At the cost known when each line was sold; lines without one are left out. */
  margin: { amount: number; coveredSales: number; uncoveredLines: number };
  cashDifferences: { count: number; total: number };
  /** Money spent from the till that is not a sale: rent, supplies, wages. */
  expenses: { total: number; byCategory: { category: string; total: number }[] };
};

export function summary(database: Database.Database, period: Period): Summary {
  const { from, to } = period;

  const totals = database
    .prepare(
      `select coalesce(sum(total), 0) as net,
              coalesce(sum(case when reverses_id is null then total else 0 end), 0) as gross,
              coalesce(sum(case when reverses_id is null then 1 else 0 end), 0) as count,
              coalesce(sum(case when reverses_id is not null then 1 else 0 end), 0) as void_count,
              coalesce(sum(case when reverses_id is not null then total else 0 end), 0) as void_total,
              coalesce(sum(case when reverses_id is null then discount else 0 end), 0) as discounts
         from sales where occurred_at >= ? and occurred_at < ?`
    )
    .get(from, to) as {
    net: number;
    gross: number;
    count: number;
    void_count: number;
    void_total: number;
    discounts: number;
  };

  const byPaymentRows = database
    .prepare(
      /* In parts where a bill was paid two ways. */
      `select method as payment, coalesce(sum(amount), 0) as total from sale_takings
        where occurred_at >= ? and occurred_at < ? group by method`
    )
    .all(from, to) as { payment: string; total: number }[];
  const pick = (kind: string) => byPaymentRows.find((row) => row.payment === kind)?.total ?? 0;

  const byApp = (
    database
      .prepare(
        `select coalesce(mobile_app, '') as app, coalesce(sum(amount), 0) as total from sale_takings
          where method = 'mobile' and occurred_at >= ? and occurred_at < ?
          group by coalesce(mobile_app, '') order by total desc`
      )
      .all(from, to) as { app: string; total: number }[]
  ).filter((row) => row.total !== 0);

  /*
   * The margin uses the batch's own cost where the line came from a batch
   * that has one, and the product's cost otherwise. A line with neither is
   * counted as uncovered, and the screen says how many, rather than guessing.
   */
  const margin = database
    .prepare(
      `select coalesce(sum(case when cost is not null then l.line_total - round(l.quantity * cost) else 0 end), 0) as amount,
              coalesce(sum(case when cost is null then 1 else 0 end), 0) as uncovered,
              count(distinct case when cost is not null then l.sale_id end) as covered
         from (select l.*, coalesce(b.cost_price, p.cost_price) as cost
                 from sale_lines l
                 join sales s on s.id = l.sale_id
                 left join products p on p.id = l.product_id
                 left join batches b on b.id = l.batch_id
                where s.occurred_at >= ? and s.occurred_at < ? and s.status = 'recorded' and s.reverses_id is null
                  and l.product_id is not null) l`
    )
    .get(from, to) as { amount: number; uncovered: number; covered: number };

  return {
    net: totals.net,
    gross: totals.gross,
    count: totals.count,
    average: totals.count > 0 ? Math.round(totals.gross / totals.count) : 0,
    voids: { count: totals.void_count, total: totals.void_total },
    discounts: totals.discounts,
    byPayment: { cash: pick("cash"), mobile: pick("mobile"), credit: pick("credit") },
    byApp,
    itemsSold: (
      database
        .prepare(
          `select coalesce(sum(l.quantity), 0) as n from sale_lines l join sales s on s.id = l.sale_id
            where s.status = 'recorded' and s.reverses_id is null and s.occurred_at >= ? and s.occurred_at < ?`
        )
        .get(from, to) as { n: number }
    ).n,
    debtPayments: paymentsBetween(database, from, to),
    debtByApp: debtPaymentsByApp(database, from, to).filter((row) => row.total !== 0),
    owed: totalOwed(database),
    margin: { amount: margin.amount, coveredSales: margin.covered, uncoveredLines: margin.uncovered },
    cashDifferences: differencesBetween(database, from, to),
    expenses: cashbookBetween(database, from, to).expenses,
  };
}

export type TopProduct = { productId: string; name: string; quantity: number; total: number };

/* What sold most, by money, net of voids. */
export function topProducts(database: Database.Database, period: Period, limit = 10): TopProduct[] {
  const rows = database
    .prepare(
      `select coalesce(l.product_id, l.label) as product_id, coalesce(p.name, l.label) as name,
              sum(l.quantity) as quantity, sum(l.line_total) as total
         from sale_lines l
         join sales s on s.id = l.sale_id
         left join products p on p.id = l.product_id
        where s.occurred_at >= ? and s.occurred_at < ? and s.status = 'recorded' and s.reverses_id is null
        group by coalesce(l.product_id, l.label)
        order by total desc
        limit ?`
    )
    .all(period.from, period.to, limit) as { product_id: string; name: string; quantity: number; total: number }[];
  return rows.map((row) => ({ productId: row.product_id, name: row.name, quantity: row.quantity, total: row.total }));
}

/*
 * What was sold past its expiry date over a period, after the warning: which
 * medicine, which batch and date, how many, and on which ticket. The owner
 * sees it here, in the reports, rather than hearing of it later.
 */
export type PastExpirySale = {
  saleNumber: number;
  occurredAt: string;
  name: string;
  quantity: number;
  lot: string | null;
  expiresOn: string | null;
};

export function pastExpirySales(database: Database.Database, period: Period): PastExpirySale[] {
  const rows = database
    .prepare(
      `select s.number, s.occurred_at, coalesce(p.name, l.label) as name, l.quantity, b.lot, b.expires_on
         from sale_lines l
         join sales s on s.id = l.sale_id
         left join products p on p.id = l.product_id
         left join batches b on b.id = l.batch_id
        where l.past_expiry = 1 and s.occurred_at >= ? and s.occurred_at < ?
          and s.status = 'recorded' and s.reverses_id is null
        order by s.occurred_at desc`
    )
    .all(period.from, period.to) as { number: number; occurred_at: string; name: string; quantity: number; lot: string | null; expires_on: string | null }[];
  return rows.map((row) => ({
    saleNumber: row.number,
    occurredAt: row.occurred_at,
    name: row.name,
    quantity: row.quantity,
    lot: row.lot,
    expiresOn: row.expires_on,
  }));
}

/*
 * The end-of-trial summary, from the owner's own records and nothing else:
 * how many sales he recorded, what credit he is following, and how many
 * closings found a difference. Worked out here, on his computer, and shown
 * only to him.
 */
export function trialSummary(database: Database.Database): { sales: number; creditCustomers: number; creditTotal: number; cashDifferences: number } {
  const sales = database.prepare("select count(*) as n from sales where reverses_id is null and status = 'recorded'").get() as { n: number };
  const owed = totalOwed(database);
  const differences = database
    .prepare("select count(*) as n from cash_sessions where difference is not null and difference != 0")
    .get() as { n: number };
  return { sales: sales.n, creditCustomers: owed.customers, creditTotal: owed.total, cashDifferences: differences.n };
}

/*
 * Takings day by day, for the dashboard's chart. Days are the computer's own
 * days: a sale at 23:30 belongs to the evening it happened in, not to the
 * next morning in some other time zone.
 */
export function dailyTotals(database: Database.Database, days: number, now = clock()): { day: string; net: number; count: number }[] {
  const out: { day: string; net: number; count: number }[] = [];
  for (let index = days - 1; index >= 0; index -= 1) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - index);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - index + 1);
    const row = database
      .prepare(
        `select coalesce(sum(total), 0) as net, coalesce(sum(case when reverses_id is null then 1 else 0 end), 0) as count
           from sales where occurred_at >= ? and occurred_at < ?`
      )
      .get(start.toISOString(), end.toISOString()) as { net: number; count: number };
    const pad = (n: number) => String(n).padStart(2, "0");
    out.push({ day: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`, net: row.net, count: row.count });
  }
  return out;
}
