import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppLanguage, Configuration } from "@app-ui/config";
import { formatQuantity } from "@app-ui/format";
import { machine, type Period, type SaleDetail, type SaleSummary, type Summary, type TopProduct } from "../bridge";
import { fill, type ScreensCopy } from "../i18n/screens";
import type { TradesCopy } from "../i18n/trades";
import { Flows } from "./warehouse";
import { Button, Choices, Confirm, Empty, Field, Notice, Panel, ScreenHeader, Stat, money, when } from "../ui";

/*
 * What the days came to.
 *
 * Kept from the old pharmacy till: the periods across the top, the takings,
 * the count and the average, voids set apart, every sale in a list with its
 * receipt and its void, and an export for the accountant. Every figure is
 * added up from the sales themselves each time the screen opens, so the
 * cards and the list under them can never disagree.
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
  const [range, setRange] = useState<Range>("today");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [top, setTop] = useState<TopProduct[]>([]);
  const [sales, setSales] = useState<SaleSummary[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [trial, setTrial] = useState<{ sales: number; creditCustomers: number; creditTotal: number; cashDifferences: number } | null>(null);

  const period = useMemo(() => periodOf(range), [range]);
  const [occupancy, setOccupancy] = useState<{ roomNights: number; sold: number; percent: number } | null>(null);
  const [routes, setRoutes] = useState<{ route: string; tickets: number; ticketTotal: number; parcels: number; parcelTotal: number }[]>([]);
  useEffect(() => {
    if (configuration.pack === "hotel") {
      const day = (iso: string) => {
        const date = new Date(iso);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      };
      void machine.occupancy(day(period.from), day(period.to)).then((answer) => answer.ok && setOccupancy(answer.value));
    }
    if (configuration.pack === "transport") void machine.routeTakings(period.from, period.to).then((answer) => answer.ok && setRoutes(answer.value));
  }, [configuration.pack, period]);

  const reload = useCallback(() => {
    void machine.reportSummary(period).then((answer) => answer.ok && setSummary(answer.value));
    void machine.reportTop(period).then((answer) => answer.ok && setTop(answer.value));
    void machine.salesBetween(period.from, period.to).then((answer) => answer.ok && setSales(answer.value));
  }, [period]);

  useEffect(reload, [reload]);
  useEffect(() => {
    if (showTrialSummary) void machine.trialSummary().then((answer) => answer.ok && setTrial(answer.value));
  }, [showTrialSummary]);

  const ranges: { value: Range; label: string }[] = [
    { value: "today", label: t.today },
    { value: "yesterday", label: t.yesterday },
    { value: "week", label: t.week },
    { value: "month", label: t.month },
    { value: "lastMonth", label: t.lastMonth },
  ];

  async function exportCsv() {
    const label = ranges.find((one) => one.value === range)?.value ?? "periode";
    const answer = await machine.reportExport(period, `OUAQT-ventes-${label}-${period.from.slice(0, 10)}.csv`);
    if (answer.ok && answer.value) setNote(fill(t.exported, { file: answer.value }));
  }

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={t.reportsTitle}>
        <Button onClick={() => void exportCsv()}>{t.export}</Button>
      </ScreenHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {showTrialSummary && trial ? (
          <div className="mb-5 rounded-lg bg-black p-5 text-white">
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

        <Choices<Range> value={range} onChange={setRange} options={ranges} />
        {note ? <div className="mt-4"><Notice kind="done" text={note} /></div> : null}

        {summary ? (
          <>
            <div className="mt-5 grid grid-cols-4 gap-3">
              <Stat label={t.net} value={money(summary.net, language)} note={t.netNote} strong />
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
              <Stat
                label={t.margin}
                value={money(summary.margin.amount, language)}
                note={
                  summary.margin.uncoveredLines > 0
                    ? fill(t.marginMissing, { count: summary.margin.uncoveredLines })
                    : fill(t.marginNote, { covered: summary.margin.coveredSales })
                }
              />
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

            {routes.length > 0 ? (
              <section className="mt-6">
                <h2 className="text-xl font-semibold">{tt.byRoute}</h2>
                <table className="mt-3 w-full text-base">
                  <thead>
                    <tr className="border-b-2 border-black/10 text-black/60">
                      <th className="py-2 text-start font-normal">{tt.route}</th>
                      <th className="py-2 text-end font-normal">{tt.tickets}</th>
                      <th className="py-2 text-end font-normal">{tt.parcelsTitle}</th>
                      <th className="py-2 text-end font-normal">{t.total}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {routes.map((row) => (
                      <tr key={row.route} className="border-b border-black/10">
                        <td className="py-2">{row.route}</td>
                        <td className="py-2 text-end"><bdi>{row.tickets}</bdi> · <bdi>{money(row.ticketTotal, language)}</bdi></td>
                        <td className="py-2 text-end"><bdi>{row.parcels}</bdi> · <bdi>{money(row.parcelTotal, language)}</bdi></td>
                        <td className="py-2 text-end font-semibold"><bdi>{money(row.ticketTotal + row.parcelTotal, language)}</bdi></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null}

            {summary.expenses.byCategory.length > 0 ? (
              <section className="mt-6">
                <h2 className="text-xl font-semibold">{tt.expensesReport}</h2>
                <dl className="mt-3 max-w-xl text-base">
                  {summary.expenses.byCategory.map((row) => (
                    <Row key={row.category} label={row.category || "—"} value={money(row.total, language)} />
                  ))}
                </dl>
              </section>
            ) : null}

            <div className="mt-6 grid grid-cols-2 gap-6">
              <section>
                <h2 className="text-xl font-semibold">{t.byPayment}</h2>
                <dl className="mt-3 text-base">
                  <Row label={t.payCash} value={money(summary.byPayment.cash, language)} />
                  <Row label={t.payMobile} value={money(summary.byPayment.mobile, language)} />
                  {summary.byApp.map((app) => (
                    <Row key={app.app} label={`· ${app.app || t.otherApp}`} value={money(app.total, language)} quiet />
                  ))}
                  {configuration.common.credit.enabled ? <Row label={t.payCredit} value={money(summary.byPayment.credit, language)} /> : null}
                  {configuration.common.credit.enabled ? (
                    <Row label={t.debtPayments} value={money(summary.debtPayments.cash + summary.debtPayments.mobile, language)} />
                  ) : null}
                </dl>
              </section>
              <section>
                <h2 className="text-xl font-semibold">{t.top}</h2>
                {top.length === 0 ? (
                  <p className="mt-3 text-base text-black/60">{t.noSales}</p>
                ) : (
                  <table className="mt-3 w-full text-base">
                    <thead>
                      <tr className="border-b-2 border-black/10 text-black/60">
                        <th className="py-2 text-start font-normal">{t.colName}</th>
                        <th className="py-2 text-end font-normal">{t.colQuantity}</th>
                        <th className="py-2 text-end font-normal">{t.colAmount}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {top.map((product) => (
                        <tr key={product.productId} className="border-b border-black/10">
                          <td className="py-2">{product.name}</td>
                          <td className="py-2 text-end"><bdi>{formatQuantity(product.quantity, language)}</bdi></td>
                          <td className="py-2 text-end"><bdi>{money(product.total, language)}</bdi></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </div>
          </>
        ) : null}

        {configuration.pack === "warehouse" ? <Flows configuration={configuration} t={t} tt={tt} /> : null}

        <h2 className="mt-8 text-xl font-semibold">{t.salesList}</h2>
        {sales.length === 0 ? (
          <Empty title={t.noSales} />
        ) : (
          <table className="mt-3 w-full text-base">
            <thead>
              <tr className="border-b-2 border-black/10 text-black/60">
                <th className="py-2 text-start font-normal">{t.colNumber}</th>
                <th className="py-2 text-start font-normal">{t.colTime}</th>
                <th className="py-2 text-start font-normal">{t.colPayment}</th>
                <th className="py-2 text-end font-normal">{t.total}</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((sale) => (
                <tr key={sale.id} onClick={() => setOpen(sale.id)} className="cursor-pointer border-b border-black/10 hover:bg-black/5">
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open ? (
        <SalePanel id={open} t={t} language={language} readOnly={readOnly} onClose={() => setOpen(null)} onChanged={reload} />
      ) : null}
    </div>
  );
}

function Row({ label, value, quiet }: { label: string; value: string; quiet?: boolean }) {
  return (
    <div className={`flex justify-between border-b border-black/10 py-2 ${quiet ? "text-black/60" : ""}`}>
      <dt>{label}</dt>
      <dd>
        <bdi>{value}</bdi>
      </dd>
    </div>
  );
}

function paymentLabel(sale: SaleSummary, t: ScreensCopy): string {
  if (sale.payment === "mobile") return sale.mobileApp ? `${t.payMobile} · ${sale.mobileApp}` : t.payMobile;
  if (sale.payment === "credit") return sale.customerName ? `${t.payCredit} · ${sale.customerName}` : t.payCredit;
  return t.payCash;
}

function SalePanel({
  id,
  t,
  language,
  readOnly,
  onClose,
  onChanged,
}: {
  id: string;
  t: ScreensCopy;
  language: AppLanguage;
  readOnly: boolean;
  onClose: () => void;
  onChanged: () => void;
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
  const reasons = t.voidReasons.split("|");
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
          <Button
            kind="primary"
            onClick={() =>
              void machine.printReceipt(sale.id).then((printed) => setNote({ text: printed.ok ? t.printed : t.notPrinted, kind: printed.ok ? "done" : "problem" }))
            }
          >
            {t.reprint}
          </Button>
        </div>
      }
    >
      <p className="text-base text-black/60">
        <bdi>{when(sale.occurredAt, language)}</bdi> · {paymentLabel(sale, t)}
        {sale.status === "voided" ? ` · ${t.voidedTag}` : ""}
        {sale.reversesNumber !== null ? ` · ${fill(t.reversalTag, { number: sale.reversesNumber })}` : ""}
      </p>
      {sale.voidReason ? <p className="mt-1 text-base">{t.voidReason} : {sale.voidReason}</p> : null}
      {note ? <div className="mt-4"><Notice kind={note.kind} text={note.text} /></div> : null}

      <ul className="mt-4">
        {sale.items.map((item, index) => (
          <li key={`${item.productId}-${index}`} className="flex items-start justify-between gap-3 border-b border-black/10 py-3">
            <span>
              <span className="block text-base font-semibold">{language === "ar" && item.nameArabic ? item.nameArabic : item.name}</span>
              <span className="block text-base text-black/60">
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
        {sale.received !== null ? <Row label={t.received} value={money(sale.received, language)} /> : null}
        {sale.received !== null ? <Row label={t.change} value={money(sale.received - sale.total, language)} /> : null}
      </dl>

      {voiding ? (
        <Confirm
          title={fill(t.voidTitle, { number: sale.number })}
          body={t.voidBody}
          yes={t.voidSale}
          no={t.cancel}
          onNo={() => setVoiding(false)}
          onYes={() => {
            if (!chosenReason) {
              setNote({ text: t.voidNeedsReason, kind: "problem" });
              setVoiding(false);
              return;
            }
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
            <div className="text-base text-black/70">{t.voidReason}</div>
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
