import type Database from "better-sqlite3";
import { differencesBetween } from "./cash";
import { paymentsBetween, totalOwed } from "./customers";

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
  /** What customers paid against their debts in the period. */
  debtPayments: { cash: number; mobile: number };
  /** Everything owed today, whatever the period. */
  owed: { customers: number; total: number };
  /** At the cost known when each line was sold; lines without one are left out. */
  margin: { amount: number; coveredSales: number; uncoveredLines: number };
  cashDifferences: { count: number; total: number };
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
      `select payment, coalesce(sum(total), 0) as total from sales
        where occurred_at >= ? and occurred_at < ? group by payment`
    )
    .all(from, to) as { payment: string; total: number }[];
  const pick = (kind: string) => byPaymentRows.find((row) => row.payment === kind)?.total ?? 0;

  const byApp = (
    database
      .prepare(
        `select coalesce(mobile_app, '') as app, coalesce(sum(total), 0) as total from sales
          where payment = 'mobile' and occurred_at >= ? and occurred_at < ?
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
                 join products p on p.id = l.product_id
                 left join batches b on b.id = l.batch_id
                where s.occurred_at >= ? and s.occurred_at < ? and s.status = 'recorded' and s.reverses_id is null) l`
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
    debtPayments: paymentsBetween(database, from, to),
    owed: totalOwed(database),
    margin: { amount: margin.amount, coveredSales: margin.covered, uncoveredLines: margin.uncovered },
    cashDifferences: differencesBetween(database, from, to),
  };
}

export type TopProduct = { productId: string; name: string; quantity: number; total: number };

/* What sold most, by money, net of voids. */
export function topProducts(database: Database.Database, period: Period, limit = 10): TopProduct[] {
  const rows = database
    .prepare(
      `select l.product_id, p.name, sum(l.quantity) as quantity, sum(l.line_total) as total
         from sale_lines l
         join sales s on s.id = l.sale_id
         join products p on p.id = l.product_id
        where s.occurred_at >= ? and s.occurred_at < ? and s.status = 'recorded' and s.reverses_id is null
        group by l.product_id
        order by total desc
        limit ?`
    )
    .all(period.from, period.to, limit) as { product_id: string; name: string; quantity: number; total: number }[];
  return rows.map((row) => ({ productId: row.product_id, name: row.name, quantity: row.quantity, total: row.total }));
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
