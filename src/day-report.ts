import type { Configuration } from "@app-ui/config";
import { formatMoney, formatQuantity } from "@app-ui/format";
import type { CashSession, PrintedDay, Summary, TopProduct, WashReport } from "./bridge";
import { fill, type ScreensCopy } from "./i18n/screens";
import type { TradesCopy } from "./i18n/trades";

/*
 * The end of the day, for any trade: what came in, how many times, what sold
 * most, how it was paid, then what only this trade counts, what else moved,
 * and where the drawer stands.
 *
 * A row with nothing to say is left out, so a shop that gave no discount does
 * not read a line of zeros. The screen, the printer and the PDF all show what
 * this returns, so they can never disagree.
 */

export type DayFacts = {
  summary: Summary;
  top: TopProduct[];
  /** The restaurant: how each order was served. */
  services?: { service: string; count: number; total: number }[];
  /** The hotel. */
  occupancy?: { roomNights: number; sold: number; percent: number } | null;
  /** The wash. */
  wash?: WashReport | null;
  /** Transport. */
  routes?: { route: string; tickets: number; ticketTotal: number; parcels: number; parcelTotal: number }[];
  /** The bakery. */
  baked?: { produced: number; sold: number; lost: number }[];
  /** The warehouse. */
  flows?: { name: string; unit: string | null; received: number; sent: number; sold: number; adjusted: number }[];
  /** The drawer: open now, or closed earlier today. */
  cash?: CashSession | null;
};

type Row = PrintedDay["sections"][number]["rows"][number];

const DATE_LOCALE = { fr: "fr-FR", ar: "ar-u-nu-latn", en: "en-GB" } as const;

export function dayDate(language: keyof typeof DATE_LOCALE, now = new Date()): string {
  return now.toLocaleDateString(DATE_LOCALE[language], { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export function dayReport(configuration: Configuration, t: ScreensCopy, tt: TradesCopy, facts: DayFacts, now = new Date()): PrintedDay {
  const language = configuration.language.app;
  const pack = configuration.pack;
  const { summary } = facts;
  const plain = (minor: number) => formatMoney(minor, language);
  const count = (quantity: number) => formatQuantity(quantity, language);
  const sections: PrintedDay["sections"] = [];
  const add = (rows: Row[], heading?: string) => {
    if (rows.length > 0) sections.push(heading ? { heading, rows } : { rows });
  };

  /* A warehouse that only moves goods has no takings to lead with: it leads with what moved. */
  const flows = facts.flows ?? [];
  const moved = flows.reduce((sum, row) => sum + row.received + row.sent + row.sold, 0);
  const movesOnly = pack === "warehouse" && !configuration.features.warehouse?.sellsDirect && summary.count === 0;

  /* ── How many, what sold most, the average ─────────────────────────── */

  const countLabel =
    pack === "restaurant" ? tt.orderCount : pack === "hotel" ? tt.endBillCount : pack === "transport" ? tt.endTicketCount : pack === "wash" ? tt.endWashCount : tt.endSaleCount;
  /* A hotel's lines are its rooms and a bus's its fares: "most sold" would say nothing, so it is left to the sections below. */
  const hasTop = pack !== "hotel" && pack !== "transport";
  const best = hasTop ? [...facts.top].sort((a, b) => b.quantity - a.quantity)[0] : undefined;
  const counted = pack === "pharmacy" || pack === "shop" || pack === "bakery" || pack === "general" || pack === "warehouse";
  /* An average basket means something at a till or a table, not for a room, a seat or a wash. */
  const hasAverage = counted || pack === "restaurant";

  if (!movesOnly) {
    add([
      { label: countLabel, value: count(summary.count) },
      ...(counted && summary.itemsSold > 0 ? [{ label: tt.endItemsSold, value: count(summary.itemsSold) }] : []),
      ...(best
        ? [{ label: pack === "restaurant" ? tt.topItem : tt.endTopSold, value: best.name, note: fill(tt.timesOrdered, { count: count(best.quantity) }) }]
        : []),
      ...(hasAverage ? [{ label: tt.averageBasket, value: plain(summary.average) }] : []),
      ...(facts.occupancy ? [{ label: tt.occupancy, value: `${facts.occupancy.percent} %`, note: fill(tt.occupancyNote, { sold: facts.occupancy.sold, total: facts.occupancy.roomNights }) }] : []),
    ]);

    /* ── How it was paid ───────────────────────────────────────────────── */

    add(
      [
        { label: t.payCash, value: plain(summary.byPayment.cash) },
        ...summary.byApp.map((row) => ({ label: row.app || t.payMobile, value: plain(row.total) })),
        ...(summary.byPayment.credit !== 0 ? [{ label: tt.onAccounts, value: plain(summary.byPayment.credit) }] : []),
        ...summary.byFund.map((row) => ({ label: row.payer === "cnam" ? t.fundCnam : row.payer === "cnass" ? t.fundCnass : t.fundOther, value: plain(row.total) })),
      ],
      tt.paymentDetails
    );
  }

  /* ── What only this trade counts ───────────────────────────────────── */

  if (pack === "restaurant") {
    const serviceName = (service: string) => (service === "dine_in" ? tt.dineIn : service === "takeaway" ? tt.takeawayShort : tt.deliveryShort);
    add((facts.services ?? []).map((row) => ({ label: `${serviceName(row.service)} (${row.count})`, value: plain(row.total) })), tt.byService);
  }

  if (pack === "wash" && facts.wash) {
    const { wash } = facts;
    add(
      [
        ...(wash.cars > 0 ? [{ label: tt.washCars, value: count(wash.cars) }] : []),
        ...(wash.upholstery > 0 ? [{ label: tt.washPieces, value: count(wash.upholstery) }] : []),
      ],
      tt.endWashes
    );
    if (configuration.features.wash?.washers !== false) {
      add(
        wash.byWasher.map((row) => ({ label: row.washer ?? tt.washNoWasher, value: plain(row.amount), note: `${tt.washReportJobs} ${count(row.jobs)}` })),
        tt.washByWasher
      );
    }
  }

  if (pack === "transport") {
    /*
     * How many, not how much: a route's figure counts a parcel when it is
     * registered, even one the receiver will pay on arrival, so it would not
     * add up to the takings at the top of this same report.
     */
    add(
      (facts.routes ?? []).map((row) => ({
        label: row.route,
        value: `${tt.tickets} ${count(row.tickets)} · ${tt.parcelsTitle} ${count(row.parcels)}`,
      })),
      tt.byRoute
    );
  }

  if (pack === "bakery") {
    const baked = facts.baked ?? [];
    const sum = (pick: (row: { produced: number; sold: number; lost: number }) => number) => baked.reduce((total, row) => total + pick(row), 0);
    const produced = sum((row) => row.produced);
    const lost = sum((row) => row.lost);
    add(
      [
        ...(produced > 0 ? [{ label: tt.produced, value: count(produced) }] : []),
        ...(lost > 0 ? [{ label: tt.lost, value: count(lost) }] : []),
      ],
      tt.endProduction
    );
  }

  if (pack === "warehouse") {
    const sum = (pick: (row: (typeof flows)[number]) => number) => flows.reduce((total, row) => total + pick(row), 0);
    const totals: [string, number][] = [
      [tt.colIn, sum((row) => row.received)],
      [tt.colOut, sum((row) => row.sent)],
      [tt.colSold, sum((row) => row.sold)],
      [tt.colAdjusted, sum((row) => row.adjusted)],
    ];
    add(totals.filter(([, value]) => value !== 0).map(([label, value]) => ({ label, value: count(value) })), tt.flowsTitle);
    add(
      flows
        .filter((row) => row.received + row.sent + row.sold !== 0)
        .map((row) => ({
          label: row.name,
          value: count(row.received + row.sent + row.sold),
          note: [
            row.received ? `${tt.colIn} ${count(row.received)}` : "",
            row.sent ? `${tt.colOut} ${count(row.sent)}` : "",
            row.sold ? `${tt.colSold} ${count(row.sold)}` : "",
          ]
            .filter(Boolean)
            .join(" · "),
        })),
      tt.endByProduct
    );
  }

  /* ── What else moved ───────────────────────────────────────────────── */

  const debts = summary.debtPayments.cash + summary.debtPayments.mobile;
  add(
    [
      ...(summary.discounts > 0 ? [{ label: t.discount, value: plain(summary.discounts) }] : []),
      ...(summary.voids.count > 0 ? [{ label: t.voids, value: plain(summary.voids.total), note: fill(tt.endVoidsNote, { count: count(summary.voids.count) }) }] : []),
      ...(debts !== 0 ? [{ label: t.debtPayments, value: plain(debts) }] : []),
      ...(summary.expenses.total !== 0 ? [{ label: tt.endExpenses, value: plain(summary.expenses.total) }] : []),
    ],
    tt.endOtherMoves
  );

  /* ── Where the drawer stands ───────────────────────────────────────── */

  if (facts.cash) {
    const { cash } = facts;
    add(
      cash.closedAt === null
        ? [
            { label: t.openingFloat, value: plain(cash.openingFloat) },
            { label: t.expected, value: plain(cash.expected) },
          ]
        : [
            { label: t.colExpected, value: plain(cash.expected) },
            ...(cash.counted !== null ? [{ label: t.colCounted, value: plain(cash.counted) }] : []),
            ...(cash.difference !== null ? [{ label: t.colDifference, value: plain(cash.difference) }] : []),
          ],
      tt.endTill
    );
  }

  return {
    title: tt.endTitle,
    date: dayDate(language, now),
    totalLabel: movesOnly ? tt.endMovedTotal : tt.revenue,
    total: movesOnly ? count(moved) : plain(summary.net),
    sections,
  };
}
