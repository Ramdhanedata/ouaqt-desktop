import { useCallback, useEffect, useMemo, useState } from "react";
import { coverPayers, type AppLanguage, type Configuration, type InsurancePayer } from "@app-ui/config";
import { formatDateTime, formatMoney, formatPercent, formatQuantity } from "@app-ui/format";
import { auditName } from "../i18n/audit";
import { ReceiptView } from "../receipt";
import { productProfile } from "../i18n/products";
import { machine, type WashReport, type AuditRow, type Claim, type PastExpirySale, type Period, type PeriodTotal, type PrintedTable, type SaleDetail, type SaleSummary, type Summary, type TopProduct } from "../bridge";
import { fundName } from "../cover";
import { fill, type ScreensCopy } from "../i18n/screens";
import type { TradesCopy } from "../i18n/trades";
import { Flows } from "./warehouse";
import { Button, Choices, Confirm, DayChart, Empty, Field, Notice, Panel, ScreenHeader, Stat, day, money, when, useDataTick } from "../ui";
import { icons } from "../icons";
import { changeOf, dayKey, fromDayKey, periodAt, previousOf, shift, startOf, startOfDay, type Unit } from "../periods";

/*
 * What the days came to.
 *
 * Kept from the old pharmacy till: the takings, the count and the average,
 * voids set apart, every sale in a list with its receipt and its void, and an
 * export for the accountant. Every figure is added up from the sales
 * themselves each time the screen opens, so the cards and the list under them
 * can never disagree.
 *
 * Any day, week or month can be opened, back to the first sale: arrows step
 * through them, a date jumps to one, and each is read against the one before.
 * Below, the history sets the days, weeks or months side by side.
 */

type Range = "today" | "yesterday" | "week" | "month" | "lastMonth";

export function periodOf(range: Range, now = new Date()): Period {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  switch (range) {
    case "yesterday":
      return { from: addDays(start, -1).toISOString(), to: start.toISOString() };
    case "week":
      return { from: addDays(start, -6).toISOString(), to: addDays(start, 1).toISOString() };
    case "month":
      return {
        from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
        to: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString(),
      };
    case "lastMonth":
      return {
        from: new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString(),
        to: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
      };
    default:
      return { from: start.toISOString(), to: addDays(start, 1).toISOString() };
  }
}

/* How a day, week or month is called on the screen: by name when it is this one or the last, by its date otherwise. */
export function periodLabel(unit: Unit, start: Date, t: ScreensCopy, language: AppLanguage, now = new Date()): string {
  const current = startOf(unit, now);
  const same = (a: Date, b: Date) => a.getTime() === b.getTime();
  if (unit === "day") {
    if (same(start, current)) return t.today;
    if (same(start, shift("day", current, -1))) return t.yesterday;
    return `${weekdayName(start, language)} ${day(dayKey(start), language)}`;
  }
  if (unit === "week") {
    if (same(start, current)) return t.thisWeek;
    if (same(start, shift("week", current, -1))) return t.lastWeek;
    return fill(t.weekOf, { date: day(dayKey(start), language) });
  }
  if (same(start, current)) return t.month;
  if (same(start, shift("month", current, -1))) return t.lastMonth;
  return monthName(start, language);
}

function weekdayName(date: Date, language: AppLanguage): string {
  return new Intl.DateTimeFormat(language === "ar" ? "ar-u-nu-latn" : language === "en" ? "en-GB" : "fr-FR", { weekday: "short" }).format(date);
}

function monthName(date: Date, language: AppLanguage, short = false): string {
  return new Intl.DateTimeFormat(language === "ar" ? "ar-u-nu-latn" : language === "en" ? "en-GB" : "fr-FR", short ? { month: "short" } : { month: "long", year: "numeric" }).format(date);
}

/* The dates a period covers, under its name: the day itself, a week's first and last day, a month and its year. */
function periodDates(unit: Unit, start: Date, language: AppLanguage): string {
  if (unit === "day") {
    return `${new Intl.DateTimeFormat(language === "ar" ? "ar-u-nu-latn" : language === "en" ? "en-GB" : "fr-FR", { weekday: "long" }).format(start)} ${day(dayKey(start), language)}`;
  }
  if (unit === "week") return `${day(dayKey(start), language)} – ${day(dayKey(shift("day", start, 6)), language)}`;
  return monthName(start, language);
}

/* A change in percent, with its sign, as the language writes a percent; kept left to right inside an Arabic sentence. */
function changeText(change: number | null, language: AppLanguage): string {
  if (change === null) return "—";
  const text = `${change > 0 ? "+" : ""}${formatPercent(change, language)}`;
  return language === "ar" ? `\u2066${text}\u2069` : text;
}

export function Reports({
  configuration,
  t,
  tt,
  readOnly,
  showTrialSummary,
}: {
  configuration: Configuration;
  t: ScreensCopy;
  tt: TradesCopy;
  readOnly: boolean;
  showTrialSummary: boolean;
}) {
  const language = configuration.language.app;
  /* A day, a week or a month, and the date it holds: today until the owner moves. */
  const [unit, setUnit] = useState<Unit>("day");
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));
  const [summary, setSummary] = useState<Summary | null>(null);
  /* The period before, read the same way, for the comparison under the takings. */
  const [before, setBefore] = useState<{ net: number; soFar: boolean } | null>(null);
  /* The days of the period chosen, or the seven up to the day chosen, as bars. */
  const [week, setWeek] = useState<PeriodTotal[]>([]);
  const [top, setTop] = useState<TopProduct[]>([]);
  const [pastExpiry, setPastExpiry] = useState<PastExpirySale[]>([]);
  const [sales, setSales] = useState<SaleSummary[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [trial, setTrial] = useState<{ sales: number; creditCustomers: number; creditTotal: number; cashDifferences: number } | null>(null);

  const period = useMemo(() => periodAt(unit, anchor), [unit, anchor]);
  const start = useMemo(() => startOf(unit, anchor), [unit, anchor]);
  /* The period still running: nothing after it to step to. */
  const running = new Date(period.to).getTime() > Date.now();
  const label = periodLabel(unit, start, t, language);
  const dataTick = useDataTick();
  const [occupancy, setOccupancy] = useState<{ roomNights: number; sold: number; percent: number } | null>(null);
  const [wash, setWash] = useState<WashReport | null>(null);
  const [routes, setRoutes] = useState<{ route: string; tickets: number; ticketTotal: number; parcels: number; parcelTotal: number }[]>([]);
  useEffect(() => {
    if (configuration.pack === "hotel") {
      const day = (iso: string) => {
        const date = new Date(iso);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      };
      void machine.occupancy(day(period.from), day(period.to)).then((answer) => answer.ok && setOccupancy(answer.value));
    }
    if (configuration.pack === "wash") void machine.washReport(period.from, period.to).then((answer) => answer.ok && setWash(answer.value));
    if (configuration.pack === "transport") void machine.routeTakings(period.from, period.to).then((answer) => answer.ok && setRoutes(answer.value));
  }, [configuration.pack, period, dataTick]);

  const reload = useCallback(() => {
    void machine.reportSummary(period).then((answer) => answer.ok && setSummary(answer.value));
    const previous = previousOf(unit, period);
    void machine.reportSummary(previous.period).then((answer) => setBefore(answer.ok ? { net: answer.value.net, soFar: previous.soFar } : null));
    /* A day is shown with the six before it; a week or a month, day by day. */
    const lastDay = shift("day", new Date(period.to), -1);
    const bars = unit === "day" ? 7 : Math.round((new Date(period.to).getTime() - new Date(period.from).getTime()) / 86_400_000); // not-a-rule: a week, and a day in milliseconds
    void machine.periodTotals("day", bars, lastDay.toISOString()).then((answer) => answer.ok && setWeek(answer.value));
    void machine.reportTop(period).then((answer) => answer.ok && setTop(answer.value));
    void machine.reportPastExpiry(period).then((answer) => answer.ok && setPastExpiry(answer.value));
    void machine.salesBetween(period.from, period.to).then((answer) => answer.ok && setSales(answer.value));
  }, [period, unit]);

  useEffect(reload, [reload, dataTick]);
  useEffect(() => {
    if (showTrialSummary) void machine.trialSummary().then((answer) => answer.ok && setTrial(answer.value));
  }, [showTrialSummary]);

  const units: { value: Unit; label: string }[] = [
    { value: "day", label: t.unitDay },
    { value: "week", label: t.unitWeek },
    { value: "month", label: t.unitMonth },
  ];

  /* Moving never goes past today: there is nothing to read in tomorrow. */
  const step = (steps: number) => {
    const next = shift(unit, start, steps);
    setAnchor(next.getTime() > Date.now() ? startOfDay(new Date()) : next);
  };
  const openPeriod = (nextUnit: Unit, date: Date) => {
    setUnit(nextUnit);
    setAnchor(startOfDay(date));
  };

  async function exportCsv() {
    const answer = await machine.reportExport(period, `OUAQT-ventes-${unit}-${dayKey(start)}.csv`);
    if (answer.ok && answer.value) setNote(fill(t.exported, { file: answer.value }));
  }

  const change = summary && before ? changeOf(summary.net, before.net) : null;
  const comparison =
    summary && before
      ? `${fill(
          before.soFar
            ? { day: t.vsDayNow, week: t.vsWeekNow, month: t.vsMonthNow }[unit]
            : { day: t.vsDay, week: t.vsWeek, month: t.vsMonth }[unit],
          { amount: money(before.net, language) }
        )}${change === null ? "" : ` (${changeText(change, language)})`}`
      : undefined;

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={t.reportsTitle}>
        <Button onClick={() => void exportCsv()}>{t.export}</Button>
      </ScreenHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {showTrialSummary && trial ? (
          <div className="mb-5 rounded-lg bg-ink p-5 text-on-ink">
            <div className="text-lg font-semibold">{t.trialSummaryTitle}</div>
            <p className="mt-2 text-base leading-relaxed">
              {fill(t.trialSummaryBody, {
                sales: trial.sales,
                customers: trial.creditCustomers,
                credit: money(trial.creditTotal, language),
                differences: trial.cashDifferences,
              })}
            </p>
          </div>
        ) : null}

        <Choices<Unit> value={unit} onChange={(next) => setUnit(next)} options={units} />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => step(-1)}
              title={t.earlier}
              aria-label={t.earlier}
              className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg border-2 border-line-strong bg-surface active:bg-hover"
            >
              <icons.back className="rtl:-scale-x-100" />
            </button>
            <div className="min-w-[11rem] px-1 max-md:min-w-0">
              <div className="text-xl font-semibold">{label}</div>
              <div className="text-base text-ink-3">{periodDates(unit, start, language)}</div>
            </div>
            <button
              type="button"
              onClick={() => step(1)}
              disabled={running}
              title={t.later}
              aria-label={t.later}
              className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg border-2 border-line-strong bg-surface active:bg-hover disabled:opacity-30"
            >
              <icons.back className="-scale-x-100 rtl:scale-x-100" />
            </button>
          </div>
          <input
            type="date"
            aria-label={t.goToDay}
            title={t.goToDay}
            dir="ltr"
            max={dayKey(new Date())}
            value={dayKey(anchor)}
            onChange={(event) => {
              const picked = fromDayKey(event.target.value);
              if (picked && picked.getTime() <= Date.now()) setAnchor(picked);
            }}
            className="min-h-[48px] rounded-lg border-2 border-line-strong bg-surface px-3 text-base text-ink outline-none focus:border-ink"
          />
          {running && unit === "day" ? null : (
            <Button kind="quiet" onClick={() => openPeriod("day", new Date())}>
              {t.backToNow}
            </Button>
          )}
        </div>
        {note ? <div className="mt-4"><Notice kind="done" text={note} /></div> : null}

        {summary ? (
          <>
            <div className="mt-5 grid grid-cols-4 max-md:grid-cols-2 gap-3">
              <Stat label={t.net} value={money(summary.net, language)} note={comparison ?? t.netNote} strong />
              <Stat label={t.salesCount} value={String(summary.count)} />
              <Stat label={t.average} value={money(summary.average, language)} />
              <Stat
                label={t.voids}
                value={String(summary.voids.count)}
                note={summary.voids.count > 0 ? fill(t.voidsNote, { count: summary.voids.count, amount: money(-summary.voids.total, language) }) : undefined}
              />
              {configuration.common.discounts || summary.discounts > 0 ? (
                <Stat label={t.discounts} value={money(summary.discounts, language)} />
              ) : null}
              {/* Margin needs a purchase price: shown where the trade records one, and plainly. */}
              {productProfile(configuration).cost !== "" ? (
                <Stat
                  label={t.margin}
                  value={money(summary.margin.amount, language)}
                  note={summary.margin.uncoveredLines > 0 ? fill(t.marginMissing, { count: summary.margin.uncoveredLines }) : undefined}
                />
              ) : null}
              <Stat
                label={t.cashDifferences}
                value={String(summary.cashDifferences.count)}
                note={
                  summary.cashDifferences.count > 0
                    ? fill(t.cashDifferencesNote, { count: summary.cashDifferences.count, amount: money(summary.cashDifferences.total, language) })
                    : undefined
                }
              />
              {configuration.common.credit.enabled ? (
                <Stat label={t.owedNow} value={money(summary.owed.total, language)} note={fill(t.owedNote, { count: summary.owed.customers })} />
              ) : null}
              {summary.expenses.total > 0 ? <Stat label={tt.expensesReport} value={money(summary.expenses.total, language)} /> : null}
              {summary.expenses.total > 0 ? <Stat label={tt.profit} value={money(summary.net - summary.expenses.total, language)} strong /> : null}
              {occupancy ? (
                <Stat
                  label={tt.occupancy}
                  value={`${occupancy.percent} %`}
                  note={fill(tt.occupancyNote, { sold: occupancy.sold, total: occupancy.roomNights })}
                />
              ) : null}
            </div>

            {week.length > 0 ? (
              <section className="mt-6">
                <h2 className="text-xl font-semibold">
                  {unit !== "day" ? t.dayByDay : running ? t.lastSeven : fill(t.sevenUntil, { date: day(dayKey(start), language) })}
                </h2>
                <div className="mt-3">
                  <DayChart
                    days={week.map((one) => ({ day: one.start, net: one.net }))}
                    language={language}
                    todayLabel={t.today}
                    highlight={unit === "day" ? dayKey(start) : dayKey(new Date())}
                    onPick={(index) => openPeriod("day", new Date(week[index].from))}
                  />
                </div>
              </section>
            ) : null}

            {wash ? (
              <section className="mt-6 rounded-xl border-2 border-line bg-surface p-5">
                <h2 className="text-lg font-semibold">{tt.washReportTitle}</h2>
                <div className="mt-3 grid grid-cols-4 gap-3 max-md:grid-cols-2">
                  <div><div className="text-base text-ink-3">{tt.washReportJobs}</div><div className="text-xl font-bold"><bdi>{wash.jobs}</bdi></div></div>
                  <div><div className="text-base text-ink-3">{tt.washReportAmount}</div><div className="text-xl font-bold"><bdi>{money(wash.amount, language)}</bdi></div></div>
                  <div><div className="text-base text-ink-3">{tt.washCars}</div><div className="text-xl font-bold"><bdi>{wash.cars}</bdi></div></div>
                  <div><div className="text-base text-ink-3">{tt.washPieces}</div><div className="text-xl font-bold"><bdi>{wash.upholstery}</bdi></div></div>
                </div>
                {configuration.features.wash?.washers !== false && wash.byWasher.length > 0 ? (
                  <>
                    <h3 className="mt-5 text-base font-semibold">{tt.washByWasher}</h3>
                    <ul className="mt-1">
                      {wash.byWasher.map((row) => (
                        <li key={row.washer ?? ""} className="flex items-baseline justify-between gap-3 border-b border-line py-2 text-base last:border-b-0">
                          <span className="min-w-0">{row.washer ?? tt.washNoWasher}</span>
                          <span className="shrink-0 text-ink-3"><bdi>{row.jobs}</bdi></span>
                          <bdi className="shrink-0 font-semibold">{money(row.amount, language)}</bdi>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </section>
            ) : null}
            {routes.length > 0 ? (
              <section className="mt-6">
                <h2 className="text-xl font-semibold">{tt.byRoute}</h2>
                <div className="max-md:-mx-4 max-md:overflow-x-auto max-md:px-4">
                  <table className="mt-3 w-full text-base max-md:w-max max-md:min-w-full max-md:[&_td]:pe-4 max-md:[&_th]:pe-4">
                    <thead>
                      <tr className="border-b-2 border-line text-ink-3">
                        <th className="py-2 text-start font-normal">{tt.route}</th>
                        <th className="py-2 text-end font-normal">{tt.tickets}</th>
                        <th className="py-2 text-end font-normal">{tt.parcelsTitle}</th>
                        <th className="py-2 text-end font-normal">{t.total}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {routes.map((row) => (
                        <tr key={row.route} className="border-b border-line">
                          <td className="py-2">{row.route}</td>
                          <td className="py-2 text-end"><bdi>{row.tickets}</bdi> · <bdi>{money(row.ticketTotal, language)}</bdi></td>
                          <td className="py-2 text-end"><bdi>{row.parcels}</bdi> · <bdi>{money(row.parcelTotal, language)}</bdi></td>
                          <td className="py-2 text-end font-semibold"><bdi>{money(row.ticketTotal + row.parcelTotal, language)}</bdi></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            {summary.expenses.byCategory.length > 0 ? (
              <section className="mt-6">
                <h2 className="text-xl font-semibold">{tt.expensesReport}</h2>
                <dl className="mt-3 max-w-xl text-base">
                  {summary.expenses.byCategory.map((row) => (
                    <Row key={row.category} label={row.category || t.noCategory} value={money(row.total, language)} />
                  ))}
                </dl>
              </section>
            ) : null}

            <div className="mt-6 grid grid-cols-2 gap-6 max-md:grid-cols-1">
              <section>
                <h2 className="text-xl font-semibold">{t.byPayment}</h2>
                <dl className="mt-3 text-base">
                  <Row label={t.payCash} value={money(summary.byPayment.cash, language)} />
                  <Row label={t.payMobile} value={money(summary.byPayment.mobile, language)} />
                  {summary.byApp.map((app) => (
                    <Row key={app.app} label={`· ${app.app || t.otherApp}`} value={money(app.total, language)} quiet />
                  ))}
                  {configuration.common.credit.enabled ? <Row label={t.payCredit} value={money(summary.byPayment.credit, language)} /> : null}
                  {coverPayers(configuration).length > 0 || summary.byPayment.insurance !== 0 ? (
                    <Row label={t.payInsurance} value={money(summary.byPayment.insurance, language)} />
                  ) : null}
                  {summary.byFund.map((fund) => (
                    <Row key={`fund-${fund.payer}`} label={`· ${fundName(fund.payer as InsurancePayer, t)}`} value={money(fund.total, language)} quiet />
                  ))}
                  {configuration.common.credit.enabled ? (
                    <Row label={t.debtPayments} value={money(summary.debtPayments.cash + summary.debtPayments.mobile, language)} />
                  ) : null}
                  {configuration.common.credit.enabled
                    ? summary.debtByApp.map((app) => (
                        <Row key={`debt-${app.app}`} label={`· ${app.app || t.otherApp}`} value={money(app.total, language)} quiet />
                      ))
                    : null}
                </dl>
              </section>
              <section>
                <h2 className="text-xl font-semibold">{t.top}</h2>
                {top.length === 0 ? (
                  <p className="mt-3 text-base text-ink-3">{t.noSales}</p>
                ) : (
                  <div className="max-md:-mx-4 max-md:overflow-x-auto max-md:px-4">
                    <table className="mt-3 w-full text-base max-md:w-max max-md:min-w-full max-md:[&_td]:pe-4 max-md:[&_th]:pe-4">
                      <thead>
                        <tr className="border-b-2 border-line text-ink-3">
                          <th className="py-2 text-start font-normal">{t.colName}</th>
                          <th className="py-2 text-end font-normal">{t.colQuantity}</th>
                          <th className="py-2 text-end font-normal">{t.colAmount}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {top.map((product) => (
                          <tr key={product.productId} className="border-b border-line">
                            <td className="py-2">{product.name}</td>
                            <td className="py-2 text-end"><bdi>{formatQuantity(product.quantity, language)}</bdi></td>
                            <td className="py-2 text-end"><bdi>{money(product.total, language)}</bdi></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          </>
        ) : null}

        {configuration.pack === "warehouse" ? <Flows configuration={configuration} t={t} tt={tt} /> : null}

        {coverPayers(configuration).length > 0 ? (
          <Claims payers={coverPayers(configuration)} period={period} rangeLabel={label} t={t} language={language} />
        ) : null}

        {/* Medicines sold past their date after the warning: shown whenever there are any. */}
        {pastExpiry.length > 0 ? (
          <section className="mt-8">
            <h2 className="text-xl font-semibold">{t.pastExpiryReport}</h2>
            <ul className="mt-3 space-y-1">
              {pastExpiry.map((item, index) => (
                <li key={index} className="border-b border-line py-2 text-base">
                  {fill(t.pastExpiryReportLine, {
                    number: item.saleNumber,
                    name: item.name,
                    quantity: formatQuantity(item.quantity, language),
                    date: item.expiresOn ? day(item.expiresOn, language) : "",
                  })}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <History unit={unit} selected={period} t={t} language={language} onOpen={openPeriod} />

        <Journal period={period} t={t} language={language} />

        <h2 className="mt-8 text-xl font-semibold">{t.salesList}</h2>
        {sales.length === 0 ? (
          <Empty title={t.noSales} />
        ) : (
          <div className="max-md:-mx-4 max-md:overflow-x-auto max-md:px-4">
            <table className="mt-3 w-full text-base max-md:w-max max-md:min-w-full max-md:[&_td]:pe-4 max-md:[&_th]:pe-4">
              <thead>
                <tr className="border-b-2 border-line text-ink-3">
                  <th className="py-2 text-start font-normal">{t.colNumber}</th>
                  <th className="py-2 text-start font-normal">{t.colTime}</th>
                  <th className="py-2 text-start font-normal">{t.colPayment}</th>
                  <th className="py-2 text-end font-normal">{t.total}</th>
                  <th className="py-2 text-end font-normal">
                    <span className="sr-only">{t.receipt}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sales.map((sale) => (
                  <tr key={sale.id} onClick={() => setOpen(sale.id)} className="cursor-pointer border-b border-line hover:bg-hover">
                    <td className="py-3"><bdi>{sale.number}</bdi></td>
                    <td className="py-3"><bdi>{when(sale.occurredAt, language)}</bdi></td>
                    <td className="py-3">
                      {paymentLabel(sale, t)}
                      {sale.status === "voided" ? <span className="ms-2 font-semibold">· {t.voidedTag}</span> : null}
                      {sale.reversesNumber !== null ? <span className="ms-2 font-semibold">· {fill(t.reversalTag, { number: sale.reversesNumber })}</span> : null}
                    </td>
                    <td className={`py-3 text-end ${sale.status === "voided" ? "line-through opacity-60" : "font-semibold"}`}>
                      <bdi>{money(sale.total, language)}</bdi>
                    </td>
                    {/* The receipt straight away; the rest of the row opens the sale itself. */}
                    <td className="py-1.5 ps-3 text-end" onClick={(event) => event.stopPropagation()}>
                      <Button onClick={() => setReceipt(sale.id)}>{t.receipt}</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {open ? (
        <SalePanel id={open} t={t} language={language} readOnly={readOnly} onClose={() => setOpen(null)} onChanged={reload} onReceipt={setReceipt} voidReasons={productProfile(configuration).voidReasons} />
      ) : null}
      {receipt ? <ReceiptView saleId={receipt} t={t} onClose={() => setReceipt(null)} /> : null}
    </div>
  );
}

/*
 * The shop's days, weeks or months side by side, newest first: what each came
 * to, how many sales, and how it moved against the one before. Every day
 * stays recorded whatever happened to the drawer, so this reaches back to the
 * first sale, a page at a time. Touching a row opens it above.
 */
const HISTORY_PAGE: Record<Unit, number> = { day: 14, week: 12, month: 12 }; // not-a-rule: two weeks, a quarter of a year, a year

function History({
  unit,
  selected,
  t,
  language,
  onOpen,
}: {
  unit: Unit;
  selected: Period;
  t: ScreensCopy;
  language: AppLanguage;
  onOpen: (unit: Unit, date: Date) => void;
}) {
  /* Follows the period chosen above, and can be switched on its own. */
  const [by, setBy] = useState<Unit>(unit);
  const [count, setCount] = useState(HISTORY_PAGE[unit]);
  const [rows, setRows] = useState<PeriodTotal[]>([]);
  const [first, setFirst] = useState<string | null>(null);
  const dataTick = useDataTick();
  useEffect(() => {
    setBy(unit);
    setCount(HISTORY_PAGE[unit]);
  }, [unit]);
  useEffect(() => {
    void machine.periodTotals(by, count).then((answer) => answer.ok && setRows(answer.value));
    void machine.firstSaleDay().then((answer) => answer.ok && setFirst(answer.value));
  }, [by, count, dataTick]);

  const startOfRow = (row: PeriodTotal) => fromDayKey(row.start) ?? new Date(row.from);
  /* Older pages only while there are older sales to show. */
  const more = first !== null && rows.length > 0 && first < rows[0].start && count < 400; // not-a-rule: the reports' own limit
  const newestFirst = rows.map((row, index) => ({ row, previous: index > 0 ? rows[index - 1] : null })).reverse();
  const short = (row: PeriodTotal) =>
    by === "month" ? monthName(startOfRow(row), language, true) : by === "week" ? `${row.start.slice(8, 10)}/${row.start.slice(5, 7)}` : undefined;

  return (
    <section className="mt-8">
      <h2 className="text-xl font-semibold">{t.historyTitle}</h2>
      <p className="mt-1 text-base text-ink-3">{t.historyNote}</p>
      <div className="mt-3">
        <Choices<Unit>
          value={by}
          onChange={(next) => {
            setBy(next);
            setCount(HISTORY_PAGE[next]);
          }}
          options={[
            { value: "day", label: t.byDay },
            { value: "week", label: t.byWeek },
            { value: "month", label: t.byMonth },
          ]}
        />
      </div>
      {rows.length > 0 ? (
        <div className="mt-3">
          <DayChart
            days={rows.map((row) => ({ day: row.start, net: row.net }))}
            language={language}
            todayLabel={t.today}
            labels={by === "day" ? undefined : rows.map((row) => short(row) ?? "")}
            highlight={rows.find((row) => row.from === selected.from && by === unit)?.start ?? rows[rows.length - 1].start}
            onPick={(index) => onOpen(by, startOfRow(rows[index]))}
          />
        </div>
      ) : null}
      <div className="max-md:-mx-4 max-md:overflow-x-auto max-md:px-4">
        <table className="mt-3 w-full max-w-4xl text-base max-md:w-max max-md:min-w-full max-md:[&_td]:pe-4 max-md:[&_th]:pe-4">
          <thead>
            <tr className="border-b-2 border-line text-ink-3">
              <th className="py-2 text-start font-normal">{t.colPeriod}</th>
              <th className="py-2 text-end font-normal">{t.salesCount}</th>
              <th className="py-2 text-end font-normal">{t.net}</th>
              {/* On a phone the change goes under the amount, so it is seen without scrolling sideways. */}
              <th className="py-2 text-end font-normal max-md:hidden">{t.colChange}</th>
            </tr>
          </thead>
          <tbody>
            {newestFirst.map(({ row, previous }) => {
              /* A period still running is not set against a whole one: its change waits until it is over. */
              const running = new Date(row.to).getTime() > Date.now();
              const change = previous && !running ? changeOf(row.net, previous.net) : null;
              const chosen = by === unit && row.from === selected.from;
              return (
                <tr
                  key={row.from}
                  onClick={() => onOpen(by, startOfRow(row))}
                  className={`cursor-pointer border-b border-line hover:bg-hover ${chosen ? "font-semibold" : ""}`}
                >
                  <td className="py-3">{periodLabel(by, startOfRow(row), t, language)}</td>
                  <td className="py-3 text-end"><bdi>{row.count}</bdi></td>
                  <td className="py-3 text-end">
                    <bdi className="font-semibold">{money(row.net, language)}</bdi>
                    {change !== null ? <div className="text-ink-3 md:hidden"><bdi>{changeText(change, language)}</bdi></div> : null}
                  </td>
                  <td className="py-3 text-end max-md:hidden"><bdi>{changeText(change, language)}</bdi></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {more ? (
        <div className="mt-3">
          <Button onClick={() => setCount((now) => Math.min(400, now + HISTORY_PAGE[by]))}>{t.showOlder}</Button>
        </div>
      ) : null}
    </section>
  );
}

/*
 * Everything done in the period that the log keeps, as the pharmacy app's
 * audit page showed it: when, what, the details, searched and filtered by
 * kind of action, to a spreadsheet or to paper like any list.
 */
function Journal({ period, t, language }: { period: Period; t: ScreensCopy; language: AppLanguage }) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [term, setTerm] = useState("");
  const [kind, setKind] = useState("");
  const [note, setNote] = useState<{ text: string; kind: "done" | "problem" } | null>(null);
  useEffect(() => {
    void machine.auditBetween(period.from, period.to).then((answer) => answer.ok && setRows(answer.value));
  }, [period.from, period.to]);

  const name = (row: AuditRow) => auditName(row.subject, row.action, language);
  const describe = (row: AuditRow) => {
    const detail = row.detail ?? {};
    const words: string[] = row.subjectName && !Object.values(detail).includes(row.subjectName) ? [row.subjectName] : [];
    for (const key of ["name", "label", "issue", "reason", "list", "lot", "payment", "app"]) {
      const value = detail[key];
      if (typeof value === "string" && value.trim()) words.push(value);
    }
    for (const key of ["added", "quantity", "values"]) {
      const value = detail[key];
      if (typeof value === "number") words.push(String(value));
    }
    return words.join(" · ");
  };
  const amountOf = (row: AuditRow) => (typeof row.detail?.amount === "number" ? formatMoney(row.detail.amount as number, language) : "");
  const kinds = [...new Set(rows.map((row) => `${row.subject}.${row.action}`))];
  const needle = term.trim().toLocaleLowerCase();
  const shown = rows.filter(
    (row) =>
      (!kind || `${row.subject}.${row.action}` === kind) &&
      (!needle || `${name(row)} ${describe(row)}`.toLocaleLowerCase().includes(needle))
  );
  const printable = (): PrintedTable => ({
    title: t.auditTitle,
    header: [t.colTime, t.auditWhat, t.auditDetail, t.colAmount],
    align: ["start", "start", "start", "end"],
    rows: shown.map((row) => [formatDateTime(new Date(row.at), language), name(row), describe(row), amountOf(row)]),
    totals: null,
  });
  const file = `${t.auditTitle}-${period.from.slice(0, 10)}`;

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{t.auditTitle}</h2>
        <div className="flex gap-2">
          <Button
            disabled={shown.length === 0}
            onClick={() =>
              void machine.exportList(printable(), file).then((answer) => {
                if (!answer.ok) setNote({ text: t.notSaved, kind: "problem" });
                else if (answer.value) setNote({ text: fill(t.listSaved, { file: answer.value }), kind: "done" });
              })
            }
          >
            {t.export}
          </Button>
          <Button disabled={shown.length === 0} onClick={() => void machine.printList(printable(), file).then((answer) => setNote(answer.ok ? null : { text: t.listPrintFailed, kind: "problem" }))}>
            {t.printList}
          </Button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={t.auditSearch}
          aria-label={t.auditSearch}
          className="min-h-[48px] min-w-[220px] flex-1 max-md:min-w-0 max-md:basis-full rounded-lg border-2 border-line-strong px-4 text-base outline-none focus:border-ink"
        />
        <select
          value={kind}
          aria-label={t.auditAll}
          onChange={(event) => setKind(event.target.value)}
          className="min-h-[48px] rounded-lg border-2 border-line-strong px-3 text-base outline-none focus:border-ink"
        >
          <option value="">{t.auditAll}</option>
          {kinds.map((one) => {
            const [subject, action] = one.split(".");
            return (
              <option key={one} value={one}>
                {auditName(subject, action, language)}
              </option>
            );
          })}
        </select>
      </div>
      {note ? (
        <div className="mt-3">
          <Notice kind={note.kind} text={note.text} />
        </div>
      ) : null}
      {shown.length === 0 ? (
        <p className="mt-3 text-base text-ink-3">{t.auditEmpty}</p>
      ) : (
        <div className="max-md:-mx-4 max-md:overflow-x-auto max-md:px-4">
          <table className="mt-3 w-full text-base max-md:w-max max-md:min-w-full max-md:[&_td]:pe-4 max-md:[&_th]:pe-4">
            <thead>
              <tr className="border-b-2 border-line text-ink-3">
                <th className="py-2 pe-3 text-start font-normal">{t.colTime}</th>
                <th className="py-2 pe-3 text-start font-normal">{t.auditWhat}</th>
                <th className="py-2 pe-3 text-start font-normal">{t.auditDetail}</th>
                <th className="py-2 text-end font-normal">{t.colAmount}</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 200).map((row) => (
                <tr key={row.id} className="border-b border-line">
                  <td className="py-2 pe-3 align-top text-ink-2">
                    <bdi>{when(row.at, language)}</bdi>
                  </td>
                  <td className={`py-2 pe-3 align-top font-semibold ${row.action === "voided" || row.action === "sold_past_expiry" || row.action === "cancelled" ? "text-danger" : ""}`}>
                    {name(row)}
                  </td>
                  <td className="py-2 pe-3 align-top text-ink-2">{describe(row)}</td>
                  <td className="py-2 text-end align-top">
                    <bdi>{amountOf(row)}</bdi>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Row({ label, value, quiet }: { label: string; value: string; quiet?: boolean }) {
  return (
    <div className={`flex justify-between border-b border-line py-2 ${quiet ? "text-ink-3" : ""}`}>
      <dt>{label}</dt>
      <dd>
        <bdi>{value}</bdi>
      </dd>
    </div>
  );
}

function paymentLabel(sale: SaleSummary, t: ScreensCopy): string {
  /* A fund's part is said after the customer's way of paying, so the list reads who paid what. */
  const fund = sale.coverPayer && sale.covered !== 0 ? ` · ${fundName(sale.coverPayer, t)}` : "";
  if (sale.payment === "mobile") return (sale.mobileApp ? `${t.payMobile} · ${sale.mobileApp}` : t.payMobile) + fund;
  if (sale.payment === "credit") return (sale.customerName ? `${t.payCredit} · ${sale.customerName}` : t.payCredit) + fund;
  return t.payCash + fund;
}

function SalePanel({
  id,
  t,
  language,
  readOnly,
  onClose,
  onChanged,
  onReceipt,
  voidReasons,
}: {
  id: string;
  t: ScreensCopy;
  language: AppLanguage;
  readOnly: boolean;
  onClose: () => void;
  onChanged: () => void;
  /* Its receipt, to see, download or print. */
  onReceipt: (id: string) => void;
  /* Why a sale of this trade is cancelled: no prescription outside a pharmacy. */
  voidReasons?: string;
}) {
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const [other, setOther] = useState("");
  const [note, setNote] = useState<{ text: string; kind: "done" | "problem" } | null>(null);

  const load = useCallback(() => {
    void machine.saleDetail(id).then((answer) => answer.ok && setSale(answer.value));
  }, [id]);
  useEffect(load, [load]);

  if (!sale) return null;
  const reasons = (voidReasons ?? t.voidReasons).split("|");
  const chosenReason = reason === "other" ? other.trim() : reason;
  const canVoid = sale.status === "recorded" && sale.reversesNumber === null;

  return (
    <Panel
      title={fill(t.saleTitle, { number: sale.number })}
      onClose={onClose}
      closeLabel={t.close}
      footer={
        <div className="flex justify-between gap-2">
          {canVoid ? (
            <Button kind="danger" disabled={readOnly} onClick={() => setVoiding(true)}>
              {t.voidSale}
            </Button>
          ) : (
            <span />
          )}
          <Button kind="primary" onClick={() => onReceipt(sale.id)}>
            {t.seeReceipt}
          </Button>
        </div>
      }
    >
      <p className="text-base text-ink-3">
        <bdi>{when(sale.occurredAt, language)}</bdi> · {paymentLabel(sale, t)}
        {sale.status === "voided" ? ` · ${t.voidedTag}` : ""}
        {sale.reversesNumber !== null ? ` · ${fill(t.reversalTag, { number: sale.reversesNumber })}` : ""}
      </p>
      {sale.voidReason ? <p className="mt-1 text-base">{t.voidReason} : {sale.voidReason}</p> : null}
      {note ? <div className="mt-4"><Notice kind={note.kind} text={note.text} /></div> : null}

      <ul className="mt-4">
        {sale.items.map((item, index) => (
          <li key={`${item.productId}-${index}`} className="flex items-start justify-between gap-3 border-b border-line py-3">
            <span>
              <span className="block text-base font-semibold">{language === "ar" && item.nameArabic ? item.nameArabic : item.name}</span>
              <span className="block text-base text-ink-3">
                <bdi>{formatQuantity(item.quantity, language)}</bdi> × <bdi>{money(item.unitPrice, language)}</bdi>
                {item.lot ? <> · {t.lot} <bdi>{item.lot}</bdi></> : null}
              </span>
            </span>
            <bdi className="text-base font-semibold">{money(item.lineTotal, language)}</bdi>
          </li>
        ))}
      </ul>

      <dl className="mt-4 text-base">
        {sale.discount > 0 ? <Row label={t.subtotal} value={money(sale.subtotal, language)} /> : null}
        {sale.discount > 0 ? <Row label={t.discount} value={`−${money(sale.discount, language)}`} /> : null}
        <div className="flex justify-between py-3 text-xl font-bold">
          <dt>{t.total}</dt>
          <dd><bdi>{money(sale.total, language)}</bdi></dd>
        </div>
        {sale.coverPayer && sale.covered !== 0 ? (
          <>
            <Row
              label={fill(t.coverPart, { fund: fundName(sale.coverPayer, t), share: sale.coverShare === null ? "" : formatPercent(sale.coverShare, language) })}
              value={`−${money(sale.covered, language)}`}
            />
            {sale.coverMember ? <Row label={t.memberNumber} value={sale.coverMember} /> : null}
            <Row label={t.toPay} value={money(sale.total - sale.prepaid - sale.covered, language)} />
          </>
        ) : null}
        {sale.received !== null ? <Row label={t.received} value={money(sale.received, language)} /> : null}
        {sale.received !== null ? <Row label={t.change} value={money(sale.received - (sale.total - sale.prepaid - sale.covered), language)} /> : null}
      </dl>

      {voiding ? (
        <Confirm
          title={fill(t.voidTitle, { number: sale.number })}
          body={t.voidBody}
          yes={t.voidSale}
          no={t.cancel}
          onNo={() => setVoiding(false)}
          onYes={() => {
            setVoiding(false);
            void machine.voidSale(sale.id, chosenReason).then((answer) => {
              if (answer.ok) {
                setNote({ text: t.voidDone, kind: "done" });
                load();
                onChanged();
              } else {
                setNote({ text: answer.reason === "read_only" ? t.readOnly : t.notSaved, kind: "problem" });
              }
            });
          }}
        >
          <div className="space-y-3">
            <div className="text-base text-ink-2">{t.voidReason}</div>
            <Choices<string>
              value={reason}
              onChange={setReason}
              options={[...reasons.map((one) => ({ value: one, label: one })), { value: "other", label: t.voidOther }]}
            />
            {reason === "other" ? <Field label={t.voidOther} value={other} onChange={setOther} autoFocus /> : null}
          </div>
        </Confirm>
      ) : null}
    </Panel>
  );
}

/*
 * What each health fund owes for the period, sale by sale: the statement a
 * pharmacy prints or sends to the fund at the end of the month. One fund at a
 * time, because each fund gets its own statement.
 */
function Claims({
  payers,
  period,
  rangeLabel,
  t,
  language,
}: {
  payers: InsurancePayer[];
  period: Period;
  rangeLabel: string;
  t: ScreensCopy;
  language: AppLanguage;
}) {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [picked, setPicked] = useState<InsurancePayer>(payers[0]);
  const [note, setNote] = useState<{ text: string; kind: "done" | "problem" } | null>(null);
  const fund = payers.includes(picked) ? picked : payers[0];

  useEffect(() => {
    void machine.reportClaims(period).then((answer) => answer.ok && setClaims(answer.value));
  }, [period]);

  const shown = claims.filter((claim) => claim.payer === fund);
  const owed = shown.reduce((sum, claim) => sum + claim.covered, 0);
  const name = fundName(fund, t);
  const file = `${t.claimsFile}-${fund}-${period.from.slice(0, 10)}`;

  /* Plain figures in the printed list, as every other list here prints them. */
  const printable = (): PrintedTable => ({
    title: `${t.claimsTitle} · ${name} · ${rangeLabel}`,
    header: [t.colNumber, t.colTime, t.colMember, t.total, t.colShare, t.colCovered],
    align: ["start", "start", "start", "end", "end", "end"],
    rows: shown.map((claim) => [
      String(claim.number),
      formatDateTime(new Date(claim.occurredAt), language),
      claim.memberNumber,
      formatMoney(claim.total, language),
      formatPercent(claim.share, language),
      formatMoney(claim.covered, language),
    ]),
    totals: ["", "", "", "", "", formatMoney(owed, language)],
  });

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{t.claimsTitle}</h2>
        <div className="flex gap-2">
          <Button
            disabled={shown.length === 0}
            onClick={() =>
              void machine.exportList(printable(), file).then((answer) => {
                if (!answer.ok) setNote({ text: t.notSaved, kind: "problem" });
                else if (answer.value) setNote({ text: fill(t.listSaved, { file: answer.value }), kind: "done" });
              })
            }
          >
            {t.export}
          </Button>
          <Button
            disabled={shown.length === 0}
            onClick={() => void machine.printList(printable(), file).then((answer) => setNote(answer.ok ? null : { text: t.listPrintFailed, kind: "problem" }))}
          >
            {t.printList}
          </Button>
        </div>
      </div>
      <p className="mt-1 text-base text-ink-3">{t.claimsNote}</p>
      {payers.length > 1 ? (
        <div className="mt-3">
          <Choices<InsurancePayer> value={fund} onChange={setPicked} options={payers.map((payer) => ({ value: payer, label: fundName(payer, t) }))} />
        </div>
      ) : null}
      {note ? <div className="mt-3"><Notice kind={note.kind} text={note.text} /></div> : null}
      {shown.length === 0 ? (
        <p className="mt-3 text-base text-ink-3">{fill(t.claimsNone, { fund: name })}</p>
      ) : (
        <div className="max-md:-mx-4 max-md:overflow-x-auto max-md:px-4">
          <table className="mt-3 w-full text-base max-md:w-max max-md:min-w-full max-md:[&_td]:pe-4 max-md:[&_th]:pe-4">
            <thead>
              <tr className="border-b-2 border-line text-ink-3">
                <th className="py-2 text-start font-normal">{t.colNumber}</th>
                <th className="py-2 text-start font-normal">{t.colTime}</th>
                <th className="py-2 text-start font-normal">{t.colMember}</th>
                <th className="py-2 text-end font-normal">{t.total}</th>
                <th className="py-2 text-end font-normal">{t.colShare}</th>
                <th className="py-2 text-end font-normal">{t.colCovered}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((claim) => (
                <tr key={claim.saleId} className="border-b border-line">
                  <td className="py-2"><bdi>{claim.number}</bdi></td>
                  <td className="py-2"><bdi>{when(claim.occurredAt, language)}</bdi></td>
                  <td className="py-2"><bdi dir="ltr">{claim.memberNumber}</bdi></td>
                  <td className="py-2 text-end"><bdi>{money(claim.total, language)}</bdi></td>
                  <td className="py-2 text-end"><bdi>{formatPercent(claim.share, language)}</bdi></td>
                  <td className="py-2 text-end font-semibold"><bdi>{money(claim.covered, language)}</bdi></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="text-lg font-bold">
                <td className="py-3" colSpan={5}>{fill(t.claimsTotal, { fund: name })}</td>
                <td className="py-3 text-end"><bdi>{money(owed, language)}</bdi></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
