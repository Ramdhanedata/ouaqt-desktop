import type { AppLanguage, Configuration, InsurancePayer } from "@app-ui/config";
import { formatDateTime, formatMoney, formatPercent, formatQuantity } from "@app-ui/format";
import type { PeriodTotal, PrintedDay, Summary, TopProduct } from "./bridge";
import { fill, type ScreensCopy } from "./i18n/screens";
import type { StatisticsCopy } from "./i18n/statistics";
import { changeOf, dayKey, startOf, type Unit } from "./periods";

/*
 * The week's or the month's report, as a page: what it came to, day by day
 * with the dates, how it was paid, what sold best, and against the period
 * before. The same page prints, saves as a PDF and is shared, and its words
 * go with it as plain text for a message.
 *
 * Built from the very figures on the screen, so the paper and the screen can
 * never disagree.
 */

export type ReportInput = {
  configuration: Configuration;
  t: ScreensCopy;
  st: StatisticsCopy;
  unit: Unit;
  /** The name of the period and its dates, as the screen shows them. */
  label: string;
  dates: string;
  summary: Summary;
  before: { net: number; soFar: boolean } | null;
  /** The period's days, oldest first; for a day, the days up to it. */
  days: PeriodTotal[];
  top: TopProduct[];
  showMargin: boolean;
  now?: Date;
};

/* Plain text, without the direction marks the screen adds: the page and the message lay out their own lines. */
const money = (minor: number, language: AppLanguage) => formatMoney(minor, language);
function day(date: string | null, language: AppLanguage): string {
  if (!date) return "";
  const [year, month, dayOfMonth] = date.split("-");
  return language === "en" ? date : `${dayOfMonth}/${month}/${year}`;
}
const fundName = (payer: InsurancePayer, t: ScreensCopy) => (payer === "cnam" ? t.fundCnam : payer === "cnass" ? t.fundCnass : t.fundOther);

function weekday(date: Date, language: AppLanguage): string {
  return new Intl.DateTimeFormat(language === "ar" ? "ar-u-nu-latn" : language === "en" ? "en-GB" : "fr-FR", { weekday: "long" }).format(date);
}

export function buildReport(input: ReportInput): PrintedDay {
  const { configuration, t, st, unit, summary, before, days, top } = input;
  const language = configuration.language.app;
  const now = input.now ?? new Date();
  const m = (minor: number) => money(minor, language);
  const title = unit === "day" ? st.reportDay : unit === "week" ? st.reportWeek : st.reportMonth;
  const sections: PrintedDay["sections"] = [];

  /* Only the days that have begun: a month still running is not divided by days to come. */
  const elapsed = unit === "day" ? [] : days.filter((one) => new Date(one.from).getTime() <= now.getTime());
  const best = elapsed.reduce<PeriodTotal | null>((top, one) => (one.net > (top?.net ?? 0) ? one : top), null);

  const overview: PrintedDay["sections"][number]["rows"] = [{ label: st.reportSalesCount, value: String(summary.count) }];
  if (summary.itemsSold > 0) overview.push({ label: st.reportItems, value: formatQuantity(summary.itemsSold, language) });
  if (elapsed.length > 1) overview.push({ label: st.reportAverageDay, value: m(Math.round(summary.net / elapsed.length)) });
  if (best) {
    const date = new Date(best.from);
    overview.push({ label: st.reportBestDay, value: m(best.net), note: `${weekday(date, language)} ${day(dayKey(date), language)}` });
  }
  if (before) {
    const change = changeOf(summary.net, before.net);
    overview.push({
      label: st.reportBefore,
      value: m(before.net),
      note: change === null ? undefined : `${change > 0 ? "+" : ""}${formatPercent(change, language)}`,
    });
  }
  if (summary.imported.count > 0) overview.push({ label: st.reportImported, value: m(summary.imported.total), note: fill(st.reportSalesNote, { count: summary.imported.count }) });
  if (input.showMargin && summary.margin.amount !== 0) overview.push({ label: st.reportMargin, value: m(summary.margin.amount) });
  if (summary.expenses.total > 0) {
    overview.push({ label: st.reportExpenses, value: m(summary.expenses.total) });
    overview.push({ label: st.reportProfit, value: m(summary.net - summary.expenses.total) });
  }
  sections.push({ rows: overview });

  if (elapsed.length > 0) {
    sections.push({
      heading: st.reportByDay,
      rows: elapsed.map((one) => {
        const date = new Date(one.from);
        return {
          label: `${weekday(date, language)} ${day(dayKey(date), language)}`,
          value: one.net === 0 && one.count === 0 ? "—" : m(one.net),
          note: one.count > 0 ? fill(st.reportSalesNote, { count: one.count }) : undefined,
        };
      }),
    });
  }

  if (unit === "month" && elapsed.length > 0) {
    const weeks = new Map<string, { first: Date; last: Date; net: number; count: number }>();
    for (const one of elapsed) {
      const start = startOf("week", new Date(one.from));
      const key = dayKey(start);
      /* Named by its own days inside the month: a week begun in the month before starts on the 1st here. */
      const week = weeks.get(key) ?? { first: new Date(one.from), last: new Date(one.from), net: 0, count: 0 };
      week.last = new Date(one.from);
      week.net += one.net;
      week.count += one.count;
      weeks.set(key, week);
    }
    sections.push({
      heading: st.reportByWeek,
      rows: [...weeks.values()].map((week) => ({
        label: fill(st.reportWeekOf, { from: day(dayKey(week.first), language), to: day(dayKey(week.last), language) }),
        value: m(week.net),
        note: week.count > 0 ? fill(st.reportSalesNote, { count: week.count }) : undefined,
      })),
    });
  }

  const payments: PrintedDay["sections"][number]["rows"] = [];
  if (summary.byPayment.cash !== 0) payments.push({ label: t.payCash, value: m(summary.byPayment.cash) });
  if (summary.byPayment.mobile !== 0) payments.push({ label: t.payMobile, value: m(summary.byPayment.mobile) });
  for (const app of summary.byApp) payments.push({ label: `· ${app.app || t.otherApp}`, value: m(app.total) });
  if (summary.byPayment.credit !== 0) payments.push({ label: t.payCredit, value: m(summary.byPayment.credit) });
  if (summary.byPayment.insurance !== 0) payments.push({ label: t.payInsurance, value: m(summary.byPayment.insurance) });
  for (const fund of summary.byFund) payments.push({ label: `· ${fundName(fund.payer as InsurancePayer, t)}`, value: m(fund.total) });
  if (payments.length > 0) sections.push({ heading: st.reportByPayment, rows: payments });

  if (top.length > 0) {
    sections.push({
      heading: st.reportTop,
      rows: top.map((product) => ({ label: `${product.name} × ${formatQuantity(product.quantity, language)}`, value: m(product.total) })),
    });
  }

  if (summary.expenses.byCategory.length > 0) {
    sections.push({
      heading: st.reportExpenses,
      rows: summary.expenses.byCategory.map((row) => ({ label: row.category || t.noCategory, value: m(row.total) })),
    });
  }

  sections.push({ rows: [{ label: st.reportMade, value: formatDateTime(now, language) }] });

  return { title, date: input.dates, totalLabel: st.reportTotal, total: m(summary.net), sections };
}

/* The same report as words, for a message beside the file. */
export function reportText(report: PrintedDay, shopName: string): string {
  const lines = [shopName, report.title, report.date, "", `${report.totalLabel} : ${report.total}`];
  for (const section of report.sections) {
    lines.push("");
    if (section.heading) lines.push(`${section.heading}`);
    for (const row of section.rows) lines.push(`${row.label} : ${row.value}${row.note ? ` (${row.note})` : ""}`);
  }
  return lines.join("\n");
}
